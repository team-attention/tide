#![allow(dead_code)]
// Tide — GPU terminal emulator with native macOS platform layer.
// Wires all crates together: native window, wgpu surface, renderer, terminal panes,
// layout engine, input router, file tree, and CWD following.

// ── Module declarations ──
mod domain;
mod application;
mod adapter;
mod theme;
mod app;
mod layout_compute;

// ── Absorbed crate aliases (use tide_X:: paths still work) ──
pub(crate) use domain::core_types as tide_core;
pub(crate) use domain::terminal as tide_terminal;
pub(crate) use domain::editor as tide_editor;
pub(crate) use domain::layout as tide_layout;
pub(crate) use domain::input as tide_input;
pub(crate) use domain::tree as tide_tree;
pub(crate) use adapter::outward::renderer_adapter as tide_renderer;
pub(crate) use adapter::outward::platform_adapter as tide_platform;
pub(crate) use adapter::outward::lsp_adapter as tide_lsp;

// ── Facade re-exports (preserve existing crate-internal paths) ──
pub(crate) use domain::state;
pub(crate) use domain::pane;
pub(crate) use application as action;
pub(crate) use adapter::inward::event_loop_adapter as event_loop;
pub(crate) use application::services as update;
pub(crate) use adapter::outward::view as rendering;
pub(crate) use rendering::header;
pub(crate) use rendering::ui;

pub(crate) use state::*;
pub(crate) use application::ports::*;
pub(crate) use update::workspace_infra_service::{Workspace, WorkspaceExtras};

pub(crate) use app::App;

// Expose types that other modules reference as `crate::X`
use pane::PaneKind;

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

    // ── Channels ──────────────────────────────────────────────────────
    // event channel: main thread → app thread (platform events + wake signals)
    // command channel: app thread → main thread (window mutations)
    let (event_tx, event_rx) = std::sync::mpsc::channel::<event_loop::AppEvent>();
    let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<crate::tide_platform::WindowCommand>();

    // ── Wakers ────────────────────────────────────────────────────────
    // Main thread waker: posts NSEvent + triggerRedraw to wake the main run loop
    // and cause the callback to fire (which drains window commands).
    let main_waker = crate::tide_platform::macos::MacosApp::create_waker();

    // Combined waker for background threads (PTY, file watcher, render thread):
    // wakes both the app thread (via event channel) and the main thread (via NSEvent).
    let waker_tx = std::sync::Arc::new(std::sync::Mutex::new(event_tx.clone()));
    let combined_waker: crate::tide_platform::WakeCallback = std::sync::Arc::new({
        let main_waker = main_waker.clone();
        let waker_tx = waker_tx.clone();
        move || {
            let _ = waker_tx.lock().unwrap().send(event_loop::AppEvent::Wake);
            main_waker();
        }
    });

    // Install wake callback for webview navigation delegate
    crate::tide_platform::macos::webview::set_webview_waker(combined_waker.clone());

    // ── WindowProxy ──────────────────────────────────────────────────
    // App thread uses this to send commands back to the main thread.
    let window_proxy = crate::tide_platform::WindowProxy::new(cmd_tx, main_waker.clone());

    // ── Agent Gateway (always on) ───────────────────────────────────
    // Start the socket server before app setup so terminals inherit TIDE_SOCKET.
    let _gateway_server = match adapter::inward::cli_adapter::server::GatewayServer::start(
        event_tx.clone(),
        combined_waker.clone(),
    ) {
        Ok(server) => {
            let path = server.socket_path.to_string_lossy().to_string();
            log::info!("Agent Gateway listening on {}", path);
            crate::tide_terminal::set_gateway_socket_path(path);
            // Discover agent wrapper scripts in .app bundle Resources
            crate::tide_terminal::discover_agent_resources();
            Some(server)
        }
        Err(e) => {
            log::warn!("Agent Gateway failed to start: {e}");
            None
        }
    };

    // ── App setup ────────────────────────────────────────────────────
    let mut app = App::new();
    // Store gateway status
    if let Some(ref server) = _gateway_server {
        app.gateway.listening = true;
        app.gateway.socket_path = Some(server.socket_path.to_string_lossy().to_string());
        app.gateway.connected_clients_shared = Some(server.connected_clients.clone());
    }
    app.bg.event_loop_waker = Some(combined_waker.clone());
    app.ports.file_watcher.init(Some(combined_waker));

    // Initialize keybinding map from saved settings
    if !app.settings.keybindings.is_empty() {
        let map = state::settings::build_keybinding_map(&app.settings);
        app.router.keybinding_map = Some(map);
    }

    // Try loading a saved session to restore window size
    let saved_session = update::session_service::load_session();
    let (win_w, win_h) = saved_session
        .as_ref()
        .map(|s| (s.window_width as f64, s.window_height as f64))
        .unwrap_or((960.0, 640.0));

    let config = crate::tide_platform::WindowConfig {
        title: "Tide".to_string(),
        width: win_w,
        height: win_h,
        min_width: 400.0,
        min_height: 300.0,
        transparent_titlebar: true,
    };

    // ── Phase 1 handoff state ────────────────────────────────────────
    // Shared between the main thread callback and Phase 1 initialization.
    // After Phase 1, the App + event_rx + proxy are moved to the app thread.
    let init_state = std::sync::Arc::new(std::sync::Mutex::new(Some((
        app,
        event_rx,
        window_proxy.clone(),
    ))));
    let init_state_cb = init_state.clone();
    let initialized = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let initialized_cb = initialized.clone();

    // ── Run the macOS event loop ─────────────────────────────────────
    // Phase 1: first event triggers GPU init on main thread, then spawns app thread.
    // Phase 2: all subsequent events are forwarded to the app thread.
    crate::tide_platform::macos::MacosApp::run(
        config,
        Box::new(move |event, window| {
            // Phase 1: one-time initialization (main thread)
            if !initialized_cb.load(std::sync::atomic::Ordering::Acquire) {
                if let Some((mut app, rx, proxy)) = init_state_cb.lock().unwrap().take() {
                    // GPU init, session restore, pane creation (needs real window)
                    app.init_phase1(window);

                    // Sync IME proxies using WindowProxy (commands go to cmd_tx)
                    app.sync_ime_proxies(&proxy);
                    app.compute_layout();

                    // Drain any window commands generated during init
                    while let Ok(cmd) = cmd_rx.try_recv() {
                        crate::tide_platform::execute_window_command(window, cmd);
                    }

                    // Spawn the app thread
                    std::thread::Builder::new()
                        .name("app-thread".into())
                        .spawn(move || {
                            app.app_thread_run(rx, proxy);
                        })
                        .expect("failed to spawn app thread");

                    initialized_cb.store(true, std::sync::atomic::Ordering::Release);
                }
                return;
            }

            // Phase 2: drain commands FIRST so IME proxy focus etc. execute
            // before macOS dispatches the next event to first responder.
            while let Ok(cmd) = cmd_rx.try_recv() {
                crate::tide_platform::execute_window_command(window, cmd);
            }
            // Forward event to app thread
            if !matches!(event, crate::tide_platform::PlatformEvent::RedrawRequested) {
                let _ = event_tx.send(event_loop::AppEvent::Platform(event));
            }
        }),
    );
}
