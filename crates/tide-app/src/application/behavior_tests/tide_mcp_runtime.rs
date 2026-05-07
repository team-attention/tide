// Spec: docs/specs/tide-mcp-runtime.md

use serde_json::json;

use crate::adapter::inward::cli_adapter::mcp;
use crate::pane::browser::BrowserPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::{FocusArea, SplitTransitionScope};
use crate::tide_core::PaneId;
use crate::App;
use crate::DockPort;
use crate::LayoutPort;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_terminal() -> (App, PaneId) {
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
    (app, terminal_id)
}

fn app_with_context_browser(dock_width: f32) -> (App, PaneId, PaneId) {
    let (mut app, terminal_id) = app_with_terminal();
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
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(terminal_id);
    app.compute_layout();
    (app, terminal_id, browser_id)
}

fn pane_entry<'a>(observed: &'a serde_json::Value, pane_id: PaneId) -> &'a serde_json::Value {
    observed["panes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["pane_id"].as_u64() == Some(pane_id))
        .expect("pane entry should be reported")
}

fn mcp_tool_description(tools: &[serde_json::Value], name: &str) -> String {
    tools
        .iter()
        .find(|tool| tool.get("name").and_then(|value| value.as_str()) == Some(name))
        .and_then(|tool| tool.get("description").and_then(|value| value.as_str()))
        .unwrap_or_default()
        .to_string()
}

// --- UC-1: ObserveTideWorkspace ---

