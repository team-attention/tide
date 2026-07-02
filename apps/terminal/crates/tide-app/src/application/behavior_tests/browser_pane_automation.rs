// Spec: docs/specs/browser-pane-automation.md

use std::path::PathBuf;

use serde_json::json;

use crate::pane::browser::{
    BrowserAutomationCursor, BrowserPane, BrowserSelectionSnapshot, BrowserSnapshot,
};
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::{FileFinderState, FocusArea};
use crate::App;
use crate::DockPort;
use crate::LayoutPort;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_browser() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        id,
        PaneKind::Browser(BrowserPane::with_url(id, "https://example.com".into())),
    );
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(id);
    (app, id)
}

fn app_with_editor() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(id, PaneKind::Editor(EditorPane::new_empty(id)));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(id);
    (app, id)
}

fn app_with_context_browser(dock_width: f32) -> (App, u64, u64) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(terminal_id);
    app.compute_layout();

    app.dock.dock_width = dock_width;
    let browser_id = app.layout.alloc_id();
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "http://localhost:4174".to_string(),
        )),
    );
    app.add_pane_to_dock(browser_id, Some(terminal_id));
    app.dock.dock_open = true;
    app.dock.visibility_animation = None;
    app.compute_layout();

    (app, terminal_id, browser_id)
}

fn observe_browser(app: &mut App, browser_id: u64) {
    app.handle_cli_command("browser-observe", json!({"pane_id": browser_id}))
        .expect("browser-observe should succeed");
}

// --- UC-1: ObserveBrowserPaneAutomationState ---

