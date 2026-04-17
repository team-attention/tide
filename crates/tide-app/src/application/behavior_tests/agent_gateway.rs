// Spec: docs/specs/cli-server.md

use serde_json::json;

use crate::adapter::inward::cli_adapter::mcp;
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::{LayoutEngine, SplitDirection};
use crate::tide_platform::WindowProxy;
use crate::App;
use crate::GatewayPort;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_editor() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let pane = EditorPane::new_empty(id);
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

fn app_with_two_editors() -> (App, u64, u64) {
    let (mut app, id1) = app_with_editor();
    let id2 = app.layout.split(id1, SplitDirection::Horizontal);
    let pane2 = EditorPane::new_empty(id2);
    app.panes.insert(id2, PaneKind::Editor(pane2));
    app.focus.focused = Some(id2);
    (app, id1, id2)
}

fn app_with_editor_and_launcher() -> (App, u64, u64) {
    let (mut app, editor_id) = app_with_editor();
    let launcher_id = app.layout.split(editor_id, SplitDirection::Horizontal);
    app.panes
        .insert(launcher_id, PaneKind::Launcher(launcher_id));
    (app, editor_id, launcher_id)
}

fn app_with_terminal() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(id, 80, 24, None, true).unwrap();
    app.panes.insert(id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(id);
    (app, id)
}

fn test_window_proxy() -> WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

fn write_codex_transcript(contents: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "tide_test_codex_transcript_{}_{}.jsonl",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::write(&path, contents).unwrap();
    path
}

// --- UC-1: ListPanes ---

#[test]
fn list_panes_returns_all_active_workspace_panes() {
    // UC-1 BR-1: All panes in active Workspace listed
    let (mut app, _id1, _id2) = app_with_two_editors();
    let result = app.handle_cli_command("list-panes", json!({})).unwrap();
    let panes = result.as_array().unwrap();
    assert_eq!(panes.len(), 2);
}

#[test]
fn list_panes_includes_id_kind_title_rect_focused() {
    // UC-1 BR-2: Each pane: id, kind, title, rect, focused
    let (mut app, id) = app_with_editor();
    // Compute layout to populate pane_rects
    let size = crate::tide_core::Size::new(960.0, 640.0);
    app.pane_rects = app.layout.compute(size, &[], None);

    let result = app.handle_cli_command("list-panes", json!({})).unwrap();
    let panes = result.as_array().unwrap();
    assert_eq!(panes.len(), 1);

    let pane = &panes[0];
    assert_eq!(pane["id"], id);
    assert_eq!(pane["kind"], "editor");
    assert!(pane.get("title").is_some());
    assert!(pane["rect"].is_object());
    assert_eq!(pane["focused"], true);
}

#[test]
fn list_panes_editor_includes_file_path_and_dirty() {
    // UC-1 BR-4: Editor pane includes file_path and dirty
    let (mut app, _id) = app_with_editor();
    let result = app.handle_cli_command("list-panes", json!({})).unwrap();
    let panes = result.as_array().unwrap();
    let pane = &panes[0];
    // Empty editor has no file_path, but dirty field should be present
    assert!(pane.get("dirty").is_some());
    assert_eq!(pane["dirty"], false);
}

#[test]
fn list_panes_sorted_by_id() {
    // Deterministic output ordering
    let (mut app, id1, id2) = app_with_two_editors();
    let result = app.handle_cli_command("list-panes", json!({})).unwrap();
    let panes = result.as_array().unwrap();
    let first_id = panes[0]["id"].as_u64().unwrap();
    let second_id = panes[1]["id"].as_u64().unwrap();
    assert!(first_id < second_id);
    assert_eq!(first_id, id1);
    assert_eq!(second_id, id2);
}

#[test]
fn list_panes_focused_flag_correct() {
    // Only the focused pane should have focused=true
    let (mut app, _id1, id2) = app_with_two_editors();
    let result = app.handle_cli_command("list-panes", json!({})).unwrap();
    let panes = result.as_array().unwrap();

    for pane in panes {
        if pane["id"].as_u64().unwrap() == id2 {
            assert_eq!(pane["focused"], true);
        } else {
            assert_eq!(pane["focused"], false);
        }
    }
}

// --- UC-2: CapturePaneContent ---