#[test]
fn observing_workspace_reports_provider_neutral_surfaces_and_panes() {
    // UC-1 BR-1 / BR-2 / BR-4: workspace observe returns provider-neutral runtime, surfaces, and Pane membership.
    let (mut app, terminal_id, browser_id) = app_with_context_browser(400.0);

    let observed = app
        .handle_cli_command("observe-workspace", json!({}))
        .expect("workspace observe should succeed");

    assert_eq!(observed["runtime"], "tide_mcp_runtime");
    assert_eq!(
        observed["browser_runtime_router"]["default_runtime"],
        "tide_browser_pane"
    );
    assert_eq!(
        observed["browser_runtime_router"]["external_runtime"],
        "explicit_fallback_only"
    );
    assert_eq!(observed["browser_runtime_router"]["provider_neutral"], true);

    let surfaces = observed["surfaces"].as_array().unwrap();
    assert!(surfaces.iter().any(|surface| surface["kind"] == "stage"));
    let terminal_context_surface = surfaces
        .iter()
        .find(|surface| surface["kind"] == "terminal_context_surface")
        .expect("active Terminal Context Surface should be reported");
    assert_eq!(
        terminal_context_surface["owner_terminal_id"].as_u64(),
        Some(terminal_id)
    );
    assert!(terminal_context_surface["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|capability| capability == "resize_width"));

    let browser = pane_entry(&observed, browser_id);
    assert_eq!(browser["kind"], "browser");
    assert_eq!(browser["surface"], "terminal_context_surface");
    assert_eq!(browser["owner_terminal_id"].as_u64(), Some(terminal_id));

    let terminal = pane_entry(&observed, terminal_id);
    assert_eq!(terminal["kind"], "terminal");
    assert_eq!(terminal["surface"], "stage");
}

#[test]
fn observing_workspace_reports_browser_visual_fit() {
    // UC-1 BR-3: Browser Pane entries report visual_fit from their visible Rect.
    let (mut app, _terminal_id, browser_id) = app_with_context_browser(400.0);

    let observed = app
        .handle_cli_command("observe-workspace", json!({}))
        .expect("workspace observe should succeed");
    let browser = pane_entry(&observed, browser_id);

    assert_eq!(browser["visual_fit"]["status"], "too_small");
    assert_eq!(browser["visual_fit"]["min_width"], 640.0);
    assert_eq!(browser["visual_fit"]["min_height"], 360.0);
    assert_eq!(
        browser["visual_fit"]["recommended_action"]["tool"],
        "tide_layout_action"
    );
    assert_eq!(
        browser["visual_fit"]["recommended_action"]["target"]["kind"],
        "terminal_context_surface"
    );
}

#[test]
fn observing_workspace_guides_layout_correction_before_browser_workarounds() {
    // UC-1 BR-5: poor Browser Pane visual fit returns Tool Selection Guidance for layout correction before browser workarounds.
    let (mut app, terminal_id, browser_id) = app_with_context_browser(398.0);

    let observed = app
        .handle_cli_command("observe-workspace", json!({}))
        .expect("workspace observe should succeed");
    let browser = pane_entry(&observed, browser_id);

    assert_eq!(
        browser["visual_fit"]["tool_selection"]["status"],
        "layout_correction_recommended"
    );
    assert_eq!(
        browser["visual_fit"]["tool_selection"]["next_tool"],
        "tide_layout_action"
    );
    assert_eq!(
        browser["visual_fit"]["tool_selection"]["action"]["target"]["owner_terminal_id"].as_u64(),
        Some(terminal_id)
    );
    let blocked_substitutes = browser["visual_fit"]["tool_selection"]["do_not_substitute"]
        .as_array()
        .expect("substitute guidance should be listed");
    assert!(blocked_substitutes
        .iter()
        .any(|value| value == "tide_browser_eval"));
    assert!(blocked_substitutes
        .iter()
        .any(|value| value == "app_internal_api_shortcuts"));
    assert!(blocked_substitutes
        .iter()
        .any(|value| value == "credential_bearing_url_shortcuts"));
    assert!(blocked_substitutes
        .iter()
        .any(|value| value == "url_parameter_shortcuts"));
    assert!(blocked_substitutes
        .iter()
        .any(|value| value == "url_shortening"));
}

// --- UC-2: ResizeLayoutTarget ---

#[test]
fn layout_action_resizes_terminal_context_surface_target() {
    // UC-2 BR-1 / BR-2 / BR-4 / BR-5: Terminal Context Surface width is resized through Layout Target action with surface animation.
    let (mut app, terminal_id, _browser_id) = app_with_context_browser(360.0);

    let result = app
        .handle_cli_command(
            "layout-action",
            json!({
                "action": "resize",
                "target": {
                    "kind": "terminal_context_surface",
                    "owner_terminal_id": terminal_id
                },
                "width_px": 720.0
            }),
        )
        .expect("Terminal Context Surface resize should succeed");

    assert_eq!(result["ok"], true);
    assert_eq!(result["action"], "resize");
    assert_eq!(result["target"]["kind"], "terminal_context_surface");
    assert_eq!(
        result["target"]["owner_terminal_id"].as_u64(),
        Some(terminal_id)
    );
    assert!((app.dock.dock_width - 720.0).abs() < 0.1);
    assert_eq!(result["animation"]["active"], true);
    assert_eq!(result["animation"]["from_width_px"], 360.0);
    assert_eq!(result["animation"]["to_width_px"], 720.0);
    assert!(app.dock.visibility_animation.is_some());
    assert!(app.surface_visibility_animation_active());
}

#[test]
fn layout_action_resizes_terminal_context_surface_pane_split() {
    // UC-2 BR-3: pane_split Layout Target works for Panes inside Terminal Context Surface.
    let (mut app, terminal_id, first_browser_id) = app_with_context_browser(720.0);
    let second_browser_id = app.layout.alloc_id();
    app.panes.insert(
        second_browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            second_browser_id,
            "http://localhost:5173".to_string(),
        )),
    );
    app.add_pane_to_dock(second_browser_id, Some(terminal_id));
    app.dock.dock_open = true;
    app.dock.visibility_animation = None;
    app.set_active_terminal_context_stacked(false);
    app.split_transition_animation = None;
    app.compute_layout();

    let result = app
        .handle_cli_command(
            "layout-action",
            json!({
                "action": "resize",
                "target": {
                    "kind": "pane_split",
                    "pane_id": second_browser_id
                },
                "ratio": 0.7
            }),
        )
        .expect("Terminal Context Surface pane split resize should succeed");

    assert_eq!(result["ok"], true);
    assert_eq!(result["target"]["surface"], "terminal_context_surface");
    assert_eq!(
        result["target"]["owner_terminal_id"].as_u64(),
        Some(terminal_id)
    );
    assert!(result["effective_rect"]["width"].as_f64().unwrap() > 0.0);

    let terminal = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(terminal)) => terminal,
        _ => panic!("owner terminal should exist"),
    };
    match terminal
        .dock_layout
        .snapshot()
        .expect("Terminal Context Surface should be split")
    {
        crate::tide_layout::LayoutSnapshot::Split { ratio, .. } => {
            assert!((ratio - 0.7).abs() < 0.01);
        }
        _ => panic!("Terminal Context Surface should have a split snapshot"),
    }
    assert!(terminal
        .dock_layout
        .all_pane_ids()
        .contains(&first_browser_id));
    assert!(terminal
        .dock_layout
        .all_pane_ids()
        .contains(&second_browser_id));
}