#[test]
fn browser_observe_returns_structured_navigation_state() {
    // UC-1 BR-1: browser-observe returns the targeted pane_id, committed Browser URL, loading state, load progress, and back/forward availability
    let (mut app, browser_id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&browser_id) {
        bp.loading = true;
        bp.load_progress = 0.5;
        bp.can_go_back = true;
        bp.can_go_forward = false;
    }

    let result = app
        .handle_cli_command("browser-observe", json!({"pane_id": browser_id}))
        .expect("browser-observe should succeed");

    assert_eq!(result["pane_id"], browser_id);
    assert_eq!(result["url"], "https://example.com");
    assert_eq!(result["loading"], true);
    assert_eq!(result["load_progress"], 0.5);
    assert_eq!(result["can_go_back"], true);
    assert_eq!(result["can_go_forward"], false);
    assert_eq!(result["generation"].as_u64(), Some(0));
    assert_eq!(result["observation_id"], format!("browser:{browser_id}:g0"));
    assert_eq!(result["readiness"]["state"], "loading");
    assert!(result["allowed_actions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "wait-for"));
    assert_eq!(result["recovery"]["next_tool"], "tide_browser_observe");
}

#[test]
fn browser_observe_includes_snapshot_selection_and_cursor_state() {
    // UC-1 BR-2 / BR-3: browser-observe includes cached BrowserSnapshot, Browser selection, and Browser Automation Cursor state when available
    let (mut app, browser_id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&browser_id) {
        bp.update_page_snapshot(Some(BrowserSnapshot {
            text: "Heading\nParagraph".into(),
            page_title: Some("Example page".into()),
            page_url: Some("https://example.com/docs".into()),
        }));
        bp.update_page_selection(Some(BrowserSelectionSnapshot {
            text: "selected".into(),
            html: "<strong>selected</strong>".into(),
            context: Some("context".into()),
            page_title: Some("Example page".into()),
            page_url: Some("https://example.com/docs".into()),
            collapsed: false,
        }));
        bp.set_automation_cursor(BrowserAutomationCursor {
            x: 120.0,
            y: 240.0,
            label: Some("Inspect".into()),
            visible: true,
        });
    }

    let result = app
        .handle_cli_command("browser-observe", json!({"pane_id": browser_id}))
        .expect("browser-observe should succeed");

    assert_eq!(result["title"], "Example page");
    assert_eq!(result["snapshot"]["text"], "Heading\nParagraph");
    assert_eq!(result["selection"]["text"], "selected");
    assert_eq!(result["selection"]["context"], "context");
    assert_eq!(result["automation_cursor"]["x"], 120.0);
    assert_eq!(result["automation_cursor"]["y"], 240.0);
    assert_eq!(result["automation_cursor"]["label"], "Inspect");
    assert_eq!(result["automation_cursor"]["visible"], true);
}

#[test]
fn browser_observe_includes_visual_fit_tool_selection_guidance() {
    // UC-1 BR-17: browser-observe includes visual fit and Tool Selection Guidance before BrowserSnapshot-only or eval workarounds.
    let (mut app, terminal_id, browser_id) = app_with_context_browser(398.0);

    let result = app
        .handle_cli_command("browser-observe", json!({"pane_id": browser_id}))
        .expect("browser-observe should succeed");

    assert_eq!(result["visual_fit"]["status"], "too_small");
    assert_eq!(
        result["visual_fit"]["tool_selection"]["next_tool"],
        "tide_layout_action"
    );
    assert_eq!(
        result["visual_fit"]["tool_selection"]["action"]["target"]["kind"],
        "terminal_context_surface"
    );
    assert_eq!(
        result["visual_fit"]["tool_selection"]["action"]["target"]["owner_terminal_id"].as_u64(),
        Some(terminal_id)
    );
    assert!(result["visual_fit"]["tool_selection"]["do_not_substitute"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "app_internal_api_shortcuts"));
    assert!(result["visual_fit"]["tool_selection"]["do_not_substitute"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "url_parameter_shortcuts"));
    assert!(result["visual_fit"]["tool_selection"]["do_not_substitute"]
        .as_array()
        .unwrap()
        .iter()
        .any(|value| value == "browser_snapshot_only_targeting"));
}

#[test]
fn browser_observe_reports_page_map_missing_recovery() {
    // Browser Operation contract: observe reports missing Page Map as a recovery state instead of leaving agents to guess.
    let (mut app, browser_id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&browser_id) {
        bp.update_page_snapshot(Some(BrowserSnapshot {
            text: "Visible text without a map".into(),
            page_title: Some("Example".into()),
            page_url: Some("https://example.com".into()),
        }));
        bp.clear_page_map();
    }

    let result = app
        .handle_cli_command("browser-observe", json!({"pane_id": browser_id}))
        .expect("browser-observe should succeed");

    assert_eq!(result["readiness"]["state"], "page_map_missing");
    assert_eq!(result["recovery"]["status"], "observe_required");
    assert_eq!(result["recovery"]["next_tool"], "tide_browser_observe");
}

#[test]
fn browser_observe_rejects_non_browser_pane() {
    // UC-1 BR-4: browser-observe rejects non-browser Panes
    let (mut app, editor_id) = app_with_editor();

    let result = app.handle_cli_command("browser-observe", json!({"pane_id": editor_id}));

    assert!(result.is_err());
}

#[test]
fn browser_observe_rejects_render_mode_browser_pane() {
    // UC-1 BR-5: browser-observe rejects render-mode Browser Panes because this slice only covers navigation-mode Browser Pane automation
    let mut app = test_app();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::new_render(
            browser_id,
            "Render".into(),
            "<div>hello</div>".into(),
        )),
    );
    app.focus.focused = Some(browser_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(browser_id);

    let result = app.handle_cli_command("browser-observe", json!({"pane_id": browser_id}));

    assert!(result.is_err());
}

// --- UC-2: ActOnBrowserPaneWithStructuredCommands ---

#[test]
fn browser_action_accepts_each_supported_action_name() {
    // UC-2 BR-6: supported Browser actions include navigation, input, scroll, recovery, and cursor actions.
    let (mut app, browser_id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&browser_id) {
        bp.can_go_back = true;
        bp.can_go_forward = true;
    }

    for params in [
        json!({"pane_id": browser_id, "action": "navigate", "url": "docs.example.com"}),
        json!({"pane_id": browser_id, "action": "move", "x": 32.0, "y": 48.0}),
        json!({"pane_id": browser_id, "action": "click", "x": 32.0, "y": 48.0}),
        json!({"pane_id": browser_id, "action": "type", "text": "hello"}),
        json!({"pane_id": browser_id, "action": "press", "key": "Enter"}),
        json!({"pane_id": browser_id, "action": "scroll", "delta_y": 480.0}),
        json!({"pane_id": browser_id, "action": "back"}),
        json!({"pane_id": browser_id, "action": "forward"}),
        json!({"pane_id": browser_id, "action": "reload"}),
        json!({"pane_id": browser_id, "action": "wait-for"}),
        json!({"pane_id": browser_id, "action": "close-modal"}),
        json!({"pane_id": browser_id, "action": "clear-cursor"}),
    ] {
        observe_browser(&mut app, browser_id);
        let result = app.handle_cli_command("browser-action", params);
        assert!(result.is_ok(), "supported action should succeed");
    }
}

#[test]
fn browser_action_rejects_unknown_action_name() {
    // UC-2 BR-11: browser-action rejects unsupported action names
    let (mut app, browser_id) = app_with_browser();

    let result = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "double-click"}),
    );

    assert!(result.is_err());
}

