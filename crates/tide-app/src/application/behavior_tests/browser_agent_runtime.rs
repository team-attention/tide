// Spec: docs/specs/browser-agent-runtime-plan.md

use std::collections::HashMap;
use std::sync::mpsc;

use serde_json::json;

use crate::adapter::inward::cli_adapter::mcp;
use crate::pane::browser::{
    BrowserAutomationCursor, BrowserPageElement, BrowserPageElementKind, BrowserPageMap,
    BrowserPane, BrowserSelectionSnapshot, BrowserSnapshot,
};
use crate::pane::{PaneKind, TerminalPane};
use crate::state::gateway_status::{AgentInfo, AgentStatus};
use crate::state::FocusArea;
use crate::tide_core::{LayoutEngine, PaneId, Rect, SplitDirection};
use crate::update::workspace_infra_service::Workspace;
use crate::App;
use crate::DockPort;

const CALLER_TERMINAL_A: PaneId = 90_001;
const CALLER_TERMINAL_B: PaneId = 90_002;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_real_terminal() -> (App, PaneId) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    (app, terminal_id)
}

fn app_with_browser(url: &str) -> (App, PaneId, PaneId) {
    let mut app = test_app();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(browser_id, url.to_string())),
    );
    app.focus.focused = Some(browser_id);
    app.focus.stage_focused = Some(browser_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(browser_id);
    app.assoc
        .associated_terminal
        .insert(browser_id, CALLER_TERMINAL_A);
    (app, browser_id, CALLER_TERMINAL_A)
}

fn app_with_caller_and_browser(url: &str) -> (App, PaneId, PaneId) {
    let (mut app, terminal_id) = app_with_real_terminal();
    let browser_id = app.layout.alloc_id();
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(browser_id, url.to_string())),
    );
    app.add_pane_to_dock(browser_id, Some(terminal_id));
    app.assoc
        .associated_terminal
        .insert(browser_id, terminal_id);
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    (app, terminal_id, browser_id)
}

fn app_with_render_browser(html: &str) -> (App, PaneId) {
    let mut app = test_app();
    let (layout, browser_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::new_render(
            browser_id,
            "Preview".to_string(),
            html.to_string(),
        )),
    );
    app.focus.focused = Some(browser_id);
    app.focus.stage_focused = Some(browser_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(browser_id);
    (app, browser_id)
}

fn observe_browser(app: &mut App, browser_id: u64) -> serde_json::Value {
    app.handle_cli_command("browser-observe", json!({"pane_id": browser_id}))
        .expect("browser observe should succeed")
}

fn set_browser_snapshot(
    app: &mut App,
    browser_id: PaneId,
    text: impl Into<String>,
    title: &str,
    url: &str,
) -> u64 {
    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.update_page_snapshot(Some(BrowserSnapshot {
            text: text.into(),
            page_title: Some(title.to_string()),
            page_url: Some(url.to_string()),
        }));
        return browser.generation;
    }
    panic!("browser pane should exist");
}

fn set_browser_page_map(app: &mut App, browser_id: PaneId) {
    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.update_page_map(Some(BrowserPageMap {
            regions: vec![BrowserPageElement {
                reference: "r1".to_string(),
                kind: BrowserPageElementKind::Region,
                role: Some("complementary".to_string()),
                tag: "ASIDE".to_string(),
                label: "Conversation Lab User list".to_string(),
                text: "User\nSearch\nDebug User".to_string(),
                value: None,
                placeholder: None,
                action: None,
                disabled: false,
                rect: Rect::new(720.0, 0.0, 320.0, 640.0),
            }],
            interactables: vec![
                BrowserPageElement {
                    reference: "i1".to_string(),
                    kind: BrowserPageElementKind::Interactable,
                    role: Some("button".to_string()),
                    tag: "BUTTON".to_string(),
                    label: "+ Debug User".to_string(),
                    text: "+ Debug User".to_string(),
                    value: None,
                    placeholder: None,
                    action: Some("open-dev-user-modal".to_string()),
                    disabled: false,
                    rect: Rect::new(902.0, 48.0, 104.0, 32.0),
                },
                BrowserPageElement {
                    reference: "i2".to_string(),
                    kind: BrowserPageElementKind::Interactable,
                    role: Some("textbox".to_string()),
                    tag: "TEXTAREA".to_string(),
                    label: "편하게 답변해주세요".to_string(),
                    text: String::new(),
                    value: Some(String::new()),
                    placeholder: Some("편하게 답변해주세요".to_string()),
                    action: None,
                    disabled: false,
                    rect: Rect::new(24.0, 592.0, 624.0, 40.0),
                },
            ],
            truncated_regions: false,
            truncated_interactables: false,
        }));
        return;
    }
    panic!("browser pane should exist");
}

fn add_stage_terminal(app: &mut App, anchor: PaneId) -> PaneId {
    let terminal_id = app.layout.split(anchor, SplitDirection::Vertical);
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    terminal_id
}

fn wrapped_agent_info(status: Option<AgentStatus>) -> AgentInfo {
    AgentInfo {
        name: "Codex",
        pid: 42,
        wrapper_managed: true,
        gateway_connected: true,
        status,
    }
}

// --- UC-1: OpenBrowserPaneForAgentVerification ---

#[test]
fn agent_open_browser_creates_browser_pane_in_terminal_context_surface() {
    // UC-1 BR-1 / BR-2: tide_open_browser creates a task-local Browser Pane attached to the caller Terminal.
    let (mut app, terminal_id) = app_with_real_terminal();

    let result = app
        .handle_cli_command(
            "open-browser",
            json!({"url": "localhost:3000", "_caller_pane": terminal_id}),
        )
        .expect("open-browser should succeed");
    let browser_id = result["pane_id"].as_u64().unwrap();

    assert!(app.is_pane_in_dock(browser_id));
    assert_eq!(
        app.assoc.associated_terminal.get(&browser_id).copied(),
        Some(terminal_id)
    );
    assert!(matches!(
        app.panes.get(&browser_id),
        Some(PaneKind::Browser(browser)) if browser.url == "localhost:3000"
    ));
}

#[test]
fn agent_browser_action_requires_prior_observe_guidance() {
    // UC-1 BR-3: Agent Browser Pane content actions require a fresh observe result first.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");

    let before_observe = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 12.0, "y": 18.0}),
    );
    assert!(before_observe.is_err());

    let observed = observe_browser(&mut app, browser_id);
    assert_eq!(observed["requires_prior_observe_for_actions"], true);

    let after_observe = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "click", "x": 12.0, "y": 18.0}),
        )
        .expect("fresh observe should allow the click");
    assert_eq!(after_observe["observe_after_action"], true);
}