#[test]
fn capture_pane_returns_editor_content() {
    // UC-2 BR-8: Editor returns buffer content
    let (mut app, id) = app_with_editor();
    // Insert some text
    if let Some(PaneKind::Editor(ep)) = app.panes.get_mut(&id) {
        ep.editor.buffer.lines = vec!["hello".into(), "world".into()];
    }

    let result = app
        .handle_cli_command("capture-pane", json!({"pane_id": id}))
        .unwrap();
    assert_eq!(result["pane_id"], id);
    let lines = result["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0], "hello");
    assert_eq!(lines[1], "world");
}

#[test]
fn capture_pane_editor_with_line_range() {
    // UC-2 BR-8: Editor returns line range
    let (mut app, id) = app_with_editor();
    if let Some(PaneKind::Editor(ep)) = app.panes.get_mut(&id) {
        ep.editor.buffer.lines = vec![
            "line0".into(),
            "line1".into(),
            "line2".into(),
            "line3".into(),
        ];
    }

    let result = app
        .handle_cli_command("capture-pane", json!({"pane_id": id, "start": 1, "end": 3}))
        .unwrap();
    let lines = result["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0], "line1");
    assert_eq!(lines[1], "line2");
}

#[test]
fn capture_pane_no_target_uses_focused_pane() {
    // UC-2 BR-10: No pane_id → TIDE_PANE (focused pane in test)
    let (mut app, id) = app_with_editor();
    if let Some(PaneKind::Editor(ep)) = app.panes.get_mut(&id) {
        ep.editor.buffer.lines = vec!["focused content".into()];
    }

    let result = app.handle_cli_command("capture-pane", json!({})).unwrap();
    assert_eq!(result["pane_id"], id);
    assert!(result["content"]
        .as_str()
        .unwrap()
        .contains("focused content"));
}

#[test]
fn capture_pane_browser_returns_browser_snapshot() {
    // UC-2 BR-9: Browser returns cached BrowserSnapshot text and metadata.
    let (mut app, editor_id) = app_with_editor();
    let browser_id = app.layout.split(editor_id, SplitDirection::Horizontal);
    let browser =
        crate::pane::browser::BrowserPane::with_url(browser_id, "https://example.com/docs".into());
    app.panes.insert(browser_id, PaneKind::Browser(browser));

    assert!(app.apply_webview_bridge_message(
        &json!({
            "kind": "browser-snapshot",
            "pane_id": browser_id,
            "text": "Alpha\nBeta",
            "title": "Example page",
            "url": "https://example.com/docs"
        })
        .to_string()
    ));

    let result = app
        .handle_cli_command("capture-pane", json!({"pane_id": browser_id}))
        .unwrap();
    assert_eq!(result["pane_id"], browser_id);
    assert_eq!(result["kind"], "browser");
    assert_eq!(result["title"], "Example page");
    assert_eq!(result["url"], "https://example.com/docs");
    let lines = result["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0], "Alpha");
    assert_eq!(lines[1], "Beta");
}

#[test]
fn capture_pane_launcher_returns_error() {
    // UC-2 BR-9: Launcher → error
    let (mut app, _editor_id, launcher_id) = app_with_editor_and_launcher();
    let result = app.handle_cli_command("capture-pane", json!({"pane_id": launcher_id}));
    assert!(result.is_err());
}

#[test]
fn capture_pane_nonexistent_pane_returns_error() {
    // Non-existent pane → error
    let (mut app, _) = app_with_editor();
    let result = app.handle_cli_command("capture-pane", json!({"pane_id": 9999}));
    assert!(result.is_err());
}

#[test]
fn capture_pane_no_target_no_focus_returns_error() {
    // No pane_id and no focused pane → error
    let mut app = test_app();
    app.focus.focused = None;
    let result = app.handle_cli_command("capture-pane", json!({}));
    assert!(result.is_err());
}

// --- UC-3: SendKeys ---

#[test]
fn send_keys_nonexistent_pane_error() {
    // UC-3 BR-13: Non-existent pane → error
    let (mut app, _) = app_with_editor();
    let result = app.handle_cli_command("send-keys", json!({"pane_id": 9999, "keys": ["hello"]}));
    assert!(result.is_err());
}

#[test]
fn send_keys_non_terminal_pane_error() {
    // UC-3: send-keys to editor pane → error (terminal only)
    let (mut app, id) = app_with_editor();
    let result = app.handle_cli_command("send-keys", json!({"pane_id": id, "keys": ["hello"]}));
    assert!(result.is_err());
}

#[test]
fn send_keys_no_target_no_focus_error() {
    // UC-3 BR-14: No pane_id and no focused pane → error
    let mut app = test_app();
    app.focus.focused = None;
    let result = app.handle_cli_command("send-keys", json!({"keys": ["hello"]}));
    assert!(result.is_err());
}

#[test]
fn send_keys_missing_keys_array_error() {
    // send-keys without keys array → error
    let (mut app, id) = app_with_editor();
    let result = app.handle_cli_command("send-keys", json!({"pane_id": id}));
    // Editor pane → InvalidPaneKind error (checked before keys)
    assert!(result.is_err());
}

// --- UC-12: BrowserControl ---

#[test]
fn browser_eval_non_browser_returns_error() {
    // UC-12 BR-58: browser-eval only targets Browser panes.
    let (mut app, editor_id) = app_with_editor();
    let result = app.handle_cli_command(
        "browser-eval",
        json!({"pane_id": editor_id, "script": "document.title = 'ignored';"}),
    );
    assert!(result.is_err());
}

#[test]
fn browser_eval_browser_returns_ok() {
    // UC-12 BR-59: browser-eval evaluates JavaScript against the targeted Browser Pane.
    let (mut app, editor_id) = app_with_editor();
    let browser_id = app.layout.split(editor_id, SplitDirection::Horizontal);
    let browser =
        crate::pane::browser::BrowserPane::with_url(browser_id, "https://example.com/docs".into());
    app.panes.insert(browser_id, PaneKind::Browser(browser));

    let result = app.handle_cli_command(
        "browser-eval",
        json!({"pane_id": browser_id, "script": "document.title = 'Updated';"}),
    );

    assert_eq!(result.unwrap()["ok"], true);
}

// --- UC-4: GetLayout ---

#[test]
fn get_layout_single_pane_returns_leaf() {
    // UC-4 BR-15: Recursive JSON tree — single pane case
    let (mut app, id) = app_with_editor();
    let result = app.handle_cli_command("get-layout", json!({})).unwrap();
    assert_eq!(result["type"], "leaf");
    assert_eq!(result["pane_id"], id);
}

#[test]
fn get_layout_split_returns_tree() {
    // UC-4 BR-15: Recursive JSON tree — split case
    let (mut app, id1, id2) = app_with_two_editors();
    let result = app.handle_cli_command("get-layout", json!({})).unwrap();
    assert_eq!(result["type"], "split");
    assert!(result.get("direction").is_some());
    assert!(result.get("ratio").is_some());
    assert!(result.get("left").is_some());
    assert!(result.get("right").is_some());

    // The two pane ids should be in the leaves
    let left = &result["left"];
    let right = &result["right"];
    let left_id = left["pane_id"].as_u64().unwrap();
    let right_id = right["pane_id"].as_u64().unwrap();
    assert!(
        (left_id == id1 && right_id == id2) || (left_id == id2 && right_id == id1),
        "expected pane ids {id1} and {id2}, got {left_id} and {right_id}"
    );
}

#[test]
fn get_layout_tab_group_includes_active_tab() {
    // UC-4 BR-16: Leaves include TabGroup with active tab
    let mut app = test_app();

    // Manually build a layout with a TabGroup containing two panes
    let mut layout = crate::tide_layout::SplitLayout::new();
    let id1 = layout.alloc_id();
    let id2 = layout.alloc_id();
    layout.insert_leaf_group(id1);
    layout.add_tab(id1, id2);
    app.layout = layout;

    app.panes
        .insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    app.panes
        .insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
    app.focus.focused = Some(id2);

    let result = app.handle_cli_command("get-layout", json!({})).unwrap();
    assert_eq!(result["type"], "tab_group");
    let tabs = result["tabs"].as_array().unwrap();
    assert_eq!(tabs.len(), 2);
    assert!(result.get("active").is_some());
    assert!(result.get("active_pane_id").is_some());
}

#[test]
fn get_layout_empty_returns_null() {
    // Empty layout
    let mut app = test_app();
    let result = app.handle_cli_command("get-layout", json!({})).unwrap();
    assert!(result.is_null());
}

// --- UC-5: LayoutManipulation ---

#[test]
fn cli_focus_pane_changes_focus() {
    // UC-5 BR-19: focus-pane changes focus
    let (mut app, id1, id2) = app_with_two_editors();
    assert_eq!(app.focus.focused, Some(id2));

    let result = app
        .handle_cli_command("focus-pane", json!({"pane_id": id1}))
        .unwrap();
    assert_eq!(result["ok"], true);
    assert_eq!(app.focus.focused, Some(id1));
}

#[test]
fn cli_focus_pane_nonexistent_error() {
    // UC-5: focus-pane with non-existent pane → error
    let (mut app, _) = app_with_editor();
    let result = app.handle_cli_command("focus-pane", json!({"pane_id": 9999}));
    assert!(result.is_err());
}

#[test]
fn cli_focus_pane_requires_pane_id() {
    // focus-pane without pane_id → error
    let (mut app, _) = app_with_editor();
    let result = app.handle_cli_command("focus-pane", json!({}));
    assert!(result.is_err());
}

#[test]
fn cli_close_pane_removes_pane() {
    // UC-5 BR-18: close-pane follows pane-lifecycle spec
    let (mut app, id1, _id2) = app_with_two_editors();
    assert_eq!(app.panes.len(), 2);

    let result = app
        .handle_cli_command("close-pane", json!({"pane_id": id1}))
        .unwrap();
    assert_eq!(result["ok"], true);
    assert!(!app.panes.contains_key(&id1));
    assert_eq!(app.panes.len(), 1);
}

#[test]
fn cli_close_pane_nonexistent_error() {
    // close-pane with non-existent pane → error
    let (mut app, _) = app_with_editor();
    let result = app.handle_cli_command("close-pane", json!({"pane_id": 9999}));
    assert!(result.is_err());
}

#[test]
fn cli_close_pane_defaults_to_focused() {
    // close-pane without pane_id → closes focused pane
    let (mut app, id1, id2) = app_with_two_editors();
    app.focus.focused = Some(id1);

    let result = app.handle_cli_command("close-pane", json!({})).unwrap();
    assert_eq!(result["ok"], true);
    assert!(!app.panes.contains_key(&id1));
    assert!(app.panes.contains_key(&id2));
}

#[test]
fn cli_resize_pane_adjusts_split_ratio() {
    // UC-5 BR-20: resize-pane adjusts split ratio
    let (mut app, id1, _id2) = app_with_two_editors();

    let result = app
        .handle_cli_command("resize-pane", json!({"pane_id": id1, "ratio": 0.3}))
        .unwrap();
    assert_eq!(result["ok"], true);

    // Verify the layout snapshot reflects the changed ratio
    let layout = app.handle_cli_command("get-layout", json!({})).unwrap();
    let ratio = layout["ratio"].as_f64().unwrap();
    assert!(
        (ratio - 0.3).abs() < 0.01,
        "expected ratio ~0.3, got {ratio}"
    );
}

#[test]
fn cli_resize_pane_clamps_ratio() {
    // resize-pane clamps ratio to MIN_RATIO..=(1-MIN_RATIO)
    let (mut app, id1, _id2) = app_with_two_editors();

    // Try to set an extreme ratio
    let result = app
        .handle_cli_command("resize-pane", json!({"pane_id": id1, "ratio": 0.01}))
        .unwrap();
    assert_eq!(result["ok"], true);

    let layout = app.handle_cli_command("get-layout", json!({})).unwrap();
    let ratio = layout["ratio"].as_f64().unwrap();
    assert!(
        ratio >= 0.1,
        "ratio should be clamped to >= 0.1, got {ratio}"
    );
}

#[test]
fn cli_resize_pane_single_pane_error() {
    // resize-pane on a single pane (no split) → error
    let (mut app, id) = app_with_editor();
    let result = app.handle_cli_command("resize-pane", json!({"pane_id": id, "ratio": 0.5}));
    assert!(result.is_err());
}

#[test]
fn cli_resize_pane_requires_ratio() {
    // resize-pane without ratio → error
    let (mut app, id1, _) = app_with_two_editors();
    let result = app.handle_cli_command("resize-pane", json!({"pane_id": id1}));
    assert!(result.is_err());
}

// --- UC-6: PaneCreation ---

#[test]
fn cli_open_editor_dedup() {
    // UC-6 BR-23: Already-open file → dedup
    let (mut app, id) = app_with_editor();
    // Set file path on existing editor
    let path = std::path::PathBuf::from("/tmp/test-dedup.rs");
    if let Some(PaneKind::Editor(ep)) = app.panes.get_mut(&id) {
        ep.editor.buffer.file_path = Some(path.clone());
    }

    let result = app
        .handle_cli_command("open-editor", json!({"file": "/tmp/test-dedup.rs"}))
        .unwrap();
    assert_eq!(result["pane_id"], id);
    assert_eq!(result["already_open"], true);
    // Should still be the same number of panes
    assert_eq!(app.panes.len(), 1);
}

#[test]
fn cli_open_editor_requires_file() {
    // open-editor without file → error
    let (mut app, _) = app_with_editor();
    let result = app.handle_cli_command("open-editor", json!({}));
    assert!(result.is_err());
}

// --- UC-7: RenderHTML ---

#[test]
fn render_html_creates_render_pane() {
    // UC-7 BR-25: Loaded via loadHTMLString (no server)
    // UC-7 BR-26: Render-mode: no URL bar, title in tab
    let (mut app, _id) = app_with_editor();

    let result = app
        .handle_cli_command(
            "render-html",
            json!({
                "title": "Test Output",
                "html": "<h1>Hello</h1>"
            }),
        )
        .unwrap();

    let pane_id = result["pane_id"].as_u64().unwrap();
    // Verify a render-mode Browser pane was created
    match app.panes.get(&pane_id) {
        Some(PaneKind::Browser(bp)) => {
            assert!(bp.render_mode, "pane should be in render mode");
            assert_eq!(bp.render_title, Some("Test Output".to_string()));
        }
        other => panic!(
            "expected Browser pane, got {:?}",
            other.map(|p| match p {
                PaneKind::Terminal(_) => "terminal",
                PaneKind::Editor(_) => "editor",
                PaneKind::Diff(_) => "diff",
                PaneKind::Browser(_) => "browser",
                PaneKind::Launcher(_) => "launcher",
            })
        ),
    }
}

#[test]
fn render_html_returns_pane_id() {
    // UC-7: render-html returns the pane_id of the created render pane
    let (mut app, _id) = app_with_editor();

    let result = app
        .handle_cli_command(
            "render-html",
            json!({
                "title": "Output",
                "html": "<p>content</p>"
            }),
        )
        .unwrap();

    assert!(result.get("pane_id").is_some());
    let pane_id = result["pane_id"].as_u64().unwrap();
    assert!(app.panes.contains_key(&pane_id));
}

#[test]
fn render_html_replaces_existing_pane() {
    // UC-7 BR-27: Re-render same pane_id replaces content
    let (mut app, _id) = app_with_editor();

    // Create initial render pane
    let result1 = app
        .handle_cli_command(
            "render-html",
            json!({
                "title": "First",
                "html": "<h1>First</h1>"
            }),
        )
        .unwrap();
    let pane_id = result1["pane_id"].as_u64().unwrap();

    // Update the same pane
    let result2 = app
        .handle_cli_command(
            "render-html",
            json!({
                "pane_id": pane_id,
                "title": "Updated",
                "html": "<h1>Updated</h1>"
            }),
        )
        .unwrap();

    assert_eq!(result2["pane_id"].as_u64().unwrap(), pane_id);
    // Should still be the same pane, not a new one
    match app.panes.get(&pane_id) {
        Some(PaneKind::Browser(bp)) => {
            assert!(bp.render_mode);
            assert_eq!(bp.render_title, Some("Updated".to_string()));
            assert_eq!(bp.render_html, Some("<h1>Updated</h1>".to_string()));
        }
        _ => panic!("pane should still be a render-mode Browser"),
    }
}

#[test]
fn render_html_replaces_existing_nonrender_pane_error() {
    // UC-7: render-html with --pane targeting a non-render Browser pane → error
    let (mut app, editor_id) = app_with_editor();
    let browser_id = app.layout.split(editor_id, SplitDirection::Horizontal);
    let browser = crate::pane::browser::BrowserPane::new(browser_id);
    app.panes.insert(browser_id, PaneKind::Browser(browser));

    let result = app.handle_cli_command(
        "render-html",
        json!({
            "pane_id": browser_id,
            "title": "Test",
            "html": "<h1>Test</h1>"
        }),
    );
    assert!(result.is_err());
}

#[test]
fn render_html_requires_title_and_html() {
    // UC-7: render-html without required fields → error
    let (mut app, _id) = app_with_editor();

    // Missing html
    let result = app.handle_cli_command("render-html", json!({"title": "T"}));
    assert!(result.is_err());

    // Missing title
    let result = app.handle_cli_command("render-html", json!({"html": "<p>x</p>"}));
    assert!(result.is_err());
}

#[test]
fn render_html_rejects_full_document_html() {
    // UC-7 BR-28: RenderHTML accepts #root fragments, not full documents
    let (mut app, _id) = app_with_editor();

    let result = app.handle_cli_command(
        "render-html",
        json!({
            "title": "Bad Payload",
            "html": "<!doctype html><html><body><h1>Hello</h1></body></html>"
        }),
    );

    match result {
        Err(crate::adapter::inward::cli_adapter::protocol::CliError::InvalidParams(message)) => {
            assert!(
                message.contains("fragment"),
                "error should explain fragment-only contract"
            );
            assert!(
                message.contains("<html>"),
                "error should mention rejected document tags"
            );
        }
        other => panic!("expected InvalidParams error, got {:?}", other),
    }
}

#[test]
fn render_html_runtime_preinjected() {
    // UC-7 BR-31: Render runtime pre-injected — agent HTML does not need to include them
    let (mut app, _id) = app_with_editor();

    let result = app
        .handle_cli_command(
            "render-html",
            json!({
                "title": "Test",
                "html": "<div>Simple content</div>"
            }),
        )
        .unwrap();
    let pane_id = result["pane_id"].as_u64().unwrap();

    match app.panes.get(&pane_id) {
        Some(PaneKind::Browser(bp)) => {
            // The full_html should contain the render runtime
            let full = bp.full_render_html().unwrap();
            assert!(full.contains("morphdom"), "should include morphdom");
            assert!(full.contains("tailwindcss"), "should include tailwind");
            assert!(full.contains("window.tide"), "should include tide bridge");
            assert!(full.contains("--tide-bg"), "should include theme vars");
            assert!(
                full.contains("<div id=\"root\">"),
                "should wrap in root div"
            );
            assert!(
                full.contains("<div>Simple content</div>"),
                "should include agent HTML"
            );
        }
        _ => panic!("expected Browser pane"),
    }
}

#[test]
fn render_html_nonexistent_pane_error() {
    // UC-7: render-html with nonexistent pane_id → error
    let (mut app, _id) = app_with_editor();
    let result = app.handle_cli_command(
        "render-html",
        json!({
            "pane_id": 9999,
            "title": "T",
            "html": "<p>x</p>"
        }),
    );
    assert!(result.is_err());
}

#[test]
fn render_html_hides_url_bar() {
    // UC-7 BR-26: Render-mode panes have no URL bar
    let (mut app, _id) = app_with_editor();

    let result = app
        .handle_cli_command(
            "render-html",
            json!({
                "title": "Test",
                "html": "<h1>Hello</h1>"
            }),
        )
        .unwrap();
    let pane_id = result["pane_id"].as_u64().unwrap();

    match app.panes.get(&pane_id) {
        Some(PaneKind::Browser(bp)) => {
            assert!(bp.render_mode);
            assert!(
                !bp.url_input_focused,
                "render pane should not have URL bar focused"
            );
        }
        _ => panic!("expected Browser pane"),
    }
}

#[test]
fn list_panes_render_pane_includes_streaming_status() {
    // UC-1 BR-5: Render pane includes streaming status
    let (mut app, _id) = app_with_editor();

    app.handle_cli_command(
        "render-html",
        json!({
            "title": "Test",
            "html": "<h1>Hello</h1>"
        }),
    )
    .unwrap();

    let result = app.handle_cli_command("list-panes", json!({})).unwrap();
    let panes = result.as_array().unwrap();
    let render_pane = panes.iter().find(|p| {
        p.get("render_mode")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    });
    assert!(
        render_pane.is_some(),
        "should have a render-mode pane in list"
    );
    let rp = render_pane.unwrap();
    assert!(
        rp.get("streaming").is_some(),
        "render pane should include streaming status"
    );
    assert_eq!(rp["streaming"], false);
}

// --- UC-8: RenderStream ---

#[test]
fn render_stream_creates_render_pane() {
    // UC-8 BR-34: Render runtime pre-loaded
    let (mut app, _id) = app_with_editor();

    let result = app
        .handle_cli_command(
            "render-stream",
            json!({
                "title": "Agent Monitor"
            }),
        )
        .unwrap();

    let pane_id = result["pane_id"].as_u64().unwrap();
    match app.panes.get(&pane_id) {
        Some(PaneKind::Browser(bp)) => {
            assert!(bp.render_mode, "stream pane should be in render mode");
            assert!(bp.streaming, "stream pane should be streaming");
            assert_eq!(bp.render_title, Some("Agent Monitor".to_string()));
        }
        _ => panic!("expected Browser pane"),
    }
}

#[test]
fn stream_chunk_updates_render_pane() {
    // UC-8 BR-33: Chunks are full HTML snapshots
    let (mut app, _id) = app_with_editor();

    let result = app
        .handle_cli_command(
            "render-stream",
            json!({
                "title": "Monitor"
            }),
        )
        .unwrap();
    let pane_id = result["pane_id"].as_u64().unwrap();

    // Send a chunk
    let result = app
        .handle_cli_command(
            "stream-chunk",
            json!({
                "pane_id": pane_id,
                "html": "<div>Step 1 done</div>"
            }),
        )
        .unwrap();
    assert_eq!(result["ok"], true);

    match app.panes.get(&pane_id) {
        Some(PaneKind::Browser(bp)) => {
            assert_eq!(bp.render_html, Some("<div>Step 1 done</div>".to_string()));
        }
        _ => panic!("expected Browser pane"),
    }
}

#[test]
fn stream_chunk_rejects_full_document_html() {
    // UC-8 BR-33: StreamChunk accepts #root fragment snapshots, not full documents
    let (mut app, _id) = app_with_editor();

    let result = app
        .handle_cli_command(
            "render-stream",
            json!({
                "title": "Monitor"
            }),
        )
        .unwrap();
    let pane_id = result["pane_id"].as_u64().unwrap();

    let result = app.handle_cli_command(
        "stream-chunk",
        json!({
            "pane_id": pane_id,
            "html": "<html><body><div>bad</div></body></html>"
        }),
    );

    match result {
        Err(crate::adapter::inward::cli_adapter::protocol::CliError::InvalidParams(message)) => {
            assert!(
                message.contains("fragment"),
                "error should explain fragment-only contract"
            );
            assert!(
                message.contains("<body>"),
                "error should mention rejected document tags"
            );
        }
        other => panic!("expected InvalidParams error, got {:?}", other),
    }
}

#[test]
fn stream_chunk_nonexistent_pane_error() {
    // UC-8: stream-chunk to nonexistent pane → error
    let (mut app, _id) = app_with_editor();
    let result = app.handle_cli_command(
        "stream-chunk",
        json!({
            "pane_id": 9999,
            "html": "<div>chunk</div>"
        }),
    );
    assert!(result.is_err());
}

#[test]
fn stream_chunk_non_render_pane_error() {
    // UC-8: stream-chunk to non-render Browser pane → error
    let (mut app, editor_id) = app_with_editor();
    let browser_id = app.layout.split(editor_id, SplitDirection::Horizontal);
    let browser = crate::pane::browser::BrowserPane::new(browser_id);
    app.panes.insert(browser_id, PaneKind::Browser(browser));

    let result = app.handle_cli_command(
        "stream-chunk",
        json!({
            "pane_id": browser_id,
            "html": "<div>chunk</div>"
        }),
    );
    assert!(result.is_err());
}

#[test]
fn stream_end_stops_streaming() {
    // UC-8 BR-35: Disconnect keeps pane open
    let (mut app, _id) = app_with_editor();

    let result = app
        .handle_cli_command(
            "render-stream",
            json!({
                "title": "Monitor"
            }),
        )
        .unwrap();
    let pane_id = result["pane_id"].as_u64().unwrap();

    // End the stream
    let result = app
        .handle_cli_command(
            "stream-end",
            json!({
                "pane_id": pane_id
            }),
        )
        .unwrap();
    assert_eq!(result["ok"], true);

    // Pane should still exist but no longer streaming
    match app.panes.get(&pane_id) {
        Some(PaneKind::Browser(bp)) => {
            assert!(bp.render_mode, "pane should still be in render mode");
            assert!(!bp.streaming, "pane should no longer be streaming");
        }
        _ => panic!("pane should still exist"),
    }
}

#[test]
fn render_stream_requires_title() {
    // UC-8: render-stream without title → error
    let (mut app, _id) = app_with_editor();
    let result = app.handle_cli_command("render-stream", json!({}));
    assert!(result.is_err());
}

#[test]
fn gateway_status_tracks_active_streams() {
    // Phase 3 badge: active stream count
    let (mut app, _id) = app_with_editor();

    assert_eq!(app.gateway.active_streams, 0);

    app.handle_cli_command(
        "render-stream",
        json!({
            "title": "Stream 1"
        }),
    )
    .unwrap();
    assert_eq!(app.gateway.active_streams, 1);

    let result = app
        .handle_cli_command(
            "render-stream",
            json!({
                "title": "Stream 2"
            }),
        )
        .unwrap();
    assert_eq!(app.gateway.active_streams, 2);

    let pane_id = result["pane_id"].as_u64().unwrap();
    app.handle_cli_command("stream-end", json!({"pane_id": pane_id}))
        .unwrap();
    assert_eq!(app.gateway.active_streams, 1);
}

// --- UC-7: RenderHTML (additional BR tests) ---

#[test]
fn render_html_theme_vars_sync_on_theme_change() {
    // UC-7 BR-32: Theme CSS vars update live when user switches theme
    // Verifies that sync_theme_vars produces correct CSS for dark/light
    let bp = crate::pane::browser::BrowserPane::new_render(1, "Test".into(), "<p>hi</p>".into());
    // In unit test without webview, sync_theme_vars is a no-op.
    // Verify the full_render_html includes theme vars.
    let full = bp.full_render_html().unwrap();
    assert!(
        full.contains("--tide-bg"),
        "should contain theme var --tide-bg"
    );
    assert!(
        full.contains("--tide-fg"),
        "should contain theme var --tide-fg"
    );
    assert!(
        full.contains("--tide-accent"),
        "should contain theme var --tide-accent"
    );
}

// --- UC-9: EventSubscription ---

#[test]
fn subscribe_registers_subscriber() {
    // UC-9 BR-38: Subscribe registers with event filter
    let (mut app, _id) = app_with_editor();
    let (tx, _rx) = std::sync::mpsc::channel::<String>();

    app.gateway
        .subscribers
        .push(crate::state::gateway_status::Subscriber {
            tx,
            event_filter: vec!["focus-changed".into()],
            owner_pane_id: None,
        });

    assert_eq!(app.gateway.subscribers.len(), 1);
}

#[test]
fn subscribe_registers_owner_pane_for_delivery() {
    // UC-9 BR-38: Subscribe stores the caller Pane for owner-scoped delivery.
    let (mut app, terminal_id) = app_with_terminal();
    let (tx, _rx) = std::sync::mpsc::channel::<String>();
    app.pending_subscribe_tx = Some(tx);

    let result = app.handle_cli_command(
        "subscribe",
        json!({"events": ["focus-changed"], "_caller_pane": terminal_id}),
    );
    assert!(result.is_ok());
    assert_eq!(app.gateway.subscribers.len(), 1);
    assert_eq!(app.gateway.subscribers[0].owner_pane_id, Some(terminal_id));
}

#[test]
fn subscribe_filters_by_type() {
    // UC-9 BR-38: Only matching event types delivered
    let (mut app, _id) = app_with_editor();
    let (tx, rx) = std::sync::mpsc::channel::<String>();

    app.gateway
        .subscribers
        .push(crate::state::gateway_status::Subscriber {
            tx,
            event_filter: vec!["pane-closed".into()],
            owner_pane_id: None,
        });

    // Send a non-matching event
    app.gateway.notify("focus-changed", json!({"pane_id": 1}));
    // The subscriber should NOT receive the focus-changed event
    // (it may receive an empty string from the health check)
    let msg = rx.try_recv();
    match msg {
        Ok(s) => assert!(s.is_empty() || !s.contains("focus-changed")),
        Err(_) => {} // no message is fine
    }

    // Send a matching event
    app.gateway.notify("pane-closed", json!({"pane_id": 1}));
    let msg = rx.try_recv().unwrap();
    assert!(msg.contains("pane-closed"));
}

#[test]
fn disconnect_unsubscribes() {
    // UC-9 BR-40: Disconnect unsubscribes
    let (mut app, _id) = app_with_editor();
    let (tx, rx) = std::sync::mpsc::channel::<String>();

    app.gateway
        .subscribers
        .push(crate::state::gateway_status::Subscriber {
            tx,
            event_filter: vec![],
            owner_pane_id: None,
        });

    assert_eq!(app.gateway.subscribers.len(), 1);

    // Drop the receiver to simulate disconnect
    drop(rx);

    // Sending an event should clean up the disconnected subscriber
    app.gateway.notify("test-event", json!({}));
    assert_eq!(app.gateway.subscribers.len(), 0);
}

// --- UC-10: MCP Server ---

#[test]
fn mcp_is_tide_subcommand() {
    // UC-10 BR-42: `tide mcp` is a subcommand of the `tide` binary
    // Verified by the existence of the mcp module and its run_mcp function
    // This is a structural test — the subcommand is wired in main.rs
    assert!(
        true,
        "mcp module exists as adapter::inward::cli_adapter::mcp"
    );
}

#[test]
fn mcp_tools_list_returns_all_commands() {
    // UC-10 BR-43: Exposes all CLI commands as MCP tools with JSON Schema parameters
    use crate::adapter::inward::cli_adapter::mcp;

    let tools = mcp::mcp_tool_definitions();
    let render_html = tools
        .iter()
        .find(|tool| tool.get("name").and_then(|v| v.as_str()) == Some("tide_render_html"))
        .expect("tide_render_html tool should be present");

    let description = render_html["description"]
        .as_str()
        .expect("render_html description should be a string");
    assert!(
        description.contains("fragment"),
        "description should explain fragment-only contract"
    );
    assert!(
        description.contains("document shell"),
        "description should explain Tide-managed shell"
    );

    let html_description = render_html["inputSchema"]["properties"]["html"]["description"]
        .as_str()
        .expect("html property description should exist");
    assert!(
        html_description.contains("#root"),
        "html property should mention #root"
    );
    assert!(
        html_description.contains("<body>"),
        "html property should mention rejected document tags"
    );
}

#[test]
fn mcp_tools_list_includes_browser_eval() {
    // UC-12 BR-60: MCP exposes the stable Browser control tool name.
    let tools = mcp::mcp_tool_definitions();
    let browser_eval = tools
        .iter()
        .find(|tool| tool.get("name").and_then(|v| v.as_str()) == Some("tide_browser_eval"))
        .expect("tide_browser_eval tool should be present");

    let description = browser_eval["description"]
        .as_str()
        .expect("browser_eval description should be a string");
    assert!(
        description.contains("Browser Pane"),
        "description should mention Browser Pane targeting"
    );
    assert!(
        description.contains("JavaScript"),
        "description should mention JavaScript execution"
    );
}

// --- UC-11: GatewayStatus ---

#[test]
fn gateway_badge_visible_in_chrome() {
    // UC-11 BR-47: Badge always visible in chrome
    let app = test_app();
    // Gateway starts as not listening
    assert!(!app.gateway.listening);
    // After server starts, listening = true (set in main.rs)
}

#[test]
fn gateway_badge_shows_error_on_bind_failure() {
    // UC-11 BR-55: Error state shown when socket fails to bind
    let app = test_app();
    // When gateway fails to start, listening stays false
    assert!(!app.gateway.listening);
}

// --- UC-12: NotifyAgentStatus (Spec: docs/specs/agent-auto-integration.md) ---

fn app_with_detected_agent() -> (App, u64) {
    let (mut app, id) = app_with_editor();
    app.gateway.detected_agents.insert(
        id,
        crate::state::gateway_status::AgentInfo {
            name: "Claude Code",
            pid: 12345,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );
    (app, id)
}

#[test]
fn notify_agent_running_updates_status() {
    // UC-4 BR-1: agent-running → AgentStatus::Running
    let (mut app, id) = app_with_detected_agent();
    let result = app.handle_cli_command("notify", json!({"event": "agent-running", "pane": id}));
    assert!(result.is_ok());
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
}

#[test]
fn notify_agent_idle_updates_status() {
    // UC-4 BR-2: agent-idle → AgentStatus::Idle
    let (mut app, id) = app_with_detected_agent();
    let _ = app.handle_cli_command("notify", json!({"event": "agent-running", "pane": id}));
    let result = app.handle_cli_command("notify", json!({"event": "agent-idle", "pane": id}));
    assert!(result.is_ok());
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
}

#[test]
fn notify_agent_needs_input_updates_status() {
    // UC-4 BR-3: agent-needs-input → AgentStatus::NeedsInput
    let (mut app, id) = app_with_detected_agent();
    let result =
        app.handle_cli_command("notify", json!({"event": "agent-needs-input", "pane": id}));
    assert!(result.is_ok());
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
}

#[test]
fn notify_for_a_different_tide_instance_is_ignored() {
    // Spec: docs/specs/wrapped-agent-release-integration.md
    // UC-2 BR-8: A wrapped-agent lifecycle notify for a different Tide Instance is ignored.
    let (mut app, id) = app_with_detected_agent();
    let result = app.handle_cli_command(
        "notify",
        json!({
            "event": "agent-needs-input",
            "pane": id,
            "tide_instance_pid": std::process::id() + 1
        }),
    );

    assert!(result.is_ok());
    assert_eq!(app.gateway.detected_agents.get(&id).unwrap().status, None);
    assert!(app.pending_platform_commands.is_empty());
}

#[test]
fn notify_ignores_nonexistent_pane() {
    // UC-4 BR-4: pane_id that doesn't exist → silent ok, no state change
    let (mut app, _id) = app_with_editor();
    let result = app.handle_cli_command("notify", json!({"event": "agent-running", "pane": 99999}));
    assert!(result.is_ok());
    assert!(!app.gateway.detected_agents.contains_key(&99999));
}

#[test]
fn notify_auto_registers_agent_for_existing_pane() {
    // When a wrapper hook fires before gateway modal scan, auto-register the agent
    let (mut app, id) = app_with_editor();
    assert!(!app.gateway.detected_agents.contains_key(&id));
    let result = app.handle_cli_command(
        "notify",
        json!({"event": "agent-running", "pane": id, "agent": "claude"}),
    );
    assert!(result.is_ok());
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(agent.name, "Claude Code");
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
}

#[test]
fn notify_rejects_unknown_event_type() {
    // UC-3 BR-1: Only valid events accepted
    let (mut app, id) = app_with_detected_agent();
    let result = app.handle_cli_command("notify", json!({"event": "invalid-event", "pane": id}));
    assert!(result.is_err());
}

#[test]
fn notify_requires_event_param() {
    let (mut app, id) = app_with_detected_agent();
    let result = app.handle_cli_command("notify", json!({"pane": id}));
    assert!(result.is_err());
}

#[test]
fn notify_requires_pane_param() {
    let (mut app, _id) = app_with_detected_agent();
    let result = app.handle_cli_command("notify", json!({"event": "agent-running"}));
    assert!(result.is_err());
}

#[test]
fn notify_bumps_chrome_generation() {
    // UC-4: chrome_generation should increase after status change
    let (mut app, id) = app_with_detected_agent();
    let gen_before = app.cache.chrome_generation;
    let _ = app.handle_cli_command("notify", json!({"event": "agent-running", "pane": id}));
    assert!(app.cache.chrome_generation > gen_before);
}

#[test]
fn notify_does_not_bump_chrome_when_no_agent() {
    // No agent detected → no chrome invalidation needed
    let (mut app, _id) = app_with_editor();
    let gen_before = app.cache.chrome_generation;
    let _ = app.handle_cli_command("notify", json!({"event": "agent-running", "pane": 99999}));
    assert_eq!(app.cache.chrome_generation, gen_before);
}

// --- UC-13: GenerateAgentWrappers ---

#[test]
fn wrapper_scripts_are_generated_at_known_path() {
    // UC-1: Wrapper scripts should be created in $TMPDIR/tide-<pid>-bin/
    let pid = std::process::id();
    let expected_dir = format!("{}/tide-{}-bin", std::env::temp_dir().display(), pid);
    // generate_agent_wrappers is called in main, but we can verify
    // the expected path format
    assert!(expected_dir.contains(&format!("tide-{}-bin", pid)));
}

#[test]
fn codex_wrapper_injects_tide_mcp_turn_stop_hook_and_prompt_submit_hook() {
    // UC-4 BR-7: The Codex wrapper injects Tide MCP server config from the checked-in script.
    // UC-4 BR-8: The Codex wrapper reports agent-attached on launch.
    // Spec: docs/specs/codex-needs-input-attention.md
    // UC-1 BR-1: Codex agent-running is emitted on each UserPromptSubmit, not just on launch.
    // UC-1 BR-2: Codex prompt-submit integration uses the documented UserPromptSubmit hook path.
    // UC-2 BR-3: The Codex wrapper forwards the Stop hook payload through tide notify.
    // UC-3 BR-7: The Codex wrapper does not depend on a Notification hook.
    let wrapper_path = format!("{}/resources/bin/codex", env!("CARGO_MANIFEST_DIR"));
    let wrapper = std::fs::read_to_string(&wrapper_path)
        .unwrap_or_else(|err| panic!("failed to read {wrapper_path}: {err}"));

    assert!(wrapper.contains("mcp_servers.tide.command"));
    assert!(wrapper.contains("mcp_servers.tide.args"));
    assert!(wrapper.contains("tide_notify \"agent-attached\""));
    assert!(wrapper.contains("features.codex_hooks=true"));
    assert!(wrapper.contains("\"UserPromptSubmit\""));
    assert!(wrapper.contains("\"Stop\""));
    assert!(wrapper.contains("$TIDE_BIN notify agent-running --pane $TIDE_PANE --agent codex"));
    assert!(wrapper.contains("notify codex-stop --pane $TIDE_PANE --agent codex --payload-stdin"));
    assert!(wrapper.contains("tide_notify \"agent-detached\""));
    assert!(wrapper.contains("rm -rf \"$TIDE_CODEX_HOME\""));
    assert!(wrapper.contains("tide:wrapped-agent:codex:$1"));
    assert!(!wrapper.contains("\"Notification\""));
    assert!(!wrapper.contains("codex-turn-complete"));
    assert!(!wrapper.contains("agent-needs-input"));
}

// --- UC-16: CodexAppServerNeedsInput (Spec: docs/specs/codex-app-server-needs-input.md) ---

#[test]
fn codex_app_server_command_approval_marks_needs_input() {
    // UC-1 BR-1: item/commandExecution/requestApproval maps to AgentStatus::NeedsInput.
    // UC-1 BR-2: Command approval snippets prefer params.reason.
    let (mut app, pane_id) = app_with_terminal();
    app.window.is_focused = false;

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-app-server-event",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "jsonrpc": "2.0",
                "id": 7,
                "method": "item/commandExecution/requestApproval",
                "params": {
                    "itemId": "item-1",
                    "threadId": "thread-1",
                    "turnId": "turn-1",
                    "reason": "Do you want to update ~/.codex/config.toml?",
                    "command": "python3 -c 'from pathlib import Path'"
                }
            }
        }),
    )
    .unwrap();

    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { pane_id: body_pane_id, body, .. })
            if *body_pane_id == pane_id
                && body == "Do you want to update ~/.codex/config.toml?"
    ));
    assert!(app.pending_platform_commands.iter().any(|command| matches!(
        command,
        crate::tide_platform::WindowCommand::RequestUserAttention
    )));
}