#[test]
fn browser_action_rejects_stale_observation_id_when_supplied() {
    // Browser Operation contract: new clients can bind actions to the observed Generation.
    let (mut app, browser_id) = app_with_browser();
    let observed = app
        .handle_cli_command("browser-observe", json!({"pane_id": browser_id}))
        .expect("browser-observe should succeed");
    let observation_id = observed["observation_id"].as_str().unwrap().to_string();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&browser_id) {
        bp.update_page_snapshot(Some(BrowserSnapshot {
            text: "Generation changed".into(),
            page_title: Some("Example".into()),
            page_url: Some("https://example.com".into()),
        }));
    }

    let result = app.handle_cli_command(
        "browser-action",
        json!({
            "pane_id": browser_id,
            "observation_id": observation_id,
            "action": "click",
            "x": 32.0,
            "y": 48.0
        }),
    );

    assert!(result.is_err());
}

#[test]
fn browser_action_close_modal_clears_modal_stack() {
    // Browser Operation recovery: close-modal gives agents a structured path when ModalStack hides the webview.
    let (mut app, browser_id) = app_with_browser();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    assert!(app.modal.is_any_open());

    let observed = app
        .handle_cli_command("browser-observe", json!({"pane_id": browser_id}))
        .expect("browser-observe should succeed");
    assert_eq!(observed["readiness"]["state"], "blocked_by_modal");
    assert_eq!(
        observed["recovery"]["action"]["action"].as_str(),
        Some("close-modal")
    );

    let result = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "close-modal"}),
        )
        .expect("close-modal should succeed");

    assert_eq!(result["modal_closed"], true);
    assert!(!app.modal.is_any_open());
}

#[test]
fn browser_action_rejects_non_browser_pane() {
    // Navigation-mode Browser Pane precondition: browser-action rejects non-browser Panes.
    let (mut app, editor_id) = app_with_editor();

    let result = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": editor_id, "action": "move", "x": 1.0, "y": 2.0}),
    );

    assert!(result.is_err());
}

#[test]
fn browser_action_navigate_reuses_the_target_browser_pane() {
    // UC-2 BR-7: navigate reuses the targeted Browser Pane instead of creating a replacement Pane
    let (mut app, browser_id) = app_with_browser();
    let pane_count_before = app.panes.len();
    observe_browser(&mut app, browser_id);

    let result = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "navigate", "url": "docs.example.com"}),
        )
        .expect("browser-action navigate should succeed");

    assert_eq!(result["pane_id"], browser_id);
    assert_eq!(result["action"], "navigate");
    assert_eq!(app.panes.len(), pane_count_before);
    assert!(app.layout.pane_ids().contains(&browser_id));

    let Some(PaneKind::Browser(bp)) = app.panes.get(&browser_id) else {
        panic!("browser pane should still exist");
    };
    assert_eq!(bp.url, "https://docs.example.com");
    assert!(bp.loading);
}

