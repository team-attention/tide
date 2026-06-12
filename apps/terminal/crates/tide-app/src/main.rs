#![allow(dead_code)]
// Tide — GPU terminal emulator with native macOS platform layer.
// Wires all crates together: native window, wgpu surface, renderer, terminal panes,
// layout engine, input router, file tree, and CWD following.

// ── Module declarations ──
mod adapter;
mod app;
mod application;
mod domain;
mod layout_compute;
mod theme;

// ── Absorbed crate aliases (use tide_X:: paths still work) ──
pub(crate) use adapter::outward::lsp_adapter as tide_lsp;
pub(crate) use adapter::outward::platform_adapter as tide_platform;
pub(crate) use adapter::outward::renderer_adapter as tide_renderer;
pub(crate) use domain::core_types as tide_core;
pub(crate) use domain::editor as tide_editor;
pub(crate) use domain::input as tide_input;
pub(crate) use domain::layout as tide_layout;
pub(crate) use domain::terminal as tide_terminal;
pub(crate) use domain::tree as tide_tree;

// ── Facade re-exports (preserve existing crate-internal paths) ──
pub(crate) use adapter::inward::event_loop_adapter as event_loop;
pub(crate) use adapter::outward::view as rendering;
pub(crate) use application as action;
pub(crate) use application::services as update;
pub(crate) use domain::pane;
pub(crate) use domain::state;
pub(crate) use rendering::header;
pub(crate) use rendering::ui;

pub(crate) use application::ports::*;
pub(crate) use state::*;
pub(crate) use update::workspace_infra_service::{Workspace, WorkspaceExtras};

pub(crate) use app::App;

// Expose types that other modules reference as `crate::X`
use pane::PaneKind;

#[derive(Clone)]
struct GatewayRuntimeInfo {
    listening: bool,
    socket_path: Option<String>,
    connected_clients_shared:
        Option<std::sync::Arc<adapter::inward::cli_adapter::server::ConnectedClients>>,
}

impl GatewayRuntimeInfo {
    fn from_server(server: Option<&adapter::inward::cli_adapter::server::GatewayServer>) -> Self {
        match server {
            Some(server) => Self {
                listening: true,
                socket_path: Some(server.socket_path.to_string_lossy().to_string()),
                connected_clients_shared: Some(server.connected_clients.clone()),
            },
            None => Self {
                listening: false,
                socket_path: None,
                connected_clients_shared: None,
            },
        }
    }
}

#[derive(Clone)]
struct WindowRuntimeShared {
    config: crate::tide_platform::WindowConfig,
    command_tx: std::sync::mpsc::Sender<crate::tide_platform::WindowCommandEnvelope>,
    command_rx: std::rc::Rc<
        std::cell::RefCell<std::sync::mpsc::Receiver<crate::tide_platform::WindowCommandEnvelope>>,
    >,
    main_waker: crate::tide_platform::WakeCallback,
    gateway_router: std::sync::Arc<adapter::inward::cli_adapter::server::GatewayCommandRouter>,
    gateway_info: GatewayRuntimeInfo,
}

fn configure_window_app(
    app: &mut App,
    tide_window_id: crate::tide_core::TideWindowId,
    allow_crash_recovery: bool,
    gateway_info: &GatewayRuntimeInfo,
    combined_waker: crate::tide_platform::WakeCallback,
) {
    app.tide_window_id = tide_window_id;
    app.allow_crash_recovery = allow_crash_recovery;
    if !allow_crash_recovery {
        app.window.is_focused = false;
    }
    app.queue_notification_permission_request_if_auto_integration_enabled();
    app.gateway.listening = gateway_info.listening;
    app.gateway.socket_path = gateway_info.socket_path.clone();
    // Build the explicit terminal spawn config (gateway socket + discovered agent
    // integration dirs). Pushed into the terminal factory once real ports are
    // installed (init_phase1).
    app.terminal_spawn_config = crate::tide_terminal::TerminalSpawnConfig::discover(
        gateway_info.socket_path.clone(),
        app.settings.auto_integration,
    );
    app.gateway.connected_clients_shared = gateway_info.connected_clients_shared.clone();
    app.bg.event_loop_waker = Some(combined_waker.clone());
    app.ports.file_watcher.init(Some(combined_waker));

    if !app.settings.keybindings.is_empty() {
        let map = state::settings::build_keybinding_map(&app.settings);
        app.router.keybinding_map = Some(map);
    }
}