#[test]
fn same_url_navigation_requires_intentional_reload() {
    // UC-1 BR-4: same-URL navigation is rejected unless the agent marks an intentional reload.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    observe_browser(&mut app, browser_id);

    let duplicate = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "navigate", "url": "https://example.com"}),
    );
    assert!(duplicate.is_err());

    let reloaded = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "navigate", "url": "https://example.com", "reload": true}),
        )
        .expect("same URL should be allowed when reload is intentional");
    assert_eq!(reloaded["action"], "navigate");
    assert_eq!(reloaded["observe_after_action"], true);
}

// --- UC-2: OperateSharedBrowserPane ---

#[test]
fn browser_action_uses_existing_browser_pane_runtime() {
    // UC-2 BR-5 / BR-6: tide_browser_action uses the existing Browser Pane runtime and does not create a second runtime.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    let pane_count = app.panes.len();
    observe_browser(&mut app, browser_id);

    let result = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "navigate", "url": "docs.example.com"}),
        )
        .expect("navigate should use existing Browser Pane");

    assert_eq!(result["runtime"], "tide_browser_pane");
    assert!(result["external_runtime"].is_null());
    assert_eq!(app.panes.len(), pane_count);
    assert!(app.panes.contains_key(&browser_id));
}

#[test]
fn browser_action_refreshes_observable_state_after_live_input() {
    // UC-2 BR-8: after a Browser Pane action that can mutate page state, the next agent decision must re-observe.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    observe_browser(&mut app, browser_id);

    app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 20.0, "y": 30.0}),
    )
    .expect("first click after observe should succeed");

    let stale_action = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 20.0, "y": 30.0}),
    );
    assert!(stale_action.is_err());

    observe_browser(&mut app, browser_id);
    assert!(app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "click", "x": 20.0, "y": 30.0}),
        )
        .is_ok());
}

#[test]
fn browser_actions_update_or_preserve_automation_cursor() {
    // UC-2 BR-7: move/click update Browser Automation Cursor, while type/press preserve the existing marker.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");

    let moved = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "move", "x": 10.0, "y": 20.0, "label": "Move"}),
        )
        .expect("move should set the Browser Automation Cursor");
    assert_eq!(moved["automation_cursor"]["x"], 10.0);
    assert_eq!(moved["automation_cursor"]["label"], "Move");

    observe_browser(&mut app, browser_id);
    let clicked = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "click", "x": 30.0, "y": 40.0, "label": "Click"}),
        )
        .expect("click should update the Browser Automation Cursor");
    assert_eq!(clicked["automation_cursor"]["x"], 30.0);
    assert_eq!(clicked["automation_cursor"]["label"], "Click");

    observe_browser(&mut app, browser_id);
    let typed = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "type", "text": "hello"}),
        )
        .expect("type should preserve the Browser Automation Cursor");
    assert_eq!(typed["automation_cursor"]["x"], 30.0);
    assert_eq!(typed["automation_cursor"]["label"], "Click");

    observe_browser(&mut app, browser_id);
    let pressed = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "press", "key": "Enter"}),
        )
        .expect("press should preserve the Browser Automation Cursor");
    assert_eq!(pressed["automation_cursor"]["x"], 30.0);
    assert_eq!(pressed["automation_cursor"]["label"], "Click");
}

#[test]
fn browser_observe_returns_browser_page_map_regions_and_interactables() {
    // UC-12 BR-53 / BR-54: browser-observe exposes bounded Browser Page Map regions and interactables with generation-scoped refs.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    set_browser_snapshot(
        &mut app,
        browser_id,
        "Conversation Lab\nUser\n+ Debug User",
        "Conversation Lab",
        "https://example.com",
    );
    set_browser_page_map(&mut app, browser_id);

    let observed = observe_browser(&mut app, browser_id);

    assert_eq!(observed["page_map"]["generation"].as_u64(), Some(2));
    assert_eq!(observed["page_map"]["regions"][0]["ref"], "r1");
    assert_eq!(
        observed["page_map"]["regions"][0]["label"],
        "Conversation Lab User list"
    );
    assert_eq!(observed["page_map"]["regions"][0]["rect"]["x"], 720.0);
    assert_eq!(observed["page_map"]["interactables"][0]["ref"], "i1");
    assert_eq!(
        observed["page_map"]["interactables"][0]["action"],
        "open-dev-user-modal"
    );
    assert_eq!(
        observed["page_map"]["interactables"][1]["placeholder"],
        "편하게 답변해주세요"
    );
    assert_eq!(
        observed["page_map"]["ref_semantics"]["generation_scoped"],
        true
    );
    assert_eq!(
        observed["page_map"]["ref_semantics"]["persistent_dom_identity"],
        false
    );
    assert_eq!(observed["page_map"]["limits"]["interactable_limit"], 80);
}

#[test]
fn browser_action_click_targets_browser_page_element_ref() {
    // UC-12 BR-55: click target_ref resolves Browser Page Element geometry and moves Browser Automation Cursor to its center.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    set_browser_page_map(&mut app, browser_id);
    observe_browser(&mut app, browser_id);

    let clicked = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "click", "target_ref": "i1"}),
        )
        .expect("target_ref click should succeed after observe");

    assert_eq!(clicked["target"]["ref"], "i1");
    assert_eq!(clicked["target"]["label"], "+ Debug User");
    assert_eq!(clicked["automation_cursor"]["x"], 954.0);
    assert_eq!(clicked["automation_cursor"]["y"], 64.0);
    assert_eq!(clicked["runtime"], "tide_browser_pane");
    assert!(clicked["external_runtime"].is_null());
}

#[test]
fn browser_action_type_targets_browser_page_element_ref() {
    // UC-12 BR-56: type target_ref focuses the observed Browser Page Element before typing through Tide Browser Pane Runtime.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    set_browser_page_map(&mut app, browser_id);
    observe_browser(&mut app, browser_id);

    let typed = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "type", "target_ref": "i2", "text": "Codex"}),
        )
        .expect("target_ref type should succeed after observe");

    assert_eq!(typed["target"]["ref"], "i2");
    assert_eq!(typed["target"]["role"], "textbox");
    assert_eq!(typed["automation_cursor"]["x"], 336.0);
    assert_eq!(typed["automation_cursor"]["y"], 612.0);
    assert_eq!(typed["targeted_focus"], true);
    assert_eq!(typed["observe_after_action"], true);
}

#[test]
fn browser_target_ref_actions_delay_dispatch_until_cursor_motion_settles() {
    // UC-12 BR-55 / BR-56: target_ref click/type dispatch waits for distance-scaled Browser Automation Cursor motion to settle.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    set_browser_page_map(&mut app, browser_id);
    observe_browser(&mut app, browser_id);

    let first = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "click", "target_ref": "i1"}),
        )
        .expect("first target_ref click should succeed after observe");
    let first_motion = first["cursor_motion_ms"]
        .as_u64()
        .expect("target_ref click should expose cursor motion duration");
    assert!(first_motion >= 120);
    assert_eq!(first["dispatch_delay_ms"].as_u64(), Some(first_motion + 45));

    let far = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "type", "target_ref": "i2", "text": "Codex"}),
        )
        .expect("chained target_ref type should succeed");
    let far_motion = far["cursor_motion_ms"]
        .as_u64()
        .expect("target_ref type should expose cursor motion duration");

    assert!(far_motion > first_motion);
    assert_eq!(far["dispatch_delay_ms"].as_u64(), Some(far_motion + 45));
}

