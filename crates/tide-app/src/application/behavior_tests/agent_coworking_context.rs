// Spec: docs/specs/agent-coworking-context.md

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;

use serde_json::json;

use crate::adapter::inward::cli_adapter::mcp;
use crate::adapter::outward::view::header::{
    active_tab_badges, reserve_title_before_badges, HeaderHitAction,
};
use crate::application::ports::outward::persistence_port::Session;
use crate::pane::browser::BrowserPane;
use crate::pane::diff::{DiffFileEntry, DiffLine, DiffPane};
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, Selection, TerminalPane};
use crate::state::context_artifact::{
    format_context_artifact_terminal_input, wrap_terminal_input_for_paste,
};
use crate::state::FocusArea;
use crate::state::InputLine;
use crate::tide_core::{LayoutEngine, SplitDirection};
use crate::App;
use crate::DockPort;

static NEXT_MARKDOWN_FILE_ID: AtomicUsize = AtomicUsize::new(0);

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn test_window_proxy() -> crate::tide_platform::WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    crate::tide_platform::WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

fn app_with_terminal() -> (App, u64) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(terminal_id);
    (app, terminal_id)
}

fn add_editor(app: &mut App, anchor_id: u64, lines: &[&str]) -> u64 {
    let editor_id = app.layout.split(anchor_id, SplitDirection::Vertical);
    let mut editor = EditorPane::new_empty(editor_id);
    editor.editor.buffer.lines = lines.iter().map(|line| (*line).to_string()).collect();
    app.panes.insert(editor_id, PaneKind::Editor(editor));
    editor_id
}

fn add_dock_editor(app: &mut App, terminal_id: u64, lines: &[&str]) -> u64 {
    let editor_id = app.layout.alloc_id();
    let mut editor = EditorPane::new_empty(editor_id);
    editor.editor.buffer.lines = lines.iter().map(|line| (*line).to_string()).collect();
    app.panes.insert(editor_id, PaneKind::Editor(editor));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.add_pane_to_dock(editor_id, None);
    editor_id
}

fn temp_markdown_path(label: &str) -> PathBuf {
    let id = NEXT_MARKDOWN_FILE_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "tide_agent_coworking_context_{}_{}_{}.md",
        std::process::id(),
        id,
        label
    ))
}

fn add_dock_markdown_editor(app: &mut App, terminal_id: u64, contents: &str) -> u64 {
    let editor_id = app.layout.alloc_id();
    let path = temp_markdown_path("live_preview");
    std::fs::write(&path, contents).unwrap();
    let editor = EditorPane::open(editor_id, &path).unwrap();
    app.panes.insert(editor_id, PaneKind::Editor(editor));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.add_pane_to_dock(editor_id, None);
    app.assoc.associated_terminal.insert(editor_id, terminal_id);
    editor_id
}