fn combined_waker_for(
    event_tx: std::sync::mpsc::Sender<event_loop::AppEvent>,
    main_waker: crate::tide_platform::WakeCallback,
) -> crate::tide_platform::WakeCallback {
    std::sync::Arc::new(move || {
        let _ = event_tx.send(event_loop::AppEvent::Wake);
        main_waker();
    })
}

fn drain_window_commands(shared: &WindowRuntimeShared) {
    let mut commands = Vec::new();
    while let Ok(command) = shared.command_rx.borrow_mut().try_recv() {
        commands.push(command);
    }

    for envelope in commands {
        match envelope.command {
            crate::tide_platform::WindowCommand::CreateWindow { width, height } => {
                create_tide_window_runtime(shared, width, height);
            }
            crate::tide_platform::WindowCommand::CloseWindow => {
                shared
                    .gateway_router
                    .unregister_window(envelope.tide_window_id);
                let close_request = crate::tide_platform::macos::MacosApp::request_close_window(
                    envelope.tide_window_id,
                );
                if close_request.remaining_window_count == 0 {
                    update::session_service::delete_running_marker();
                    std::process::exit(0);
                }
            }
            crate::tide_platform::WindowCommand::BroadcastSettingsChanged => {
                shared.gateway_router.broadcast_reload_settings();
            }
            command => {
                crate::tide_platform::macos::with_window(envelope.tide_window_id, |window| {
                    crate::tide_platform::execute_window_command(window, command)
                });
            }
        }
    }
}

pub(crate) fn launch_window_config(
    _saved_session: Option<&crate::application::ports::outward::persistence_port::Session>,
) -> crate::tide_platform::WindowConfig {
    crate::tide_platform::WindowConfig::default()
}

fn child_window_config(
    base: &crate::tide_platform::WindowConfig,
    width: f64,
    height: f64,
) -> crate::tide_platform::WindowConfig {
    let mut config = base.clone();
    config.width = width.max(config.min_width);
    config.height = height.max(config.min_height);
    config
}

fn build_window_callback(
    shared: WindowRuntimeShared,
    tide_window_id: crate::tide_core::TideWindowId,
    allow_crash_recovery: bool,
) -> crate::tide_platform::EventCallback {
    let (event_tx, event_rx) = std::sync::mpsc::channel::<event_loop::AppEvent>();
    let combined_waker = combined_waker_for(event_tx.clone(), shared.main_waker.clone());
    shared
        .gateway_router
        .register_window(tide_window_id, event_tx.clone(), combined_waker.clone());

    let mut app = App::new();
    // Seed the WorkspaceManager so the rail draws the active Workspace from
    // boot. Without this, `workspaces` is empty until the user creates a
    // second Workspace via `new_workspace`, which leaves the rail blank and
    // makes the Workspace rail context menu / MCP rename for idx 0 inaccessible.
    app.ensure_initial_workspace_seeded();
    configure_window_app(
        &mut app,
        tide_window_id,
        allow_crash_recovery,
        &shared.gateway_info,
        combined_waker,
    );

    let window_proxy = crate::tide_platform::WindowProxy::new_for_window(
        tide_window_id,
        shared.command_tx.clone(),
        shared.main_waker.clone(),
    );

    let init_state = std::rc::Rc::new(std::cell::RefCell::new(Some((
        app,
        event_rx,
        window_proxy.clone(),
    ))));
    let initialized = std::rc::Rc::new(std::cell::Cell::new(false));

    Box::new(move |event, window| {
        if matches!(event, crate::tide_platform::PlatformEvent::Focused(true)) {
            shared.gateway_router.set_active_window(tide_window_id);
        }

        if !initialized.get() {
            if let Some((mut app, rx, proxy)) = init_state.borrow_mut().take() {
                app.init_phase1(window);
                app.sync_ime_proxies(&proxy);
                app.compute_layout();
                crate::AppCorePort::request_redraw(&mut app);

                drain_window_commands(&shared);

                std::thread::Builder::new()
                    .name(format!("app-thread-{}", tide_window_id.get()))
                    .spawn(move || {
                        app.app_thread_run(rx, proxy);
                    })
                    .expect("failed to spawn app thread");

                initialized.set(true);
            }
            return;
        }

        drain_window_commands(&shared);
        if !matches!(event, crate::tide_platform::PlatformEvent::RedrawRequested) {
            let _ = event_tx.send(event_loop::AppEvent::Platform(event));
        }
    })
}