#[test]
fn browser_action_rejects_unknown_browser_page_element_ref() {
    // UC-12 BR-57: unknown target_ref fails explicitly before dispatch.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    set_browser_page_map(&mut app, browser_id);
    observe_browser(&mut app, browser_id);

    let result = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "target_ref": "missing"}),
    );

    assert!(result.is_err());
}

#[test]
fn browser_action_chains_current_page_map_target_refs_after_live_input() {
    // UC-12 BR-58: after an initial observe, currently cached enabled Browser Page Element refs can be chained without an intervening observe.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    set_browser_page_map(&mut app, browser_id);

    let first_without_observe = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "target_ref": "i1"}),
    );
    assert!(first_without_observe.is_err());

    observe_browser(&mut app, browser_id);
    app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "type", "target_ref": "i2", "text": "민준"}),
    )
    .expect("first target_ref action after observe should succeed");

    let coordinate_action = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 12.0, "y": 18.0}),
    );
    assert!(coordinate_action.is_err());

    let chained = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "click", "target_ref": "i1"}),
        )
        .expect("current target_ref should allow a chained visible Browser Pane action");

    assert_eq!(chained["target"]["ref"], "i1");
    assert_eq!(
        chained["used_current_page_map_target_without_fresh_observe"],
        true
    );
}

#[test]
fn browser_observe_compact_returns_browser_observation_summary() {
    // UC-12 BR-59: compact observe preserves Browser Page Map targeting data while omitting full BrowserSnapshot text.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    let long_text = "Conversation Lab\nUser list\nRuntime Trace\n".repeat(300);
    set_browser_snapshot(
        &mut app,
        browser_id,
        long_text,
        "Conversation Lab",
        "https://example.com",
    );
    set_browser_page_map(&mut app, browser_id);

    let compact = app
        .handle_cli_command(
            "browser-observe",
            json!({"pane_id": browser_id, "detail": "compact"}),
        )
        .expect("compact browser observe should succeed");

    assert_eq!(compact["detail"], "compact");
    assert!(compact["snapshot"]["text"].is_null());
    assert_eq!(compact["snapshot"]["status"], "ok");
    assert!(
        compact["snapshot"]["text_excerpt"]
            .as_str()
            .expect("compact observe should return a text excerpt")
            .len()
            <= 2048
    );
    assert_eq!(compact["page_map"]["interactables"][0]["ref"], "i1");
    assert_eq!(
        compact["page_map"]["interactables"][0]["action"],
        "open-dev-user-modal"
    );
    assert!(compact["page_map"]["interactables"][0]["text"].is_null());
    assert_eq!(compact["page_map"]["regions"][0]["ref"], "r1");
}

// --- UC-3: UseBrowserAutomationCursor ---

#[test]
fn browser_automation_cursor_marks_and_clears_agent_target() {
    // UC-3 BR-9 / BR-10 / BR-11 / BR-12: Browser Automation Cursor is marker state, not element identity or human consent, and can be cleared.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");

    let moved = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "move", "x": 64.0, "y": 96.0, "label": "Target"}),
        )
        .expect("move should set the Browser Automation Cursor");
    assert_eq!(moved["automation_cursor"]["x"], 64.0);
    assert_eq!(moved["cursor_semantics"]["marker_only"], true);
    assert_eq!(moved["cursor_semantics"]["element_identity"], false);
    assert_eq!(moved["cursor_semantics"]["pointer_ownership"], false);
    assert_eq!(moved["cursor_semantics"]["human_consent"], false);

    let cleared = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "clear-cursor"}),
        )
        .expect("clear-cursor should clear the marker");
    assert!(cleared["automation_cursor"].is_null());
}

#[test]
fn browser_automation_cursor_requires_reobserve_after_navigation() {
    // UC-3 BR-13: Browser Automation Cursor can be stale after navigation, so content interaction requires re-observe.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.set_automation_cursor(BrowserAutomationCursor {
            x: 12.0,
            y: 18.0,
            label: Some("Before".to_string()),
            visible: true,
        });
    }

    observe_browser(&mut app, browser_id);
    app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "navigate", "url": "example.com/next"}),
    )
    .expect("navigate should succeed after observe");

    let stale_click = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 12.0, "y": 18.0}),
    );
    assert!(stale_click.is_err());

    observe_browser(&mut app, browser_id);
    assert!(app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "click", "x": 12.0, "y": 18.0}),
        )
        .is_ok());
}

// --- UC-4: CaptureHumanBrowserSelection ---

#[test]
fn browser_capture_selection_prefers_page_selection_over_url_fallback() {
    // UC-4 BR-14 / BR-17: page selection metadata is explicit and broad body text is not used as fallback selection.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com/docs");
    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.update_page_selection(Some(BrowserSelectionSnapshot {
            text: "selected browser text".to_string(),
            html: "<strong>selected browser text</strong>".to_string(),
            context: Some("nearby context".to_string()),
            page_title: Some("Example docs".to_string()),
            page_url: Some("https://example.com/docs".to_string()),
            collapsed: false,
        }));
    }

    let page = app
        .handle_cli_command("capture-selection", json!({"pane_id": browser_id}))
        .expect("page selection should capture");
    assert_eq!(page["selection_source"], "page");
    assert_eq!(page["browser_selection"]["url"], "https://example.com/docs");
    assert!(page["content"]
        .as_str()
        .unwrap()
        .contains("selected browser text"));

    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.url_input_focused = true;
        browser.url_input = "https://example.com/docs".to_string();
        browser.url_selection = Some((8, 19));
    }
    let url = app
        .handle_cli_command("capture-selection", json!({"pane_id": browser_id}))
        .expect("URL selection should capture");
    assert_eq!(url["selection_source"], "url");
    assert_eq!(url["content"], "example.com");
}

#[test]
fn browser_region_selection_is_reported_as_unsupported_until_region_model_exists() {
    // UC-4 BR-16: region and element capture are explicit future gaps in V1.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");

    let region = app.handle_cli_command(
        "capture-selection",
        json!({"pane_id": browser_id, "selection_kind": "region"}),
    );
    assert!(region.is_err());

    let element = app.handle_cli_command(
        "capture-selection",
        json!({"pane_id": browser_id, "selection_kind": "element"}),
    );
    assert!(element.is_err());
}