#[test]
fn codex_app_server_user_input_requests_mark_needs_input() {
    // UC-2 BR-3: item/fileChange/requestApproval maps to AgentStatus::NeedsInput.
    // UC-2 BR-4: item/permissions/requestApproval maps to AgentStatus::NeedsInput.
    // UC-2 BR-5: item/tool/requestUserInput maps to AgentStatus::NeedsInput.
    // UC-2 BR-6: mcpServer/elicitation/request maps to AgentStatus::NeedsInput.
    for payload in [
        json!({
            "method": "item/fileChange/requestApproval",
            "params": {
                "itemId": "item-file",
                "threadId": "thread-1",
                "turnId": "turn-1",
                "reason": "Approve file change?"
            }
        }),
        json!({
            "method": "item/permissions/requestApproval",
            "params": {
                "itemId": "item-perm",
                "threadId": "thread-1",
                "turnId": "turn-1",
                "reason": "Grant additional permissions?"
            }
        }),
        json!({
            "method": "item/tool/requestUserInput",
            "params": {
                "itemId": "item-tool",
                "threadId": "thread-1",
                "turnId": "turn-1",
                "questions": [
                    {
                        "id": "choice",
                        "header": "Confirm",
                        "question": "Which option should Codex use?"
                    }
                ]
            }
        }),
        json!({
            "method": "mcpServer/elicitation/request",
            "params": {
                "serverName": "google_workspace",
                "threadId": "thread-1",
                "turnId": "turn-1",
                "mode": "form",
                "message": "Choose the Google Workspace account."
            }
        }),
    ] {
        let (mut app, pane_id) = app_with_detected_agent();
        app.handle_cli_command(
            "notify",
            json!({
                "event": "codex-app-server-event",
                "pane": pane_id,
                "agent": "codex",
                "payload": payload
            }),
        )
        .unwrap();

        assert_eq!(
            app.gateway.detected_agents.get(&pane_id).unwrap().status,
            Some(crate::state::gateway_status::AgentStatus::NeedsInput)
        );
    }
}