// --- UC-3: RouteBrowserRuntime ---

#[test]
fn mcp_instructions_route_browsers_provider_neutrally() {
    // UC-3 BR-1 / BR-2 / BR-3: MCP guidance requires Tide Browser Pane Runtime first and keeps fallback runtimes out of the normal browser path.
    let initialize = mcp::mcp_initialize_for_test();
    let instructions = initialize["result"]["instructions"]
        .as_str()
        .unwrap_or_default();

    assert!(instructions.contains("Tide MCP Runtime"));
    assert!(instructions.contains("Codex, Claude, Gemini"));
    assert!(instructions.contains("Browser Runtime Router"));
    assert!(instructions.contains("Tide Browser Pane Runtime"));
    assert!(instructions.contains("must use Tide Browser Pane Runtime as the first runtime"));
    assert!(instructions.contains("Tool Selection Guidance"));
    assert!(instructions.contains("Browser Operation"));
    assert!(instructions.contains("tide_browser_operation"));
    assert!(instructions.contains("visual_fit.tool_selection.next_tool=tide_layout_action"));
    assert!(instructions.contains("When layout correction is recommended, use tide_layout_action"));
    assert!(instructions.contains("human-like Browser Pane"));
    assert!(!instructions.contains("External Browser Runtime"));
    assert!(!instructions.contains("fallback reason"));
    assert!(!instructions.contains("Do not mention unavailable provider-specific browser runtimes"));
    assert!(!instructions.contains("Do not use shell/backend/API shortcuts"));
    assert!(!instructions.contains("Node REPL"));

    let tools = mcp::mcp_tool_definitions();
    assert!(tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_observe_workspace")
    }));
    assert!(tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_layout_action")
    }));
    assert!(tools.iter().any(|tool| {
        tool.get("name").and_then(|value| value.as_str()) == Some("tide_browser_operation")
    }));
}

// --- UC-5: OrientWrappedAgentToTideStructure ---

#[test]
fn mcp_instructions_describe_tide_structure_and_capabilities() {
    // UC-5 BR-1 / BR-2 / BR-3 / BR-4: MCP startup instructions orient Wrapped Agents to Tide structure and keep exact intent boundaries in tool descriptions.
    let initialize = mcp::mcp_initialize_for_test();
    let instructions = initialize["result"]["instructions"]
        .as_str()
        .unwrap_or_default();

    assert!(instructions.contains("terminal-centered task Workspace"));
    assert!(instructions.contains("Stage is the primary live Terminal area"));
    assert!(instructions.contains("Terminal Context Surface is the right-side support surface"));
    assert!(instructions.contains("FileTree View is a separate filesystem view, not a Pane"));
    assert!(instructions.contains("Workspace rail is task navigation"));
    assert!(instructions.contains("Pane kinds are Terminal, Editor, Diff, Browser, and Launcher"));
    assert!(instructions.contains("observe surfaces and Pane geometry"));
    assert!(instructions.contains("open Editor and Browser Panes"));
    assert!(instructions.contains("send keys to the Terminal"));
    assert!(instructions.contains("manage Context Artifacts"));
    assert!(
        instructions.contains("Tool descriptions define the exact intent, placement, and limits")
    );
}