#[test]
fn render_mode_browser_capture_selection_falls_back_to_render_html() {
    // UC-4 BR-15: render-mode Browser Pane selection falls back to render HTML when no page selection exists.
    let (mut app, browser_id) =
        app_with_render_browser("<main><h1>Preview</h1><p>Rendered fallback text</p></main>");

    let captured = app
        .handle_cli_command("capture-selection", json!({"pane_id": browser_id}))
        .expect("render-mode Browser Pane should use render HTML fallback");

    assert_eq!(captured["kind"], "browser-render");
    assert_eq!(captured["selection_source"], "render-html");
    assert!(captured["browser_selection"].is_null());
    assert!(captured["content"]
        .as_str()
        .unwrap()
        .contains("Rendered fallback text"));
}

// --- UC-5: CreateBrowserContextArtifact ---

#[test]
fn browser_context_artifact_delivers_only_to_paired_agent() {
    // UC-5 BR-18 / BR-21 / BR-23: Browser Context Artifacts use Source Label and deliver only to the paired agent.
    let (mut app, browser_id, terminal_a) = app_with_browser("https://example.com/docs");
    let terminal_b = CALLER_TERMINAL_B;
    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.update_page_selection(Some(BrowserSelectionSnapshot {
            text: "selected browser text".to_string(),
            html: "<p>selected browser text</p>".to_string(),
            context: None,
            page_title: Some("Example docs".to_string()),
            page_url: Some("https://example.com/docs".to_string()),
            collapsed: false,
        }));
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
            json!({"pane_id": browser_id, "comment": "review this", "_caller_pane": terminal_a}),
        )
        .unwrap();
    assert_eq!(created["source_label"], "https://example.com/docs");

    app.handle_cli_command(
        "send-context-artifact",
        json!({"artifact_id": created["artifact_id"].as_u64().unwrap(), "_caller_pane": terminal_a}),
    )
    .unwrap();

    let paired = rx_a
        .try_recv()
        .expect("paired agent should receive delivery");
    assert!(paired.contains("context-artifact-delivered"));
    assert!(
        rx_b.try_recv().is_err(),
        "unpaired terminal must not receive Browser Context Artifact delivery"
    );
}

#[test]
fn browser_context_artifact_list_read_are_workspace_and_terminal_scoped() {
    // UC-5 BR-19 / BR-20 / BR-22: Browser Context Artifact list/read stay Workspace-local and Associated Terminal-authorized.
    let (mut app, browser_id, terminal_a) = app_with_browser("https://example.com/docs");
    let terminal_b = CALLER_TERMINAL_B;

    let created = app
        .handle_cli_command(
            "create-context-artifact",
            json!({"pane_id": browser_id, "comment": "browser note", "_caller_pane": terminal_a}),
        )
        .unwrap();
    let artifact_id = created["artifact_id"].as_u64().unwrap();

    let list_a = app
        .handle_cli_command(
            "list-context-artifacts",
            json!({"_caller_pane": terminal_a}),
        )
        .unwrap();
    assert_eq!(list_a.as_array().unwrap().len(), 1);

    assert!(app
        .handle_cli_command(
            "read-context-artifact",
            json!({"artifact_id": artifact_id, "_caller_pane": terminal_b}),
        )
        .is_err());

    let list_b = app
        .handle_cli_command(
            "list-context-artifacts",
            json!({"_caller_pane": terminal_b}),
        )
        .unwrap();
    assert!(list_b.as_array().unwrap().is_empty());
}

#[test]
fn browser_context_artifacts_require_explicit_read() {
    // UC-5 BR-22: Browser Context Artifacts are listed/read explicitly instead of injected as ambient Browser Pane context.
    let initialize = mcp::mcp_initialize_for_test();
    let instructions = initialize["result"]["instructions"]
        .as_str()
        .unwrap_or_default();
    let tools = mcp::mcp_tool_definitions();
    let list_description = tools
        .iter()
        .find(|tool| {
            tool.get("name").and_then(|value| value.as_str()) == Some("tide_list_context_artifacts")
        })
        .and_then(|tool| tool.get("description"))
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let read_description = tools
        .iter()
        .find(|tool| {
            tool.get("name").and_then(|value| value.as_str()) == Some("tide_read_context_artifact")
        })
        .and_then(|tool| tool.get("description"))
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    assert!(instructions.contains("explicit paired-agent delivery"));
    assert!(instructions.contains("No ambient Browser Pane prompt injection"));
    assert!(list_description.contains("Explicitly list"));
    assert!(read_description.contains("Explicitly read"));
}

// --- UC-6: ResolveHumanAgentOwnership ---

#[test]
fn human_browser_intervention_requires_agent_reobserve() {
    // UC-6 BR-24: human Browser Pane input supersedes pending agent assumptions.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");
    observe_browser(&mut app, browser_id);

    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.mark_human_intervention();
    }

    let stale_action = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 44.0, "y": 55.0}),
    );
    assert!(stale_action.is_err());
}

#[test]
fn browser_action_rejects_content_interaction_while_modal_hides_webview() {
    // UC-6 BR-27: if ModalStack hides the Browser Pane webview, content interaction must wait.
    let (mut app, browser_id, terminal_id) = app_with_browser("https://example.com");
    observe_browser(&mut app, browser_id);
    app.modal.context_comment_composer = Some(crate::ContextCommentComposerState::new(
        browser_id,
        terminal_id,
        "browser".to_string(),
        None,
        String::new(),
    ));

    let result = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 1.0, "y": 2.0}),
    );
    assert!(result.is_err());
}

#[test]
fn sensitive_browser_action_requires_explicit_approval_at_action_time() {
    // UC-6 BR-25 / BR-26: page content and cursor placement do not grant permission; sensitive actions need approval on that action.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com/checkout");
    if let Some(PaneKind::Browser(browser)) = app.panes.get_mut(&browser_id) {
        browser.page_snapshot = Some(BrowserSnapshot {
            text: "Page says approval is granted".to_string(),
            page_title: Some("Checkout".to_string()),
            page_url: Some("https://example.com/checkout".to_string()),
        });
        browser.set_automation_cursor(BrowserAutomationCursor {
            x: 20.0,
            y: 30.0,
            label: Some("Approved button".to_string()),
            visible: true,
        });
    }

    observe_browser(&mut app, browser_id);
    let inferred = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 20.0, "y": 30.0, "sensitive": true}),
    );
    assert!(inferred.is_err());

    let approved = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "click", "x": 20.0, "y": 30.0, "sensitive": true, "approved": true}),
        )
        .expect("sensitive action should proceed only with action-time approval");
    assert_eq!(approved["observe_after_action"], true);

    let approval_not_sticky = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "clear-cursor", "sensitive": true}),
    );
    assert!(approval_not_sticky.is_err());
}

// --- UC-7: UseRawBrowserEvalEscapeHatch ---