fn add_dock_terminal(app: &mut App, terminal_id: u64) -> u64 {
    let dock_terminal_id = app.layout.alloc_id();
    let dock_terminal = TerminalPane::with_cwd(dock_terminal_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(dock_terminal_id, PaneKind::Terminal(dock_terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.add_pane_to_dock(dock_terminal_id, None);
    app.assoc
        .associated_terminal
        .insert(dock_terminal_id, terminal_id);
    dock_terminal_id
}

fn add_markdown_editor(app: &mut App, terminal_id: u64, contents: &str) -> u64 {
    let editor_id = app.layout.split(terminal_id, SplitDirection::Vertical);
    let path = temp_markdown_path("stage_live_preview");
    std::fs::write(&path, contents).unwrap();
    let editor = EditorPane::open(editor_id, &path).unwrap();
    app.panes.insert(editor_id, PaneKind::Editor(editor));
    app.assoc.associated_terminal.insert(editor_id, terminal_id);
    app.focus.focused = Some(editor_id);
    app.focus.stage_focused = Some(editor_id);
    app.focus.focus_area = FocusArea::Stage;
    editor_id
}

fn add_diff(app: &mut App, anchor_id: u64) -> u64 {
    let diff_id = app.layout.split(anchor_id, SplitDirection::Horizontal);
    let mut diff = DiffPane::new_empty(diff_id, PathBuf::from("/tmp"));
    diff.files = vec![DiffFileEntry {
        status: "M".into(),
        path: "src/lib.rs".into(),
        additions: 1,
        deletions: 0,
    }];
    diff.expanded = HashSet::from([0]);
    diff.diff_cache.insert(
        0,
        vec![
            DiffLine::Context("alpha".into()),
            DiffLine::Added("beta".into()),
        ],
    );
    app.panes.insert(diff_id, PaneKind::Diff(diff));
    diff_id
}

fn add_browser(app: &mut App, anchor_id: u64) -> u64 {
    let browser_id = app.layout.split(anchor_id, SplitDirection::Horizontal);
    let browser = BrowserPane::with_url(browser_id, "https://example.com".into());
    app.panes.insert(browser_id, PaneKind::Browser(browser));
    browser_id
}

fn add_dock_browser(app: &mut App, terminal_id: u64) -> u64 {
    let browser_id = app.layout.alloc_id();
    let browser = BrowserPane::with_url(browser_id, "https://example.com".into());
    app.panes.insert(browser_id, PaneKind::Browser(browser));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.add_pane_to_dock(browser_id, None);
    browser_id
}

fn add_render_browser(app: &mut App, anchor_id: u64) -> u64 {
    let browser_id = app.layout.split(anchor_id, SplitDirection::Horizontal);
    let browser = BrowserPane::new_render(browser_id, "Preview".into(), "<p>hello</p>".into());
    app.panes.insert(browser_id, PaneKind::Browser(browser));
    browser_id
}

// --- UC-1: PaneSelectionCapture ---

#[test]
fn capture_selection_returns_editor_text_and_range_metadata() {
    // UC-1 BR-1, BR-2: Editor Pane selection capture is supported and returns range metadata.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_editor(&mut app, terminal_id, &["hello world"]);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 5),
        });
    }

    let result = app
        .handle_cli_command("capture-selection", json!({"pane_id": editor_id}))
        .unwrap();

    assert_eq!(result["pane_id"], editor_id);
    assert_eq!(result["content"], "hello");
    assert_eq!(result["selection"]["anchor_row"], 0);
    assert_eq!(result["selection"]["end_col"], 5);
}

#[test]
fn capture_selection_returns_diff_text_and_range_metadata() {
    // UC-1 BR-1, BR-2: Diff Pane selection capture is supported and returns range metadata.
    let (mut app, terminal_id) = app_with_terminal();
    let diff_id = add_diff(&mut app, terminal_id);
    if let Some(PaneKind::Diff(diff)) = app.panes.get_mut(&diff_id) {
        diff.selection = Some(Selection {
            anchor: (2, 0),
            end: (2, 6),
        });
    }

    let result = app
        .handle_cli_command("capture-selection", json!({"pane_id": diff_id}))
        .unwrap();

    assert_eq!(result["pane_id"], diff_id);
    assert_eq!(result["content"], "+ beta");
    assert_eq!(result["selection"]["anchor_row"], 2);
    assert_eq!(result["selection"]["end_col"], 6);
}

#[test]
fn capture_selection_supports_terminal_pane() {
    // UC-1 BR-1, BR-2: Terminal Pane selection capture is supported and returns source metadata.
    let (mut app, terminal_id) = app_with_terminal();
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&terminal_id) {
        terminal.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 0),
        });
    }

    let result = app
        .handle_cli_command("capture-selection", json!({"pane_id": terminal_id}))
        .unwrap();

    assert_eq!(result["pane_id"], terminal_id);
    assert_eq!(result["selection"]["anchor_row"], 0);
    assert_eq!(result["selection"]["end_col"], 0);
}

// --- UC-2: BrowserPaneSelectionCapture ---