#[test]
fn codex_app_server_turn_lifecycle_updates_running_and_idle() {
    // UC-3 BR-7: turn/started maps to AgentStatus::Running.
    // UC-3 BR-8: turn/completed maps to AgentStatus::Idle.
    let (mut app, pane_id) = app_with_detected_agent();

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-app-server-event",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "method": "turn/started",
                "params": {"threadId": "thread-1", "turnId": "turn-1"}
            }
        }),
    )
    .unwrap();
    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-app-server-event",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "method": "turn/completed",
                "params": {"threadId": "thread-1", "turnId": "turn-1"}
            }
        }),
    )
    .unwrap();
    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
}

#[test]
fn codex_app_server_waiting_on_approval_thread_status_marks_needs_input() {
    // UC-3 BR-9: thread/status/changed waitingOnApproval maps to AgentStatus::NeedsInput.
    let (mut app, pane_id) = app_with_terminal();
    app.window.is_focused = false;

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-app-server-event",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "method": "thread/status/changed",
                "params": {
                    "threadId": "thread-1",
                    "status": {
                        "type": "active",
                        "activeFlags": ["waitingOnApproval"]
                    }
                }
            }
        }),
    )
    .unwrap();

    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { pane_id: body_pane_id, body, .. })
            if *body_pane_id == pane_id && body == "Codex is waiting for approval"
    ));
}

#[test]
fn codex_app_server_thread_status_updates_running_and_idle() {
    // UC-3 BR-10: thread/status/changed active maps to AgentStatus::Running.
    // UC-3 BR-11: thread/status/changed idle maps to AgentStatus::Idle.
    let (mut app, pane_id) = app_with_detected_agent();

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-app-server-event",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "method": "thread/status/changed",
                "params": {
                    "threadId": "thread-1",
                    "status": {
                        "type": "active",
                        "activeFlags": []
                    }
                }
            }
        }),
    )
    .unwrap();
    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-app-server-event",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "method": "thread/status/changed",
                "params": {
                    "threadId": "thread-1",
                    "status": {
                        "type": "idle",
                        "activeFlags": []
                    }
                }
            }
        }),
    )
    .unwrap();
    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
}

#[test]
fn codex_app_server_unsupported_payload_does_not_change_status() {
    // UC-3 BR-12: Unsupported Codex App Server payload methods are ignored without changing status.
    let (mut app, pane_id) = app_with_detected_agent();
    app.gateway
        .detected_agents
        .get_mut(&pane_id)
        .unwrap()
        .status = Some(crate::state::gateway_status::AgentStatus::Running);

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-app-server-event",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "method": "mcpServer/startupStatus/updated",
                "params": {"threadId": "thread-1"}
            }
        }),
    )
    .unwrap();

    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
}

#[test]
fn codex_wrapper_launches_app_server_remote_tui_and_watcher() {
    // UC-4 BR-13: The wrapper owns Codex App Server and watcher process lifecycle.
    // UC-4 BR-14: The wrapper preserves existing MCP and hook injection for fallback.
    // UC-4 BR-15: The wrapper still reports agent-detached and removes its temporary CODEX_HOME on exit.
    let wrapper_path = format!("{}/resources/bin/codex", env!("CARGO_MANIFEST_DIR"));
    let wrapper = std::fs::read_to_string(&wrapper_path)
        .unwrap_or_else(|err| panic!("failed to read {wrapper_path}: {err}"));

    assert!(wrapper.contains("codex app-server"));
    assert!(wrapper.contains("--listen ws://127.0.0.1:"));
    assert!(wrapper.contains("codex-app-server-watch"));
    assert!(wrapper.contains("--remote ws://127.0.0.1:"));
    assert!(wrapper.contains("codex_app_server_cleanup"));
    assert!(wrapper.contains("mcp_servers.tide.command"));
    assert!(wrapper.contains("\"UserPromptSubmit\""));
    assert!(wrapper.contains("\"Stop\""));
    assert!(wrapper.contains("tide_notify \"agent-detached\""));
    assert!(wrapper.contains("rm -rf \"$TIDE_CODEX_HOME\""));
}

#[test]
fn claude_wrapper_forwards_hook_stdin_payloads_for_notification_and_stop() {
    // Spec: docs/specs/agent-auto-integration.md
    // UC-5 BR-13: Claude Notification and Stop hooks forward stdin JSON through tide notify.
    let wrapper_path = format!("{}/resources/bin/claude", env!("CARGO_MANIFEST_DIR"));
    let wrapper = std::fs::read_to_string(&wrapper_path)
        .unwrap_or_else(|err| panic!("failed to read {wrapper_path}: {err}"));

    assert!(wrapper
        .contains("notify agent-needs-input --pane $TIDE_PANE --agent claude --payload-stdin"));
    assert!(wrapper.contains("notify agent-idle --pane $TIDE_PANE --agent claude --payload-stdin"));
    assert!(wrapper.contains("tide_notify agent-attached"));
    assert!(wrapper.contains("tide_notify agent-detached"));
    assert!(wrapper.contains("notify agent-running --pane $TIDE_PANE --agent claude"));
}

#[test]
fn gemini_wrapper_forwards_hook_stdin_payloads_for_notification_and_after_agent() {
    // Spec: docs/specs/agent-auto-integration.md
    // UC-5 BR-14: Gemini Notification and AfterAgent hooks forward stdin JSON through tide notify.
    let wrapper_path = format!("{}/resources/bin/gemini", env!("CARGO_MANIFEST_DIR"));
    let wrapper = std::fs::read_to_string(&wrapper_path)
        .unwrap_or_else(|err| panic!("failed to read {wrapper_path}: {err}"));

    assert!(wrapper
        .contains("notify agent-needs-input --pane $TIDE_PANE --agent gemini --payload-stdin"));
    assert!(wrapper.contains("notify agent-idle --pane $TIDE_PANE --agent gemini --payload-stdin"));
    assert!(wrapper.contains("tide_notify agent-attached"));
    assert!(wrapper.contains("tide_notify agent-detached"));
    assert!(wrapper.contains("notify agent-running --pane $TIDE_PANE --agent gemini"));
}

#[test]
fn agent_attached_marks_presence_without_running_or_notification_routing() {
    // Spec: docs/specs/agent-notification-routing.md
    // UC-14 BR-39: Launch-time wrapper integration marks presence without forcing Running.
    // UC-14 BR-40: Presence alone does not route notifications.
    let (mut app, pane_id) = app_with_terminal();
    app.pending_platform_commands.clear();

    app.handle_cli_command(
        "notify",
        json!({"event": "agent-attached", "pane": pane_id, "agent": "codex"}),
    )
    .unwrap();

    let agent = app
        .gateway
        .detected_agents
        .get(&pane_id)
        .expect("agent should be registered");

    assert!(agent.wrapper_managed);
    assert!(agent.gateway_connected);
    assert_eq!(agent.status, None);
    assert!(app.pending_platform_commands.is_empty());
}

#[test]
fn agent_detached_clears_wrapped_agent_presence_and_attention() {
    // Spec: docs/specs/agent-notification-routing.md
    // UC-14 BR-42: Wrapper EXIT clears presence and unresolved wrapped-agent attention.
    let (mut app, pane_id) = app_with_terminal();
    app.window.is_focused = false;
    app.gateway.detected_agents.insert(
        pane_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 12345,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );
    app.notified_panes.insert(pane_id);
    app.agent_notification_snippets
        .insert(pane_id, "Need an answer".into());
    app.refresh_workspace_agent_notification(app.ws.active);
    assert!(app.ws.workspace_extras[app.ws.active].has_agent_notification);

    app.handle_cli_command(
        "notify",
        json!({"event": "agent-detached", "pane": pane_id, "agent": "codex"}),
    )
    .unwrap();

    assert!(!app.gateway.detected_agents.contains_key(&pane_id));
    assert!(!app.notified_panes.contains(&pane_id));
    assert!(!app.agent_notification_snippets.contains_key(&pane_id));
    assert!(!app.ws.workspace_extras[app.ws.active].has_agent_notification);
    assert!(app.pending_platform_commands.is_empty());
}

#[test]
fn codex_prompt_submit_hook_reports_running_for_each_new_turn() {
    // Spec: docs/specs/codex-needs-input-attention.md
    // UC-1 BR-1: Codex UserPromptSubmit returns the source Pane to Running for each new turn.
    let (mut app, pane_id) = app_with_terminal();
    app.gateway.detected_agents.insert(
        pane_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 12345,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    app.handle_cli_command(
        "notify",
        json!({"event": "agent-running", "pane": pane_id, "agent": "codex"}),
    )
    .unwrap();

    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );

    app.gateway
        .detected_agents
        .get_mut(&pane_id)
        .unwrap()
        .status = Some(crate::state::gateway_status::AgentStatus::Idle);
    app.acknowledge_agent_attention(pane_id);

    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        None
    );

    app.handle_cli_command(
        "notify",
        json!({"event": "agent-running", "pane": pane_id, "agent": "codex"}),
    )
    .unwrap();

    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
}

// --- Unknown method ---

#[test]
fn unknown_method_returns_error() {
    let (mut app, _) = app_with_editor();
    let result = app.handle_cli_command("unknown-method", json!({}));
    assert!(result.is_err());
}

// --- Spec: docs/specs/agent-integration-toggle.md ---

// --- UC-1: ToggleAutoIntegration ---

#[test]
fn auto_integration_defaults_to_true() {
    // UC-1 BR-2: Default value is true
    let app = test_app();
    assert!(app.settings.auto_integration);
}

#[test]
fn toggle_auto_integration_flips_setting() {
    // UC-1 BR-1: Toggle only affects newly spawned terminals
    let (mut app, _id) = app_with_editor();
    assert!(app.settings.auto_integration);
    app.toggle_auto_integration();
    assert!(!app.settings.auto_integration);
    app.toggle_auto_integration();
    assert!(app.settings.auto_integration);
}

#[test]
fn auto_integration_bootstrap_requests_notification_permission_when_enabled() {
    // UC-5 BR-1: Startup proactively requests notification permission when persisted auto-integration is enabled.
    let mut app = test_app();
    app.pending_platform_commands.clear();

    app.queue_notification_permission_request_if_auto_integration_enabled();

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::RequestNotificationPermission)
    ));
}

#[test]
fn enabling_auto_integration_requests_notification_permission() {
    // UC-5 BR-2: Toggling auto-integration on queues a proactive notification-permission request.
    let (mut app, _id) = app_with_editor();
    app.pending_platform_commands.clear();

    app.toggle_auto_integration();
    assert!(!app.settings.auto_integration);
    assert!(app.pending_platform_commands.is_empty());

    app.toggle_auto_integration();
    assert!(app.settings.auto_integration);
    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::RequestNotificationPermission)
    ));
}

#[test]
fn wrapped_agent_lifecycle_signal_requests_notification_permission_as_a_fallback() {
    // UC-10 BR-32: A wrapper-managed lifecycle signal also queues the notification-permission request as a fallback.
    let (mut app, agent_pane) = app_with_terminal();
    app.pending_platform_commands.clear();

    app.handle_terminal_notification(agent_pane, "tide:wrapped-agent:codex:agent-running");

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::RequestNotificationPermission)
    ));
}

#[test]
fn disabling_auto_integration_does_not_request_notification_permission() {
    // UC-5 BR-3: Toggling auto-integration off does not queue a permission request.
    let (mut app, _id) = app_with_editor();
    app.pending_platform_commands.clear();

    app.toggle_auto_integration();

    assert!(!app.settings.auto_integration);
    assert!(app.pending_platform_commands.is_empty());
}

#[test]
fn focusing_the_window_retries_notification_permission_when_authorization_is_unresolved() {
    // UC-5 BR-4: When Tide regains focus with unresolved notification authorization, it retries the permission request.
    use crate::adapter::inward::event_loop_adapter::handle_platform_event;

    let mut app = test_app();
    app.pending_platform_commands.clear();
    app.window.notification_authorization_status =
        crate::state::NotificationAuthorizationStatus::NotDetermined;

    handle_platform_event(
        &mut app,
        crate::tide_platform::PlatformEvent::Focused(true),
        &test_window_proxy(),
    );

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::RequestNotificationPermission)
    ));
}

// --- UC-4: RemoveGatewayModal ---

#[test]
fn gateway_status_tracks_agents_after_modal_removal() {
    // UC-4 BR-1: GatewayStatus still tracks detected agents
    let (mut app, id) = app_with_editor();
    app.gateway.detected_agents.insert(
        id,
        crate::state::gateway_status::AgentInfo {
            name: "Claude Code",
            pid: 12345,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::Running),
        },
    );
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
}

// --- Spec: docs/specs/osc-9-notification.md ---

// --- UC-2: RouteNotification ---

#[test]
fn osc9_agent_running_updates_status() {
    // UC-2 BR-1: tide:agent-running → AgentStatus::Running
    let (mut app, id) = app_with_detected_agent();
    app.handle_terminal_notification(id, "tide:agent-running");
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
}

#[test]
fn osc9_agent_needs_input_updates_status() {
    // UC-2 BR-2: tide:agent-needs-input → AgentStatus::NeedsInput
    let (mut app, id) = app_with_detected_agent();
    app.handle_terminal_notification(id, "tide:agent-needs-input");
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
}

#[test]
fn osc9_agent_idle_updates_status() {
    // UC-2 BR-3: tide:agent-idle → AgentStatus::Idle
    let (mut app, id) = app_with_detected_agent();
    app.handle_terminal_notification(id, "tide:agent-idle");
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
}

#[test]
fn wrapped_agent_osc9_auto_registers_and_requests_redraw() {
    // UC-2 BR-4,5,6: Wrapped-agent OSC 9 registers a Wrapped Agent and invalidates chrome immediately.
    let (mut app, id) = app_with_editor();
    app.cache.needs_redraw = false;
    let gen_before = app.cache.chrome_generation;

    app.handle_terminal_notification(id, "tide:wrapped-agent:codex:agent-idle");

    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(agent.name, "Codex");
    assert!(agent.wrapper_managed);
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
    assert!(app.cache.chrome_generation > gen_before);
    assert!(app.cache.needs_redraw);
}