#[test]
fn browser_action_move_updates_browser_automation_cursor_state() {
    // UC-2 BR-8: move updates Browser Automation Cursor state with viewport coordinates and optional label text
    let (mut app, browser_id) = app_with_browser();

    let result = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "move", "x": 64.0, "y": 96.0, "label": "Target"}),
        )
        .expect("browser-action move should succeed");

    assert_eq!(result["automation_cursor"]["x"], 64.0);
    assert_eq!(result["automation_cursor"]["y"], 96.0);
    assert_eq!(result["automation_cursor"]["label"], "Target");
    assert_eq!(result["automation_cursor"]["visible"], true);

    let Some(PaneKind::Browser(bp)) = app.panes.get(&browser_id) else {
        panic!("browser pane should exist");
    };
    assert_eq!(
        bp.automation_cursor(),
        Some(&BrowserAutomationCursor {
            x: 64.0,
            y: 96.0,
            label: Some("Target".into()),
            visible: true,
        })
    );
}

#[test]
fn browser_action_clear_cursor_hides_browser_automation_cursor_state() {
    // UC-2 BR-9 / UC-3 BR-15: clear-cursor hides Browser Automation Cursor state explicitly without depending on BrowserSnapshot changes
    let (mut app, browser_id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&browser_id) {
        bp.update_page_snapshot(Some(BrowserSnapshot {
            text: "Before".into(),
            page_title: Some("Example".into()),
            page_url: Some("https://example.com".into()),
        }));
        bp.set_automation_cursor(BrowserAutomationCursor {
            x: 80.0,
            y: 120.0,
            label: Some("Before".into()),
            visible: true,
        });
    }

    let result = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "clear-cursor"}),
        )
        .expect("browser-action clear-cursor should succeed");

    assert!(result["automation_cursor"].is_null());
    let Some(PaneKind::Browser(bp)) = app.panes.get(&browser_id) else {
        panic!("browser pane should exist");
    };
    assert!(bp.automation_cursor().is_none());
    assert_eq!(
        bp.page_snapshot.as_ref(),
        Some(&BrowserSnapshot {
            text: "Before".into(),
            page_title: Some("Example".into()),
            page_url: Some("https://example.com".into()),
        })
    );
}

#[test]
fn browser_action_rejects_render_mode_browser_pane() {
    // UC-2 BR-12: browser-action rejects render-mode Browser Panes because render panes are outside this navigation-mode automation slice
    let mut app = test_app();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::new_render(
            browser_id,
            "Render".into(),
            "<div>hello</div>".into(),
        )),
    );
    app.focus.focused = Some(browser_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(browser_id);

    let result = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "move", "x": 1.0, "y": 2.0}),
    );

    assert!(result.is_err());
}

// --- UC-3: MirrorBrowserAutomationCursorIntoBrowserPane ---

#[test]
fn browser_action_source_requests_snapshot_refresh_after_live_input_dispatch() {
    // UC-2 BR-10: click, type, and press request a BrowserSnapshot refresh after live dispatch
    let source = include_str!("../../adapter/inward/cli_adapter/commands.rs");

    assert!(source.contains(
        "let dispatched = browser.dispatch_automation_click_after(x, y, dispatch_delay_ms);"
    ));
    assert!(source.contains("browser.dispatch_automation_type_at_after("));
    assert!(source.contains("None => browser.dispatch_automation_type(text),"));
    assert!(source.contains("let dispatched = browser.dispatch_automation_press(key);"));
    assert!(
        source
            .matches("browser.request_page_snapshot_refresh();")
            .count()
            >= 4
    );
}