#[test]
fn capture_selection_supports_navigation_and_render_browser_panes() {
    // UC-2 BR-3, BR-4: Both normal Browser panes and Render Panes support normalized selection capture.
    let (mut app, terminal_id) = app_with_terminal();
    let browser_id = add_browser(&mut app, terminal_id);
    let render_browser_id = add_render_browser(&mut app, browser_id);
    assert!(app.apply_webview_bridge_message(
        &json!({
            "kind": "browser-selection",
            "pane_id": browser_id,
            "text": "selected browser text",
            "html": "<p>selected browser text</p>",
            "context": "surrounding browser context",
            "title": "Example page",
            "url": "https://example.com/docs",
            "collapsed": false
        })
        .to_string()
    ));
    assert!(app.apply_webview_bridge_message(
        &json!({
            "kind": "browser-selection",
            "pane_id": render_browser_id,
            "text": "selected render text",
            "html": "<strong>selected render text</strong>",
            "context": "render context",
            "title": "Preview",
            "url": "tide://render",
            "collapsed": false
        })
        .to_string()
    ));

    let browser = app
        .handle_cli_command("capture-selection", json!({"pane_id": browser_id}))
        .unwrap();
    let render = app
        .handle_cli_command("capture-selection", json!({"pane_id": render_browser_id}))
        .unwrap();

    assert_eq!(browser["kind"], "browser");
    assert_eq!(browser["selection"], serde_json::Value::Null);
    let browser_content = browser["content"].as_str().unwrap();
    assert!(browser_content.contains("selected browser text"));
    assert!(browser_content.contains("surrounding browser context"));

    assert_eq!(render["kind"], "browser-render");
    assert_eq!(render["selection"], serde_json::Value::Null);
    let render_content = render["content"].as_str().unwrap();
    assert!(render_content.contains("selected render text"));
    assert!(render_content.contains("render context"));
}

#[test]
fn capture_selection_prefers_url_bar_selection_over_stale_page_snapshot() {
    // UC-2 BR-3, BR-4: URL-bar selection wins when it is the active Browser selection source.
    let (mut app, terminal_id) = app_with_terminal();
    let browser_id = add_browser(&mut app, terminal_id);
    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.page_selection = Some(crate::pane::browser::BrowserSelectionSnapshot {
            text: "stale page text".into(),
            html: "<p>stale page text</p>".into(),
            context: Some("stale page context".into()),
            page_title: Some("Example page".into()),
            page_url: Some("https://example.com/docs".into()),
            collapsed: false,
        });
        browser.url_input_focused = true;
        browser.url_input = "https://example.com/docs".into();
        browser.url_selection = Some((8, 19));
    }

    let result = app
        .handle_cli_command("capture-selection", json!({"pane_id": browser_id}))
        .unwrap();

    assert_eq!(result["kind"], "browser");
    assert_eq!(result["selection"], serde_json::Value::Null);
    assert_eq!(result["content"], "example.com");
}

// --- UC-3: AddCommentCreatesContextArtifact ---

#[test]
fn add_comment_creates_workspace_local_contextartifact() {
    // UC-3 BR-5, BR-6: Creating an artifact stores source Pane data, comment text, and Workspace-local scope.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_editor(&mut app, terminal_id, &["ship it"]);
    app.assoc.associated_terminal.insert(editor_id, terminal_id);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 4),
        });
    }

    assert!(app
        .handle_cli_command(
            "create-context-artifact",
            json!({"pane_id": editor_id, "comment": "missing caller"}),
        )
        .is_err());

    let result = app.handle_cli_command(
        "create-context-artifact",
        json!({"pane_id": editor_id, "comment": "focus this", "pin": true, "_caller_pane": terminal_id}),
    ).unwrap();

    assert_eq!(result["pane_id"], editor_id);
    assert_eq!(result["comment"], "focus this");
    assert_eq!(result["pinned"], true);
}

#[test]
fn create_context_artifact_from_dock_terminal_uses_the_dock_groups_paired_terminal() {
    // UC-3 BR-5, BR-6: Explicit artifact creation from a Dock Terminal Pane still authorizes against the Dock group's paired Terminal.
    let (mut app, terminal_id) = app_with_terminal();
    let dock_terminal_id = add_dock_terminal(&mut app, terminal_id);
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&dock_terminal_id) {
        terminal.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 4),
        });
    }

    let result = app
        .handle_cli_command(
            "create-context-artifact",
            json!({"pane_id": dock_terminal_id, "comment": "dock terminal", "_caller_pane": terminal_id}),
        )
        .unwrap();

    assert_eq!(result["pane_id"], dock_terminal_id);
    assert_eq!(result["associated_terminal_id"], terminal_id);
}

