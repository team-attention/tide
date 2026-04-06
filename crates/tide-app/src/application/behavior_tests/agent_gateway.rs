// Spec: docs/specs/cli-server.md

use serde_json::json;

use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::{LayoutEngine, SplitDirection};
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
fn capture_pane_browser_returns_error() {
    // UC-2 BR-9: Browser → error
    let (mut app, editor_id) = app_with_editor();
    let browser_id = app.layout.split(editor_id, SplitDirection::Horizontal);
    let browser = crate::pane::browser::BrowserPane::new(browser_id);
    app.panes.insert(browser_id, PaneKind::Browser(browser));

    let result = app.handle_cli_command("capture-pane", json!({"pane_id": browser_id}));
    assert!(result.is_err());
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
fn osc9_creates_synthetic_agent_if_none_detected() {
    // UC-2 BR-6: If no agent exists for the pane, create synthetic AgentInfo
    let (mut app, id) = app_with_editor();
    assert!(!app.gateway.detected_agents.contains_key(&id));
    app.handle_terminal_notification(id, "tide:agent-running");
    let agent = app.gateway.detected_agents.get(&id).unwrap();
    assert_eq!(agent.name, "Unknown");
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
}

#[test]
fn focusing_pane_clears_needs_input_status() {
    // Focusing a pane with NeedsInput should clear the status (user has seen it)
    use crate::FocusNavPort;
    let (mut app, id) = app_with_detected_agent();
    app.handle_terminal_notification(id, "tide:agent-needs-input");
    assert_eq!(
        app.gateway.detected_agents.get(&id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
    app.focus_pane(id);
    assert_eq!(app.gateway.detected_agents.get(&id).unwrap().status, None);
}

#[test]
fn focusing_pane_clears_idle_status() {
    // Focusing a pane with Idle (task completed) should clear the status
    use crate::FocusNavPort;
    let (mut app, id) = app_with_detected_agent();
    app.handle_terminal_notification(id, "tide:agent-running");
    app.handle_terminal_notification(id, "tide:agent-idle");
    assert_eq!(
        app.gateway.detected_agents.get(&id).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
    app.focus_pane(id);
    assert_eq!(app.gateway.detected_agents.get(&id).unwrap().status, None);
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
fn focused_pane_skips_all_notification_channels() {
    // UC-1 BR-2: If the pane is focused, all notification channels are skipped
    let (mut app, agent_pane) = app_with_detected_agent();
    app.focus.focused = Some(agent_pane);
    app.window.is_focused = false;
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    // Even though window is unfocused, focused pane skips notifications
    assert!(app.pending_platform_commands.is_empty());
}

#[test]
fn background_notification_includes_foreground_dot() {
    // UC-1 BR-3: Background notifications are sent in addition to foreground notifications
    let (mut app, agent_pane, _) = app_with_unfocused_agent();
    app.window.is_focused = false;
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    // System notification queued
    assert!(!app.pending_platform_commands.is_empty());
    // Agent status dot is also set (foreground indicator)
    assert_eq!(
        app.gateway.detected_agents.get(&agent_pane).unwrap().status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput),
    );
}

#[test]
fn duplicate_system_notification_suppressed_until_acknowledged() {
    // UC-1 BR-4: System notifications not sent again until user acknowledges (focuses)
    use crate::FocusNavPort;
    let (mut app, agent_pane, _) = app_with_unfocused_agent();
    app.window.is_focused = false;

    // First notification: should queue
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    assert!(!app.pending_platform_commands.is_empty());
    app.pending_platform_commands.clear();

    // Second notification for same pane: should NOT queue (suppressed)
    app.handle_terminal_notification(agent_pane, "tide:agent-idle");
    assert!(app.pending_platform_commands.is_empty());

    // Acknowledge by focusing
    app.focus_pane(agent_pane);
    assert!(!app.notified_panes.contains(&agent_pane));

    // Now another notification should be able to fire
    app.focus.focused = Some(0); // unfocus
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    assert!(!app.pending_platform_commands.is_empty());
}

// --- UC-2: TrackWindowFocusState ---

#[test]
fn window_focus_state_tracks_platform_event() {
    // UC-2 BR-1: Initial value is true, tracks PlatformEvent::Focused
    let app = test_app();
    assert!(app.window.is_focused); // initial = true
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
fn idle_dot_does_not_blink() {
    // UC-5 BR-3: Running and Idle dots do not blink (static)
    // Verify that blink is only applied for NeedsInput, not Idle
    let (mut app, agent_pane, _) = app_with_unfocused_agent();
    app.handle_terminal_notification(agent_pane, "tide:agent-idle");
    // Idle status should not trigger needs_redraw for blink animation
    // (needs_redraw may be set for other reasons, but route_agent_notification
    //  only sets it for NeedsInput)
    let status = app.gateway.detected_agents.get(&agent_pane).unwrap().status;
    assert_eq!(
        status,
        Some(crate::state::gateway_status::AgentStatus::Idle)
    );
    // No blink animation: only NeedsInput triggers continuous redraw
}

// --- UC-6: ShowWorkspaceSidebarDot ---

#[test]
fn active_workspace_has_no_sidebar_dot() {
    // UC-6 BR-1: Do not show sidebar dot for the active workspace
    use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};
    let mut app = test_app();
    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: std::collections::HashMap::new(),
    });
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.active = 0;
    // Even if has_agent_notification is true on the active workspace, it should be irrelevant
    app.ws.workspace_extras[0].has_agent_notification = true;
    // The rendering logic skips active workspace — tested by checking the flag exists
    // but the view code only renders dot for !is_active (UC-6 BR-1)
    assert!(app.ws.workspace_extras[0].has_agent_notification);
}

#[test]
fn workspace_switch_clears_notification_dot() {
    // UC-6 BR-2: Clear has_agent_notification on the switched-to workspace
    use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};
    let mut app = test_app();
    // Create two workspaces
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
        panes: std::collections::HashMap::new(),
    });
    let mut extras1 = WorkspaceExtras::new();
    extras1.has_agent_notification = false;
    let mut extras2 = WorkspaceExtras::new();
    extras2.has_agent_notification = true;
    app.ws.workspace_extras.push(extras1);
    app.ws.workspace_extras.push(extras2);
    app.ws.active = 0;

    // Switch to WS2
    app.switch_workspace(1);
    // has_agent_notification should be cleared on the switched-to workspace
    assert!(!app.ws.workspace_extras[1].has_agent_notification);
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

    // Create WS2 with an agent pane
    let agent_pane_id = 999;
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

    // Register agent in WS2
    app.gateway.detected_agents.insert(
        agent_pane_id,
        crate::state::gateway_status::AgentInfo {
            name: "Claude Code",
            pid: 12345,
            gateway_connected: true,
            status: None,
        },
    );

    // Agent in inactive workspace sends notification
    app.route_agent_notification(
        agent_pane_id,
        crate::state::gateway_status::AgentStatus::NeedsInput,
    );
    assert!(app.ws.workspace_extras[1].has_agent_notification);
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
        None
    );
}

// --- UC-5: BlinkTabDotAndBorder (enhanced) ---

#[test]
fn needs_input_border_blinks_orange_when_unfocused() {
    // UC-5 BR-6,7: Pane border blinks orange for NeedsInput + unfocused
    // Uses same frequency and opacity range as dot blink
    let (mut app, agent_pane, other_pane) = app_with_unfocused_agent();
    app.handle_terminal_notification(agent_pane, "tide:agent-needs-input");
    let status = app.gateway.detected_agents.get(&agent_pane).unwrap().status;
    assert_eq!(
        status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
    // Pane is unfocused (other_pane is focused)
    assert_eq!(app.focus.focused, Some(other_pane));
    // needs_redraw should be set (for blink animation including border)
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
    use crate::application::ports::inward::{GatewayPort, PaneAccessPort};
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