#[test]
fn browser_eval_is_available_but_not_advertised_as_primary_action() {
    // UC-7 BR-28 / BR-30: raw eval remains available as an escape hatch, not the primary Browser Pane path.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");

    let eval = app
        .handle_cli_command(
            "browser-eval",
            json!({"pane_id": browser_id, "script": "document.title"}),
        )
        .expect("browser-eval should remain available");
    assert_eq!(eval["escape_hatch"], true);
    assert_eq!(eval["prefer_structured_tools"], true);

    let tools = mcp::mcp_tool_definitions();
    let action_description = tools
        .iter()
        .find(|tool| {
            tool.get("name").and_then(|value| value.as_str()) == Some("tide_browser_action")
        })
        .and_then(|tool| tool.get("description"))
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let eval_description = tools
        .iter()
        .find(|tool| tool.get("name").and_then(|value| value.as_str()) == Some("tide_browser_eval"))
        .and_then(|tool| tool.get("description"))
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    assert!(action_description.contains("preferred"));
    assert!(eval_description.contains("escape hatch"));
}

#[test]
fn browser_eval_requires_approval_for_marked_sensitive_flow() {
    // UC-7 BR-29: raw eval cannot bypass explicit approval when the caller marks a sensitive flow.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");

    let rejected = app.handle_cli_command(
        "browser-eval",
        json!({"pane_id": browser_id, "script": "document.title", "sensitive": true}),
    );
    assert!(rejected.is_err());

    let approved = app.handle_cli_command(
        "browser-eval",
        json!({"pane_id": browser_id, "script": "document.title", "sensitive": true, "approved": true}),
    );
    assert!(approved.is_ok());
}

#[test]
fn browser_eval_rejects_interactive_dom_actions_and_debug_overlays() {
    // UC-7 BR-43: raw eval cannot bypass Browser Automation Cursor or Agent Browser Control Mode with synthetic interaction or debug overlays.
    let (mut app, browser_id, _terminal_id) = app_with_browser("https://example.com");

    let click = app.handle_cli_command(
        "browser-eval",
        json!({"pane_id": browser_id, "script": "document.querySelector('button').click()"}),
    );
    assert!(click.is_err());

    let overlay = app.handle_cli_command(
        "browser-eval",
        json!({"pane_id": browser_id, "script": "const dump = document.createElement('pre'); dump.id = 'codex-debug-dump'; document.body.appendChild(dump);"}),
    );
    assert!(overlay.is_err());

    let attempted_allow = app.handle_cli_command(
        "browser-eval",
        json!({
            "pane_id": browser_id,
            "script": "const dump = document.createElement('pre'); dump.id = 'debug';",
            "allow_dom_mutation": true
        }),
    );
    assert!(attempted_allow.is_err());
}

// --- UC-8: EscalateToExternalBrowserRuntime ---

#[test]
fn browser_runtime_guidance_focuses_on_tide_browser_pane_runtime() {
    // UC-8 BR-31 / BR-33: normal MCP browser guidance presents Tide Browser Pane Runtime without advertising external runtime choices.
    let initialize = mcp::mcp_initialize_for_test();
    let instructions = initialize["result"]["instructions"]
        .as_str()
        .unwrap_or_default();

    assert!(instructions.contains("Tide Browser Pane Runtime"));
    assert!(instructions.contains("must use Tide Browser Pane Runtime as the first runtime"));
    assert!(!instructions.contains("External Browser Runtime"));
    assert!(!instructions.contains("fallback reason"));
    assert!(instructions.contains("Browser Runtime Router"));
}

#[test]
fn browser_pane_v2_profile_cookie_persistence_is_not_v1_default() {
    // UC-8 BR-32: Browser profile/cookie persistence is Browser Pane V2 or external-runtime work, not V1 default behavior.
    let (mut app, terminal_id) = app_with_real_terminal();

    let opened = app
        .handle_cli_command(
            "open-browser",
            json!({"url": "https://example.com", "_caller_pane": terminal_id}),
        )
        .expect("open-browser should create the V1 Browser Pane");
    let browser_id = opened["pane_id"].as_u64().unwrap();
    let opened_object = opened.as_object().unwrap();
    for key in [
        "profile_id",
        "cookie_store",
        "persistent_profile",
        "persistent_cookies",
        "password_store",
        "passkey_store",
        "extensions",
    ] {
        assert!(
            !opened_object.contains_key(key),
            "open-browser must not expose V2 browser persistence key {key}"
        );
    }

    let observed = observe_browser(&mut app, browser_id);
    assert_eq!(observed["runtime"], "tide_browser_pane");
    assert!(observed["external_runtime"].is_null());
    for key in [
        "profile_id",
        "cookie_store",
        "persistent_profile",
        "persistent_cookies",
    ] {
        assert!(
            observed.get(key).is_none(),
            "observe must not expose V2 browser persistence key {key}"
        );
    }
}

// --- UC-9: ReadAndDiffBrowserSnapshot ---