#[test]
fn dock_selection_with_gateway_connected_paired_agent_opens_context_comment_composer() {
    // UC-3 BR-17, BR-18: The add-comment flow is available for an eligible Dock Pane when the selection yields content.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_dock_editor(&mut app, terminal_id, &["ship it"]);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 4),
        });
    }
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    assert!(app.can_open_context_comment_composer(editor_id));

    app.open_context_comment_composer(editor_id);

    assert!(app.modal.context_comment_composer.is_some());
}

#[test]
fn stage_selection_with_gateway_connected_paired_agent_does_not_open_context_comment_composer() {
    // UC-3 BR-17: Stage Panes do not show the add-comment flow even when a paired agent is connected.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_editor(&mut app, terminal_id, &["ship it"]);
    app.assoc.associated_terminal.insert(editor_id, terminal_id);
    app.focus.focused = Some(editor_id);
    app.focus.stage_focused = Some(editor_id);
    app.focus.focus_area = FocusArea::Stage;
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 4),
        });
    }
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    assert!(!app.can_show_context_comment_badge(editor_id));
    assert!(!app.can_open_context_comment_composer(editor_id));

    app.open_context_comment_composer(editor_id);

    assert!(
        app.modal.context_comment_composer.is_none(),
        "stage panes should not open the comment composer"
    );
}

#[test]
fn dock_selection_without_gateway_connected_agent_hides_context_comment_composer() {
    // UC-3 BR-17: Dock Panes hide the add-comment flow when their paired Terminal is not gateway-connected.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_dock_editor(&mut app, terminal_id, &["ship it"]);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 4),
        });
    }
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: false,
            status: None,
        },
    );

    assert!(!app.can_show_context_comment_badge(editor_id));
    assert!(!app.can_open_context_comment_composer(editor_id));

    app.open_context_comment_composer(editor_id);

    assert!(
        app.modal.context_comment_composer.is_none(),
        "disconnected paired agents should not expose the comment composer"
    );
}

#[test]
fn dock_terminal_with_gateway_connected_paired_agent_opens_context_comment_composer() {
    // UC-3 BR-17: Dock Terminal Panes can open the comment flow when the Dock group's paired Terminal is gateway-connected.
    let (mut app, terminal_id) = app_with_terminal();
    let dock_terminal_id = add_dock_terminal(&mut app, terminal_id);
    if let Some(PaneKind::Terminal(terminal)) = app.panes.get_mut(&dock_terminal_id) {
        terminal.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 4),
        });
    }
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    assert!(app.can_show_context_comment_badge(dock_terminal_id));
    assert!(app.can_open_context_comment_composer(dock_terminal_id));

    app.open_context_comment_composer(dock_terminal_id);

    let composer = app
        .modal
        .context_comment_composer
        .as_ref()
        .expect("composer should open for a dock terminal pane");
    assert_eq!(composer.source_pane_id, dock_terminal_id);
    assert_eq!(composer.associated_terminal_id, terminal_id);
    assert_eq!(composer.pane_kind, "terminal");
}

#[test]
fn dock_pane_with_associated_terminal_opens_context_comment_composer_without_selection() {
    // UC-3 BR-18: Dock Panes can keep the add-comment affordance visible and open the Context Comment Composer without an active text selection.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_dock_editor(&mut app, terminal_id, &["ship it"]);
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    assert!(app.can_show_context_comment_badge(editor_id));
    assert!(app.can_open_context_comment_composer(editor_id));

    app.open_context_comment_composer(editor_id);

    let composer = app
        .modal
        .context_comment_composer
        .as_ref()
        .expect("composer should open without selection");
    assert_eq!(composer.source_pane_id, editor_id);
    assert_eq!(composer.associated_terminal_id, terminal_id);
    assert_eq!(composer.pane_kind, "editor");
    assert!(composer.selection.is_none());
    assert!(composer.content.is_empty());
}

