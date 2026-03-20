// App struct definition and core helpers.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::tide_core::{PaneId, Rect, Size, TerminalBackend};
use crate::tide_input::Router;
use crate::tide_layout::SplitLayout;
use crate::tide_tree::FsTree;

use crate::pane::{PaneKind, TerminalPane};
use crate::theme::*;
use crate::state;
use crate::update::workspace::{Workspace, WorkspaceExtras};
use crate::DockPort;
use crate::AppCorePort;
use crate::LayoutPort;
use crate::PaneLifecyclePort;

// ──────────────────────────────────────────────
// App state
// ──────────────────────────────────────────────

pub(crate) struct App {
    // Port abstractions for external boundaries
    pub(crate) ports: crate::domain::ports::Ports,

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
    pub(crate) header_hit_zones: Vec<crate::header::HeaderHitZone>,

    // Workspace management (grouped)
    pub(crate) ws: state::WorkspaceManager,

    // Loaded settings
    pub(crate) settings: state::settings::TideSettings,

    // Background services (grouped)
    pub(crate) bg: state::BackgroundServices,

    // (Platform pointers moved to ports.platform)

    // Pane associations (grouped)
    pub(crate) assoc: state::PaneAssociations,
}

// Safety: App contains raw pointers (content_view_ptr, window_ptr) and browser
// WebViewHandles that are not inherently Send. These are only used for webview
// management which will be dispatched back to the main thread via WindowCommand.
// All other fields (wgpu resources, channels, atomics) are Send-safe.
unsafe impl Send for App {}

impl App {
    pub(crate) fn new() -> Self {
        let top_inset = if cfg!(target_os = "macos") { TITLEBAR_HEIGHT } else { 0.0 };
        Self {
            ports: crate::domain::ports::Ports::noop(),
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
            settings: state::settings::load_settings(),
            bg: state::BackgroundServices::new(),
            assoc: state::PaneAssociations::new(),
        }
    }

    // ── Helpers ──

    /// Install an event-loop waker on a terminal pane so the PTY thread
    /// can wake us from sleep when new output arrives.
    pub(crate) fn install_pty_waker(&self, pane: &TerminalPane) {
        if let Some(ref waker) = self.bg.event_loop_waker {
            let w = waker.clone();
            pane.backend.set_waker(Box::new(move || w()));
        }
    }

    /// Create the initial terminal pane.
    pub(crate) fn create_initial_pane(&mut self, early_terminal: Option<crate::tide_terminal::Terminal>) {
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
            self.ports.terminal_factory.create_terminal(pane_id, cols, rows, None, self.window.dark_mode)
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

        let cwd = self.ports.fs.current_dir().unwrap_or_else(|_| PathBuf::from("/"));
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

}

impl crate::domain::ports::inward::AppCorePort for App {
    fn dock_zoomed_pane(&self) -> Option<PaneId> {
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

    fn logical_size(&self) -> Size {
        self.window.logical_size()
    }

    fn cell_size(&self) -> Size {
        self.window.cached_cell_size
    }

    fn apply_font_size(&mut self, size: f32) {
        let size = size.clamp(8.0, 32.0);
        if (size - self.window.current_font_size).abs() < 0.01 {
            return;
        }
        self.window.current_font_size = size;
        self.window.cached_cell_size = self.window.lookup_cell_size(size);

        if !self.ports.gpu.set_font_size(size) {
            self.window.pending_font_size = Some(size);
        }

        self.cache.pane_generations.clear();
        self.cache.invalidate_chrome();
        self.cache.layout_generation = self.cache.layout_generation.wrapping_add(1);
        self.compute_layout();
    }

    fn flush_pending_font_size(&mut self) {
        if let Some(size) = self.window.pending_font_size.take() {
            self.ports.gpu.set_font_size(size);
        }
    }
}