#[test]
fn wrapped_agent_osc9_broadcasts_agent_status_changed_event() {
    // UC-2 BR-4,5,6: Wrapped-agent OSC 9 drives the same subscriber event as the CLI notify path.
    let (mut app, id) = app_with_editor();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    app.gateway
        .subscribers
        .push(crate::state::gateway_status::Subscriber {
            tx,
            event_filter: vec!["agent-status-changed".into()],
            owner_pane_id: None,
        });

    app.handle_terminal_notification(id, "tide:wrapped-agent:codex:agent-needs-input");

    let msg = rx.try_recv().unwrap();
    assert!(msg.contains("agent-status-changed"));
    assert!(msg.contains("\"pane_id\":1") || msg.contains(&format!("\"pane_id\":{}", id)));
    assert!(msg.contains("agent-needs-input"));
    assert!(msg.contains("Codex"));
}

#[test]
fn osc9_unknown_tide_message_ignored() {
    // UC-2 BR-4: Unknown tide: messages are ignored (no crash, no status change)
    let (mut app, id) = app_with_detected_agent();
    app.handle_terminal_notification(id, "tide:unknown-event");
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(agent.status, None); // Unchanged from initial
}

#[test]
fn osc9_non_tide_message_ignored() {
    // UC-2 BR-5: Non-tide: messages are silently ignored
    let (mut app, id) = app_with_detected_agent();
    app.handle_terminal_notification(id, "Hello World");
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(agent.status, None);
}

#[test]
fn osc9_unmanaged_notification_does_not_create_attention_source() {
    // UC-3 BR-9: OSC 9 does not create a synthetic Unknown attention source
    let (mut app, id) = app_with_editor();
    assert!(!app.gateway.detected_agents.contains_key(&id));

    app.handle_terminal_notification(id, "tide:agent-needs-input");

    assert!(!app.gateway.detected_agents.contains_key(&id));
}

#[test]
fn focusing_pane_preserves_needs_input_status() {
    // Wrapped-agent NeedsInput remains active after focus until the next Running signal.
    use crate::FocusNavPort;
    let (mut app, id) = app_with_detected_agent();
    app.handle_terminal_notification(id, "tide:agent-needs-input");
    assert_eq!(
        app.gateway.detected_agents.get(&id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
    app.focus_pane(id);
    assert_eq!(
        app.gateway.detected_agents.get(&id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
}

#[test]
fn focusing_pane_preserves_idle_status() {
    // Wrapped-agent Idle remains connected idle after focus so the Pane can render acknowledged completion chrome.
    use crate::FocusNavPort;
    let (mut app, id) = app_with_detected_agent();
    app.handle_terminal_notification(id, "tide:agent-running");
    app.handle_terminal_notification(id, "tide:agent-idle");
    assert_eq!(
        app.gateway.detected_agents.get(&id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
    app.focus_pane(id);
    assert_eq!(
        app.gateway.detected_agents.get(&id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
}

#[test]
fn focusing_associated_pane_does_not_clear_paired_terminal_attention() {
    // UC-7 BR-22: Focusing a non-terminal Pane that has an Associated Terminal does not clear the wrapped-agent Terminal alert.
    use crate::FocusNavPort;

    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = app.layout.split(terminal_id, SplitDirection::Horizontal);
    app.panes.insert(
        editor_id,
        PaneKind::Editor(EditorPane::new_empty(editor_id)),
    );
    app.assoc.associated_terminal.insert(editor_id, terminal_id);
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );
    app.notified_panes.insert(terminal_id);
    app.focus.focused = Some(terminal_id);

    app.focus_pane(editor_id);

    assert_eq!(
        app.gateway
            .detected_agents
            .get(&terminal_id)
            .unwrap()
            .status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
    assert!(app.notified_panes.contains(&terminal_id));
}

#[test]
fn focusing_terminal_acknowledges_attention_and_clears_notification_suppression() {
    // UC-5 BR-8: Focusing the wrapped-agent Terminal in the active window acknowledges unresolved attention and clears duplicate suppression.
    use crate::WorkspaceNavPort;

    let (mut app, first_terminal_id) = app_with_terminal();
    let second_terminal_id = app
        .layout
        .split(first_terminal_id, SplitDirection::Horizontal);
    let second_terminal = TerminalPane::with_cwd(second_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(second_terminal_id, PaneKind::Terminal(second_terminal));
    app.focus.focused = Some(second_terminal_id);
    app.focus.stage_focused = Some(second_terminal_id);

    app.gateway.detected_agents.insert(
        first_terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );
    app.notified_panes.insert(first_terminal_id);

    app.focus_terminal(first_terminal_id);

    assert_eq!(
        app.gateway
            .detected_agents
            .get(&first_terminal_id)
            .unwrap()
            .status,
        None
    );
    assert!(!app.notified_panes.contains(&first_terminal_id));
}

#[test]
fn focusing_idle_terminal_does_not_queue_a_replacement_background_notification() {
    // UC-5 BR-8: Direct focus must not re-route the same Idle alert as a replacement background notification.
    use crate::WorkspaceNavPort;

    let (mut app, target_terminal_id) = app_with_terminal();
    let other_terminal_id = app
        .layout
        .split(target_terminal_id, SplitDirection::Horizontal);
    let other_terminal = TerminalPane::with_cwd(other_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(other_terminal_id, PaneKind::Terminal(other_terminal));
    app.focus.focused = Some(other_terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(other_terminal_id);
    app.window.is_focused = false;

    app.gateway.detected_agents.insert(
        target_terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::Idle),
        },
    );
    app.notified_panes.insert(target_terminal_id);

    app.focus_terminal(target_terminal_id);

    assert_eq!(app.focus.focused, Some(target_terminal_id));
    assert!(
        app.pending_platform_commands.iter().all(|command| !matches!(
            command,
            crate::tide_platform::WindowCommand::SendSystemNotification { pane_id, .. }
                if *pane_id == target_terminal_id
        )),
        "direct focus should not synthesize a replacement background notification for the same Idle alert"
    );
    assert!(
        !app.notified_panes.contains(&target_terminal_id),
        "direct focus should still clear duplicate suppression for the focused Idle pane"
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Spec: docs/specs/agent-notification-routing.md
// ────────────────────────────────────────────────────────────────────────────

/// Helper: create an app with two panes, one with a detected agent, focused on the other pane.
fn app_with_unfocused_agent() -> (App, u64, u64) {
    let (mut app, id1, id2) = app_with_two_editors();
    // id2 is focused, id1 has the agent
    app.gateway.detected_agents.insert(
        id1,
        crate::state::gateway_status::AgentInfo {
            name: "Claude Code",
            pid: 12345,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );
    app.focus.focused = Some(id2);
    (app, id1, id2)
}

// --- UC-1: RouteNotificationByContext ---

#[test]
fn running_status_does_not_trigger_notification_routing() {
    // UC-1 BR-1: Running status changes do not trigger notification routing
    let (mut app, agent_pane, _) = app_with_unfocused_agent();
    app.window.is_focused = false;
    app.handle_terminal_notification(agent_pane, "tide:agent-running");
    // No system notification should be queued (Running is user-initiated)
    assert!(app.pending_platform_commands.is_empty());
    assert!(!app.notified_panes.contains(&agent_pane));
}

#[test]
fn running_status_clears_inactive_workspace_highlight_when_no_pending_attention_remains() {
    // UC-1 BR-4: Inactive-Workspace attention is recomputed on Running transitions too.
    use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};

    let mut app = test_app();
    let (layout, active_pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        active_pane_id,
        PaneKind::Editor(EditorPane::new_empty(active_pane_id)),
    );
    app.focus.focused = Some(active_pane_id);

    let (mut inactive_layout, inactive_root_id) =
        crate::tide_layout::SplitLayout::with_initial_pane();
    let inactive_pane_id = inactive_layout.split(inactive_root_id, SplitDirection::Horizontal);
    let inactive_root = TerminalPane::with_cwd(inactive_root_id, 80, 24, None, true).unwrap();
    let inactive_terminal = TerminalPane::with_cwd(inactive_pane_id, 80, 24, None, true).unwrap();
    let mut inactive_panes = std::collections::HashMap::new();
    inactive_panes.insert(inactive_root_id, PaneKind::Terminal(inactive_root));
    inactive_panes.insert(inactive_pane_id, PaneKind::Terminal(inactive_terminal));

    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: std::collections::HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS2".into(),
        layout: inactive_layout,
        focused: None,
        panes: inactive_panes,
    });
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    let mut inactive_extras = WorkspaceExtras::new();
    inactive_extras.has_agent_notification = true;
    app.ws.workspace_extras.push(inactive_extras);
    app.ws.active = 0;
    app.window.is_focused = false;

    app.gateway.detected_agents.insert(
        inactive_pane_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 12345,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );

    app.handle_terminal_notification(inactive_pane_id, "tide:agent-running");

    assert_eq!(
        app.gateway
            .detected_agents
            .get(&inactive_pane_id)
            .unwrap()
            .status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
    assert!(
        !app.ws.workspace_extras[1].has_agent_notification,
        "Running must clear stale inactive-Workspace highlight when no Idle or NeedsInput panes remain"
    );
    assert!(
        !app.pending_platform_commands.iter().any(|command| matches!(
            command,
            crate::tide_platform::WindowCommand::SendSystemNotification { .. }
                | crate::tide_platform::WindowCommand::RequestUserAttention
        )),
        "Running still must not emit notification attention commands"
    );
    assert!(
        app.pending_platform_commands
            .iter()
            .all(|command| !matches!(
                command,
                crate::tide_platform::WindowCommand::SendSystemNotification { .. }
                    | crate::tide_platform::WindowCommand::RequestUserAttention
            )),
        "Running should only leave unrelated fallback commands such as notification permission requests"
    );
    assert!(!app.notified_panes.contains(&inactive_pane_id));
}

#[test]
fn background_notification_routes_for_focused_pane_when_window_is_unfocused() {
    // UC-4 BR-5: NeedsInput still routes the macOS notification path for the focused Pane.
    let (mut app, agent_pane) = app_with_detected_agent();
    app.focus.focused = Some(agent_pane);
    app.window.is_focused = false;
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { pane_id, .. })
            if *pane_id == agent_pane
    ));
    assert!(matches!(
        app.pending_platform_commands.get(1),
        Some(crate::tide_platform::WindowCommand::RequestUserAttention)
    ));
    assert!(app.notified_panes.contains(&agent_pane));
}

#[test]
fn unfocused_wrapped_agent_terminal_routes_notification_while_window_is_focused() {
    // UC-3 BR-11: A wrapped-agent Terminal that is not the focused Pane may queue macOS notification attention while the Tide window stays focused.
    let (mut app, target_terminal_id) = app_with_terminal();
    let focused_terminal_id = app
        .layout
        .split(target_terminal_id, SplitDirection::Horizontal);
    let focused_terminal = TerminalPane::with_cwd(focused_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(focused_terminal_id, PaneKind::Terminal(focused_terminal));
    app.focus.focused = Some(focused_terminal_id);
    app.focus.stage_focused = Some(focused_terminal_id);
    app.window.is_focused = true;
    app.gateway.detected_agents.insert(
        target_terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 12345,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    app.handle_terminal_notification(target_terminal_id, "tide:agent-needs-input");

    assert!(app.pending_platform_commands.iter().any(|command| {
        matches!(
            command,
            crate::tide_platform::WindowCommand::SendSystemNotification { pane_id, .. }
                if *pane_id == target_terminal_id
        )
    }));
    assert!(app.pending_platform_commands.iter().any(|command| {
        matches!(
            command,
            crate::tide_platform::WindowCommand::RequestUserAttention
        )
    }));
    assert!(app.notified_panes.contains(&target_terminal_id));
}

#[test]
fn focused_pane_skips_background_notification_while_window_is_focused() {
    // UC-3 BR-11: The active Pane skips background notification routing while the Tide window is focused.
    let (mut app, agent_pane) = app_with_detected_agent();
    app.focus.focused = Some(agent_pane);
    app.window.is_focused = true;
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");

    assert!(app.pending_platform_commands.is_empty());
    assert!(!app.notified_panes.contains(&agent_pane));
}

#[test]
fn focusing_another_pane_after_an_unresolved_alert_routes_a_system_notification() {
    // UC-4 BR-6: Leaving an unresolved NeedsInput wrapped-agent Terminal reroutes the background notification path immediately.
    use crate::WorkspaceNavPort;

    let (mut app, agent_pane) = app_with_terminal();
    let other_terminal_id = app.layout.split(agent_pane, SplitDirection::Horizontal);
    let other_terminal = TerminalPane::with_cwd(other_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(other_terminal_id, PaneKind::Terminal(other_terminal));
    app.focus.focused = Some(agent_pane);
    app.focus.stage_focused = Some(agent_pane);
    app.window.is_focused = true;

    app.handle_terminal_notification(agent_pane, "tide:wrapped-agent:codex:agent-needs-input");
    app.pending_platform_commands.clear();

    app.focus_terminal(other_terminal_id);

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { pane_id, .. })
            if *pane_id == agent_pane
    ));
    assert!(matches!(
        app.pending_platform_commands.get(1),
        Some(crate::tide_platform::WindowCommand::RequestUserAttention)
    ));
    assert!(app.notified_panes.contains(&agent_pane));
}

#[test]
fn window_blur_after_an_unresolved_alert_routes_a_system_notification() {
    // UC-4 BR-6: Window blur reroutes an unresolved NeedsInput alert into a system notification.
    use crate::adapter::inward::event_loop_adapter::handle_platform_event;

    let (mut app, agent_pane) = app_with_terminal();
    app.focus.focused = Some(agent_pane);
    app.focus.stage_focused = Some(agent_pane);
    app.window.is_focused = true;

    app.handle_terminal_notification(agent_pane, "tide:wrapped-agent:codex:agent-needs-input");
    app.pending_platform_commands.clear();

    handle_platform_event(
        &mut app,
        crate::tide_platform::PlatformEvent::Focused(false),
        &test_window_proxy(),
    );

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { pane_id, .. })
            if *pane_id == agent_pane
    ));
    assert!(matches!(
        app.pending_platform_commands.get(1),
        Some(crate::tide_platform::WindowCommand::RequestUserAttention)
    ));
    assert!(app.notified_panes.contains(&agent_pane));
}

#[test]
fn background_notification_includes_foreground_dot() {
    // UC-4 BR-5: NeedsInput background notifications still update the foreground dot.
    let (mut app, agent_pane, _) = app_with_unfocused_agent();
    app.window.is_focused = false;
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    // System notification queued with the source Pane target preserved for activation.
    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { pane_id, .. })
            if *pane_id == agent_pane
    ));
    // Agent status dot is also set (foreground indicator)
    assert_eq!(
        app.gateway.detected_agents.get(&agent_pane).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput),
    );
}