#[test]
fn live_preview_context_artifact_capture_uses_visible_selected_text() {
    // UC-3 BR-21, BR-22: A Dock Markdown Pane in LivePreviewMode can open the Context Comment Composer and capture the visible selected text.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_dock_markdown_editor(
        &mut app,
        terminal_id,
        "cursor line\n[OpenAI](https://openai.com)\n",
    );
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    let cell = app.window.cached_cell_size;
    app.visual_pane_rects = vec![(editor_id, pane_rect)];

    let content_rect = {
        let pane = match app.panes.get_mut(&editor_id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        let content_rect = pane.content_rect(pane_rect, crate::theme::TAB_BAR_HEIGHT, cell);
        pane.handle_action(
            crate::tide_editor::input::EditorAction::SetCursor { line: 0, col: 0 },
            20,
        );
        pane.prepare_inline_caches(content_rect, cell, false);
        content_rect
    };

    let gutter_x = content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width;
    let start = crate::tide_core::Vec2::new(gutter_x + 1.0, content_rect.y + cell.height + 1.0);
    let end = crate::tide_core::Vec2::new(
        gutter_x + 6.0 * cell.width + 1.0,
        content_rect.y + cell.height + 1.0,
    );
    app.window.last_cursor_pos = start;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
        &mut app,
        end,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::handle_mouse_up(
        &mut app,
        crate::tide_core::MouseButton::Left,
    );

    assert!(app.can_open_context_comment_composer(editor_id));
    app.open_context_comment_composer(editor_id);

    let composer = app
        .modal
        .context_comment_composer
        .as_ref()
        .expect("composer should open for dock live preview markdown selection");
    assert_eq!(composer.content, "OpenAI");
}

#[test]
fn active_markdown_live_preview_keeps_add_comment_visible_when_shared_tab_budget_allows_both_badges() {
    // UC-3 BR-25: The shared active-tab width budget stretches with the available row width to keep add-comment visible beside the plain/live mode badge for an active Markdown Pane.
    let mut editor = EditorPane::new_empty(11);
    editor.editor.buffer.file_path = Some(PathBuf::from(
        "/tmp/a-very-long-markdown-file-name-for-comment-priority.md",
    ));
    editor.live_preview = true;

    let mut panes = std::collections::HashMap::new();
    panes.insert(11, PaneKind::Editor(editor));

    let active_badges = active_tab_badges(&panes, &11, true, true);
    let badge_widths: Vec<f32> = active_badges
        .iter()
        .map(|badge| badge.text.chars().count() as f32 * 8.0 + crate::theme::BADGE_PADDING_H * 2.0)
        .collect();
    let title_layout = reserve_title_before_badges(
        320.0,
        &badge_widths,
        crate::header::active_tab_width_cap(540.0) - (crate::theme::TAB_H_PAD * 2.0 + 16.0),
        crate::theme::TAB_MIN_TITLE_WIDTH,
        4.0,
    );
    let visible_badges: Vec<_> = active_badges
        .iter()
        .take(title_layout.visible_badges)
        .collect();

    assert_eq!(title_layout.visible_badges, 2);
    assert_eq!(visible_badges[0].action, Some(HeaderHitAction::ToggleLivePreview));
    assert_eq!(visible_badges[1].action, Some(HeaderHitAction::AddComment));
    assert!(title_layout.title_w >= crate::theme::TAB_MIN_TITLE_WIDTH);
}

#[test]
fn open_context_comment_composer_captures_browser_selection() {
    // UC-3 BR-5, BR-6: Browser selections can be captured into the explicit comment composer.
    let (mut app, terminal_id) = app_with_terminal();
    let browser_id = add_dock_browser(&mut app, terminal_id);
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    assert!(app.apply_webview_bridge_message(
        &json!({
            "kind": "browser-selection",
            "pane_id": browser_id,
            "text": "selected browser text",
            "html": "<p>selected browser text</p>",
            "context": "browser context",
            "title": "Example page",
            "url": "https://example.com/docs",
            "collapsed": false
        })
        .to_string()
    ));

    app.open_context_comment_composer(browser_id);

    let composer = app
        .modal
        .context_comment_composer
        .as_ref()
        .expect("composer should open");
    assert_eq!(composer.source_pane_id, browser_id);
    assert_eq!(composer.associated_terminal_id, terminal_id);
    assert_eq!(composer.pane_kind, "browser");
    assert!(composer.content.contains("selected browser text"));
    assert!(composer.content.contains("browser context"));
}

