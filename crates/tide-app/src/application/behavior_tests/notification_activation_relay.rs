// Spec: docs/specs/notification-activation-relay.md

use std::collections::HashMap;

use serde_json::json;

use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_platform::WindowCommand;
use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
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

fn app_with_inactive_workspace_target_terminal() -> (App, u64, u64) {
    let (mut app, active_pane_id) = app_with_terminal();

    let target_pane_id = active_pane_id + 100;
    let (inactive_layout, target_pane_id) =
        crate::tide_layout::SplitLayout::with_initial_pane_id(target_pane_id);
    let inactive_terminal = TerminalPane::with_cwd(target_pane_id, 80, 24, None, true).unwrap();
    let mut inactive_panes = HashMap::new();
    inactive_panes.insert(target_pane_id, PaneKind::Terminal(inactive_terminal));

    app.ws.workspaces.push(Workspace {
        name: "Workspace 1".into(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: HashMap::new(),
    });
    app.ws.workspaces.push(Workspace {
        name: "Workspace 2".into(),
        layout: inactive_layout,
        focused: Some(target_pane_id),
        panes: inactive_panes,
    });
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws.workspace_extras.push(WorkspaceExtras::new());
    app.ws
        .workspace_context_artifacts
        .push(crate::ContextArtifactStore::new());
    app.ws
        .workspace_context_artifacts
        .push(crate::ContextArtifactStore::new());
    app.ws.active = 0;
    app.focus.focused = Some(active_pane_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(active_pane_id);

    (app, active_pane_id, target_pane_id)
}

// --- UC-3: ActivateNotificationTargetInOwningTideInstance ---

#[test]
fn activate_notification_target_cli_command_switches_to_the_target_workspace_and_focuses_the_target_terminal(
) {
    // UC-3 BR-4: The internal activation command must switch to the owning Workspace and focus the target Pane.
    let (mut app, _active_pane_id, target_pane_id) = app_with_inactive_workspace_target_terminal();

    let result = app
        .handle_cli_command(
            "activate-notification-target",
            json!({ "pane_id": target_pane_id }),
        )
        .unwrap();

    assert_eq!(result, json!({ "ok": true }));
    assert_eq!(app.ws.active, 1);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.focused, Some(target_pane_id));
    assert_eq!(app.focus.stage_focused, Some(target_pane_id));
}

#[test]
fn activate_notification_target_cli_command_queues_window_reveal_for_the_owning_tide_instance() {
    // UC-3 BR-5: The internal activation command must queue Tide Window presentation for the owning Tide Instance.
    let (mut app, _active_pane_id, target_pane_id) = app_with_inactive_workspace_target_terminal();

    let _ = app.handle_cli_command(
        "activate-notification-target",
        json!({ "pane_id": target_pane_id }),
    );

    assert!(matches!(
        app.pending_platform_commands.last(),
        Some(WindowCommand::ShowWindow)
    ));
}

#[test]
fn system_notification_activation_platform_event_brings_the_window_forward() {
    // UC-3 BR-6: The local SystemNotificationActivated platform path must bring the Tide Window forward after focusing the target Pane.
    let source = include_str!("../../adapter/inward/event_loop_adapter/mod.rs");
    let branch = source
        .split("PlatformEvent::SystemNotificationActivated { pane_id } => {")
        .nth(1)
        .expect("expected SystemNotificationActivated branch");

    assert!(
        branch.contains("window.show_window();"),
        "expected SystemNotificationActivated handling to bring the Tide Window forward"
    );
}

#[test]
fn activate_notification_target_cli_command_with_missing_pane_is_a_no_op() {
    // UC-3 BR-7: Missing activation targets are a no-op and must not queue Tide Window presentation.
    let (mut app, active_pane_id) = app_with_terminal();

    let result = app
        .handle_cli_command("activate-notification-target", json!({ "pane_id": 404_u64 }))
        .unwrap();

    assert_eq!(result, json!({ "ok": true }));
    assert_eq!(app.ws.active, 0);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.focused, Some(active_pane_id));
    assert!(app.pending_platform_commands.is_empty());
}

// --- UC-4: SuppressWrongInstanceWindowReveal ---

#[test]
fn macos_window_construction_defers_window_order_front_until_show_window() {
    // UC-4 BR-8: MacosWindow::new must not order the Tide Window front during construction.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");
    let new_start = source.find("pub fn new(").expect("expected MacosWindow::new");
    let show_start = source
        .find("fn show_window(&self)")
        .expect("expected MacosWindow::show_window");
    let new_body = &source[new_start..show_start];

    assert!(
        !new_body.contains("makeKeyAndOrderFront(None)"),
        "expected MacosWindow::new to keep the Tide Window hidden until show_window()"
    );
}

#[test]
fn macos_show_window_orders_front_and_activates_the_app() {
    // UC-4 BR-9: show_window() must own Tide Window order-front plus app activation.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");
    let show_start = source
        .find("fn show_window(&self)")
        .expect("expected MacosWindow::show_window");
    let show_body = &source[show_start..];

    assert!(
        show_body.contains("makeKeyAndOrderFront(None)"),
        "expected show_window() to order the Tide Window front"
    );
    assert!(
        show_body.contains("activateIgnoringOtherApps: true"),
        "expected show_window() to activate the Tide app"
    );
}

#[test]
fn macos_app_launch_path_does_not_activate_the_app_before_window_reveal() {
    // UC-4 BR-10: MacosApp::run must not activate the app before the explicit reveal path.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");

    assert!(
        !source.contains("activateIgnoringOtherApps(true)"),
        "expected MacosApp::run to defer app activation until show_window()"
    );
}