#[test]
fn open_tool_descriptions_distinguish_content_from_surface_intent() {
    // UC-5 BR-5 / BR-6: open tools describe content-opening intent instead of treating every open request as Editor or Browser creation.
    let tools = mcp::mcp_tool_definitions();

    let editor = mcp_tool_description(&tools, "tide_open_editor");
    assert!(editor.contains("Open an existing file path"));
    assert!(editor.contains("Tide Editor Pane"));
    assert!(editor.contains("caller Terminal's Terminal Context Surface"));
    assert!(editor.contains("owner_terminal_id"));
    assert!(editor.contains("without moving visible focus"));

    let browser = mcp_tool_description(&tools, "tide_open_browser");
    assert!(browser.contains("Open a URL or empty browser"));
    assert!(browser.contains("Tide Browser Pane"));
    assert!(browser.contains("active Terminal Context Surface when possible"));
    assert!(browser.contains("links, pages, previews, and web inspection inside Tide"));
    assert!(browser.contains("external/default browser"));
}

#[test]
fn mcp_open_browser_in_terminal_context_surface_starts_split_transition_animation() {
    // UC-6 BR-1: MCP-opened Terminal Context Surface Panes start SplitTransitionAnimation when they create a visible split.
    let (mut app, terminal_id, _browser_id) = app_with_context_browser(360.0);
    app.set_active_terminal_context_stacked(false);
    app.split_transition_animation = None;
    app.compute_layout();

    let result = app
        .handle_cli_command("open-browser", json!({"url": "http://localhost:4175"}))
        .expect("MCP open-browser should create a Browser Pane");
    let new_id = result["pane_id"]
        .as_u64()
        .expect("open-browser should return pane_id");

    let animation = app
        .split_transition_animation
        .expect("MCP-opened Browser Pane should start a split transition");
    assert_eq!(
        animation.scope,
        SplitTransitionScope::TerminalContextSurface { terminal_id }
    );
    assert_eq!(animation.pane_id, new_id);
    assert!(app.layout_animation_active());
}

#[test]
fn mcp_close_pane_in_terminal_context_surface_starts_split_transition_animation() {
    // UC-6 BR-2: tide_close_pane uses the split close transition path for visible Terminal Context Surface splits.
    let (mut app, terminal_id, first_browser_id) = app_with_context_browser(360.0);
    let second_browser_id = app.layout.alloc_id();
    app.panes.insert(
        second_browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            second_browser_id,
            "http://localhost:4175".to_string(),
        )),
    );
    app.add_pane_to_dock(second_browser_id, Some(terminal_id));
    app.set_active_terminal_context_stacked(false);
    app.split_transition_animation = None;
    app.compute_layout();

    app.handle_cli_command("close-pane", json!({"pane_id": second_browser_id}))
        .expect("MCP close-pane should accept a context Browser Pane");

    assert!(app.panes.contains_key(&second_browser_id));
    assert!(app.panes.contains_key(&first_browser_id));
    let animation = app
        .split_transition_animation
        .expect("MCP close-pane should start a split transition");
    assert!(animation.is_closing());
    assert_eq!(
        animation.scope,
        SplitTransitionScope::TerminalContextSurface { terminal_id }
    );
    assert_eq!(animation.pane_id, second_browser_id);
}
