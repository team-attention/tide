// Tide — GPU terminal emulator with native macOS platform layer.
// Wires all crates together: native window, wgpu surface, renderer, terminal panes,
// layout engine, input router, file tree, and CWD following.

// ── State layer ──
mod state;
mod theme;

// ── Pane types ──
mod pane;

// ── Update layer ──
mod action;
mod event_handler;
mod update;

// ── View layer ──
mod rendering;
mod header;

// ── Infrastructure ──
mod event_loop;
mod gpu;
mod layout_compute;
mod ui;

#[cfg(test)]
mod behavior_tests;

pub(crate) use state::*;

use std::collections::HashMap;
use std::path::PathBuf;

use tide_core::{PaneId, Rect, Size, TerminalBackend};
use tide_input::Router;
use tide_layout::SplitLayout;
use tide_tree::FsTree;

use pane::{PaneKind, TerminalPane};
use theme::*;

pub(crate) use update::workspace::{Workspace, WorkspaceExtras};

// ──────────────────────────────────────────────
// App state
// ──────────────────────────────────────────────

struct App {
    // GPU resources (grouped)
    pub(crate) gpu: state::GpuState,

    // Panes
    pub(crate) panes: HashMap<PaneId, PaneKind>,
    pub(crate) layout: SplitLayout,
    pub(crate) router: Router,

    // File tree (grouped state)
    pub(crate) ft: state::FileTreeModel,

    // Window/display state (grouped)
    pub(crate) window: state::WindowState,

    // Focus tracking (grouped)
    pub(crate) focus: state::FocusState,

    // Timing/scheduling (grouped)
    pub(crate) timing: state::TimingState,

    // IME composition state (grouped)
    pub(crate) ime: state::ImeState,

    // Computed pane rects: tiling rects (hit-testing/drag) and visual rects (gap-inset, rendering)
    pub(crate) pane_rects: Vec<(PaneId, Rect)>,
    pub(crate) visual_pane_rects: Vec<(PaneId, Rect)>,
    pub(crate) prev_visual_pane_rects: Vec<(PaneId, Rect)>,

    // The overall rect available for pane tiling (excluding file tree and editor panel)
    pub(crate) pane_area_rect: Option<Rect>,
    // The rect available for dock panes (right of pane area)
    pub(crate) dock_area_rect: Option<Rect>,

    // Render generation tracking (grouped)
    pub(crate) cache: state::RenderCache,

    // Input latency tracking (grouped)
    pub(crate) input: state::InputLatencyState,

    // Mouse/drag/scroll interaction (grouped)
    pub(crate) interaction: state::InteractionState,

    // Modal/popup overlay state (grouped)
    pub(crate) modal: state::ModalStack,

    // Dock layout state (grouped)
    pub(crate) dock: state::DockState,

    // Header hit zones (for badge click handling)
    pub(crate) header_hit_zones: Vec<header::HeaderHitZone>,

    // Workspace management (grouped)
    pub(crate) ws: state::WorkspaceManager,

    // Loaded settings
    pub(crate) settings: settings::TideSettings,

    // Background services (grouped)
    pub(crate) bg: state::BackgroundServices,

    // Platform pointers (grouped)
    pub(crate) platform: state::PlatformPtrs,

    // Pane associations (grouped)
    pub(crate) assoc: state::PaneAssociations,
}

// Safety: App contains raw pointers (content_view_ptr, window_ptr) and browser
// WebViewHandles that are not inherently Send. These are only used for webview
// management which will be dispatched back to the main thread via WindowCommand.
// All other fields (wgpu resources, channels, atomics) are Send-safe.
unsafe impl Send for App {}

impl App {
    fn new() -> Self {
        let top_inset = if cfg!(target_os = "macos") { TITLEBAR_HEIGHT } else { 0.0 };
        Self {
            gpu: state::GpuState::new(),
            panes: HashMap::new(),
            layout: SplitLayout::new(),
            router: Router::new(),
            ft: state::FileTreeModel::new(FILE_TREE_WIDTH),
            window: state::WindowState::new(top_inset),
            focus: state::FocusState::new(),
            timing: state::TimingState::new(),
            ime: state::ImeState::new(),
            pane_rects: Vec::new(),
            visual_pane_rects: Vec::new(),
            prev_visual_pane_rects: Vec::new(),
            pane_area_rect: None,
            dock_area_rect: None,
            cache: state::RenderCache::new(),
            input: state::InputLatencyState::new(),
            interaction: state::InteractionState::new(),
            modal: state::ModalStack::new(),
            dock: state::DockState::new(),
            header_hit_zones: Vec::new(),
            ws: state::WorkspaceManager::new(),
            settings: settings::load_settings(),
            bg: state::BackgroundServices::new(),
            platform: state::PlatformPtrs::new(),
            assoc: state::PaneAssociations::new(),
        }
    }

    // ── Helpers ──

