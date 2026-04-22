// Spec: docs/specs/single-process-multi-window.md

use std::cell::Cell;
use std::io;
use std::path::Path;
use std::rc::Rc;
use std::sync::mpsc;

use crate::application::ports::inward::ActionPort;
use crate::application::ports::outward::process_port::ProcessPort;
use crate::event_loop::{AppEvent, PlatformEventOutcome};
use crate::tide_core::TideWindowId;
use crate::tide_input::GlobalAction;
use crate::tide_platform::{PlatformEvent, WindowCommand, WindowCommandEnvelope, WindowProxy};
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

#[derive(Clone)]
struct RecordingProcess {
    launched_windows: Rc<Cell<u32>>,
}

impl ProcessPort for RecordingProcess {
    fn open_with_default_app(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn reveal_in_finder(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn open_url(&self, _url: &str) -> io::Result<()> {
        Ok(())
    }

    fn launch_new_tide_window(&self) -> io::Result<()> {
        self.launched_windows
            .set(self.launched_windows.get().saturating_add(1));
        Ok(())
    }
}

// --- UC-1: CreateInProcessTideWindow ---

#[test]
fn cmd_n_creates_new_tide_window_in_same_process() {
    // UC-1 BR-1, BR-2, BR-3: NewWindow stays the action, requests CreateWindow, and does not launch a process.
    let mut app = test_app();
    let launched_windows = Rc::new(Cell::new(0));
    app.ports.process = Box::new(RecordingProcess {
        launched_windows: Rc::clone(&launched_windows),
    });

    app.handle_global_action(GlobalAction::NewWindow);

    assert_eq!(launched_windows.get(), 0);
    assert!(matches!(
        app.pending_platform_commands.last(),
        Some(WindowCommand::CreateWindow)
    ));
}

#[test]
fn new_tide_window_uses_cascaded_tide_window_position() {
    // UC-1 BR-5: new Tide Windows use AppKit cascade positioning before registration.
    let app_source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");
    let window_source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");
    let create_window = app_source
        .find("pub fn create_window")
        .expect("create window function");
    let position = app_source[create_window..]
        .find("position_window_for_creation")
        .map(|offset| create_window + offset)
        .expect("window positioning");
    let register = app_source[create_window..]
        .find("insert(tide_window_id, window)")
        .map(|offset| create_window + offset)
        .expect("window registry insert");

    assert!(position < register);
    assert!(app_source.contains("NEXT_CASCADE_TOP_LEFT"));
    assert!(window_source.contains("cascadeTopLeftFromPoint"));
    assert!(window_source.contains("frame_top_left"));
}

// --- UC-2: RouteWindowCommandByTideWindowId ---

#[test]
fn window_targeted_commands_route_to_the_addressed_tide_window() {
    // UC-2 BR-1, BR-2, BR-3: WindowProxy wraps commands with the addressed TideWindowId.
    let (tx, rx) = mpsc::channel::<WindowCommandEnvelope>();
    let proxy = WindowProxy::new_for_window(TideWindowId::new(7), tx, std::sync::Arc::new(|| {}));

    proxy.request_redraw();

    let envelope = rx.recv().expect("window command envelope");
    assert_eq!(envelope.tide_window_id, TideWindowId::new(7));
    assert!(matches!(envelope.command, WindowCommand::RequestRedraw));
}

// --- UC-3: OwnIndependentWindowAppState ---

#[test]
fn each_tide_window_keeps_independent_workspace_state() {
    // UC-3 BR-1, BR-2, BR-3: each App owns an independent WorkspaceManager and active Workspace fields.
    let mut first = test_app();
    let second = test_app();

    first.ws.workspaces.push(crate::Workspace {
        name: "First window workspace".to_string(),
        layout: crate::tide_layout::SplitLayout::new(),
        focused: None,
        panes: std::collections::HashMap::new(),
    });
    first.ws.active = 0;

    assert_eq!(first.ws.workspaces.len(), 1);
    assert_eq!(second.ws.workspaces.len(), 0);
    assert!(first.panes.is_empty());
    assert!(second.panes.is_empty());
}

// --- UC-4: RouteGatewayCommandByTideWindowId ---

#[test]
fn cli_callers_include_tide_window_for_gateway_routing() {
    // UC-4 BR-1, BR-2: terminal children export TIDE_WINDOW, and CLI/MCP/notify clients forward it as _caller_window.
    let terminal_source = include_str!("../../domain/terminal/mod.rs");
    let cli_source = include_str!("../../adapter/inward/cli_adapter/client.rs");
    let mcp_source = include_str!("../../adapter/inward/cli_adapter/mcp.rs");
    let notify_source = include_str!("../../adapter/inward/cli_adapter/notify.rs");

    assert!(terminal_source.contains("\"TIDE_WINDOW\""));
    assert!(cli_source.contains("std::env::var(\"TIDE_WINDOW\")"));
    assert!(cli_source.contains("\"_caller_window\""));
    assert!(mcp_source.contains("std::env::var(\"TIDE_WINDOW\")"));
    assert!(mcp_source.contains("\"_caller_window\""));
    assert!(notify_source.contains("std::env::var(\"TIDE_WINDOW\")"));
    assert!(notify_source.contains("\"_caller_window\""));
}

#[test]
fn gateway_router_dispatches_cli_command_to_the_addressed_tide_window() {
    // UC-4 BR-3, BR-4: GatewayCommandRouter uses _caller_window when present and otherwise falls back to the active Tide Window.
    let router = crate::adapter::inward::cli_adapter::server::GatewayCommandRouter::new();
    let (first_tx, first_rx) = mpsc::channel::<AppEvent>();
    let (second_tx, second_rx) = mpsc::channel::<AppEvent>();

    router.register_window(TideWindowId::new(1), first_tx, std::sync::Arc::new(|| {}));
    router.register_window(TideWindowId::new(2), second_tx, std::sync::Arc::new(|| {}));

    let (response_tx, _response_rx) = mpsc::channel();
    assert!(router.dispatch(
        Some(TideWindowId::new(2)),
        crate::adapter::inward::cli_adapter::CliCommand {
            method: "list-panes".to_string(),
            params: serde_json::json!({}),
            response_tx,
            notification_tx: None,
        },
    ));

    assert!(matches!(
        second_rx.recv().expect("addressed command"),
        AppEvent::CliCommand(cmd) if cmd.method == "list-panes"
    ));
    assert!(first_rx.try_recv().is_err());

    router.set_active_window(TideWindowId::new(1));
    let (response_tx, _response_rx) = mpsc::channel();
    assert!(router.dispatch(
        None,
        crate::adapter::inward::cli_adapter::CliCommand {
            method: "get-layout".to_string(),
            params: serde_json::json!({}),
            response_tx,
            notification_tx: None,
        },
    ));

    assert!(matches!(
        first_rx.recv().expect("active-window fallback command"),
        AppEvent::CliCommand(cmd) if cmd.method == "get-layout"
    ));
    assert!(second_rx.try_recv().is_err());
}

// --- UC-5: CloseTideWindow ---

#[test]
fn close_requested_closes_the_addressed_tide_window_without_process_exit() {
    // UC-5 BR-1: CloseRequested sends CloseWindow for this TideWindowId and lets the App runtime shut down.
    let mut app = test_app();
    app.tide_window_id = TideWindowId::new(9);
    let (tx, rx) = mpsc::channel::<WindowCommandEnvelope>();
    let proxy = WindowProxy::new_for_window(app.tide_window_id, tx, std::sync::Arc::new(|| {}));

    let outcome =
        crate::event_loop::handle_platform_event(&mut app, PlatformEvent::CloseRequested, &proxy);

    assert_eq!(outcome, PlatformEventOutcome::ShutdownWindow);
    let envelope = rx.recv().expect("close window command");
    assert_eq!(envelope.tide_window_id, TideWindowId::new(9));
    assert!(matches!(envelope.command, WindowCommand::CloseWindow));
}

#[test]
fn closed_tide_window_is_removed_from_gateway_routing() {
    // UC-5 BR-2, BR-3, BR-4: closed windows are unregistered, addressed stale commands fail, and unaddressed commands use the active Tide Window.
    let router = crate::adapter::inward::cli_adapter::server::GatewayCommandRouter::new();
    let (first_tx, first_rx) = mpsc::channel::<AppEvent>();
    let (second_tx, second_rx) = mpsc::channel::<AppEvent>();

    router.register_window(TideWindowId::new(1), first_tx, std::sync::Arc::new(|| {}));
    router.register_window(TideWindowId::new(2), second_tx, std::sync::Arc::new(|| {}));
    router.unregister_window(TideWindowId::new(2));

    let (response_tx, _response_rx) = mpsc::channel();
    assert!(!router.dispatch(
        Some(TideWindowId::new(2)),
        crate::adapter::inward::cli_adapter::CliCommand {
            method: "list-panes".to_string(),
            params: serde_json::json!({}),
            response_tx,
            notification_tx: None,
        },
    ));
    assert!(first_rx.try_recv().is_err());
    assert!(second_rx.try_recv().is_err());

    let (response_tx, _response_rx) = mpsc::channel();
    assert!(router.dispatch(
        None,
        crate::adapter::inward::cli_adapter::CliCommand {
            method: "get-layout".to_string(),
            params: serde_json::json!({}),
            response_tx,
            notification_tx: None,
        },
    ));
    assert!(matches!(
        first_rx.recv().expect("active fallback command"),
        AppEvent::CliCommand(cmd) if cmd.method == "get-layout"
    ));
}

#[test]
fn close_window_command_deletes_running_marker_only_for_last_tide_window() {
    // UC-5 BR-5: main thread close handling deletes the running marker only when no Tide Window remains.
    let main_source = include_str!("../../main.rs");

    assert!(main_source.contains("WindowCommand::CloseWindow"));
    assert!(main_source.contains("remaining_window_count == 0"));
    assert!(main_source.contains("delete_running_marker()"));
    assert!(main_source.contains("std::process::exit(0)"));
}

#[test]
fn close_window_request_reports_remaining_count_after_registry_removal() {
    // UC-5 BR-6: process exit uses the registry count after the addressed Tide Window is removed.
    let app_source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");
    let request = app_source
        .find("pub(crate) fn request_close_window")
        .expect("close request function");
    let close = app_source[request..]
        .find("close_window_now(tide_window_id);")
        .map(|offset| request + offset)
        .expect("registry removal call");
    let remaining = app_source[request..]
        .find("remaining_window_count: live_window_count()")
        .map(|offset| request + offset)
        .expect("remaining window count");

    assert!(close < remaining);
    assert!(!app_source.contains("CLOSING_WINDOWS"));
}

#[test]
fn closing_last_pane_requests_tide_window_close_without_process_exit() {
    // UC-5 BR-7: closing the last Pane in a Tide Window uses the TideWindowId-targeted close path.
    let app_source = include_str!("../../app.rs");
    let pane_close_source = include_str!("../../application/services/pane_close_service/mod.rs");
    let event_loop_source = include_str!("../../adapter/inward/event_loop_adapter/mod.rs");

    assert!(app_source.contains("tide_window_close_requested: bool"));

    let start = pane_close_source
        .find("if remaining.len() <= 1")
        .expect("last-pane close branch");
    let end = pane_close_source[start..]
        .find("// Decrement active_streams")
        .map(|offset| start + offset)
        .expect("end of last-pane close branch");
    let last_pane_branch = &pane_close_source[start..end];

    assert!(last_pane_branch.contains("WindowCommand::CloseWindow"));
    assert!(last_pane_branch.contains("tide_window_close_requested = true"));
    assert!(!last_pane_branch.contains("self.exit_app()"));
    assert!(event_loop_source.contains("self.tide_window_close_requested"));
}

#[test]
fn pending_close_window_command_is_forwarded_to_window_proxy() {
    // UC-5 BR-8: a queued CloseWindow command must reach the TideWindowId-targeted WindowProxy.
    let event_loop_source = include_str!("../../adapter/inward/event_loop_adapter/mod.rs");
    let start = event_loop_source
        .find("let cmds: Vec<_> = self.pending_platform_commands.drain(..).collect();")
        .expect("pending platform command drain");
    let end = event_loop_source[start..]
        .find("// File watcher")
        .map(|offset| start + offset)
        .expect("end of pending platform command drain");
    let drain_source = &event_loop_source[start..end];

    assert!(drain_source.contains("WindowCommand::CloseWindow"));
    assert!(drain_source.contains("window.close_window();"));
}

#[test]
fn retained_native_window_disables_appkit_release_on_close() {
    // UC-5 BR-9: Tide retains NSWindow directly, so AppKit must not also release it on close.
    let window_source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");
    let init = window_source
        .find("initWithContentRect")
        .expect("NSWindow initialization");
    let release_policy = window_source[init..]
        .find("setReleasedWhenClosed")
        .map(|offset| init + offset)
        .expect("release-on-close policy");
    let min_size = window_source[init..]
        .find("ns_window.setMinSize")
        .map(|offset| init + offset)
        .expect("post-init window configuration");

    assert!(release_policy < min_size);
    assert!(window_source.contains("setReleasedWhenClosed: Bool::NO"));
}

// --- UC-6: IsolateProcessGlobalWindowState ---

#[test]
fn browser_bridge_queues_are_scoped_by_tide_window() {
    // UC-6 BR-1, BR-2: Browser bridge messages and new-tab requests are queued and drained by TideWindowId.
    use crate::tide_platform::macos::webview::{
        drain_bridge_messages_for_window, drain_new_tab_urls_for_window,
        queue_bridge_message_for_window, queue_new_tab_url_for_window,
    };
    let webview_source = include_str!("../../adapter/outward/platform_adapter/macos/webview.rs");

    queue_bridge_message_for_window(TideWindowId::new(11), "first-window-message".to_string());
    queue_bridge_message_for_window(TideWindowId::new(12), "second-window-message".to_string());
    queue_new_tab_url_for_window(TideWindowId::new(11), "https://first.example".to_string());
    queue_new_tab_url_for_window(TideWindowId::new(12), "https://second.example".to_string());

    assert_eq!(
        drain_bridge_messages_for_window(TideWindowId::new(11)),
        vec!["first-window-message".to_string()]
    );
    assert_eq!(
        drain_new_tab_urls_for_window(TideWindowId::new(12)),
        vec!["https://second.example".to_string()]
    );
    assert_eq!(
        drain_bridge_messages_for_window(TideWindowId::new(12)),
        vec!["second-window-message".to_string()]
    );
    assert_eq!(
        drain_new_tab_urls_for_window(TideWindowId::new(11)),
        vec!["https://first.example".to_string()]
    );
    assert!(webview_source.contains("HashMap<TideWindowId, Vec<String>>"));
    assert!(webview_source.contains("queue.remove(&tide_window_id).unwrap_or_default()"));
    assert!(!webview_source.contains("struct WindowBridgeMessage"));
    assert!(!webview_source.contains("struct WindowNewTabRequest"));
}

#[test]
fn browser_native_handlers_are_keyed_by_tide_window_and_pane() {
    // UC-6 BR-3: native Browser Pane handler tables include TideWindowId so PaneId reuse across windows cannot collide.
    let webview_source = include_str!("../../adapter/outward/platform_adapter/macos/webview.rs");

    assert!(webview_source.contains("struct WebViewTarget"));
    assert!(webview_source.contains("tide_window_id: TideWindowId"));
    assert!(webview_source.contains("HashMap<WebViewTarget, BlockPtr>"));
    assert!(webview_source.contains("HashMap<WebViewTarget, DelegatePtr>"));
}

#[test]
fn notification_authorization_updates_are_not_main_window_only() {
    // UC-6 BR-4: process-wide notification authorization status is delivered to live Tide Windows, not just the main one.
    let app_source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");
    let window_source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");

    assert!(app_source.contains("for_each_window"));
    assert!(window_source.contains("for_each_window"));
    assert!(!window_source.contains("with_main_window"));
}

#[test]
fn terminal_workspace_environment_uses_the_owning_app_workspace() {
    // UC-6 BR-5: TIDE_WORKSPACE is passed through terminal creation from the owning App instead of a process-global active workspace.
    let terminal_source = include_str!("../../domain/terminal/mod.rs");
    let terminal_factory_source =
        include_str!("../../application/ports/outward/terminal_factory_port/mod.rs");
    let pane_create_source = include_str!("../../application/services/pane_create_service/mod.rs");

    assert!(terminal_source.contains("\"TIDE_WORKSPACE\""));
    assert!(!terminal_source.contains("ACTIVE_WORKSPACE_NAME"));
    assert!(terminal_factory_source.contains("workspace_name"));
    assert!(pane_create_source.contains("active_workspace_name"));
}

#[test]
fn settings_changes_are_broadcast_to_live_tide_windows() {
    // UC-6 BR-6: a settings change sends a reload event to every live App runtime.
    let router = crate::adapter::inward::cli_adapter::server::GatewayCommandRouter::new();
    let (first_tx, first_rx) = mpsc::channel::<AppEvent>();
    let (second_tx, second_rx) = mpsc::channel::<AppEvent>();

    router.register_window(TideWindowId::new(1), first_tx, std::sync::Arc::new(|| {}));
    router.register_window(TideWindowId::new(2), second_tx, std::sync::Arc::new(|| {}));
    router.broadcast_reload_settings();

    assert!(matches!(
        first_rx.recv().expect("first reload settings"),
        AppEvent::ReloadSettings
    ));
    assert!(matches!(
        second_rx.recv().expect("second reload settings"),
        AppEvent::ReloadSettings
    ));
}

#[test]
fn crash_recovery_restore_is_limited_to_the_first_tide_window() {
    // UC-6 BR-7: crash recovery restore is enabled for process startup, while in-process new windows start fresh.
    let app_source = include_str!("../../app.rs");
    let event_loop_source = include_str!("../../adapter/inward/event_loop_adapter/mod.rs");
    let main_source = include_str!("../../main.rs");

    assert!(app_source.contains("allow_crash_recovery"));
    assert!(event_loop_source.contains("self.allow_crash_recovery"));
    assert!(main_source.contains("build_window_callback(shared.clone(), tide_window_id, false)"));
    assert!(main_source.contains("build_window_callback(shared, first_tide_window_id, true)"));
}

#[test]
fn periodic_session_auto_save_is_limited_to_the_focused_tide_window() {
    // UC-6 BR-8: global crash-recovery session auto-save is written only by the focused Tide Window.
    let event_loop_source = include_str!("../../adapter/inward/event_loop_adapter/mod.rs");
    let main_source = include_str!("../../main.rs");

    assert!(event_loop_source.contains("self.window.is_focused"));
    assert!(event_loop_source.contains("self.timing.last_session_save"));
    assert!(main_source.contains("app.window.is_focused = false"));
}

#[test]
fn main_thread_waker_does_not_message_native_views_from_app_threads() {
    // UC-6 BR-9: cross-thread wakeups dispatch to the main queue and trigger at most one native view.
    let app_source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");
    let start = app_source
        .find("pub fn create_waker")
        .expect("create_waker source");
    let end = app_source[start..]
        .find("/// Clear the wakeup coalescing flag")
        .map(|offset| start + offset)
        .expect("clear wakeup source");
    let create_waker_source = &app_source[start..end];

    assert!(create_waker_source.contains("dispatch_async_f"));
    assert!(create_waker_source.contains("wake_main_queue"));
    assert!(!create_waker_source.contains("performSelectorOnMainThread"));
    assert!(!app_source.contains("GLOBAL_VIEW"));
    assert!(app_source.contains("fn first_live_window_view"));

    let wake_start = app_source
        .find("unsafe extern \"C\" fn wake_main_queue")
        .expect("wake main queue source");
    let wake_end = app_source[wake_start..]
        .find("fn post_application_defined_event")
        .map(|offset| wake_start + offset)
        .expect("post event source");
    let wake_source = &app_source[wake_start..wake_end];
    assert!(wake_source.contains("first_live_window_view()"));
    assert!(!wake_source.contains("for view in views"));
    assert!(!wake_source.contains("live_window_views()"));
}

#[test]
fn new_tide_window_runtime_requests_initial_redraw_before_app_thread_run() {
    // UC-6 BR-10: a newly initialized App runtime requests redraw before its app thread starts.
    let main_source = include_str!("../../main.rs");
    let redraw = main_source
        .find("crate::AppCorePort::request_redraw(&mut app)")
        .expect("initial redraw request");
    let app_thread = main_source
        .find("app.app_thread_run(rx, proxy)")
        .expect("app thread run");

    assert!(redraw < app_thread);
}

#[test]
fn platform_event_dispatch_releases_window_registry_borrow_before_callback() {
    // UC-6 BR-11: EventCallback can drain commands that create or close Tide Windows.
    let app_source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");
    let macos_mod_source = include_str!("../../adapter/outward/platform_adapter/macos/mod.rs");

    assert!(app_source.contains("HashMap<TideWindowId, Rc<MacosWindow>>"));
    assert!(app_source.contains("fn window_for_event"));
    assert!(app_source.contains("cell.borrow().get(&tide_window_id).cloned()"));
    assert!(macos_mod_source.contains("app::window_for_event(tide_window_id)"));
    assert!(!macos_mod_source.contains("app::with_window(tide_window_id, |window|"));
}