#[test]
fn submit_context_comment_composer_creates_artifact_and_delivers_to_paired_terminal() {
    // UC-3 BR-5, BR-6 and UC-5 BR-9, BR-10: submitting the popup creates a Context Artifact and delivers it to the paired terminal only.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_dock_editor(&mut app, terminal_id, &["route me"]);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 5),
        });
    }
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    let (tx, rx) = mpsc::channel::<String>();
    app.pending_subscribe_tx = Some(tx);
    app.handle_cli_command(
        "subscribe",
        json!({"events": ["context-artifact-delivered"], "_caller_pane": terminal_id}),
    )
    .unwrap();

    app.open_context_comment_composer(editor_id);
    {
        let composer = app
            .modal
            .context_comment_composer
            .as_mut()
            .expect("composer should open");
        composer.comment = InputLine::with_text("paired only".to_string());
        composer.pinned = true;
    }

    assert!(app.submit_context_comment_composer());
    assert!(app.modal.context_comment_composer.is_none());

    let stored = app
        .context_artifacts
        .artifacts
        .values()
        .find(|artifact| artifact.source_pane_id == editor_id)
        .cloned()
        .expect("artifact should be stored");
    assert_eq!(stored.associated_terminal_id, terminal_id);
    assert_eq!(stored.comment, "paired only");
    assert!(stored.pinned);

    let msg = rx
        .try_recv()
        .expect("paired terminal should receive delivery");
    assert!(msg.contains("context-artifact-delivered"));
}

#[test]
fn submit_context_comment_composer_delivery_event_includes_artifact_body() {
    // UC-5 BR-19: Owner-scoped delivery events include the artifact body for explicit subscriber handling.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_dock_editor(&mut app, terminal_id, &["route me"]);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 5),
        });
    }
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    let (tx, rx) = mpsc::channel::<String>();
    app.pending_subscribe_tx = Some(tx);
    app.handle_cli_command(
        "subscribe",
        json!({"events": ["context-artifact-delivered"], "_caller_pane": terminal_id}),
    )
    .unwrap();

    app.open_context_comment_composer(editor_id);
    {
        let composer = app
            .modal
            .context_comment_composer
            .as_mut()
            .expect("composer should open");
        composer.comment = InputLine::with_text("paired only".to_string());
        composer.pinned = true;
    }

    assert!(app.submit_context_comment_composer());

    let msg = rx
        .try_recv()
        .expect("paired terminal should receive delivery");
    let parsed: serde_json::Value =
        serde_json::from_str(&msg).expect("delivery event should be valid json");
    let data = &parsed["params"]["data"];
    assert_eq!(data["pane_kind"], "editor");
    assert_eq!(data["content"], "route");
    assert_eq!(data["comment"], "paired only");
    assert_eq!(data["pinned"], true);
    assert_eq!(data["terminal_input_injected"], true);
}

#[test]
fn contextartifact_terminal_input_is_formatted_for_paired_agent_injection() {
    // UC-5 BR-20: Live paired-terminal delivery uses formatted Terminal input injection.
    let artifact = crate::ContextArtifact {
        artifact_id: 7,
        source_pane_id: 11,
        associated_terminal_id: 3,
        pane_kind: "editor".to_string(),
        source_label: "/tmp/context.md".to_string(),
        selection: Some(Selection {
            anchor: (0, 0),
            end: (0, 5),
        }),
        content: "route".to_string(),
        comment: "paired only".to_string(),
        pinned: true,
    };

    let prompt = format_context_artifact_terminal_input(&artifact);
    assert!(prompt.contains("Tide Context Artifact #7"));
    assert!(prompt.contains("Source:"));
    assert!(prompt.contains("/tmp/context.md"));
    assert!(prompt.contains("Comment:"));
    assert!(prompt.contains("paired only"));
    assert!(prompt.contains("Selection:"));
    assert!(prompt.contains("route"));
}

#[test]
fn contextartifact_terminal_input_uses_human_readable_source_label() {
    // UC-5 BR-26: Context Artifact delivery text uses a human-readable Source Label instead of pane numbering.
    let artifact = crate::ContextArtifact {
        artifact_id: 8,
        source_pane_id: 14,
        associated_terminal_id: 3,
        pane_kind: "editor".to_string(),
        source_label: "/tmp/nested/context.md".to_string(),
        selection: None,
        content: String::new(),
        comment: "review this".to_string(),
        pinned: false,
    };

    let prompt = format_context_artifact_terminal_input(&artifact);

    assert!(prompt.contains("Source:"));
    assert!(prompt.contains("/tmp/nested/context.md"));
    assert!(!prompt.contains("editor pane 14"));
}

