// Spec: docs/specs/cli-workspace-routing.md

use serde_json::json;
use std::collections::HashMap;

use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::LayoutEngine;
use crate::tide_layout::SplitLayout;
use crate::update::workspace_infra_service::Workspace;
use crate::App;
use crate::DockPort;
use crate::PaneLifecyclePort;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

/// Build an App with two workspaces, each containing one editor pane.
/// WS0 (active) has pane 100, WS1 (inactive) has pane 200.
fn app_with_two_workspaces() -> App {
    let mut app = test_app();

    let id1: u64 = 100;
    let id2: u64 = 200;

    // Push two workspace slots
    app.ws.workspaces.push(Workspace {
        name: "WS0".into(),
        layout: SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "WS1".into(),
        layout: SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });

    // Set up WS0 as active with pane 100
    app.ws.active = 0;
    app.panes = HashMap::new();
    app.panes
        .insert(id1, PaneKind::Editor(EditorPane::new_empty(id1)));
    app.focus.focused = Some(id1);
    app.focus.focus_area = FocusArea::Stage;

    // Save WS0, switch to WS1, set up pane 200
    app.save_active_workspace();
    app.ws.active = 1;
    app.panes = HashMap::new();
    app.panes
        .insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
    app.focus.focused = Some(id2);
    app.save_active_workspace();

    // Load WS0 back as active
    app.ws.active = 0;
    app.load_active_workspace();
    app
}

// --- UC-1: CLI command from agent in active Workspace (no swap needed) ---

#[test]
fn cli_command_in_active_workspace_strips_caller_pane() {
    // UC-1 BR-5: _caller_pane is stripped from params before reaching command handlers
    let mut app = app_with_two_workspaces();
    let active_pane_id = 100u64;

    // Send a list-panes command with _caller_pane pointing to the active workspace's pane.
    // The _caller_pane param must not leak into the handler — list-panes should succeed
    // and the command should execute in the active workspace (no swap).
    let result = app
        .handle_cli_command("list-panes", json!({"_caller_pane": active_pane_id}))
        .unwrap();

    // Command executed in active workspace (WS0 has pane 100)
    let panes = result.as_array().unwrap();
    assert_eq!(panes.len(), 1);
    assert_eq!(panes[0]["id"], active_pane_id);

    // Active workspace should still be WS0
    assert_eq!(app.ws.active, 0);
}

// --- UC-2: CLI command from agent in inactive Workspace (swap, execute, swap back) ---

#[test]
fn cli_command_in_inactive_workspace_executes_in_correct_context() {
    // UC-2 BR-1: If _caller_pane belongs to a non-active Workspace, commands execute
    // in that Workspace's context
    let mut app = app_with_two_workspaces();
    let inactive_pane_id = 200u64;

    // Active is WS0 (pane 100). Send command with _caller_pane=200 (in WS1).
    // list-panes should return WS1's panes, not WS0's.
    let result = app
        .handle_cli_command("list-panes", json!({"_caller_pane": inactive_pane_id}))
        .unwrap();

    let panes = result.as_array().unwrap();
    assert_eq!(panes.len(), 1, "should see WS1's panes");
    assert_eq!(
        panes[0]["id"], inactive_pane_id,
        "should see pane 200 from WS1"
    );
}

#[test]
fn cli_command_in_inactive_workspace_restores_active_workspace() {
    // UC-2 BR-2: Active Workspace must be restored after cross-workspace command execution
    let mut app = app_with_two_workspaces();
    let inactive_pane_id = 200u64;

    assert_eq!(app.ws.active, 0, "precondition: WS0 is active");
    assert_eq!(
        app.focus.focused,
        Some(100),
        "precondition: pane 100 focused"
    );

    // Execute command targeting inactive workspace
    let _result = app
        .handle_cli_command("list-panes", json!({"_caller_pane": inactive_pane_id}))
        .unwrap();

    // After the command, the user's active workspace must be restored
    assert_eq!(app.ws.active, 0, "active workspace must be restored to WS0");
    assert_eq!(
        app.focus.focused,
        Some(100),
        "focus must be restored to pane 100"
    );
    assert!(
        app.panes.contains_key(&100),
        "WS0's panes must be loaded back"
    );
    assert!(
        !app.panes.contains_key(&200),
        "WS1's panes must not leak into active state"
    );
}

#[test]
fn cli_command_in_inactive_workspace_restores_on_error() {
    // UC-2 BR-2: Active Workspace restored even when the command handler returns an error
    let mut app = app_with_two_workspaces();
    let inactive_pane_id = 200u64;

    assert_eq!(app.ws.active, 0);

    // Send a command that will fail (capture-pane with nonexistent pane_id in WS1)
    let result = app.handle_cli_command(
        "capture-pane",
        json!({"_caller_pane": inactive_pane_id, "pane_id": 9999}),
    );
    assert!(result.is_err(), "command should fail");

    // Even on error, active workspace must be restored
    assert_eq!(
        app.ws.active, 0,
        "active workspace must be restored after error"
    );
    assert!(app.panes.contains_key(&100), "WS0 panes must be restored");
}

