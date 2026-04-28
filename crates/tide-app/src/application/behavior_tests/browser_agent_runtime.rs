// Spec: docs/specs/browser-agent-runtime-plan.md

use std::sync::mpsc;

use serde_json::json;

use crate::adapter::inward::cli_adapter::mcp;
use crate::pane::browser::{
    BrowserAutomationCursor, BrowserPane, BrowserSelectionSnapshot, BrowserSnapshot,
};
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::PaneId;
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
        json!({"pane_id": browser_id, "script": "document.querySelector('form').submit()", "sensitive": true}),
    );
    assert!(rejected.is_err());

    let approved = app.handle_cli_command(
        "browser-eval",
        json!({"pane_id": browser_id, "script": "document.querySelector('form').submit()", "sensitive": true, "approved": true}),
    );
    assert!(approved.is_ok());
}

// --- UC-8: EscalateToExternalBrowserRuntime ---

#[test]
fn external_browser_runtime_requires_explicit_fallback_reason() {
    // UC-8 BR-31 / BR-33: external browser runtimes are explicit fallbacks, separate from Tide Browser Pane.
    let initialize = mcp::mcp_initialize_for_test();
    let instructions = initialize["result"]["instructions"]
        .as_str()
        .unwrap_or_default();

    assert!(instructions.contains("Tide Browser Pane first"));
    assert!(instructions.contains("Browser Use"));
    assert!(instructions.contains("Computer Use"));
    assert!(instructions.contains("fallback reason"));
    assert!(instructions.contains("separate from Tide Browser Pane"));
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