    /// Returns the active dock pane when dock is in zoomed/stacked mode.
    /// Falls back to dock_focused or first pinned pane when focused is not a dock pane.
    pub(crate) fn dock_zoomed_pane(&self) -> Option<PaneId> {
        if !self.dock.dock_zoomed {
            return None;
        }
        self.focus.focused
            .filter(|id| self.is_pane_in_dock(*id))
            .or_else(|| {
                self.focused_terminal_id().and_then(|tid| {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        tp.dock_focused.filter(|id| self.panes.contains_key(id))
                    } else {
                        None
                    }
                })
            })
            .or_else(|| self.dock.pinned_dock_layout.pane_ids().into_iter().next())
    }

    /// Install an event-loop waker on a terminal pane so the PTY thread
    /// can wake us from sleep when new output arrives.
    fn install_pty_waker(&self, pane: &TerminalPane) {
        if let Some(ref waker) = self.bg.event_loop_waker {
            let w = waker.clone();
            pane.backend.set_waker(Box::new(move || w()));
        }
    }

    /// Create the initial terminal pane.
    fn create_initial_pane(&mut self, early_terminal: Option<tide_terminal::Terminal>) {
        let (layout, pane_id) = SplitLayout::with_initial_pane();
        self.layout = layout;

        let cell_size = self.cell_size();
        let logical_w = self.window.window_size.0 as f32 / self.window.scale_factor;
        let logical_h = self.window.window_size.1 as f32 / self.window.scale_factor;

        let cols = if cell_size.width > 0.0 {
            ((logical_w / cell_size.width).max(1.0).min(1000.0)) as u16
        } else {
            80
        };
        let rows = if cell_size.height > 0.0 {
            ((logical_h / cell_size.height).max(1.0).min(500.0)) as u16
        } else {
            24
        };

        let result = if let Some(mut terminal) = early_terminal {
            terminal.resize(cols, rows);
            Ok(TerminalPane::with_terminal(pane_id, terminal))
        } else {
            TerminalPane::with_cwd(pane_id, cols, rows, None, self.window.dark_mode)
        };

        match result {
            Ok(pane) => {
                self.install_pty_waker(&pane);
                self.panes.insert(pane_id, PaneKind::Terminal(pane));
                self.ime.pending_creates.push(pane_id);
                self.focus.focused = Some(pane_id);
                self.focus.stage_focused = Some(pane_id);
                self.router.set_focused(pane_id);
            }
            Err(e) => {
                log::error!("Failed to create terminal pane: {}", e);
            }
        }

        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
        let tree = FsTree::new(cwd.clone());
        self.ft.tree = Some(tree);
        self.timing.last_cwd = Some(cwd);

        self.ws.workspaces.push(Workspace {
            name: "Workspace 1".to_string(),
            layout: SplitLayout::new(),
            focused: None,
            panes: HashMap::new(),
        });
        self.ws.workspace_extras.push(WorkspaceExtras::new());
        self.ws.active = 0;
    }

    pub(crate) fn logical_size(&self) -> Size {
        self.window.logical_size()
    }

    pub(crate) fn cell_size(&self) -> Size {
        self.window.cached_cell_size
    }

    pub(crate) fn apply_font_size(&mut self, size: f32) {
        let size = size.clamp(8.0, 32.0);
        if (size - self.window.current_font_size).abs() < 0.01 {
            return;
        }
        self.window.current_font_size = size;
        self.window.cached_cell_size = self.window.lookup_cell_size(size);

        if let Some(renderer) = &mut self.gpu.renderer {
            renderer.set_font_size(size);
        } else {
            self.window.pending_font_size = Some(size);
        }

        self.cache.pane_generations.clear();
        self.cache.invalidate_chrome();
        self.cache.layout_generation = self.cache.layout_generation.wrapping_add(1);
        self.compute_layout();
    }

    pub(crate) fn flush_pending_font_size(&mut self) {
        if let Some(size) = self.window.pending_font_size.take() {
            if let Some(renderer) = &mut self.gpu.renderer {
                renderer.set_font_size(size);
            }
        }
    }
}

// ──────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────

fn main() {
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
    let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<tide_platform::WindowCommand>();

    // ── Wakers ────────────────────────────────────────────────────────
    // Main thread waker: posts NSEvent + triggerRedraw to wake the main run loop
    // and cause the callback to fire (which drains window commands).
    let main_waker = tide_platform::macos::MacosApp::create_waker();

    // Combined waker for background threads (PTY, file watcher, render thread):
    // wakes both the app thread (via event channel) and the main thread (via NSEvent).
    let waker_tx = std::sync::Arc::new(std::sync::Mutex::new(event_tx.clone()));
    let combined_waker: tide_platform::WakeCallback = std::sync::Arc::new({
        let main_waker = main_waker.clone();
        let waker_tx = waker_tx.clone();
        move || {
            let _ = waker_tx.lock().unwrap().send(event_loop::AppEvent::Wake);
            main_waker();
        }
    });

    // ── WindowProxy ──────────────────────────────────────────────────
    // App thread uses this to send commands back to the main thread.
    let window_proxy = tide_platform::WindowProxy::new(cmd_tx, main_waker.clone());

    // ── App setup ────────────────────────────────────────────────────
    let mut app = App::new();
    app.bg.event_loop_waker = Some(combined_waker);

    // Initialize keybinding map from saved settings
    if !app.settings.keybindings.is_empty() {
        let map = settings::build_keybinding_map(&app.settings);
        app.router.keybinding_map = Some(map);
    }

    // Try loading a saved session to restore window size
    let saved_session = update::session::load_session();
    let (win_w, win_h) = saved_session
        .as_ref()
        .map(|s| (s.window_width as f64, s.window_height as f64))
        .unwrap_or((960.0, 640.0));

    let config = tide_platform::WindowConfig {
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
    tide_platform::macos::MacosApp::run(
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
                        tide_platform::execute_window_command(window, cmd);
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
                tide_platform::execute_window_command(window, cmd);
            }
            // Forward event to app thread
            if !matches!(event, tide_platform::PlatformEvent::RedrawRequested) {
                let _ = event_tx.send(event_loop::AppEvent::Platform(event));
            }
        }),
    );
}