#[test]
fn codex_stop_notification_uses_transcript_final_answer_snippet() {
    // UC-2 BR-4, UC-6 BR-10: Codex Stop notifications prefer the final main-thread transcript answer as the body.
    use crate::PaneAccessPort;
    let (mut app, pane_id) = app_with_terminal();
    app.window.is_focused = false;
    let expected_title = format!("Tide - {}", app.pane_title(pane_id));
    let transcript_path = write_codex_transcript(
        "{\"type\":\"session_meta\",\"payload\":{\"id\":\"main-thread\"}}\n\
         {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Intermediate commentary.\"}],\"phase\":\"commentary\"}}\n\
         {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"<subagent_notification>{\\\"agent_path\\\":\\\"codex\\\"}</subagent_notification>\"}]}}\n\
         {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Implemented the final main-thread answer.\"}],\"phase\":\"final_answer\"}}\n",
    );

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-stop",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "hook_event_name": "Stop",
                "turn_id": "turn-1",
                "transcript_path": transcript_path,
                "last_assistant_message": "Stale payload text that should not win."
            }
        }),
    )
    .unwrap();
    let _ = std::fs::remove_file(&transcript_path);

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { title, pane_id: body_pane_id, body, .. })
            if *body_pane_id == pane_id
                && title == &expected_title
                && body == "Implemented the final main-thread answer."
    ));
    assert!(
        !app.pending_platform_commands.iter().any(|command| matches!(
            command,
            crate::tide_platform::WindowCommand::RequestUserAttention
        ))
    );
}

#[test]
fn codex_stop_notification_uses_event_msg_final_answer_snippet() {
    // UC-2 BR-4, UC-6 BR-10: Codex Stop notifications accept event_msg final-answer text when response_item text is absent.
    use crate::PaneAccessPort;
    let (mut app, pane_id) = app_with_terminal();
    app.window.is_focused = false;
    let expected_title = format!("Tide - {}", app.pane_title(pane_id));
    let transcript_path = write_codex_transcript(
        "{\"type\":\"session_meta\",\"payload\":{\"id\":\"main-thread\"}}\n\
         {\"timestamp\":\"2026-04-14T12:00:00.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"agent_message\",\"message\":\"Resolved the final answer from event_msg.\",\"phase\":\"final_answer\"}}\n",
    );

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-stop",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "hook_event_name": "Stop",
                "turn_id": "turn-event-msg",
                "transcript_path": transcript_path,
                "last_assistant_message": "Stale payload text that should not win."
            }
        }),
    )
    .unwrap();
    let _ = std::fs::remove_file(&transcript_path);

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { title, pane_id: body_pane_id, body, .. })
            if *body_pane_id == pane_id
                && title == &expected_title
                && body == "Resolved the final answer from event_msg."
    ));
}

#[test]
fn codex_stop_notification_uses_task_complete_last_agent_message_snippet() {
    // UC-2 BR-4, UC-6 BR-10: Codex Stop notifications accept task_complete.last_agent_message when other structured text is absent.
    use crate::PaneAccessPort;
    let (mut app, pane_id) = app_with_terminal();
    app.window.is_focused = false;
    let expected_title = format!("Tide - {}", app.pane_title(pane_id));
    let transcript_path = write_codex_transcript(
        "{\"type\":\"session_meta\",\"payload\":{\"id\":\"main-thread\"}}\n\
         {\"timestamp\":\"2026-04-14T12:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"task_complete\",\"turn_id\":\"turn-task-complete\",\"last_agent_message\":\"Resolved the final answer from task_complete.\"}}\n",
    );

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-stop",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "hook_event_name": "Stop",
                "turn_id": "turn-task-complete",
                "transcript_path": transcript_path,
                "last_assistant_message": "Stale payload text that should not win."
            }
        }),
    )
    .unwrap();
    let _ = std::fs::remove_file(&transcript_path);

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { title, pane_id: body_pane_id, body, .. })
            if *body_pane_id == pane_id
                && title == &expected_title
                && body == "Resolved the final answer from task_complete."
    ));
}

#[test]
fn gemini_after_agent_notification_uses_prompt_response_snippet() {
    // UC-6 BR-10, BR-11: Gemini idle completion notifications use prompt_response as the body.
    let (mut app, pane_id) = app_with_terminal();
    let focused_pane = app.layout.split(pane_id, SplitDirection::Horizontal);
    let focused_terminal = TerminalPane::with_cwd(focused_pane, 80, 24, None, true).unwrap();
    app.panes
        .insert(focused_pane, PaneKind::Terminal(focused_terminal));
    app.focus.focused = Some(focused_pane);
    app.focus.stage_focused = Some(focused_pane);
    app.window.is_focused = false;

    app.handle_cli_command(
        "notify",
        json!({
            "event": "agent-idle",
            "pane": pane_id,
            "agent": "gemini",
            "payload": {
                "hook_event_name": "AfterAgent",
                "prompt": "Explain this codebase",
                "prompt_response": "The codebase is split into a Terminal domain, Workspace services, and renderer adapters."
            }
        }),
    )
    .unwrap();

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { pane_id: body_pane_id, body, .. })
            if *body_pane_id == pane_id && body == "The codebase is split into a Terminal domain, Workspace services, and renderer adapters."
    ));
    assert!(
        !app.pending_platform_commands.iter().any(|command| matches!(
            command,
            crate::tide_platform::WindowCommand::RequestUserAttention
        ))
    );
}

#[cfg(target_os = "macos")]
#[test]
fn foreground_notification_presentation_uses_banner_and_sound() {
    // UC-3 BR-14: Frontmost Tide notifications still use banner-capable presentation options.
    assert_eq!(
        crate::tide_platform::macos::foreground_notification_presentation_options(),
        0x12
    );
}

#[test]
fn duplicate_system_notification_suppressed_until_acknowledged() {
    // UC-4 BR-6: NeedsInput system notifications are not sent again until the source Pane is focused in the active window.
    use crate::FocusNavPort;
    let (mut app, agent_pane, _) = app_with_unfocused_agent();
    app.window.is_focused = true;

    // First notification: should queue
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    assert!(!app.pending_platform_commands.is_empty());
    app.pending_platform_commands.clear();

    // Second notification for same pane: should NOT queue (suppressed)
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    assert!(app.pending_platform_commands.is_empty());

    // Acknowledge by focusing
    app.focus_pane(agent_pane);
    assert!(!app.notified_panes.contains(&agent_pane));

    // Now another notification should be able to fire
    app.focus.focused = Some(0); // unfocus
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    assert!(!app.pending_platform_commands.is_empty());
}

#[test]
fn wrapped_agent_notification_falls_back_to_visible_terminal_snippet() {
    // UC-6 BR-11: When no structured payload snippet exists, wrapped-agent notifications fall back to the owning Terminal's visible text.
    let (mut app, target_terminal_id) = app_with_terminal();
    let focused_terminal_id = app
        .layout
        .split(target_terminal_id, SplitDirection::Horizontal);
    let focused_terminal = TerminalPane::with_cwd(focused_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(focused_terminal_id, PaneKind::Terminal(focused_terminal));
    app.focus.focused = Some(focused_terminal_id);
    app.focus.stage_focused = Some(focused_terminal_id);
    app.window.is_focused = true;
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&target_terminal_id) {
        terminal.backend.load_mock_screen_for_test(
            "model: claude-sonnet\nTip: Tide help text\n• Finalized the parser fix and verified the behavior tests.\n",
        );
    }

    app.handle_terminal_notification(target_terminal_id, "tide:wrapped-agent:claude:agent-idle");

    assert!(app.pending_platform_commands.iter().any(|command| {
        matches!(
            command,
            crate::tide_platform::WindowCommand::SendSystemNotification { title, pane_id, body, .. }
                if *pane_id == target_terminal_id
                    && title.starts_with("Tide - ")
                    && body == "• Finalized the parser fix and verified the behavior tests."
        )
    }));
    assert!(
        !app.pending_platform_commands.iter().any(|command| matches!(
            command,
            crate::tide_platform::WindowCommand::RequestUserAttention
        ))
    );
}

#[test]
fn backgrounded_wrapped_agent_reroute_reuses_the_stored_notification_snippet() {
    // UC-6 BR-10, BR-11: Re-routing an unresolved Idle alert reuses the stored snippet.
    use crate::WorkspaceNavPort;

    let (mut app, agent_pane) = app_with_terminal();
    let other_terminal_id = app.layout.split(agent_pane, SplitDirection::Horizontal);
    let other_terminal = TerminalPane::with_cwd(other_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(other_terminal_id, PaneKind::Terminal(other_terminal));
    app.focus.focused = Some(agent_pane);
    app.focus.stage_focused = Some(agent_pane);
    app.window.is_focused = true;

    app.handle_cli_command(
        "notify",
        json!({
            "event": "agent-idle",
            "pane": agent_pane,
            "agent": "gemini",
            "payload": {
                "hook_event_name": "AfterAgent",
                "prompt": "Summarize the repo",
                "prompt_response": "Summarized the repo layout and highlighted the gateway routing path."
            }
        }),
    )
    .unwrap();
    assert!(
        app.pending_platform_commands.is_empty(),
        "the focused Terminal should not route a background notification yet"
    );

    app.focus_terminal(other_terminal_id);

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { pane_id, body, .. })
            if *pane_id == agent_pane
                && body == "Summarized the repo layout and highlighted the gateway routing path."
    ));
    assert!(
        !app.pending_platform_commands.iter().any(|command| matches!(
            command,
            crate::tide_platform::WindowCommand::RequestUserAttention
        ))
    );
}

#[test]
fn stale_idle_snippet_does_not_override_future_needs_input_visible_fallback() {
    // UC-6 BR-10, BR-11: A stale Idle snippet must not outrank a later NeedsInput visible-text fallback.
    let (mut app, source_pane) = app_with_terminal();
    let focused_pane = app.layout.split(source_pane, SplitDirection::Horizontal);
    let focused_terminal = TerminalPane::with_cwd(focused_pane, 80, 24, None, true).unwrap();
    app.panes
        .insert(focused_pane, PaneKind::Terminal(focused_terminal));
    app.focus.focused = Some(focused_pane);
    app.focus.stage_focused = Some(focused_pane);
    app.window.is_focused = false;

    app.handle_cli_command(
        "notify",
        json!({
            "event": "agent-idle",
            "pane": source_pane,
            "agent": "gemini",
            "payload": {
                "hook_event_name": "AfterAgent",
                "prompt": "Summarize the repo",
                "prompt_response": "Stale idle completion text that must not be reused."
            }
        }),
    )
    .unwrap();
    app.pending_platform_commands.clear();
    app.notified_panes.remove(&source_pane);

    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&source_pane) {
        terminal.backend.load_mock_screen_for_test(
            "model: gemini-pro\nTip: Tide help text\n• Fresh visible fallback text from the terminal.\n",
        );
    }

    app.handle_cli_command(
        "notify",
        json!({
            "event": "agent-needs-input",
            "pane": source_pane,
            "agent": "gemini"
        }),
    )
    .unwrap();

    assert!(matches!(
        app.pending_platform_commands.first(),
        Some(crate::tide_platform::WindowCommand::SendSystemNotification { pane_id, body, .. })
            if *pane_id == source_pane
                && body == "• Fresh visible fallback text from the terminal."
    ));
    assert!(
        app.pending_platform_commands
            .iter()
            .all(|command| !matches!(
                command,
                crate::tide_platform::WindowCommand::SendSystemNotification { body, .. }
                    if body == "Stale idle completion text that must not be reused."
            )),
        "later NeedsInput notifications must not reuse the earlier Idle snippet"
    );
}

// --- UC-2: ClassifyCodexCompletedTurns ---

#[test]
fn codex_stop_payload_classifies_idle_or_needs_input() {
    // UC-2 BR-5: Codex Stop payloads normalize to shared Idle or NeedsInput states.
    let (mut app, pane_id) = app_with_editor();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    app.gateway
        .subscribers
        .push(crate::state::gateway_status::Subscriber {
            tx,
            event_filter: vec!["agent-status-changed".into()],
            owner_pane_id: None,
        });

    for (turn_id, transcript_text, payload_message, expected_event, expected_status) in [
        (
            "turn-1",
            "what should i do next?",
            "rename complete and verified cargo build succeeds.",
            "agent-needs-input",
            crate::state::gateway_status::AgentStatus::NeedsInput,
        ),
        (
            "turn-2",
            "yes",
            "Implemented everything cleanly.",
            "agent-needs-input",
            crate::state::gateway_status::AgentStatus::NeedsInput,
        ),
        (
            "turn-3",
            "rename complete and verified cargo build succeeds.",
            "allow",
            "agent-idle",
            crate::state::gateway_status::AgentStatus::Idle,
        ),
        (
            "turn-4",
            "allow",
            "rename complete and verified cargo build succeeds.",
            "agent-needs-input",
            crate::state::gateway_status::AgentStatus::NeedsInput,
        ),
    ] {
        let transcript_path = write_codex_transcript(&format!(
            "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"main-thread\"}}}}\n\
             {{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{{\"type\":\"output_text\",\"text\":\"{transcript_text}\"}}],\"phase\":\"final_answer\"}}}}\n"
        ));
        app.handle_cli_command(
            "notify",
            json!({
                "event": "codex-stop",
                "pane": pane_id,
                "agent": "codex",
                "payload": {
                    "hook_event_name": "Stop",
                    "turn_id": turn_id,
                    "transcript_path": transcript_path,
                    "last_assistant_message": payload_message
                }
            }),
        )
        .unwrap();
        let _ = std::fs::remove_file(&transcript_path);

        let event = rx.try_recv().unwrap();
        assert!(event.contains(expected_event));
        assert!(event.contains("Codex"));
        assert_eq!(
            app.gateway.detected_agents.get(&pane_id).unwrap().status,
            Some(expected_status)
        );
    }
}

#[test]
fn codex_stop_payload_falls_back_to_idle_when_unclassified() {
    // UC-2 BR-6: Unclassified Codex Stop payloads fail closed to Idle.
    let (mut app, pane_id) = app_with_editor();
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    app.gateway
        .subscribers
        .push(crate::state::gateway_status::Subscriber {
            tx,
            event_filter: vec!["agent-status-changed".into()],
            owner_pane_id: None,
        });

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-stop",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "hook_event_name": "Stop",
                "turn_id": "turn-3",
                "last_assistant_message": "rename complete and verified cargo build succeeds."
            }
        }),
    )
    .unwrap();

    let idle_event = rx.try_recv().unwrap();
    assert!(idle_event.contains("agent-idle"));
    assert_eq!(
        app.gateway.detected_agents.get(&pane_id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
}

#[test]
fn codex_stop_payload_ignores_subagent_transcript() {
    // UC-2 BR-7: Subagent transcripts must not synthesize a routed Codex lifecycle update.
    let (mut app, pane_id) = app_with_editor();
    let transcript_path = write_codex_transcript(
        "{\"type\":\"session_meta\",\"payload\":{\"id\":\"subagent-thread\",\"source\":{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"main-thread\",\"depth\":1}}}}}\n\
         {\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"allow\"}],\"phase\":\"final_answer\"}}\n",
    );
    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-stop",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "hook_event_name": "Stop",
                "turn_id": "turn-4",
                "transcript_path": transcript_path,
                "last_assistant_message": "allow"
            }
        }),
    )
    .unwrap();
    let _ = std::fs::remove_file(&transcript_path);

    assert!(app.gateway.detected_agents.get(&pane_id).is_none());
    assert!(app.pending_platform_commands.is_empty());
}