#[test]
fn contextartifact_terminal_paste_wrapper_does_not_auto_submit() {
    // UC-5 BR-27: Live paired-Terminal delivery pastes artifact text without auto-submitting the paired agent turn.
    let plain = wrap_terminal_input_for_paste("hello", false);
    assert_eq!(plain, b"hello");

    let bracketed = wrap_terminal_input_for_paste("hello", true);
    assert_eq!(bracketed, b"\x1b[200~hello\x1b[201~\x1b[D\x1b[C");
    assert!(
        !bracketed.ends_with(b"\r"),
        "artifact paste must not append Enter"
    );
}

// --- UC-4: ArtifactReadAndList ---

#[test]
fn contextartifact_list_and_read_are_workspace_scoped() {
    // UC-4 BR-7, BR-8: Artifact list/read stay within the active Workspace and caller Terminal boundary.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_editor(&mut app, terminal_id, &["workspace zero"]);
    app.assoc.associated_terminal.insert(editor_id, terminal_id);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 9),
        });
    }

    let created = app
        .handle_cli_command(
            "create-context-artifact",
            json!({"pane_id": editor_id, "comment": "w0", "_caller_pane": terminal_id}),
        )
        .unwrap();
    let artifact_id = created["artifact_id"].as_u64().unwrap();

    let terminal_b = app.layout.split(terminal_id, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(terminal_b, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_b, PaneKind::Terminal(terminal));
    let editor_b = add_editor(&mut app, terminal_b, &["workspace one"]);
    app.assoc.associated_terminal.insert(editor_b, terminal_b);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_b) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 9),
        });
    }

    let created_b = app
        .handle_cli_command(
            "create-context-artifact",
            json!({"pane_id": editor_b, "comment": "w1", "_caller_pane": terminal_b}),
        )
        .unwrap();
    let artifact_id_b = created_b["artifact_id"].as_u64().unwrap();

    let list_a = app
        .handle_cli_command(
            "list-context-artifacts",
            json!({"_caller_pane": terminal_id}),
        )
        .unwrap();
    let ids_a: Vec<_> = list_a
        .as_array()
        .unwrap()
        .iter()
        .map(|artifact| artifact["artifact_id"].as_u64().unwrap())
        .collect();
    assert_eq!(ids_a, vec![artifact_id]);

    let list_b = app
        .handle_cli_command(
            "list-context-artifacts",
            json!({"_caller_pane": terminal_b}),
        )
        .unwrap();
    let ids_b: Vec<_> = list_b
        .as_array()
        .unwrap()
        .iter()
        .map(|artifact| artifact["artifact_id"].as_u64().unwrap())
        .collect();
    assert_eq!(ids_b, vec![artifact_id_b]);

    assert!(app
        .handle_cli_command("list-context-artifacts", json!({}))
        .is_err());

    app.new_workspace();
    let active_workspace_terminal = app.focus.focused.unwrap();
    let list_result = app
        .handle_cli_command(
            "list-context-artifacts",
            json!({"_caller_pane": active_workspace_terminal}),
        )
        .unwrap();
    assert_eq!(list_result.as_array().unwrap().len(), 0);

    app.switch_workspace(0);
    let read_result = app
        .handle_cli_command(
            "read-context-artifact",
            json!({"artifact_id": artifact_id, "_caller_pane": terminal_id}),
        )
        .unwrap();
    assert_eq!(read_result["artifact_id"], artifact_id);
}

// --- UC-5: ImmediateArtifactDelivery ---