fn create_tide_window_runtime(
    shared: &WindowRuntimeShared,
    width: f64,
    height: f64,
) -> crate::tide_core::TideWindowId {
    let tide_window_id = crate::tide_platform::macos::MacosApp::allocate_window_id();
    let callback = build_window_callback(shared.clone(), tide_window_id, false);
    crate::tide_platform::macos::MacosApp::create_window(
        tide_window_id,
        child_window_config(&shared.config, width, height),
        callback,
    )
}

// ──────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────

fn main() {
    // ── Subcommand routing ───────────────────────────────────────────
    // Check for CLI subcommand before any GUI initialization.
    let args: Vec<String> = std::env::args().collect();
    if args.len() >= 2 && args[1] == "cli" {
        let exit_code = adapter::inward::cli_adapter::client::run_cli(&args[2..]);
        std::process::exit(exit_code);
    }
    if args.len() >= 2 && args[1] == "mcp" {
        let exit_code = adapter::inward::cli_adapter::mcp::run_mcp();
        std::process::exit(exit_code);
    }
    if args.len() >= 2 && args[1] == "notify" {
        let exit_code = adapter::inward::cli_adapter::notify::run_notify(&args[2..]);
        std::process::exit(exit_code);
    }

    // Enable backtraces for panic diagnostics
    std::env::set_var("RUST_BACKTRACE", "1");

    // Install a custom panic hook that logs to stderr before the default handler.
    // This ensures we capture the panic message even when catch_unwind absorbs it.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        eprintln!("[tide] PANIC: {info}");
        default_hook(info);
    }));

    env_logger::init();

    // Main thread waker: posts NSEvent + triggerRedraw to wake the run loop.
    let main_waker = crate::tide_platform::macos::MacosApp::create_waker();
    let gateway_router =
        std::sync::Arc::new(adapter::inward::cli_adapter::server::GatewayCommandRouter::new());

    crate::tide_platform::macos::webview::set_webview_waker(std::sync::Arc::new({
        let gateway_router = gateway_router.clone();
        let main_waker = main_waker.clone();
        move || {
            gateway_router.wake_all();
            main_waker();
        }
    }));

    // ── Agent Gateway (always on) ───────────────────────────────────
    // Start the socket server before app setup so terminals inherit TIDE_TERMINAL_SOCKET.
    let _gateway_server =
        match adapter::inward::cli_adapter::server::GatewayServer::start(gateway_router.clone()) {
            Ok(server) => {
                let path = server.socket_path.to_string_lossy().to_string();
                log::info!("Agent Gateway listening on {}", path);
                // The socket path flows into each App's TerminalSpawnConfig via
                // GatewayRuntimeInfo (configure_window_app); the agent wrapper /
                // shell-integration dirs are discovered there too.
                Some(server)
            }
            Err(e) => {
                log::warn!("Agent Gateway failed to start: {e}");
                None
            }
        };
    let gateway_info = GatewayRuntimeInfo::from_server(_gateway_server.as_ref());

    let config = launch_window_config(None);

    let (command_tx, command_rx) =
        std::sync::mpsc::channel::<crate::tide_platform::WindowCommandEnvelope>();
    let shared = WindowRuntimeShared {
        config: config.clone(),
        command_tx,
        command_rx: std::rc::Rc::new(std::cell::RefCell::new(command_rx)),
        main_waker,
        gateway_router,
        gateway_info,
    };

    let first_tide_window_id = crate::tide_platform::macos::MacosApp::allocate_window_id();
    let first_callback = build_window_callback(shared, first_tide_window_id, true);
    crate::tide_platform::macos::MacosApp::run_with_window(
        first_tide_window_id,
        config,
        first_callback,
    );
}