#[test]
fn browser_snapshot_read_returns_bounded_current_snapshot() {
    // UC-9 BR-34: read_snapshot returns only bounded cached BrowserSnapshot state and explicit truncation metadata.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/long");
    let text = format!("{}tail", "A".repeat(140 * 1024));
    let generation = set_browser_snapshot(
        &mut app,
        browser_id,
        text,
        "Long page",
        "https://example.com/long",
    );
    let generation_before = app
        .panes
        .get(&browser_id)
        .and_then(|pane| match pane {
            PaneKind::Browser(browser) => Some(browser.generation),
            _ => None,
        })
        .unwrap();

    let read = app
        .handle_cli_command(
            "browser-read-snapshot",
            json!({"pane_id": browser_id, "_caller_pane": terminal_id}),
        )
        .expect("authorized read_snapshot should succeed");

    assert_eq!(read["pane_id"], browser_id);
    assert_eq!(read["status"], "ok");
    assert_eq!(read["generation"], generation);
    assert_eq!(read["page_title"], "Long page");
    assert_eq!(read["page_url"], "https://example.com/long");
    assert!(read["text"].as_str().unwrap().len() <= 128 * 1024);
    assert_eq!(read["truncation"]["text_truncated"], true);
    assert_eq!(read["truncation"]["limit_bytes"], 128 * 1024);
    let generation_after = app
        .panes
        .get(&browser_id)
        .and_then(|pane| match pane {
            PaneKind::Browser(browser) => Some(browser.generation),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        generation_after, generation_before,
        "read_snapshot must not refresh or mutate the Browser Pane"
    );
}

#[test]
fn browser_snapshot_find_searches_cached_snapshot_without_refresh() {
    // UC-9 BR-35: find_in_snapshot searches only cached BrowserSnapshot text and returns bounded matches.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/search");
    let mut text = String::new();
    for idx in 0..60 {
        text.push_str(&format!("line {idx}: needle in cached text\n"));
    }
    let generation = set_browser_snapshot(
        &mut app,
        browser_id,
        text,
        "Search page",
        "https://example.com/search",
    );

    let found = app
        .handle_cli_command(
            "browser-find-in-snapshot",
            json!({"pane_id": browser_id, "query": "needle", "_caller_pane": terminal_id}),
        )
        .expect("authorized find_in_snapshot should succeed");

    assert_eq!(found["pane_id"], browser_id);
    assert_eq!(found["status"], "ok");
    assert_eq!(found["generation"], generation);
    assert_eq!(found["matches"].as_array().unwrap().len(), 50);
    assert_eq!(found["truncation"]["matches_truncated"], true);
    assert_eq!(found["matches"][0]["line"], 1);
    assert!(found["matches"][0]["context"]
        .as_str()
        .unwrap()
        .contains("needle in cached text"));

    let missing = app
        .handle_cli_command(
            "browser-find-in-snapshot",
            json!({"pane_id": browser_id, "query": "not-present", "_caller_pane": terminal_id}),
        )
        .expect("missing query still returns a bounded result");
    assert_eq!(missing["matches"].as_array().unwrap().len(), 0);
}

#[test]
fn browser_snapshot_diff_rejects_stale_generation() {
    // UC-9 BR-36: diff_since requires a retained Generation anchor for the same Browser Pane.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/diff");
    let first_generation = set_browser_snapshot(
        &mut app,
        browser_id,
        "alpha\nbeta\n",
        "Diff page",
        "https://example.com/diff",
    );
    set_browser_snapshot(
        &mut app,
        browser_id,
        "alpha\nbeta changed\n",
        "Diff page",
        "https://example.com/diff",
    );

    let diff = app
        .handle_cli_command(
            "browser-diff-since",
            json!({
                "pane_id": browser_id,
                "anchor": {"pane_id": browser_id, "generation": first_generation},
                "_caller_pane": terminal_id
            }),
        )
        .expect("retained anchor should produce a diff");
    assert_eq!(diff["status"], "ok");
    assert!(diff["diff"].as_str().unwrap().contains("+beta changed"));

    set_browser_snapshot(
        &mut app,
        browser_id,
        "alpha\nbeta changed again\n",
        "Diff page",
        "https://example.com/diff",
    );
    let stale = app.handle_cli_command(
        "browser-diff-since",
        json!({
            "pane_id": browser_id,
            "anchor": {"pane_id": browser_id, "generation": first_generation},
            "_caller_pane": terminal_id
        }),
    );
    assert!(stale.is_err());
}

#[test]
fn browser_snapshot_cache_is_pane_and_workspace_scoped() {
    // UC-9 BR-37 / BR-42: BrowserSnapshot anchors are owned by one Browser Pane in one Workspace.
    let (mut app, terminal_id, browser_id) = app_with_caller_and_browser("https://example.com/one");
    let other_browser_id = app.layout.alloc_id();
    app.panes.insert(
        other_browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            other_browser_id,
            "https://example.com/two".to_string(),
        )),
    );
    app.add_pane_to_dock(other_browser_id, Some(terminal_id));
    app.assoc
        .associated_terminal
        .insert(other_browser_id, terminal_id);

    let first_generation = set_browser_snapshot(
        &mut app,
        browser_id,
        "first browser text",
        "First",
        "https://example.com/one",
    );
    set_browser_snapshot(
        &mut app,
        other_browser_id,
        "second browser text",
        "Second",
        "https://example.com/two",
    );

    let first = app
        .handle_cli_command(
            "browser-read-snapshot",
            json!({"pane_id": browser_id, "_caller_pane": terminal_id}),
        )
        .unwrap();
    let second = app
        .handle_cli_command(
            "browser-read-snapshot",
            json!({"pane_id": other_browser_id, "_caller_pane": terminal_id}),
        )
        .unwrap();
    assert!(first["text"].as_str().unwrap().contains("first browser"));
    assert!(second["text"].as_str().unwrap().contains("second browser"));

    let cross_pane = app.handle_cli_command(
        "browser-diff-since",
        json!({
            "pane_id": other_browser_id,
            "anchor": {"pane_id": browser_id, "generation": first_generation},
            "_caller_pane": terminal_id
        }),
    );
    assert!(cross_pane.is_err());

    app.ws.workspaces.push(Workspace {
        name: "WS0".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    let inactive_layout = crate::tide_layout::SplitLayout::new();
    let inactive_terminal_id = 190_001;
    let inactive_terminal =
        TerminalPane::with_cwd(inactive_terminal_id, 80, 24, None, true).unwrap();
    app.ws.workspaces[1] = Workspace {
        name: "WS1".into(),
        layout: inactive_layout,
        focused: Some(inactive_terminal_id),
        panes: HashMap::from([(inactive_terminal_id, PaneKind::Terminal(inactive_terminal))]),
    };

    let wrong_workspace = app.handle_cli_command(
        "browser-read-snapshot",
        json!({"pane_id": browser_id, "_caller_pane": inactive_terminal_id}),
    );
    assert!(wrong_workspace.is_err());
}

#[test]
fn closing_or_cold_storing_browser_pane_drops_snapshot_history() {
    // UC-9 BR-38: closing or cold-storing a Browser Pane drops BrowserSnapshot history and invalidates anchors.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/close");
    set_browser_snapshot(
        &mut app,
        browser_id,
        "closing snapshot",
        "Close",
        "https://example.com/close",
    );
    assert!(app
        .handle_cli_command(
            "browser-read-snapshot",
            json!({"pane_id": browser_id, "_caller_pane": terminal_id}),
        )
        .is_ok());

    app.handle_cli_command(
        "close-pane",
        json!({"pane_id": browser_id, "_caller_pane": terminal_id}),
    )
    .expect("closing Browser Pane should succeed");
    assert!(app
        .handle_cli_command(
            "browser-read-snapshot",
            json!({"pane_id": browser_id, "_caller_pane": terminal_id}),
        )
        .is_err());

    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/cold");
    set_browser_snapshot(
        &mut app,
        browser_id,
        "cold snapshot",
        "Cold",
        "https://example.com/cold",
    );
    app.ws.workspaces.push(Workspace {
        name: "WS0".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    app.save_active_workspace();
    app.load_active_workspace();

    let read = app
        .handle_cli_command(
            "browser-read-snapshot",
            json!({"pane_id": browser_id, "_caller_pane": terminal_id}),
        )
        .expect("cold-stored Browser Pane still exists after reload");
    assert_eq!(read["status"], "missing");
    assert!(app
        .handle_cli_command(
            "browser-diff-since",
            json!({
                "pane_id": browser_id,
                "anchor": {"pane_id": browser_id, "generation": 1},
                "_caller_pane": terminal_id
            }),
        )
        .is_err());
}

// --- UC-10: GateAgentBrowserControlMode ---

#[test]
fn non_wrapper_browser_action_does_not_enter_agent_browser_control_mode() {
    // UC-10 BR-39: non-wrapper browser-action callers keep ordinary behavior without wrapper-managed visual privileges.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/control");
    app.gateway.detected_agents.insert(
        terminal_id,
        AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: false,
            gateway_connected: true,
            status: Some(AgentStatus::Running),
        },
    );

    let moved = app
        .handle_cli_command(
            "browser-action",
            json!({
                "pane_id": browser_id,
                "action": "move",
                "x": 10.0,
                "y": 20.0,
                "_caller_pane": terminal_id
            }),
        )
        .expect("ordinary browser-action should still work");

    assert_eq!(moved["automation_cursor"]["x"], 10.0);
    assert_eq!(moved["agent_browser_control_mode"]["active"], false);
    assert_eq!(
        moved["agent_browser_control_mode"]["wrapper_managed"],
        false
    );
}

#[test]
fn wrapper_managed_browser_action_enters_agent_browser_control_mode() {
    // UC-10 BR-40: wrapper-managed browser-action callers enter Agent Browser Control Mode only when all gates pass.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/control");

    app.gateway.detected_agents.insert(
        terminal_id,
        AgentInfo {
            gateway_connected: false,
            ..wrapped_agent_info(Some(AgentStatus::Running))
        },
    );
    let disconnected = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "move", "x": 1.0, "y": 2.0, "_caller_pane": terminal_id}),
        )
        .unwrap();
    assert_eq!(disconnected["agent_browser_control_mode"]["active"], false);

    app.gateway
        .detected_agents
        .insert(terminal_id, wrapped_agent_info(Some(AgentStatus::Idle)));
    let idle = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "move", "x": 3.0, "y": 4.0, "_caller_pane": terminal_id}),
        )
        .unwrap();
    assert_eq!(idle["agent_browser_control_mode"]["active"], false);

    app.gateway
        .detected_agents
        .insert(terminal_id, wrapped_agent_info(Some(AgentStatus::Running)));
    let running = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "move", "x": 5.0, "y": 6.0, "_caller_pane": terminal_id}),
        )
        .unwrap();
    assert_eq!(running["agent_browser_control_mode"]["active"], true);
    assert_eq!(
        running["agent_browser_control_mode"]["caller_pane"],
        terminal_id
    );
    assert_eq!(
        running["agent_browser_control_mode"]["associated_terminal"],
        terminal_id
    );
}