#[test]
fn cross_workspace_swap_uses_raw_save_load_not_switch() {
    // UC-2 BR-4: Raw save_active_workspace / load_active_workspace is used (NOT switch_workspace)
    // to avoid side effects like chrome invalidation, IME commit, browser hide/show.
    // We verify this by checking that chrome_generation is NOT bumped by the workspace
    // context swap itself (switch_workspace bumps it, raw save/load does not).
    let mut app = app_with_two_workspaces();
    let inactive_pane_id = 200u64;

    let gen_before = app.cache.chrome_generation;

    // list-panes is a read-only command — it should not bump chrome_generation.
    // If switch_workspace were used, it would bump chrome_generation.
    let _result = app
        .handle_cli_command("list-panes", json!({"_caller_pane": inactive_pane_id}))
        .unwrap();

    assert_eq!(
        app.cache.chrome_generation, gen_before,
        "chrome_generation must not change — raw save/load should not trigger UI side effects"
    );
}

#[test]
fn caller_pane_stripped_before_handler_receives_params() {
    // UC-2 BR-5: _caller_pane is stripped from params before reaching command handlers.
    // We test this with open-editor which reads params. If _caller_pane leaks, it might
    // cause unexpected behavior. The command should process normally without seeing _caller_pane.
    let mut app = app_with_two_workspaces();
    let inactive_pane_id = 200u64;

    // open-editor requires "file" param. We pass _caller_pane alongside it.
    // The handler should see {file: ...} without _caller_pane.
    let result = app.handle_cli_command(
        "open-editor",
        json!({"_caller_pane": inactive_pane_id, "file": "/tmp/test-strip.rs"}),
    );

    // The command should succeed (file param is present after stripping _caller_pane)
    assert!(
        result.is_ok(),
        "open-editor should succeed when _caller_pane is stripped"
    );
}

// --- UC-3: CLI command without _caller_pane (fallback to active Workspace) ---

#[test]
fn cli_command_without_caller_pane_uses_active_workspace() {
    // UC-3 BR-3: Commands without _caller_pane execute in the active Workspace (backward compatible)
    let mut app = app_with_two_workspaces();

    // No _caller_pane in params — should execute in active workspace (WS0)
    let result = app.handle_cli_command("list-panes", json!({})).unwrap();

    let panes = result.as_array().unwrap();
    assert_eq!(panes.len(), 1);
    assert_eq!(panes[0]["id"], 100, "should list active workspace's pane");
    assert_eq!(app.ws.active, 0, "active workspace unchanged");
}

// --- UC-4: CLI command with _caller_pane that doesn't exist in any Workspace ---

#[test]
fn cli_command_with_nonexistent_caller_pane_falls_back_to_active() {
    // UC-4 BR-3: Commands with _caller_pane referencing a pane that no longer exists
    // fall back to active Workspace
    let mut app = app_with_two_workspaces();

    // _caller_pane=9999 doesn't exist in any workspace
    let result = app
        .handle_cli_command("list-panes", json!({"_caller_pane": 9999}))
        .unwrap();

    let panes = result.as_array().unwrap();
    assert_eq!(panes.len(), 1);
    assert_eq!(
        panes[0]["id"], 100,
        "should fall back to active workspace's pane"
    );
    assert_eq!(app.ws.active, 0, "active workspace unchanged");
}

// --- UC-5: Notify command for pane in inactive Workspace ---