#[test]
fn browser_automation_cursor_is_injected_through_the_browser_bridge_dom_path() {
    // UC-3 BR-13 / BR-16: visible Browser Automation Cursor is cursor-shaped, DOM-injected, and updated before click events through the Browser Pane helper path.
    let browser_source = include_str!("../../domain/pane/browser.rs");
    // The bridge JS lives in the extracted browser_bridge module (S-6).
    let bridge_source = include_str!("../../domain/pane/browser_bridge.rs");
    let layout_source = include_str!("../../layout_compute.rs");

    assert!(bridge_source.contains("window.__tideSetAutomationCursor = (payload) => {"));
    assert!(bridge_source.contains("window.__tideClearAutomationCursor = () => {"));
    assert!(bridge_source.contains("document.createElementNS('http://www.w3.org/2000/svg', 'svg')"));
    assert!(bridge_source.contains("shape.setAttribute('viewBox', '0 0 24 24')"));
    assert!(bridge_source.contains(
        "cursor.style.transition = 'left 280ms cubic-bezier(0.2, 0.8, 0.2, 1), top 280ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease-out';"
    ));
    assert!(bridge_source.contains("window.__tideAutomationCursorLastPoint"));
    assert!(bridge_source.contains("window.__tideAutomationCursorMotionDurationMs"));
    assert!(bridge_source.contains("const associatedLabelText = (el) => {"));
    assert!(bridge_source
        .contains("textFromIds(el.getAttribute && el.getAttribute(\"aria-labelledby\"))"));
    assert!(bridge_source
        .contains("normalizeText(parent.innerText || parent.textContent || \"\", 1000);"));
    assert!(bridge_source.contains("const stableElementRef = (el, prefix) => {"));
    assert!(bridge_source.contains("window.__tidePageMapRefCounter"));
    assert!(bridge_source.contains("const interactableSet = new Set(interactableNodes);"));
    assert!(
        bridge_source.contains("\"summary\", \"[onclick]\", \"[tabindex]:not([tabindex='-1'])\"")
    );
    assert!(bridge_source.contains("visibleInteractableCount > interactableLimit"));
    assert!(bridge_source.contains("const motionMs = window.__tideAutomationCursorMotionDurationMs(origin, target, payload.motionMs);"));
    assert!(!bridge_source.contains("cursor.style.transition = 'none';"));
    assert!(!bridge_source.contains("label.dataset.role = 'label';"));
    assert!(
        bridge_source.contains("(document.body || document.documentElement).appendChild(cursor);")
    );
    assert!(
        bridge_source.contains("window.__tideBrowserAutomationClick = (x, y, delayMs = 0) => {")
    );
    assert!(bridge_source.contains("const clickDelayMs = Math.max(0, delayMs + 45);"));
    assert!(bridge_source
        .contains("window.setTimeout(() => requestAnimationFrame(fireClick), clickDelayMs);"));
    assert!(bridge_source
        .contains("window.__tideBrowserAutomationTypeAt = (x, y, text, delayMs = 0) => {"));
    assert!(bridge_source.contains("const typeDelayMs = Math.max(0, delayMs + 45);"));
    assert!(bridge_source
        .contains("window.setTimeout(() => requestAnimationFrame(focusAndType), typeDelayMs);"));
    assert!(browser_source.contains("self.sync_automation_cursor_overlay();"));
    assert!(layout_source.contains("browser_native_views_obscured_by_overlays"));
}

#[test]
fn browser_automation_cursor_state_survives_navigation_reinstall() {
    // UC-3 BR-14: Browser Automation Cursor state survives Browser bridge reinstall inside the same Browser Pane session
    let (mut app, browser_id) = app_with_browser();
    let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&browser_id) else {
        panic!("browser pane should exist");
    };

    bp.set_automation_cursor(BrowserAutomationCursor {
        x: 32.0,
        y: 48.0,
        label: Some("Persist".into()),
        visible: true,
    });
    bp.navigate("example.com/next");

    assert_eq!(
        bp.automation_cursor(),
        Some(&BrowserAutomationCursor {
            x: 32.0,
            y: 48.0,
            label: Some("Persist".into()),
            visible: true,
        })
    );
}

#[test]
fn browser_selection_bridge_reapplies_browser_automation_cursor_on_install() {
    // UC-3 BR-14: Browser bridge install reapplies the current Browser Automation Cursor state
    let browser_source = include_str!("../../domain/pane/browser.rs");

    assert!(browser_source
        .contains("wv.evaluate_javascript(&browser_selection_bridge_script(self.id));"));
    assert!(browser_source.contains("self.selection_bridge_installed = true;"));
    assert!(browser_source.contains("self.sync_automation_cursor_overlay();"));
}
