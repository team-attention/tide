// Spec: docs/specs/cli-workspace-routing.md

use serde_json::json;
use std::collections::HashMap;

use crate::pane::browser::BrowserPane;
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::{LayoutEngine, Rect};
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

fn layout_snapshot_contains(snapshot: &crate::tide_layout::LayoutSnapshot, pane_id: u64) -> bool {
    match snapshot {
        crate::tide_layout::LayoutSnapshot::Leaf { tabs, .. }
        | crate::tide_layout::LayoutSnapshot::LeafGroup { tabs, .. } => tabs.contains(&pane_id),
        crate::tide_layout::LayoutSnapshot::Split { left, right, .. } => {
            layout_snapshot_contains(left, pane_id) || layout_snapshot_contains(right, pane_id)
        }
    }
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

/// Build an App with two Workspaces, each containing one direct Stage Terminal.
/// WS0 (active) has Terminal Pane 100, WS1 (inactive) has Terminal Pane 200.
fn app_with_two_terminal_workspaces() -> App {
    let mut app = test_app();

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

    let (layout0, t0) = SplitLayout::with_initial_pane_id(100);
    app.ws.active = 0;
    app.layout = layout0;
    app.panes = HashMap::new();
    app.panes.insert(
        t0,
        PaneKind::Terminal(TerminalPane::with_cwd(t0, 80, 24, None, true).unwrap()),
    );
    app.focus.focused = Some(t0);
    app.focus.stage_focused = Some(t0);
    app.focus.focus_area = FocusArea::Stage;
    app.save_active_workspace();

    let (layout1, t1) = SplitLayout::with_initial_pane_id(200);
    app.ws.active = 1;
    app.layout = layout1;
    app.panes = HashMap::new();
    app.panes.insert(
        t1,
        PaneKind::Terminal(TerminalPane::with_cwd(t1, 80, 24, None, true).unwrap()),
    );
    app.focus.focused = Some(t1);
    app.focus.stage_focused = Some(t1);
    app.focus.focus_area = FocusArea::Stage;
    app.save_active_workspace();

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
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let test_path = tmp.path().join("test-strip.rs");
    std::fs::write(&test_path, "fn main() {}\n").expect("test file should be written");

    // open-editor requires "file" param. We pass _caller_pane alongside it.
    // The handler should see {file: ...} without _caller_pane.
    let result = app.handle_cli_command(
        "open-editor",
        json!({"_caller_pane": inactive_pane_id, "file": test_path.to_string_lossy().to_string()}),
    );

    // The command should succeed (file param is present after stripping _caller_pane)
    assert!(
        result.is_ok(),
        "open-editor should succeed when _caller_pane is stripped"
    );
}

#[test]
fn cross_workspace_swap_hides_inactive_browser_pane_native_view_before_restore() {
    // UC-2 BR-8: Before a temporarily loaded Workspace is cold-stored, Browser Pane
    // native views are hidden and Browser Pane first-responder state is cleared.
    let mut app = app_with_two_terminal_workspaces();
    let inactive_terminal_id = 200u64;
    let browser_id = 201u64;

    app.ws.workspaces[1].panes.insert(
        browser_id,
        PaneKind::Browser(BrowserPane::with_url(
            browser_id,
            "https://example.com".to_string(),
        )),
    );
    match app.ws.workspaces[1].panes.get_mut(&browser_id) {
        Some(PaneKind::Browser(browser)) => {
            browser.is_first_responder = true;
        }
        _ => panic!("inactive Workspace should contain Browser Pane {browser_id}"),
    }

    let _result = app
        .handle_cli_command("list-panes", json!({"_caller_pane": inactive_terminal_id}))
        .unwrap();

    assert_eq!(app.ws.active, 0, "active Workspace must be restored");
    match app.ws.workspaces[1].panes.get(&browser_id) {
        Some(PaneKind::Browser(browser)) => assert!(
            !browser.is_first_responder,
            "inactive Browser Pane must not retain native first responder state"
        ),
        _ => panic!("inactive Workspace should still contain Browser Pane {browser_id}"),
    }
}

#[test]
fn cross_workspace_browser_pane_command_restores_active_workspace_geometry() {
    // UC-2 BR-9: A Browser Pane command in an inactive Workspace must not leave
    // target-Workspace geometry driving the restored active Workspace.
    let mut app = app_with_two_terminal_workspaces();
    let inactive_terminal_id = 200u64;
    let original_geometry = vec![(100u64, Rect::new(12.0, 24.0, 320.0, 240.0))];
    app.pane_rects = original_geometry.clone();
    app.visual_pane_rects = original_geometry.clone();

    let _result = app
        .handle_cli_command(
            "open-browser",
            json!({
                "_caller_pane": inactive_terminal_id,
                "url": "https://example.com"
            }),
        )
        .unwrap();

    assert_eq!(app.ws.active, 0, "active Workspace must be restored");
    assert_eq!(
        app.pane_rects, original_geometry,
        "active Workspace pane geometry must be restored"
    );
    assert_eq!(
        app.visual_pane_rects, original_geometry,
        "active Workspace visual geometry must be restored before Browser Pane sync"
    );
    assert!(
        !app.panes
            .values()
            .any(|pane| matches!(pane, PaneKind::Browser(_))),
        "inactive Browser Pane must not leak into active Workspace panes"
    );
    assert!(
        app.ws.workspaces[1]
            .panes
            .values()
            .any(|pane| matches!(pane, PaneKind::Browser(_))),
        "Browser Pane should be stored in the caller Workspace"
    );
}

#[test]
fn cross_workspace_context_pane_command_does_not_leak_terminal_context_surface_animation() {
    // UC-2 BR-10: SurfaceVisibilityAnimation started by a temporarily loaded
    // Workspace must not leak into the restored active Workspace.
    let mut app = app_with_two_terminal_workspaces();
    let inactive_terminal_id = 200u64;

    app.dock.dock_open = false;
    app.dock.visibility_animation = None;
    assert!(
        !app.dock.visible_for_layout(),
        "precondition: active Workspace Terminal Context Surface is hidden"
    );

    let _result = app
        .handle_cli_command(
            "open-browser",
            json!({
                "_caller_pane": inactive_terminal_id,
                "url": "https://example.com"
            }),
        )
        .unwrap();

    assert_eq!(app.ws.active, 0, "active Workspace must be restored");
    assert!(
        app.dock.visibility_animation.is_none(),
        "inactive Workspace Terminal Context Surface animation must not leak"
    );
    assert!(
        !app.dock.visible_for_layout(),
        "restored active Workspace Terminal Context Surface must stay hidden"
    );
    assert!(
        app.ws.workspaces[1]
            .panes
            .values()
            .any(|pane| matches!(pane, PaneKind::Browser(_))),
        "Browser Pane should be stored in the caller Workspace"
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
    app.panes.insert(
        editor_id,
        PaneKind::Editor(EditorPane::new_empty(editor_id)),
    );

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
    app.panes.insert(
        editor_id,
        PaneKind::Editor(EditorPane::new_empty(editor_id)),
    );

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

// --- UC-7: Explicit Terminal Context Surface target while human focus differs ---

#[test]
fn open_terminal_uses_caller_terminal_as_split_source() {
    // UC-7 BR-11: open-terminal must prefer the CLI caller Terminal as the Stage split source.
    let (mut app, t1, t2) = app_with_two_real_terminals();

    app.focus.stage_focused = Some(t2);
    app.focus.focused = Some(t2);
    app.focus.focus_area = FocusArea::Stage;

    let result = app
        .handle_cli_command(
            "open-terminal",
            json!({
                "_caller_pane": t1,
                "position": "split-right"
            }),
        )
        .unwrap();
    let new_terminal = result["pane_id"]
        .as_u64()
        .expect("open-terminal should return pane_id");

    let snapshot = app.layout.snapshot().expect("layout should have a root");
    match snapshot {
        crate::tide_layout::LayoutSnapshot::Split { left, right, .. } => {
            assert!(
                layout_snapshot_contains(&left, t1),
                "caller Terminal must remain in the split branch"
            );
            assert!(
                layout_snapshot_contains(&left, new_terminal),
                "new Terminal must be split from caller Terminal"
            );
            assert!(
                layout_snapshot_contains(&right, t2),
                "human-focused Terminal must not be used as the split source"
            );
        }
        _ => panic!("layout should remain a split after open-terminal"),
    }
}

#[test]
fn open_terminal_from_background_caller_preserves_human_focus() {
    // UC-7 BR-12: a background caller can create a Terminal without stealing human focus.
    let (mut app, t1, t2) = app_with_two_real_terminals();

    app.focus.stage_focused = Some(t2);
    app.focus.focused = Some(t2);
    app.focus.focus_area = FocusArea::Stage;
    app.dock.dock_open = false;

    let _result = app
        .handle_cli_command(
            "open-terminal",
            json!({
                "_caller_pane": t1,
                "position": "split-right"
            }),
        )
        .unwrap();

    assert_eq!(
        app.focus.focused,
        Some(t2),
        "human focus must stay on Terminal B"
    );
    assert_eq!(
        app.focus.stage_focused,
        Some(t2),
        "active Stage Terminal must stay Terminal B"
    );
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert!(
        !app.dock.dock_open,
        "background Terminal creation must not reveal the visible Terminal Context Surface"
    );
}

#[test]
fn open_editor_explicit_owner_terminal_opens_in_background_context_surface() {
    // UC-7 BR-13/BR-15: explicit owner opens an Editor Pane in that Terminal's
    // Terminal Context Surface without moving visible focus when the owner is backgrounded.
    let (mut app, t1, t2) = app_with_two_real_terminals();
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let test_path = tmp.path().join("background.md");
    std::fs::write(&test_path, "# background\n").expect("test file should be written");

    app.focus.stage_focused = Some(t2);
    app.focus.focused = Some(t2);
    app.focus.focus_area = FocusArea::Stage;
    app.dock.dock_open = false;

    let result = app
        .handle_cli_command(
            "open-editor",
            json!({
                "_caller_pane": t1,
                "file": test_path.to_string_lossy().to_string(),
                "target": {
                    "kind": "terminal_context_surface",
                    "owner_terminal_id": t1
                }
            }),
        )
        .unwrap();
    let editor_id = result["pane_id"]
        .as_u64()
        .expect("open-editor should return pane_id");

    assert_eq!(
        app.terminal_owning(editor_id),
        Some(t1),
        "Editor Pane must be owned by explicit Terminal"
    );
    assert_eq!(app.associated_terminal(editor_id), Some(t1));
    match app.panes.get(&t1) {
        Some(PaneKind::Terminal(terminal)) => {
            assert!(
                terminal.dock_layout.all_pane_ids().contains(&editor_id),
                "Editor Pane must be in explicit Terminal's Terminal Context Surface"
            );
            assert_eq!(terminal.dock_focused, Some(editor_id));
        }
        _ => panic!("explicit owner should be a Terminal Pane"),
    }
    assert_eq!(
        app.focus.focused,
        Some(t2),
        "human focus must stay on Terminal B"
    );
    assert_eq!(app.focus.stage_focused, Some(t2));
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert!(
        !app.dock.dock_open,
        "background Editor Pane open must not reveal the visible Terminal Context Surface"
    );
}

#[test]
fn open_editor_explicit_owner_does_not_replace_visible_terminal_launcher() {
    // UC-7 BR-15: background open must not replace a Launcher Pane from the
    // currently visible Terminal Context Surface when the explicit owner differs.
    let (mut app, t1, t2) = app_with_two_real_terminals();
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let test_path = tmp.path().join("background-with-launcher.md");
    std::fs::write(&test_path, "# background\n").expect("test file should be written");

    let visible_launcher = app.layout.alloc_id();
    app.panes
        .insert(visible_launcher, PaneKind::Launcher(visible_launcher));
    app.add_pane_to_dock(visible_launcher, Some(t2));

    app.focus.stage_focused = Some(t2);
    app.focus.focused = Some(t2);
    app.focus.focus_area = FocusArea::Stage;

    let result = app
        .handle_cli_command(
            "open-editor",
            json!({
                "_caller_pane": t1,
                "file": test_path.to_string_lossy().to_string(),
                "target": {
                    "kind": "terminal_context_surface",
                    "owner_terminal_id": t1
                }
            }),
        )
        .unwrap();
    let editor_id = result["pane_id"]
        .as_u64()
        .expect("open-editor should return pane_id");

    assert!(
        app.panes.contains_key(&visible_launcher),
        "visible Terminal's Launcher Pane must not be removed"
    );
    match app.panes.get(&t2) {
        Some(PaneKind::Terminal(terminal)) => assert!(
            terminal
                .dock_layout
                .all_pane_ids()
                .contains(&visible_launcher),
            "visible Terminal Context Surface must keep its Launcher Pane"
        ),
        _ => panic!("visible owner should be a Terminal Pane"),
    }
    assert_eq!(app.terminal_owning(editor_id), Some(t1));
}

#[test]
fn open_editor_explicit_owner_rejects_non_terminal_pane() {
    // UC-7 BR-14: explicit owner_terminal_id must reference a live Terminal Pane.
    let (mut app, _t1, t2) = app_with_two_real_terminals();
    let editor_owner = app.layout.alloc_id();
    app.panes.insert(
        editor_owner,
        PaneKind::Editor(EditorPane::new_empty(editor_owner)),
    );
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let test_path = tmp.path().join("bad-owner.md");
    std::fs::write(&test_path, "# bad owner\n").expect("test file should be written");

    let result = app.handle_cli_command(
        "open-editor",
        json!({
            "_caller_pane": t2,
            "file": test_path.to_string_lossy().to_string(),
            "target": {
                "kind": "terminal_context_surface",
                "owner_terminal_id": editor_owner
            }
        }),
    );

    assert!(
        result.is_err(),
        "non-Terminal explicit owner must fail instead of falling back"
    );
}

#[test]
fn open_editor_explicit_owner_in_inactive_workspace_restores_active_workspace() {
    // UC-7 BR-16: cross-Workspace explicit owner mutations are stored in the caller
    // Workspace and the human-visible active Workspace is restored.
    let mut app = app_with_two_terminal_workspaces();
    let active_terminal = 100u64;
    let inactive_terminal = 200u64;
    let tmp = tempfile::TempDir::new().expect("temp dir should be created");
    let test_path = tmp.path().join("inactive.md");
    std::fs::write(&test_path, "# inactive\n").expect("test file should be written");

    app.focus.focused = Some(active_terminal);
    app.focus.stage_focused = Some(active_terminal);
    app.focus.focus_area = FocusArea::Stage;

    let result = app
        .handle_cli_command(
            "open-editor",
            json!({
                "_caller_pane": inactive_terminal,
                "file": test_path.to_string_lossy().to_string(),
                "target": {
                    "kind": "terminal_context_surface",
                    "owner_terminal_id": inactive_terminal
                }
            }),
        )
        .unwrap();
    let editor_id = result["pane_id"]
        .as_u64()
        .expect("open-editor should return pane_id");

    assert_eq!(app.ws.active, 0, "active Workspace must be restored");
    assert_eq!(app.focus.focused, Some(active_terminal));
    assert_eq!(app.focus.stage_focused, Some(active_terminal));
    assert!(
        !app.panes.contains_key(&editor_id),
        "inactive Workspace Editor Pane must not leak into active panes"
    );
    assert!(
        app.ws.workspaces[1].panes.contains_key(&editor_id),
        "Editor Pane must be stored in the caller Workspace"
    );
    match app.ws.workspaces[1].panes.get(&inactive_terminal) {
        Some(PaneKind::Terminal(terminal)) => {
            assert!(
                terminal.dock_layout.all_pane_ids().contains(&editor_id),
                "Editor Pane must be in inactive Terminal's Terminal Context Surface"
            );
            assert_eq!(terminal.dock_focused, Some(editor_id));
        }
        _ => panic!("inactive owner should be a Terminal Pane"),
    }
    assert_eq!(app.associated_terminal(editor_id), Some(inactive_terminal));
}
