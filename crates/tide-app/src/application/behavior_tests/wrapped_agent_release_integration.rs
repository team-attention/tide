// Spec: docs/specs/wrapped-agent-release-integration.md

use std::collections::HashMap;

use serde_json::json;

use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::Color;
use crate::tide_core::DropZone;
use crate::tide_core::LayoutEngine;
use crate::tide_layout::SplitLayout;
use crate::tide_platform::WindowCommand;
use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_wrapped_agent_status(
    status: crate::state::gateway_status::AgentStatus,
) -> (App, u64, u64) {
    let mut app = test_app();
    let (layout, agent_pane_id) = SplitLayout::with_initial_pane();
    app.layout = layout;
    let agent_terminal = TerminalPane::with_cwd(agent_pane_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(agent_pane_id, PaneKind::Terminal(agent_terminal));

    let other_pane_id = app
        .layout
        .split(agent_pane_id, crate::tide_core::SplitDirection::Vertical);
    let other_terminal = TerminalPane::with_cwd(other_pane_id, 80, 24, None, true).unwrap();
    app.panes
        .insert(other_pane_id, PaneKind::Terminal(other_terminal));

    app.focus.focused = Some(other_pane_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(other_pane_id);
    app.gateway.detected_agents.insert(
        agent_pane_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(status),
        },
    );

    (app, agent_pane_id, other_pane_id)
}

fn app_with_inactive_workspace_target_terminal() -> (App, u64, u64) {
    let (mut app, active_pane_id, _) =
        app_with_wrapped_agent_status(crate::state::gateway_status::AgentStatus::Running);

    let target_pane_id = active_pane_id + 100;
    let mut inactive_layout = SplitLayout::new();
    inactive_layout.insert_at_root(target_pane_id, DropZone::Right);
    let inactive_terminal = TerminalPane::with_cwd(target_pane_id, 80, 24, None, true).unwrap();
    let mut inactive_panes = HashMap::new();
    inactive_panes.insert(target_pane_id, PaneKind::Terminal(inactive_terminal));

    app.ws.workspaces.push(Workspace {
        name: "Workspace 1".into(),
        layout: SplitLayout::new(),
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

// --- UC-1: BuildLaunchableTideBundle ---

#[test]
fn source_tide_info_plist_omits_lsrequirescarbon() {
    // UC-1 BR-1: The source Tide Info.plist must omit LSRequiresCarbon.
    let plist = include_str!("../../../Info.plist");

    assert!(
        !plist.contains("<key>LSRequiresCarbon</key>"),
        "expected Tide Info.plist to omit LSRequiresCarbon"
    );
}

#[test]
fn local_bundle_build_script_strips_lsrequirescarbon_before_signing() {
    // UC-1 BR-2: The local Tide.app build script must strip LSRequiresCarbon before signing.
    let script = include_str!("../../../../../scripts/build-app.sh");

    assert!(
        script.contains("Delete :LSRequiresCarbon"),
        "expected build-app.sh to remove LSRequiresCarbon before codesign"
    );
}

#[test]
fn macos_launch_path_defers_activation_until_window_reveal() {
    // UC-1 BR-3: MacosApp::run must defer activation until show_window().
    let source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");

    assert!(
        !source.contains("activateIgnoringOtherApps(true)"),
        "expected MacosApp::run to defer app activation until show_window()"
    );
}

// --- UC-2: ReportCodexLifecycleFromHooks ---

#[test]
fn codex_wrapper_uses_a_temporary_codex_home_overlay() {
    // UC-2 BR-4: The wrapper must use a temporary CODEX_HOME overlay instead of mutating the user's real CODEX_HOME.
    let wrapper = include_str!("../../../resources/bin/codex");

    assert!(wrapper.contains("TIDE_CODEX_HOME"));
    assert!(wrapper.contains("REAL_CODEX_HOME"));
}

#[test]
fn codex_wrapper_installs_user_prompt_submit_hook_and_turn_complete_notify() {
    // UC-2 BR-5: The wrapper must install UserPromptSubmit and the official completed-turn notify wiring.
    let wrapper = include_str!("../../../resources/bin/codex");

    assert!(wrapper.contains("\"UserPromptSubmit\""));
    assert!(wrapper.contains("features.codex_hooks=true"));
    assert!(
        wrapper.contains("notify=[\\\"$TIDE_BIN\\\",\\\"notify\\\",\\\"codex-turn-complete\\\"")
    );
    assert!(!wrapper.contains("\"Stop\""));
}

#[test]
fn notify_client_accepts_payload_from_stdin() {
    // UC-2 BR-6: The notify client must accept payload JSON from stdin.
    let source = include_str!("../../adapter/inward/cli_adapter/notify.rs");

    assert!(source.contains("--payload-stdin"));
    assert!(source.contains("read_payload_from_stdin"));
}

#[test]
fn notify_client_requires_an_explicit_tide_socket_for_wrapper_hooks() {
    // UC-2 BR-7: Wrapper-hook notify must require the owning TIDE_SOCKET and must not fall back to tide-latest.sock.
    let source = include_str!("../../adapter/inward/cli_adapter/notify.rs");

    assert!(source.contains("std::env::var(\"TIDE_SOCKET\")"));
    assert!(
        !source.contains("tide-latest.sock"),
        "wrapper-hook notify must not fall back to the latest Tide socket"
    );
}

#[test]
fn notify_client_forwards_the_owning_tide_instance_pid() {
    // UC-2 BR-8: Wrapper-hook notify forwards the owning Tide Instance PID so a mismatched gateway can ignore the event.
    let source = include_str!("../../adapter/inward/cli_adapter/notify.rs");

    assert!(source.contains("std::env::var(\"TIDE_INSTANCE_PID\")"));
    assert!(source.contains("\"tide_instance_pid\""));
}

#[test]
fn terminal_pty_env_exports_the_owning_tide_instance_pid() {
    // UC-2 BR-8: PTY env exports the owning Tide Instance PID so wrapper hooks can forward it.
    let source = include_str!("../../domain/terminal/mod.rs");

    assert!(source.contains("String::from(\"TIDE_INSTANCE_PID\")"));
    assert!(source.contains("std::process::id().to_string()"));
}

// --- UC-3: PreserveWrappedAgentAttentionUntilAcknowledged ---

#[test]
fn idle_status_is_attention_orange_until_acknowledged_then_connected_blue() {
    // UC-3 BR-7,8: Idle uses attention chrome until acknowledgement, then connected-idle chrome.
    use crate::adapter::outward::view::header::agent_status_dot_color;
    use crate::state::gateway_status::AgentStatus;

    let unresolved = agent_status_dot_color(AgentStatus::Idle, true, Some(0.0));
    let acknowledged = agent_status_dot_color(AgentStatus::Idle, false, Some(0.0));

    assert_eq!(unresolved, Color::new(0.95, 0.65, 0.2, 1.0));
    assert_eq!(acknowledged, Color::new(0.3, 0.55, 0.95, 1.0));
}

#[test]
fn needs_input_status_stays_attention_orange_when_focused() {
    // UC-3 BR-9: NeedsInput remains attention chrome even when the source Pane is focused.
    use crate::adapter::outward::view::header::agent_status_dot_color;
    use crate::state::gateway_status::AgentStatus;

    let focused = agent_status_dot_color(AgentStatus::NeedsInput, false, Some(0.0));
    assert_eq!(focused, Color::new(0.95, 0.65, 0.2, 1.0));
}

#[test]
fn focusing_wrapped_agent_pane_clears_notification_suppression_without_clearing_needs_input() {
    // UC-3 BR-10: Focusing the source Pane clears notification suppression without clearing NeedsInput.
    use crate::FocusNavPort;

    let (mut app, agent_pane_id, _) =
        app_with_wrapped_agent_status(crate::state::gateway_status::AgentStatus::NeedsInput);
    app.notified_panes.insert(agent_pane_id);

    app.focus_pane(agent_pane_id);

    assert!(!app.notified_panes.contains(&agent_pane_id));
    assert_eq!(
        app.gateway
            .detected_agents
            .get(&agent_pane_id)
            .unwrap()
            .status,
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
}

#[test]
fn running_status_does_not_clear_stale_notification_suppression() {
    // UC-3 BR-11: Running does not clear unresolved notification suppression on its own.
    let (mut app, agent_pane_id, _) =
        app_with_wrapped_agent_status(crate::state::gateway_status::AgentStatus::Idle);
    app.notified_panes.insert(agent_pane_id);

    let _ = app.handle_cli_command(
        "notify",
        json!({ "event": "agent-running", "pane": agent_pane_id, "agent": "codex" }),
    );

    assert!(app.notified_panes.contains(&agent_pane_id));
    assert_eq!(
        app.gateway
            .detected_agents
            .get(&agent_pane_id)
            .unwrap()
            .status,
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
}

// --- UC-4: RelayNotificationActivationToOwningTideInstance ---

#[test]
fn activate_notification_target_cli_command_switches_to_target_workspace_and_focuses_the_target_pane(
) {
    // UC-4 BR-12: activate-notification-target must switch to the target Workspace and focus the target Pane.
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
fn activate_notification_target_cli_command_queues_window_reveal() {
    // UC-4 BR-13: activate-notification-target must queue Tide Window reveal for the owning Tide Instance.
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
fn macos_notification_activation_relay_suppresses_non_owning_window_after_successful_relay() {
    // UC-4 BR-19: A non-owning Tide process that successfully relays notification activation must not leave a non-owning Tide Window frontmost.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");
    let relay_start = source
        .find("} else if relay_notification_activation(target) {")
        .expect("expected notification relay branch");
    let relay_body = &source[relay_start..];

    assert!(relay_body.contains("suppress_current_tide_instance_after_successful_relay();"));
    assert!(source.contains("fn suppress_current_tide_instance_after_successful_relay()"));
    assert!(source.contains("hide_current_tide_instance();"));
    assert!(source.contains("terminate_current_tide_instance();"));
}

#[test]
fn macos_window_construction_keeps_window_hidden_until_show_window() {
    // UC-4 BR-14: MacosWindow::new must keep the Tide Window hidden until show_window().
    let source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");
    let new_start = source
        .find("pub fn new(")
        .expect("expected MacosWindow::new");
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
    // UC-4 BR-15: show_window() must own makeKeyAndOrderFront plus app activation.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");
    let show_start = source
        .find("fn show_window(&self)")
        .expect("expected MacosWindow::show_window");
    let show_body = &source[show_start..];

    assert!(show_body.contains("makeKeyAndOrderFront(None)"));
    assert!(show_body.contains("activateIgnoringOtherApps"));
}
