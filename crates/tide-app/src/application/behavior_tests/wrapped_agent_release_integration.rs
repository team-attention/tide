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
fn local_bundle_build_script_fails_closed_if_lsrequirescarbon_survives() {
    // UC-1 BR-19: The local Tide.app build script must verify LSRequiresCarbon is gone before codesign.
    let script = include_str!("../../../../../scripts/build-app.sh");

    assert!(
        script.contains("Print :LSRequiresCarbon"),
        "expected build-app.sh to verify LSRequiresCarbon is absent before codesign"
    );
    assert!(
        !script.contains("Delete :LSRequiresCarbon\" \"$APP_PLIST\" >/dev/null 2>&1 || true"),
        "expected build-app.sh not to swallow LSRequiresCarbon strip failures"
    );
}

#[test]
fn macos_launch_path_defers_activation_until_window_reveal() {
    // UC-1 BR-3: MacosApp::run must defer regular app activation until explicit window reveal.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");
    let window_source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");
    let show_start = window_source
        .find("fn show_window(&self)")
        .expect("expected MacosWindow::show_window");
    let show_body = &window_source[show_start..];

    assert!(source.contains("NSApplicationActivationPolicy::Accessory"));
    assert!(
        !source.contains("setActivationPolicy(NSApplicationActivationPolicy::Regular)"),
        "expected MacosApp::run to defer regular app activation until show_window()"
    );
    assert!(show_body.contains("setActivationPolicy(NSApplicationActivationPolicy::Regular)"));
}

#[test]
fn macos_launch_path_schedules_initial_redraw_on_run_loop() {
    // UC-1 BR-20: native Tide Window creation must schedule initial redraw on the run loop instead of directly revealing a startup Tide Window before notification responses can be delivered.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");
    let create_start = source
        .find("pub fn create_window(")
        .expect("expected MacosApp::create_window");
    let create_end = source[create_start..]
        .find("tide_window_id\n    }")
        .map(|offset| create_start + offset)
        .expect("expected create_window return");
    let startup_body = &source[create_start..create_end];

    assert!(
        !startup_body.contains("super::emit_event("),
        "expected startup to avoid synchronous RedrawRequested before NSApp.run()"
    );
    assert!(startup_body.contains("window.request_redraw();"));
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
fn codex_wrapper_installs_user_prompt_submit_and_stop_hooks() {
    // UC-2 BR-5: The wrapper must install UserPromptSubmit and Stop hook wiring.
    let wrapper = include_str!("../../../resources/bin/codex");

    assert!(wrapper.contains("\"UserPromptSubmit\""));
    assert!(wrapper.contains("\"Stop\""));
    assert!(wrapper.contains("features.codex_hooks=true"));
    assert!(wrapper.contains("notify codex-stop --pane $TIDE_PANE --agent codex --payload-stdin"));
    assert!(!wrapper.contains("codex-turn-complete"));
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
fn focusing_wrapped_agent_pane_acknowledges_needs_input_and_clears_notification_suppression() {
    // UC-3 BR-10, UC-5 BR-8: Focusing the source Pane acknowledges NeedsInput and clears notification suppression.
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
        None
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
    assert!(show_body.contains("activateWithOptions"));
    assert!(!show_body.contains("activateIgnoringOtherApps: true"));
}

#[test]
fn macos_show_window_uses_full_window_activation_for_full_screen_space() {
    // UC-4 BR-15: show_window() must use ordering and all-window activation strong enough to reveal a Full-Screen Space Tide Window.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");
    let show_start = source
        .find("fn show_window(&self)")
        .expect("expected MacosWindow::show_window");
    let show_body = &source[show_start..];

    assert!(show_body.contains("deminiaturize(None)"));
    assert!(show_body.contains("orderFrontRegardless()"));
    assert!(show_body.contains("makeMainWindow()"));
    assert!(show_body.contains("NSRunningApplication::currentApplication()"));
    assert!(show_body.contains("NSApplicationActivateAllWindows"));
}