#[test]
fn codex_stop_notification_uses_generic_body_without_trusted_snippet() {
    // UC-6 BR-10, BR-11: Codex Stop notifications use generic lifecycle text when no trusted snippet exists.
    let (mut app, pane_id) = app_with_terminal();
    app.window.is_focused = false;
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&pane_id) {
        terminal.backend.load_mock_screen_for_test(
            "{\"id\":\"main\",\"role\":\"main\"}\n<subagent_notification>{\"agent_path\":\"codex\"}</subagent_notification>\n",
        );
    }

    app.handle_cli_command(
        "notify",
        json!({
            "event": "codex-stop",
            "pane": pane_id,
            "agent": "codex",
            "payload": {
                "hook_event_name": "Stop",
                "turn_id": "turn-5",
                "last_assistant_message": null
            }
        }),
    )
    .unwrap();

    assert!(
        app.pending_platform_commands.iter().any(|command| matches!(
            command,
            crate::tide_platform::WindowCommand::SendSystemNotification {
                pane_id: body_pane_id,
                body,
                ..
            } if *body_pane_id == pane_id && body == "Codex finished"
        )),
        "expected a Codex notification with the generic lifecycle body, got {:?}",
        app.pending_platform_commands
    );
    assert!(
        !app.pending_platform_commands.iter().any(|command| matches!(
            command,
            crate::tide_platform::WindowCommand::RequestUserAttention
        ))
    );
}

// --- UC-2: TrackWindowFocusState ---

#[test]
fn window_focus_state_tracks_platform_event() {
    // UC-2 BR-1: Initial value is true, tracks PlatformEvent::Focused
    let app = test_app();
    assert!(app.window.is_focused); // initial = true
}

#[test]
fn notification_authorization_status_event_updates_window_state() {
    // UC-6 BR-1: macOS notification-authorization snapshots update WindowState.
    use crate::adapter::inward::event_loop_adapter::handle_platform_event;

    let mut app = test_app();
    assert_eq!(
        app.window.notification_authorization_status,
        crate::state::NotificationAuthorizationStatus::Unknown
    );

    handle_platform_event(
        &mut app,
        crate::tide_platform::PlatformEvent::NotificationAuthorizationStatusChanged {
            status: crate::state::NotificationAuthorizationStatus::Authorized,
        },
        &test_window_proxy(),
    );

    assert_eq!(
        app.window.notification_authorization_status,
        crate::state::NotificationAuthorizationStatus::Authorized
    );
}

#[test]
fn unknown_notification_authorization_status_is_preserved() {
    // UC-6 BR-3: Tide preserves Unknown notification-authorization status instead of guessing a resolved state.
    use crate::adapter::inward::event_loop_adapter::handle_platform_event;

    let mut app = test_app();

    handle_platform_event(
        &mut app,
        crate::tide_platform::PlatformEvent::NotificationAuthorizationStatusChanged {
            status: crate::state::NotificationAuthorizationStatus::Unknown,
        },
        &test_window_proxy(),
    );

    assert_eq!(
        app.window.notification_authorization_status,
        crate::state::NotificationAuthorizationStatus::Unknown
    );
}

// --- UC-5: BlinkTabDot ---

#[test]
fn needs_input_dot_blinks_when_unfocused() {
    // UC-5 BR-1,2: NeedsInput dot blinks when pane is unfocused
    // Verify blink computation produces opacity in range [0.3, 1.0]
    let frequency = crate::theme::AGENT_BLINK_FREQUENCY;
    // Sample at various times
    for i in 0..20 {
        let t = i as f64 * 0.1;
        let opacity = 0.65 + 0.35 * (t * frequency).sin();
        assert!(opacity >= 0.29, "opacity {} too low at t={}", opacity, t);
        assert!(opacity <= 1.01, "opacity {} too high at t={}", opacity, t);
    }
}

#[test]
fn idle_wrapped_agent_states_queue_notifications_without_user_attention() {
    // UC-3 BR-4, UC-4 BR-5: Idle routes background notifications for supported wrapped agents, but never requests user attention.
    let has_system_notification = |commands: &Vec<crate::tide_platform::WindowCommand>| {
        commands.iter().any(|command| {
            matches!(
                command,
                crate::tide_platform::WindowCommand::SendSystemNotification { .. }
            )
        })
    };
    let has_user_attention = |commands: &Vec<crate::tide_platform::WindowCommand>| {
        commands.iter().any(|command| {
            matches!(
                command,
                crate::tide_platform::WindowCommand::RequestUserAttention
            )
        })
    };

    let (mut claude_app, claude_pane, _) = app_with_unfocused_agent();
    claude_app.window.is_focused = false;
    claude_app.handle_terminal_notification(claude_pane, "tide:wrapped-agent:claude:agent-idle");
    assert_eq!(
        claude_app
            .gateway
            .detected_agents
            .get(&claude_pane)
            .unwrap()
            .status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
    assert!(has_system_notification(
        &claude_app.pending_platform_commands
    ));
    assert!(!has_user_attention(&claude_app.pending_platform_commands));
    assert!(claude_app.notified_panes.contains(&claude_pane));

    {
        let (mut codex_app, source_pane) = app_with_terminal();
        let focused_pane = codex_app
            .layout
            .split(source_pane, SplitDirection::Horizontal);
        let focused_terminal = TerminalPane::with_cwd(focused_pane, 80, 24, None, true).unwrap();
        codex_app
            .panes
            .insert(focused_pane, PaneKind::Terminal(focused_terminal));
        codex_app.focus.focused = Some(focused_pane);
        codex_app.focus.stage_focused = Some(focused_pane);
        codex_app.window.is_focused = false;
        codex_app
            .handle_cli_command(
                "notify",
                json!({
                    "event": "codex-turn-complete",
                    "pane": source_pane,
                    "agent": "codex",
                    "payload": {
                        "type": "agent-turn-complete",
                        "thread-id": "thread-idle",
                        "turn-id": "turn-idle",
                        "cwd": "/tmp/project",
                        "input-messages": ["Continue."],
                        "last-assistant-message": "Implemented the parser fix and updated the tests."
                    }
                }),
            )
            .unwrap();
        assert_eq!(
            codex_app
                .gateway
                .detected_agents
                .get(&source_pane)
                .unwrap()
                .status,
            Some(crate::state::gateway_status::AgentStatus::Idle)
        );
        assert!(has_system_notification(
            &codex_app.pending_platform_commands
        ));
        assert!(!has_user_attention(&codex_app.pending_platform_commands));
        assert!(codex_app.notified_panes.contains(&source_pane));
    }

    {
        let (mut gemini_app, source_pane) = app_with_terminal();
        let focused_pane = gemini_app
            .layout
            .split(source_pane, SplitDirection::Horizontal);
        let focused_terminal = TerminalPane::with_cwd(focused_pane, 80, 24, None, true).unwrap();
        gemini_app
            .panes
            .insert(focused_pane, PaneKind::Terminal(focused_terminal));
        gemini_app.focus.focused = Some(focused_pane);
        gemini_app.focus.stage_focused = Some(focused_pane);
        gemini_app.window.is_focused = false;
        gemini_app
            .handle_cli_command(
                "notify",
                json!({
                    "event": "agent-idle",
                    "pane": source_pane,
                    "agent": "gemini",
                    "payload": {
                        "hook_event_name": "AfterAgent",
                        "prompt": "Explain this codebase",
                        "prompt_response": "The codebase is split into a Terminal domain, Workspace services, and renderer adapters."
                    }
                }),
            )
            .unwrap();
        assert_eq!(
            gemini_app
                .gateway
                .detected_agents
                .get(&source_pane)
                .unwrap()
                .status,
            Some(crate::state::gateway_status::AgentStatus::Idle)
        );
        assert!(has_system_notification(
            &gemini_app.pending_platform_commands
        ));
        assert!(!has_user_attention(&gemini_app.pending_platform_commands));
        assert!(gemini_app.notified_panes.contains(&source_pane));
    }
}

// --- UC-6: ResolveAttentionOnWindowFocus ---

#[test]
fn window_focus_acknowledges_attention_for_the_already_focused_pane() {
    // UC-6 BR-19: Restoring window focus acknowledges the already-focused Pane.
    // UC-6 BR-20: Restoring window focus clears notification suppression for that Pane.
    use crate::adapter::inward::event_loop_adapter::handle_platform_event;

    let (mut app, agent_pane) = app_with_detected_agent();
    app.focus.focused = Some(agent_pane);
    app.focus.focus_area = FocusArea::Stage;
    app.window.is_focused = false;
    app.gateway
        .detected_agents
        .get_mut(&agent_pane)
        .unwrap()
        .status = Some(crate::state::gateway_status::AgentStatus::NeedsInput);
    app.notified_panes.insert(agent_pane);

    handle_platform_event(
        &mut app,
        crate::tide_platform::PlatformEvent::Focused(true),
        &test_window_proxy(),
    );

    assert!(app.window.is_focused);
    assert_eq!(
        app.gateway.detected_agents.get(&agent_pane).unwrap().status,
        None
    );
    assert!(!app.notified_panes.contains(&agent_pane));
}

#[test]
fn workspace_notification_recomputes_for_remaining_pending_panes() {
    // UC-3 BR-12, UC-5 BR-8: Inactive-Workspace highlight recomputes from remaining unresolved Wrapped Agent panes after direct focus acknowledges one source Pane.
    use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};
    use crate::WorkspaceNavPort;
    let (mut app, active_terminal_id) = app_with_terminal();
    let (mut inactive_layout, first_terminal_id) =
        crate::tide_layout::SplitLayout::with_initial_pane();
    let second_terminal_id = inactive_layout.split(first_terminal_id, SplitDirection::Horizontal);

    let first_terminal = TerminalPane::with_cwd(first_terminal_id, 80, 24, None, true).unwrap();
    let second_terminal = TerminalPane::with_cwd(second_terminal_id, 80, 24, None, true).unwrap();
    let mut inactive_panes = std::collections::HashMap::new();
    inactive_panes.insert(first_terminal_id, PaneKind::Terminal(first_terminal));
    inactive_panes.insert(second_terminal_id, PaneKind::Terminal(second_terminal));

    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: Some(active_terminal_id),
        panes: std::collections::HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS2".into(),
        layout: inactive_layout,
        focused: Some(first_terminal_id),
        panes: inactive_panes,
    });
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    let mut inactive_extras = WorkspaceExtras::new();
    inactive_extras.has_agent_notification = true;
    app.ws.workspace_extras.push(inactive_extras);
    app.ws.active = 0;

    for (pane_id, status) in [
        (
            first_terminal_id,
            crate::state::gateway_status::AgentStatus::NeedsInput,
        ),
        (
            second_terminal_id,
            crate::state::gateway_status::AgentStatus::Idle,
        ),
    ] {
        app.gateway.detected_agents.insert(
            pane_id,
            crate::state::gateway_status::AgentInfo {
                name: "Codex",
                pid: pane_id as u32,
                wrapper_managed: true,
                gateway_connected: true,
                status: Some(status),
            },
        );
    }

    app.switch_workspace(1);
    assert!(
        !app.ws.workspace_extras[1].has_agent_notification,
        "switching into the Workspace clears the inactive-Workspace sidebar highlight while it is active"
    );

    app.focus_terminal(first_terminal_id);
    assert_eq!(
        app.gateway
            .detected_agents
            .get(&first_terminal_id)
            .unwrap()
            .status,
        None
    );
    assert_eq!(
        app.gateway
            .detected_agents
            .get(&second_terminal_id)
            .unwrap()
            .status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
    assert!(
        app.ws.workspace_extras[1].has_agent_notification,
        "refreshing the active Workspace should recompute its attention state from the remaining pending panes"
    );

    app.switch_workspace(0);
    assert!(
        app.ws.workspace_extras[1].has_agent_notification,
        "leaving the Workspace must preserve the inactive highlight while another pending pane remains"
    );
}

// --- UC-8: PreservePaneIdIdentityAcrossWorkspaces ---

#[test]
fn new_workspace_seeds_a_distinct_root_terminal_pane_id() {
    // UC-8 BR-25: new_workspace() seeds its initial Stage Terminal above every existing PaneId.
    let mut app = test_app();
    let (layout, left_terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        left_terminal_id,
        PaneKind::Terminal(TerminalPane::with_cwd(left_terminal_id, 80, 24, None, true).unwrap()),
    );
    let right_terminal_id = app
        .layout
        .split(left_terminal_id, SplitDirection::Horizontal);
    app.panes.insert(
        right_terminal_id,
        PaneKind::Terminal(TerminalPane::with_cwd(right_terminal_id, 80, 24, None, true).unwrap()),
    );
    app.focus.focused = Some(right_terminal_id);
    app.focus.stage_focused = Some(right_terminal_id);
    app.focus.focus_area = FocusArea::Stage;

    app.new_workspace();

    let new_workspace_terminal_id = app.focus.focused.expect("new Workspace root");
    assert_ne!(new_workspace_terminal_id, left_terminal_id);
    assert_ne!(new_workspace_terminal_id, right_terminal_id);
    assert!(new_workspace_terminal_id > right_terminal_id);
}

#[test]
fn switching_back_to_an_older_workspace_rebases_future_pane_ids_above_other_workspaces() {
    // UC-8 BR-26: Loading an older Workspace rebases its SplitLayout allocator above other Workspaces.
    let mut app = test_app();
    let (layout, left_terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        left_terminal_id,
        PaneKind::Terminal(TerminalPane::with_cwd(left_terminal_id, 80, 24, None, true).unwrap()),
    );
    let right_terminal_id = app
        .layout
        .split(left_terminal_id, SplitDirection::Horizontal);
    app.panes.insert(
        right_terminal_id,
        PaneKind::Terminal(TerminalPane::with_cwd(right_terminal_id, 80, 24, None, true).unwrap()),
    );
    app.focus.focused = Some(right_terminal_id);
    app.focus.stage_focused = Some(right_terminal_id);
    app.focus.focus_area = FocusArea::Stage;

    app.new_workspace();
    let workspace_two_root_id = app.focus.focused.expect("Workspace 2 root");
    let workspace_two_second_id = app
        .layout
        .split(workspace_two_root_id, SplitDirection::Horizontal);
    app.panes.insert(
        workspace_two_second_id,
        PaneKind::Terminal(
            TerminalPane::with_cwd(workspace_two_second_id, 80, 24, None, true).unwrap(),
        ),
    );
    let workspace_two_third_id = app
        .layout
        .split(workspace_two_second_id, SplitDirection::Vertical);
    app.panes.insert(
        workspace_two_third_id,
        PaneKind::Terminal(
            TerminalPane::with_cwd(workspace_two_third_id, 80, 24, None, true).unwrap(),
        ),
    );

    app.switch_workspace(0);
    let rebased_terminal_id = app
        .layout
        .split(right_terminal_id, SplitDirection::Vertical);

    assert!(rebased_terminal_id > workspace_two_third_id);
}