#[test]
fn agent_browser_control_mode_preserves_modal_sensitive_and_generation_gates() {
    // UC-10 BR-41: Agent Browser Control Mode preserves ModalStack, sensitive-action approval, observe-before-action, and Generation freshness rules.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/control");
    app.gateway
        .detected_agents
        .insert(terminal_id, wrapped_agent_info(Some(AgentStatus::Running)));

    let before_observe = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 1.0, "y": 2.0, "_caller_pane": terminal_id}),
    );
    assert!(before_observe.is_err());

    observe_browser(&mut app, browser_id);
    app.modal.context_comment_composer = Some(crate::ContextCommentComposerState::new(
        browser_id,
        terminal_id,
        "browser".to_string(),
        None,
        String::new(),
    ));
    let hidden_by_modal = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 1.0, "y": 2.0, "_caller_pane": terminal_id}),
    );
    assert!(hidden_by_modal.is_err());
    app.modal.context_comment_composer = None;

    let unapproved_sensitive = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 1.0, "y": 2.0, "sensitive": true, "_caller_pane": terminal_id}),
    );
    assert!(unapproved_sensitive.is_err());

    let approved = app
        .handle_cli_command(
            "browser-action",
            json!({"pane_id": browser_id, "action": "click", "x": 1.0, "y": 2.0, "sensitive": true, "approved": true, "_caller_pane": terminal_id}),
        )
        .expect("approved sensitive action should preserve Agent Browser Control Mode gates");
    assert_eq!(approved["agent_browser_control_mode"]["active"], true);
    assert_eq!(approved["observe_after_action"], true);

    let stale_generation = app.handle_cli_command(
        "browser-action",
        json!({"pane_id": browser_id, "action": "click", "x": 1.0, "y": 2.0, "_caller_pane": terminal_id}),
    );
    assert!(stale_generation.is_err());
}