#[test]
fn send_contextartifact_targets_only_the_paired_agent() {
    // UC-5 BR-9, BR-10: Artifact delivery reaches only the paired agent and never crosses terminal boundaries.
    let (mut app, terminal_a) = app_with_terminal();
    let terminal_b = app.layout.split(terminal_a, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(terminal_b, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_b, PaneKind::Terminal(terminal));

    let editor_id = add_editor(&mut app, terminal_a, &["route me"]);
    app.assoc.associated_terminal.insert(editor_id, terminal_a);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 5),
        });
    }

    let (tx_a, rx_a) = mpsc::channel::<String>();
    app.pending_subscribe_tx = Some(tx_a);
    app.handle_cli_command(
        "subscribe",
        json!({"events": ["context-artifact-delivered"], "_caller_pane": terminal_a}),
    )
    .unwrap();

    let (tx_b, rx_b) = mpsc::channel::<String>();
    app.pending_subscribe_tx = Some(tx_b);
    app.handle_cli_command(
        "subscribe",
        json!({"events": ["context-artifact-delivered"], "_caller_pane": terminal_b}),
    )
    .unwrap();

    let created = app
        .handle_cli_command(
            "create-context-artifact",
            json!({"pane_id": editor_id, "comment": "paired only", "_caller_pane": terminal_a}),
        )
        .unwrap();
    let artifact_id = created["artifact_id"].as_u64().unwrap();

    app.handle_cli_command(
        "send-context-artifact",
        json!({"artifact_id": artifact_id, "_caller_pane": terminal_a}),
    )
    .unwrap();

    let msg_a = rx_a
        .try_recv()
        .expect("paired agent should receive delivery");
    assert!(msg_a.contains("context-artifact-delivered"));
    assert!(
        rx_b.try_recv().is_err(),
        "other terminal must not receive delivery"
    );
}

// --- UC-6: AssociatedTerminalAuthorization ---

#[test]
fn contextartifact_requests_require_the_source_associated_terminal() {
    // UC-6 BR-11, BR-12: Artifact flows require the source Pane Associated Terminal and reject mismatched terminals.
    let (mut app, terminal_a) = app_with_terminal();
    let terminal_b = app.layout.split(terminal_a, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(terminal_b, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_b, PaneKind::Terminal(terminal));

    let editor_id = add_editor(&mut app, terminal_a, &["guard this"]);
    app.assoc.associated_terminal.insert(editor_id, terminal_a);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 5),
        });
    }

    let created = app
        .handle_cli_command(
            "create-context-artifact",
            json!({"pane_id": editor_id, "comment": "owner only", "_caller_pane": terminal_a}),
        )
        .unwrap();
    let artifact_id = created["artifact_id"].as_u64().unwrap();

    let result = app.handle_cli_command(
        "read-context-artifact",
        json!({"artifact_id": artifact_id, "_caller_pane": terminal_b}),
    );

    assert!(result.is_err());
}

// --- UC-7: WorkspaceLocalNonPersistentLifecycle ---

#[test]
fn contextartifacts_are_workspace_local_and_not_persisted_to_session() {
    // UC-7 BR-13, BR-14: ContextArtifacts are session-local/Workspace-local only and not serialized into restart session state.
    let (mut app, terminal_id) = app_with_terminal();
    let editor_id = add_editor(&mut app, terminal_id, &["remember this"]);
    app.assoc.associated_terminal.insert(editor_id, terminal_id);
    if let Some(PaneKind::Editor(editor)) = app.panes.get_mut(&editor_id) {
        editor.selection = Some(Selection {
            anchor: (0, 0),
            end: (0, 8),
        });
    }

    app.handle_cli_command(
        "create-context-artifact",
        json!({"pane_id": editor_id, "comment": "do not persist", "_caller_pane": terminal_id}),
    )
    .unwrap();

    let session = Session::from_app(&app);
    let serialized = serde_json::to_string(&session).unwrap();

    assert!(!serialized.contains("context-artifact"));
    assert!(!serialized.contains("do not persist"));
}

// --- UC-4 / UC-5: MCP command surface ---

#[test]
fn mcp_tools_list_exposes_contextartifact_commands() {
    // UC-4 BR-7/8 and UC-5 BR-9/10: MCP exposes explicit artifact read/list/send tools.
    let tools = mcp::mcp_tool_definitions();
    let names: Vec<_> = tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(|v| v.as_str()))
        .collect();

    assert!(names.contains(&"tide_capture_selection"));
    assert!(names.contains(&"tide_create_context_artifact"));
    assert!(names.contains(&"tide_list_context_artifacts"));
    assert!(names.contains(&"tide_read_context_artifact"));
    assert!(names.contains(&"tide_pin_context_artifact"));
    assert!(names.contains(&"tide_remove_context_artifact"));
    assert!(names.contains(&"tide_send_context_artifact"));
}