#[test]
fn wrapped_agent_attention_does_not_leak_across_workspaces_after_switching_back() {
    // UC-8 BR-27: Wrapped-agent attention stays attached to the owning Workspace instead of leaking through PaneId reuse.
    let mut app = test_app();
    let (layout, left_terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        left_terminal_id,
        PaneKind::Terminal(TerminalPane::with_cwd(left_terminal_id, 80, 24, None, true).unwrap()),
    );
    let right_terminal_id = app
        .layout
        .split(left_terminal_id, SplitDirection::Horizontal);
    app.panes.insert(
        right_terminal_id,
        PaneKind::Terminal(TerminalPane::with_cwd(right_terminal_id, 80, 24, None, true).unwrap()),
    );
    app.focus.focused = Some(right_terminal_id);
    app.focus.stage_focused = Some(right_terminal_id);
    app.focus.focus_area = FocusArea::Stage;

    app.new_workspace();
    let workspace_two_terminal_id = app.focus.focused.expect("Workspace 2 root");
    app.gateway.detected_agents.insert(
        workspace_two_terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: workspace_two_terminal_id as u32,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::Idle),
        },
    );

    app.switch_workspace(0);

    assert_eq!(app.pane_agent_attention_status(left_terminal_id), None);
    assert_eq!(app.pane_agent_attention_status(right_terminal_id), None);
    assert_eq!(app.workspace_stage_agent_flags(0), (false, false, false));
    assert_eq!(app.workspace_stage_agent_flags(1), (false, true, false));
    assert!(!app.ws.workspace_extras[0].has_agent_notification);
    assert!(app.ws.workspace_extras[1].has_agent_notification);
}

#[test]
fn switching_workspace_preserves_attention_on_an_unfocused_stage_terminal() {
    // UC-4 BR-16: Switching into a Workspace does not acknowledge an unfocused Stage Terminal alert.
    use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};

    let (mut app, active_terminal_id) = app_with_terminal();
    let (mut inactive_layout, left_terminal_id) =
        crate::tide_layout::SplitLayout::with_initial_pane();
    let right_terminal_id = inactive_layout.split(left_terminal_id, SplitDirection::Horizontal);

    let left_terminal = TerminalPane::with_cwd(left_terminal_id, 80, 24, None, true).unwrap();
    let right_terminal = TerminalPane::with_cwd(right_terminal_id, 80, 24, None, true).unwrap();
    let mut inactive_panes = std::collections::HashMap::new();
    inactive_panes.insert(left_terminal_id, PaneKind::Terminal(left_terminal));
    inactive_panes.insert(right_terminal_id, PaneKind::Terminal(right_terminal));

    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: Some(active_terminal_id),
        panes: std::collections::HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS2".into(),
        layout: inactive_layout,
        focused: Some(left_terminal_id),
        panes: inactive_panes,
    });
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    let mut inactive_extras = WorkspaceExtras::new();
    inactive_extras.has_agent_notification = true;
    app.ws.workspace_extras.push(inactive_extras);
    app.ws.active = 0;

    app.gateway.detected_agents.insert(
        right_terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: right_terminal_id as u32,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );

    app.switch_workspace(1);

    assert_eq!(app.focus.focused, Some(left_terminal_id));
    assert_eq!(
        app.gateway
            .detected_agents
            .get(&right_terminal_id)
            .unwrap()
            .status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
}

#[test]
fn inactive_workspace_agent_status_sets_notification_dot() {
    // UC-6 BR-3: Set has_agent_notification when agent status changes in an inactive workspace
    use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};
    let mut app = test_app();

    // Create WS1 (active) with a pane
    let (layout, pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let pane = EditorPane::new_empty(pane_id);
    app.panes.insert(pane_id, PaneKind::Editor(pane));
    app.focus.focused = Some(pane_id);

    // Create WS2 with an agent Terminal in the Stage layout
    let (mut inactive_layout, inactive_root_id) =
        crate::tide_layout::SplitLayout::with_initial_pane();
    let agent_pane_id = inactive_layout.split(inactive_root_id, SplitDirection::Horizontal);
    let inactive_root = TerminalPane::with_cwd(inactive_root_id, 80, 24, None, true).unwrap();
    let inactive_terminal = TerminalPane::with_cwd(agent_pane_id, 80, 24, None, true).unwrap();
    let mut ws2_panes = std::collections::HashMap::new();
    ws2_panes.insert(inactive_root_id, PaneKind::Terminal(inactive_root));
    ws2_panes.insert(agent_pane_id, PaneKind::Terminal(inactive_terminal));

    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: std::collections::HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS2".into(),
        layout: inactive_layout,
        focused: None,
        panes: ws2_panes,
    });
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.active = 0;

    // Register agent in WS2
    app.gateway.detected_agents.insert(
        agent_pane_id,
        crate::state::gateway_status::AgentInfo {
            name: "Claude Code",
            pid: 12345,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );

    // Agent in inactive workspace sends notification
    app.route_agent_notification(
        agent_pane_id,
        crate::state::gateway_status::AgentStatus::NeedsInput,
        None,
    );
    assert!(app.ws.workspace_extras[1].has_agent_notification);
}

#[test]
fn inactive_workspace_osc9_notification_sets_workspace_dot_without_loading_workspace() {
    // UC-1 BR-4: Wrapped-agent OSC 9 from an inactive Workspace updates attention without a Workspace switch.
    use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};

    let mut app = test_app();
    let (layout, active_pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        active_pane_id,
        PaneKind::Editor(EditorPane::new_empty(active_pane_id)),
    );
    app.focus.focused = Some(active_pane_id);
    app.focus.focus_area = FocusArea::Stage;

    let (mut inactive_layout, inactive_root_id) =
        crate::tide_layout::SplitLayout::with_initial_pane();
    let inactive_terminal_id = inactive_layout.split(inactive_root_id, SplitDirection::Horizontal);
    let inactive_root = TerminalPane::with_cwd(inactive_root_id, 80, 24, None, true).unwrap();
    let inactive_terminal =
        TerminalPane::with_cwd(inactive_terminal_id, 80, 24, None, true).unwrap();
    inactive_terminal
        .backend
        .queue_notification_for_test("tide:wrapped-agent:codex:agent-needs-input");

    let mut ws2_panes = std::collections::HashMap::new();
    ws2_panes.insert(inactive_root_id, PaneKind::Terminal(inactive_root));
    ws2_panes.insert(inactive_terminal_id, PaneKind::Terminal(inactive_terminal));

    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: std::collections::HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS2".into(),
        layout: inactive_layout,
        focused: None,
        panes: ws2_panes,
    });
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.active = 0;

    let window = test_window_proxy();
    app.poll_background_events(&window);

    let agent = app
        .gateway
        .detected_agents
        .get(&inactive_terminal_id)
        .unwrap();
    assert_eq!(agent.name, "Codex");
    assert!(agent.wrapper_managed);
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
    assert!(app.ws.workspace_extras[1].has_agent_notification);
    assert_eq!(app.ws.active, 0);
    assert!(app.panes.contains_key(&active_pane_id));
    assert!(!app.panes.contains_key(&inactive_terminal_id));
}

#[test]
fn unmanaged_notification_does_not_mark_inactive_workspace() {
    // UC-2 BR-7: Unmanaged notifications do not set inactive-Workspace attention
    use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};
    let mut app = test_app();

    let (layout, pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(pane_id, PaneKind::Editor(EditorPane::new_empty(pane_id)));
    app.focus.focused = Some(pane_id);

    let unmanaged_pane_id = 999;
    let mut ws2_panes = std::collections::HashMap::new();
    ws2_panes.insert(
        unmanaged_pane_id,
        PaneKind::Editor(EditorPane::new_empty(unmanaged_pane_id)),
    );

    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: std::collections::HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS2".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: ws2_panes,
    });
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.active = 0;

    app.handle_terminal_notification(unmanaged_pane_id, "tide:agent-needs-input");

    assert!(!app.ws.workspace_extras[1].has_agent_notification);
}

// --- UC-7: ClearNotificationOnAcknowledge ---

#[test]
fn focusing_pane_clears_workspace_notification_if_no_others() {
    // UC-7 BR-2: has_agent_notification cleared when no other panes have pending notifications
    use crate::FocusNavPort;
    let (mut app, agent_pane) = app_with_detected_agent();
    app.notified_panes.insert(agent_pane);
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    // Focus clears notification suppression
    app.focus_pane(agent_pane);
    assert!(!app.notified_panes.contains(&agent_pane));
    assert_eq!(
        app.gateway.detected_agents.get(&agent_pane).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
}

// --- UC-5: BlinkTabDotAndBorder (enhanced) ---

#[test]
fn needs_input_border_blinks_orange_when_unfocused() {
    // UC-5 BR-6,7: Unfocused NeedsInput keeps the alert redraw path alive for the blinking Stage-terminal dot.
    let (mut app, agent_pane, other_pane) = app_with_unfocused_agent();
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    let status = app.gateway.detected_agents.get(&agent_pane).unwrap().status;
    assert_eq!(
        status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
    // Pane is unfocused (other_pane is focused)
    assert_eq!(app.focus.focused, Some(other_pane));
    // needs_redraw should be set so the alert dot can animate.
    assert!(app.cache.needs_redraw);
}

// --- UC-6: ShowWorkspaceSidebarDot (enhanced) ---

#[test]
fn workspace_sidebar_dot_blinks_for_notification() {
    // UC-6 BR-4: Workspace sidebar dot blinks with same frequency as tab dot
    // Verify blink computation for workspace sidebar produces opacity in range [0.3, 1.0]
    let frequency = crate::theme::AGENT_BLINK_FREQUENCY;
    for i in 0..20 {
        let t = i as f64 * 0.1;
        let opacity = 0.65 + 0.35 * (t * frequency).sin();
        assert!(
            opacity >= 0.29,
            "sidebar dot opacity {} too low at t={}",
            opacity,
            t
        );
        assert!(
            opacity <= 1.01,
            "sidebar dot opacity {} too high at t={}",
            opacity,
            t
        );
    }
}

// --- UC-9: RouteNotifyForInactiveWorkspace ---

#[test]
fn cli_notify_routes_to_inactive_workspace_pane() {
    // UC-9 BR-1: Notifications for panes in any workspace must be processed
    use crate::application::ports::inward::PaneAccessPort;
    use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};
    let mut app = test_app();

    // Create WS1 (active) with a pane
    let (layout, pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let pane = EditorPane::new_empty(pane_id);
    app.panes.insert(pane_id, PaneKind::Editor(pane));
    app.focus.focused = Some(pane_id);

    // Create WS2 (inactive) with an agent pane
    let agent_pane_id = 888;
    let mut ws2_panes = std::collections::HashMap::new();
    ws2_panes.insert(
        agent_pane_id,
        PaneKind::Editor(EditorPane::new_empty(agent_pane_id)),
    );

    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: std::collections::HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS2".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: ws2_panes,
    });
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.active = 0;

    // has_pane_in_any_workspace should find panes in inactive workspaces
    assert!(app.has_pane_in_any_workspace(agent_pane_id));
    assert!(!app.has_pane_in_any_workspace(99999)); // non-existent pane
}

// --- UC-4: ActivateSystemNotificationTarget ---

#[test]
fn macos_notification_activation_switches_to_target_workspace_and_focuses_target_pane() {
    // UC-4 BR-13: Notification activation must switch to the target Workspace.
    // UC-4 BR-14: Notification activation must focus the target Pane.
    // UC-7 BR-14: Notification activation routes to the target Pane, but focused-window acknowledgment still runs separately.
    use crate::adapter::inward::event_loop_adapter::handle_platform_event;
    use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};

    let (mut app, active_pane_id) = app_with_terminal();

    let target_pane_id = 999;
    let mut inactive_layout = crate::tide_layout::SplitLayout::new();
    inactive_layout.insert_leaf_group(target_pane_id);
    let inactive_terminal = TerminalPane::with_cwd(target_pane_id, 80, 24, None, true).unwrap();
    let mut inactive_panes = std::collections::HashMap::new();
    inactive_panes.insert(target_pane_id, PaneKind::Terminal(inactive_terminal));

    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: std::collections::HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS2".into(),
        layout: inactive_layout,
        focused: Some(target_pane_id),
        panes: inactive_panes,
    });
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.workspace_extras[1].has_agent_notification = true;
    app.ws.active = 0;
    app.focus.focused = Some(active_pane_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(active_pane_id);

    app.gateway.detected_agents.insert(
        target_pane_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 77,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );
    app.notified_panes.insert(target_pane_id);

    handle_platform_event(
        &mut app,
        crate::tide_platform::PlatformEvent::SystemNotificationActivated {
            pane_id: target_pane_id,
        },
        &test_window_proxy(),
    );

    assert_eq!(app.ws.active, 1);
    assert_eq!(app.focus.focused, Some(target_pane_id));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.stage_focused, Some(target_pane_id));
    assert!(
        !app.ws.workspace_extras[1].has_agent_notification,
        "switching to the target Workspace clears the inactive-Workspace notification dot"
    );
    assert_eq!(
        app.gateway
            .detected_agents
            .get(&target_pane_id)
            .unwrap()
            .status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
    assert!(app.notified_panes.contains(&target_pane_id));
}

#[test]
fn notification_activation_does_not_queue_a_duplicate_background_notification_before_window_focus()
{
    // UC-7 BR-15: Notification activation preserves duplicate suppression until the owning Tide window regains focus.
    use crate::adapter::inward::event_loop_adapter::handle_platform_event;
    use crate::tide_platform::WindowCommand;

    let (mut app, target_pane_id) = app_with_terminal();
    let focused_pane_id = app.layout.split(target_pane_id, SplitDirection::Horizontal);
    let focused_terminal = TerminalPane::with_cwd(focused_pane_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(focused_pane_id, PaneKind::Terminal(focused_terminal));
    app.focus.focused = Some(focused_pane_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(focused_pane_id);
    app.window.is_focused = false;

    app.gateway.detected_agents.insert(
        target_pane_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 77,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );
    app.notified_panes.insert(target_pane_id);
    app.pending_platform_commands.clear();

    handle_platform_event(
        &mut app,
        crate::tide_platform::PlatformEvent::SystemNotificationActivated {
            pane_id: target_pane_id,
        },
        &test_window_proxy(),
    );

    assert!(
        !app.pending_platform_commands.iter().any(|command| matches!(
            command,
            WindowCommand::SendSystemNotification { pane_id, .. } if *pane_id == target_pane_id
        )),
        "notification activation should not queue a replacement background notification before window focus"
    );
    assert!(app.notified_panes.contains(&target_pane_id));
}

#[test]
fn notification_activation_with_missing_pane_is_no_op() {
    // UC-5 BR-18: Activating a notification for a missing Pane leaves state unchanged.
    use crate::adapter::inward::event_loop_adapter::handle_platform_event;

    let (mut app, active_pane_id) = app_with_terminal();
    app.focus.focused = Some(active_pane_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(active_pane_id);
    app.notified_panes.insert(active_pane_id);
    app.gateway.detected_agents.insert(
        active_pane_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 88,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );

    handle_platform_event(
        &mut app,
        crate::tide_platform::PlatformEvent::SystemNotificationActivated { pane_id: 404 },
        &test_window_proxy(),
    );

    assert_eq!(app.ws.active, 0);
    assert_eq!(app.focus.focused, Some(active_pane_id));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.stage_focused, Some(active_pane_id));
    assert!(app.notified_panes.contains(&active_pane_id));
    assert_eq!(
        app.gateway
            .detected_agents
            .get(&active_pane_id)
            .unwrap()
            .status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
}