#[test]
fn browser_snapshot_tools_reject_missing_caller_wrong_terminal_and_wrong_workspace() {
    // UC-10 BR-42: BrowserSnapshot tools reject missing Caller Pane, wrong Associated Terminal, and wrong Workspace access.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/scope");
    set_browser_snapshot(
        &mut app,
        browser_id,
        "scoped snapshot",
        "Scoped",
        "https://example.com/scope",
    );

    let missing_caller =
        app.handle_cli_command("browser-read-snapshot", json!({"pane_id": browser_id}));
    assert!(missing_caller.is_err());

    let wrong_terminal_id = add_stage_terminal(&mut app, terminal_id);
    let wrong_terminal = app.handle_cli_command(
        "browser-read-snapshot",
        json!({"pane_id": browser_id, "_caller_pane": wrong_terminal_id}),
    );
    assert!(wrong_terminal.is_err());

    app.ws.workspaces.push(Workspace {
        name: "WS0".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    let inactive_layout = crate::tide_layout::SplitLayout::new();
    let inactive_terminal_id = 190_002;
    let inactive_terminal =
        TerminalPane::with_cwd(inactive_terminal_id, 80, 24, None, true).unwrap();
    app.ws.workspaces[1] = Workspace {
        name: "WS1".into(),
        layout: inactive_layout,
        focused: Some(inactive_terminal_id),
        panes: HashMap::from([(inactive_terminal_id, PaneKind::Terminal(inactive_terminal))]),
    };

    let wrong_workspace = app.handle_cli_command(
        "browser-find-in-snapshot",
        json!({"pane_id": browser_id, "query": "scoped", "_caller_pane": inactive_terminal_id}),
    );
    assert!(wrong_workspace.is_err());
}

#[test]
fn browser_live_tools_reject_wrong_associated_terminal_for_caller() {
    // UC-10 BR-60: Caller-scoped live Browser Pane tools reject a target owned by a different Associated Terminal before live read or mutation.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/scope");
    let wrong_terminal_id = add_stage_terminal(&mut app, terminal_id);

    app.handle_cli_command(
        "browser-observe",
        json!({"pane_id": browser_id, "_caller_pane": terminal_id}),
    )
    .expect("owner Caller Pane should be allowed to observe its Browser Pane");

    let wrong_observe = app.handle_cli_command(
        "browser-observe",
        json!({"pane_id": browser_id, "_caller_pane": wrong_terminal_id}),
    );
    assert!(wrong_observe.is_err());

    let before_url = match app.panes.get(&browser_id) {
        Some(PaneKind::Browser(browser)) => browser.url.clone(),
        _ => panic!("Browser Pane should exist"),
    };
    let wrong_action = app.handle_cli_command(
        "browser-action",
        json!({
            "pane_id": browser_id,
            "action": "navigate",
            "url": "https://example.com/wrong",
            "_caller_pane": wrong_terminal_id
        }),
    );
    assert!(wrong_action.is_err());
    assert!(matches!(
        app.panes.get(&browser_id),
        Some(PaneKind::Browser(browser)) if browser.url == before_url
    ));

    let wrong_operation = app.handle_cli_command(
        "browser-operation",
        json!({"pane_id": browser_id, "action": "start", "_caller_pane": wrong_terminal_id}),
    );
    assert!(wrong_operation.is_err());
    assert!(matches!(
        app.panes.get(&browser_id),
        Some(PaneKind::Browser(browser)) if browser.automation_cursor().is_none()
    ));

    let wrong_eval = app.handle_cli_command(
        "browser-eval",
        json!({
            "pane_id": browser_id,
            "script": "document.title",
            "_caller_pane": wrong_terminal_id
        }),
    );
    assert!(wrong_eval.is_err());
}

// --- UC-11: HoldBrowserOperation ---

#[test]
fn browser_operation_transaction_keeps_agent_indicator_and_cursor_visible_until_finish() {
    // UC-11 BR-47 / BR-48 / BR-49: Browser Operation holds agent-control chrome and Browser Automation Cursor for the task duration.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/operation");
    app.gateway
        .detected_agents
        .insert(terminal_id, wrapped_agent_info(Some(AgentStatus::Running)));

    let started = app
        .handle_cli_command(
            "browser-operation",
            json!({
                "pane_id": browser_id,
                "action": "start",
                "x": 18.0,
                "y": 22.0,
                "label": "Browser Operation",
                "_caller_pane": terminal_id
            }),
        )
        .expect("Browser Operation start should succeed");

    assert_eq!(started["operation"]["active"], true);
    assert_eq!(started["agent_browser_control_mode"]["active"], true);
    assert_eq!(started["automation_cursor"]["visible"], true);
    assert_eq!(started["automation_cursor"]["x"], 18.0);
    assert_eq!(started["automation_cursor"]["y"], 22.0);

    let browser = match app.panes.get(&browser_id) {
        Some(PaneKind::Browser(browser)) => browser,
        _ => panic!("target Browser Pane should exist"),
    };
    assert!(browser.agent_browser_control_mode().is_some());
    assert_eq!(
        browser.automation_cursor(),
        Some(&BrowserAutomationCursor {
            x: 18.0,
            y: 22.0,
            label: Some("Browser Operation".to_string()),
            visible: true,
        })
    );

    let finished = app
        .handle_cli_command(
            "browser-operation",
            json!({
                "pane_id": browser_id,
                "action": "finish",
                "_caller_pane": terminal_id
            }),
        )
        .expect("Browser Operation finish should succeed");

    assert_eq!(finished["operation"]["active"], false);
    assert_eq!(finished["agent_browser_control_mode"]["active"], false);
    assert!(finished["automation_cursor"].is_null());

    let browser = match app.panes.get(&browser_id) {
        Some(PaneKind::Browser(browser)) => browser,
        _ => panic!("target Browser Pane should exist"),
    };
    assert!(browser.agent_browser_control_mode().is_none());
    assert!(browser.automation_cursor().is_none());
}

#[test]
fn open_browser_starts_operation_visuals_for_wrapped_agent_before_first_action() {
    // UC-11 BR-47 / BR-48: opening a Browser Pane is enough to enter Browser Operation visuals for an authorized Wrapped Agent.
    let (mut app, terminal_id) = app_with_real_terminal();
    app.gateway
        .detected_agents
        .insert(terminal_id, wrapped_agent_info(Some(AgentStatus::Running)));

    let opened = app
        .handle_cli_command(
            "open-browser",
            json!({
                "url": "https://example.com/operation",
                "_caller_pane": terminal_id
            }),
        )
        .expect("open-browser should start Browser Operation visuals for wrapped agents");
    let browser_id = opened["pane_id"]
        .as_u64()
        .expect("open-browser should return a Browser Pane id");

    assert_eq!(opened["operation"]["active"], true);
    assert_eq!(opened["agent_browser_control_mode"]["active"], true);
    assert_eq!(opened["automation_cursor"]["visible"], true);

    let browser = match app.panes.get(&browser_id) {
        Some(PaneKind::Browser(browser)) => browser,
        _ => panic!("opened Pane should be a Browser Pane"),
    };
    assert!(browser.agent_browser_control_mode().is_some());
    assert_eq!(
        browser.automation_cursor(),
        Some(&BrowserAutomationCursor {
            x: 24.0,
            y: 24.0,
            label: None,
            visible: true,
        })
    );
}

#[test]
fn browser_observe_starts_operation_visuals_and_keeps_generation_stable() {
    // UC-11 BR-47 / BR-48 / BR-51: observing a Browser Pane starts operation visuals and repeated observations do not churn Agent Browser Control Mode.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/operation");
    app.gateway
        .detected_agents
        .insert(terminal_id, wrapped_agent_info(Some(AgentStatus::Running)));

    let first = app
        .handle_cli_command(
            "browser-observe",
            json!({"pane_id": browser_id, "_caller_pane": terminal_id}),
        )
        .expect("browser-observe should start Browser Operation visuals");
    let first_generation = first["agent_browser_control_mode"]["generation"]
        .as_u64()
        .expect("Agent Browser Control Mode should expose a generation");

    assert_eq!(first["agent_browser_control_mode"]["active"], true);
    assert_eq!(first["automation_cursor"]["visible"], true);

    let second = app
        .handle_cli_command(
            "browser-observe",
            json!({"pane_id": browser_id, "_caller_pane": terminal_id}),
        )
        .expect("second browser-observe should keep Browser Operation visuals stable");

    assert_eq!(second["agent_browser_control_mode"]["active"], true);
    assert_eq!(
        second["agent_browser_control_mode"]["generation"].as_u64(),
        Some(first_generation)
    );
}

#[test]
fn wrapped_agent_idle_clears_browser_operation_visuals() {
    // UC-11 BR-52: Wrapped Agent idle lifecycle ends visible Browser Operation state for Browser Panes owned by that Terminal.
    let (mut app, terminal_id, browser_id) =
        app_with_caller_and_browser("https://example.com/operation");
    app.gateway
        .detected_agents
        .insert(terminal_id, wrapped_agent_info(Some(AgentStatus::Running)));

    app.handle_cli_command(
        "browser-operation",
        json!({
            "pane_id": browser_id,
            "action": "start",
            "_caller_pane": terminal_id
        }),
    )
    .expect("Browser Operation start should succeed");

    app.handle_cli_command(
        "notify",
        json!({
            "event": "agent-idle",
            "pane": terminal_id,
            "agent": "codex"
        }),
    )
    .expect("agent idle notification should succeed");

    let browser = match app.panes.get(&browser_id) {
        Some(PaneKind::Browser(browser)) => browser,
        _ => panic!("target Browser Pane should exist"),
    };
    assert!(browser.agent_browser_control_mode().is_none());
    assert!(browser.automation_cursor().is_none());
}