#[test]
fn notify_for_inactive_workspace_pane_updates_agent_status() {
    // UC-5 BR-1: Command executes in the pane's Workspace context,
    // so cli_notify's has_pane check succeeds and agent status is updated
    let mut app = app_with_two_workspaces();
    let inactive_pane_id = 200u64;

    // Pre-register an agent for pane 200 so cli_notify can update its status
    app.gateway.detected_agents.insert(
        inactive_pane_id,
        crate::state::gateway_status::AgentInfo {
            name: "Claude Code",
            pid: 1234,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    // Save the agent info into WS1's stored state so it persists across swaps
    // (detected_agents is on App, not per-workspace, so it should survive)

    // Send notify with _caller_pane targeting inactive workspace
    let result = app
        .handle_cli_command(
            "notify",
            json!({
                "_caller_pane": inactive_pane_id,
                "event": "agent-running",
                "pane": inactive_pane_id,
                "agent": "claude"
            }),
        )
        .unwrap();

    assert_eq!(result["ok"], true);

    // Agent status should be updated
    let agent = app
        .gateway
        .detected_agents
        .get(&inactive_pane_id)
        .expect("agent should still be registered");
    assert_eq!(
        agent.status,
        Some(crate::state::gateway_status::AgentStatus::Running),
        "agent status should be updated to Running"
    );
}

#[test]
fn notify_for_inactive_workspace_pane_restores_active_workspace() {
    // UC-5 BR-2: Active Workspace is restored after notify execution
    let mut app = app_with_two_workspaces();
    let inactive_pane_id = 200u64;

    assert_eq!(app.ws.active, 0);
    assert_eq!(app.focus.focused, Some(100));

    let _result = app
        .handle_cli_command(
            "notify",
            json!({
                "_caller_pane": inactive_pane_id,
                "event": "agent-running",
                "pane": inactive_pane_id,
                "agent": "claude"
            }),
        )
        .unwrap();

    // Active workspace must be restored
    assert_eq!(app.ws.active, 0, "active workspace must be WS0");
    assert_eq!(app.focus.focused, Some(100), "focus must be restored");
    assert!(app.panes.contains_key(&100), "WS0 panes must be loaded");
    assert!(!app.panes.contains_key(&200), "WS1 panes must not leak");
}

// --- UC-6: Dock routing uses caller terminal, not stage_focused ---

/// Build an App with two real terminals (t1 and t2) in a single workspace.
/// t1 is `stage_focused`, t2 is the "other" terminal.
fn app_with_two_real_terminals() -> (App, u64, u64) {
    let mut app = test_app();
    let (layout, t1) = SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal1 = TerminalPane::with_cwd(t1, 80, 24, None, true).unwrap();
    app.panes.insert(t1, PaneKind::Terminal(terminal1));

    let t2 = app
        .layout
        .split(t1, crate::tide_core::SplitDirection::Vertical);
    let terminal2 = TerminalPane::with_cwd(t2, 80, 24, None, true).unwrap();
    app.panes.insert(t2, PaneKind::Terminal(terminal2));

    app.focus.stage_focused = Some(t1);
    app.focus.focused = Some(t1);
    app.focus.focus_area = FocusArea::Stage;
    (app, t1, t2)
}

#[test]
fn add_pane_to_dock_uses_target_terminal_not_stage_focused() {
    // UC-6 BR-6: add_pane_to_dock uses the explicit target_terminal when provided,
    // falling back to focused_terminal_id() only when target_terminal is None.
    let (mut app, _t1, t2) = app_with_two_real_terminals();

    // stage_focused = t1, but we want to add a pane to t2's dock
    let editor_id = app.layout.alloc_id();
    app.panes
        .insert(editor_id, PaneKind::Editor(EditorPane::new_empty(editor_id)));

    app.add_pane_to_dock(editor_id, Some(t2));

    // Pane should be in t2's dock_layout, not t1's
    assert_eq!(
        app.terminal_owning(editor_id),
        Some(t2),
        "pane must be in target terminal t2's dock, not stage_focused t1"
    );
    assert_eq!(
        app.associated_terminal(editor_id),
        Some(t2),
        "associated_terminal must be t2"
    );
}

#[test]
fn add_pane_to_dock_falls_back_to_focused_when_target_is_none() {
    // UC-6 BR-6: When target_terminal is None, falls back to focused_terminal_id()
    let (mut app, t1, _t2) = app_with_two_real_terminals();

    let editor_id = app.layout.alloc_id();
    app.panes
        .insert(editor_id, PaneKind::Editor(EditorPane::new_empty(editor_id)));

    app.add_pane_to_dock(editor_id, None);

    // stage_focused = t1, so pane should go to t1's dock
    assert_eq!(
        app.terminal_owning(editor_id),
        Some(t1),
        "pane must be in stage_focused t1's dock when target is None"
    );
}

#[test]
fn open_browser_pane_routes_to_caller_terminal_dock() {
    // UC-6 BR-7: open_browser_pane passes resolve_context_terminal_id() as target terminal.
    // When pending_cli_caller_pane is set, the pane should go to the caller's dock.
    let (mut app, t1, t2) = app_with_two_real_terminals();

    // Simulate: agent in t2 calls open-browser, but stage_focused = t1
    app.focus.stage_focused = Some(t1);
    app.focus.focused = Some(t1);
    app.pending_cli_caller_pane = Some(t2);

    app.open_browser_pane(None);

    // Find the newly created browser pane
    let browser_id = app
        .panes
        .iter()
        .find(|(_, pk)| matches!(pk, PaneKind::Browser(_)))
        .map(|(&id, _)| id)
        .expect("browser pane should exist");

    assert_eq!(
        app.terminal_owning(browser_id),
        Some(t2),
        "browser pane must be in caller terminal t2's dock, not stage_focused t1"
    );
    assert_eq!(
        app.associated_terminal(browser_id),
        Some(t2),
        "associated_terminal must be t2 (the caller)"
    );
}
