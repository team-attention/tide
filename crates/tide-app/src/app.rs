// App struct definition and core helpers.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::tide_core::{PaneId, Rect, Size, TerminalBackend};
use crate::tide_input::Router;
use crate::tide_layout::SplitLayout;
use crate::tide_tree::FsTree;

use crate::pane::{PaneKind, TerminalPane};
use crate::state;
use crate::theme::*;
use crate::update::workspace_infra_service::{Workspace, WorkspaceExtras};
use crate::AppCorePort;
use crate::DockPort;
use crate::GatewayPort;
use crate::LayoutPort;

// Adapter implementations
use crate::adapter::outward::clipboard_adapter::{NoopClipboard, SystemClipboard};
use crate::adapter::outward::clock_adapter::{FixedClock, SystemClock};
use crate::adapter::outward::file_watcher_adapter::{NoopFileWatcher, RealFileWatcher};
use crate::adapter::outward::fs_adapter::{NoopFileSystem, RealFileSystem};
use crate::adapter::outward::git_adapter::{NoopGit, RealGit};
use crate::adapter::outward::lsp_adapter::{NoopLsp, RealLsp};
use crate::adapter::outward::persistence_adapter::{NoopPersistence, RealPersistence};
use crate::adapter::outward::platform_adapter::{NoopPlatform, RealPlatform};
use crate::adapter::outward::process_adapter::{NoopProcess, SystemProcess};
use crate::adapter::outward::renderer_adapter::port_impl::{NoopGpu, RealGpu};
use crate::adapter::outward::terminal_factory_adapter::RealTerminalFactory;

use crate::application::ports::outward::{
    ClipboardPort, ClockPort, FileSystemPort, FileWatcherPort, GitPort, GpuPort, LspPort,
    PersistencePort, PlatformPort, ProcessPort, TerminalFactoryPort,
};

/// Aggregates all outward port implementations. Injected into App.
pub(crate) struct Ports {
    pub clock: Box<dyn ClockPort>,
    pub clipboard: Box<dyn ClipboardPort>,
    pub fs: Box<dyn FileSystemPort>,
    pub process: Box<dyn ProcessPort>,
    pub persistence: Box<dyn PersistencePort>,
    pub git: Box<dyn GitPort>,
    pub terminal_factory: Box<dyn TerminalFactoryPort>,
    pub file_watcher: Box<dyn FileWatcherPort>,
    pub lsp: Box<dyn LspPort>,
    pub gpu: Box<dyn GpuPort>,
    pub platform: Box<dyn PlatformPort>,
}

impl Ports {
    pub fn noop() -> Self {
        Self {
            clock: Box::new(FixedClock {
                instant: std::time::Instant::now(),
            }),
            clipboard: Box::new(NoopClipboard),
            fs: Box::new(NoopFileSystem),
            process: Box::new(NoopProcess),
            persistence: Box::new(NoopPersistence),
            git: Box::new(NoopGit),
            terminal_factory: Box::new(RealTerminalFactory),
            file_watcher: Box::new(NoopFileWatcher),
            lsp: Box::new(NoopLsp),
            gpu: Box::new(NoopGpu),
            platform: Box::new(NoopPlatform),
        }
    }
    pub fn real() -> Self {
        Self {
            clock: Box::new(SystemClock),
            clipboard: Box::new(SystemClipboard),
            fs: Box::new(RealFileSystem),
            process: Box::new(SystemProcess),
            persistence: Box::new(RealPersistence),
            git: Box::new(RealGit),
            terminal_factory: Box::new(RealTerminalFactory),
            file_watcher: Box::new(RealFileWatcher::new()),
            lsp: Box::new(RealLsp::new()),
            gpu: Box::new(RealGpu::new()),
            platform: Box::new(RealPlatform::new()),
        }
    }
}

// ──────────────────────────────────────────────
// App state
// ──────────────────────────────────────────────

pub(crate) struct App {
    // Port abstractions for external boundaries
    pub(crate) ports: Ports,

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

    // Live workspace-local artifact state for the active Workspace.
    pub(crate) context_artifacts: state::ContextArtifactStore,

    // Loaded settings
    pub(crate) settings: state::settings::TideSettings,

    // Background services (grouped)
    pub(crate) bg: state::BackgroundServices,

    // (Platform pointers moved to ports.platform)

    // Pane associations (grouped)
    pub(crate) assoc: state::PaneAssociations,

    // Agent Gateway status
    pub(crate) gateway: state::GatewayStatus,

    // Temporary: holds notification_tx for subscribe command during dispatch
    pub(crate) pending_subscribe_tx: Option<std::sync::mpsc::Sender<String>>,

    // Temporary: holds the caller PaneId while a CLI command is dispatching.
    pub(crate) pending_cli_caller_pane: Option<PaneId>,

    // Pending platform commands queued by notification routing, drained by event loop.
    pub(crate) pending_platform_commands: Vec<crate::tide_platform::WindowCommand>,

    /// Pane IDs that have already sent a system notification and haven't been
    /// acknowledged (focused) yet. Prevents duplicate notifications (UC-1 BR-4).
    pub(crate) notified_panes: std::collections::HashSet<PaneId>,
    /// Pane IDs with an undelivered Wrapped Agent Completion Notification.
    pub(crate) pending_completion_notification_panes: std::collections::HashSet<PaneId>,
    /// Last unresolved notification snippet per wrapped-agent source Pane.
    pub(crate) agent_notification_snippets: HashMap<PaneId, String>,
}

// Safety: App contains raw pointers (content_view_ptr, window_ptr) and browser
// WebViewHandles that are not inherently Send. These are only used for webview
// management which will be dispatched back to the main thread via WindowCommand.
// All other fields (wgpu resources, channels, atomics) are Send-safe.
unsafe impl Send for App {}

impl App {
    pub(crate) fn new() -> Self {
        let top_inset = if cfg!(target_os = "macos") {
            TITLEBAR_HEIGHT
        } else {
            0.0
        };
        Self {
            ports: Ports::noop(),
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
            context_artifacts: state::ContextArtifactStore::new(),
            settings: {
                let s = state::settings::load_settings();
                crate::tide_terminal::set_auto_integration(s.auto_integration);
                s
            },
            bg: state::BackgroundServices::new(),
            assoc: state::PaneAssociations::new(),
            gateway: state::GatewayStatus::new(),
            pending_subscribe_tx: None,
            pending_cli_caller_pane: None,
            pending_platform_commands: Vec::new(),
            notified_panes: std::collections::HashSet::new(),
            pending_completion_notification_panes: std::collections::HashSet::new(),
            agent_notification_snippets: HashMap::new(),
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

    fn queue_notification_permission_request(&mut self) {
        if self.pending_platform_commands.iter().any(|cmd| {
            matches!(
                cmd,
                crate::tide_platform::WindowCommand::RequestNotificationPermission
            )
        }) {
            return;
        }

        self.pending_platform_commands
            .push(crate::tide_platform::WindowCommand::RequestNotificationPermission);
    }

    pub(crate) fn queue_notification_permission_request_if_auto_integration_enabled(&mut self) {
        if self.settings.auto_integration {
            self.queue_notification_permission_request();
        }
    }

    fn is_terminal_pane_in_any_workspace(&self, pane_id: PaneId) -> bool {
        matches!(
            self.panes.get(&pane_id),
            Some(crate::pane::PaneKind::Terminal(_))
        ) || self.ws.workspaces.iter().any(|workspace| {
            matches!(
                workspace.panes.get(&pane_id),
                Some(crate::pane::PaneKind::Terminal(_))
            )
        })
    }

    pub(crate) fn reroute_backgrounded_wrapped_agent_attention(&mut self) {
        let pending_attention: Vec<_> = self
            .gateway
            .detected_agents
            .iter()
            .filter(|(_, agent)| agent.wrapper_managed)
            .filter_map(|(&pane_id, agent)| match agent.status {
                Some(crate::state::gateway_status::AgentStatus::Idle) => {
                    Some((pane_id, crate::state::gateway_status::AgentStatus::Idle))
                }
                Some(crate::state::gateway_status::AgentStatus::NeedsInput) => Some((
                    pane_id,
                    crate::state::gateway_status::AgentStatus::NeedsInput,
                )),
                _ => None,
            })
            .collect();

        for (pane_id, status) in pending_attention {
            self.route_agent_notification(pane_id, status, None);
        }
    }

    pub(crate) fn acknowledge_agent_attention(&mut self, pane_id: PaneId) {
        let mut affected_workspaces = Vec::new();
        let mut clear_completion_state = false;

        if let Some(workspace_idx) = self.find_workspace_for_pane(pane_id) {
            if !affected_workspaces.contains(&workspace_idx) {
                affected_workspaces.push(workspace_idx);
            }
        }
        if let Some(agent) = self.gateway.detected_agents.get_mut(&pane_id) {
            if matches!(
                agent.status,
                Some(crate::state::gateway_status::AgentStatus::Idle)
            ) {
                agent.status = None;
                clear_completion_state = true;
            }
        }
        if clear_completion_state
            || self
                .pending_completion_notification_panes
                .contains(&pane_id)
        {
            self.notified_panes.remove(&pane_id);
            self.pending_completion_notification_panes.remove(&pane_id);
            self.agent_notification_snippets.remove(&pane_id);
        }

        for workspace_idx in affected_workspaces {
            self.refresh_workspace_agent_notification(workspace_idx);
        }
    }

    pub(crate) fn detach_wrapped_agent(&mut self, pane_id: PaneId) {
        let mut affected_workspaces = Vec::new();

        if let Some(workspace_idx) = self.find_workspace_for_pane(pane_id) {
            affected_workspaces.push(workspace_idx);
        }

        self.gateway.detected_agents.remove(&pane_id);
        self.notified_panes.remove(&pane_id);
        self.pending_completion_notification_panes.remove(&pane_id);
        self.agent_notification_snippets.remove(&pane_id);

        for workspace_idx in affected_workspaces {
            self.refresh_workspace_agent_notification(workspace_idx);
        }
    }

    /// Create the initial terminal pane.
    pub(crate) fn create_initial_pane(
        &mut self,
        early_terminal: Option<crate::tide_terminal::Terminal>,
    ) {
        let pane_id = self.next_workspace_pane_id();
        let (layout, pane_id) = SplitLayout::with_initial_pane_id(pane_id);
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
            self.ports.terminal_factory.create_terminal(
                pane_id,
                cols,
                rows,
                None,
                self.window.dark_mode,
            )
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

        let cwd = self
            .ports
            .fs
            .current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"));
        let tree = FsTree::new(cwd.clone());
        self.ft.tree = Some(tree);
        self.sync_file_tree_path_identity_cache();
        self.sync_file_tree_modified_editor_cache();
        self.timing.last_cwd = Some(cwd);

        crate::tide_terminal::set_active_workspace_name("Workspace 1".to_string());
        self.ws.workspaces.push(Workspace {
            name: "Workspace 1".to_string(),
            layout: SplitLayout::new(),
            focused: None,
            panes: HashMap::new(),
        });
        self.ws.workspace_extras.push(WorkspaceExtras::new());
        self.ws
            .workspace_context_artifacts
            .push(state::ContextArtifactStore::new());
        self.ws.active = 0;
    }
}

impl crate::application::ports::inward::AppCorePort for App {
    fn dock_zoomed_pane(&self) -> Option<PaneId> {
        if !self.dock.dock_zoomed {
            return None;
        }
        self.focus
            .focused
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

    // ── State queries ──

    fn has_renderer(&self) -> bool {
        self.ports.gpu.has_renderer()
    }

    // ── Cache invalidation ──

    fn invalidate_chrome(&mut self) {
        self.cache.invalidate_chrome();
    }

    fn invalidate_pane(&mut self, id: PaneId) {
        self.cache.invalidate_pane(id);
    }

    fn invalidate_all_panes(&mut self) {
        self.cache.pane_generations.clear();
    }

    fn request_redraw(&mut self) {
        self.cache.needs_redraw = true;
    }

    fn sync_file_tree_modified_editor_cache(&mut self) {
        App::sync_file_tree_modified_editor_cache(self);
    }

    // ── State queries ──

    fn top_inset(&self) -> f32 {
        self.window.top_inset
    }

    fn sidebar_side(&self) -> crate::LayoutSide {
        self.window.sidebar_side
    }

    fn gateway_listening(&self) -> bool {
        self.gateway.listening
    }

    fn gateway_agent_counts(&self) -> (usize, usize) {
        let total = self.gateway.detected_agents.len();
        let connected = self
            .gateway
            .detected_agents
            .values()
            .filter(|a| a.gateway_connected)
            .count();
        (connected, total)
    }

    // ── Header hit zones ──

    fn header_hit_zones(&self) -> Vec<crate::header::HeaderHitZone> {
        self.header_hit_zones.clone()
    }

    // ── Outward port delegates ──

    fn read_file_to_string(&self, path: &std::path::Path) -> Result<String, String> {
        self.ports
            .fs
            .read_to_string(path)
            .map_err(|e| e.to_string())
    }

    fn git_list_branches(
        &self,
        cwd: &std::path::Path,
    ) -> Vec<crate::tide_terminal::git::BranchInfo> {
        self.ports.git.list_branches(cwd)
    }

    fn git_list_worktrees(
        &self,
        cwd: &std::path::Path,
    ) -> Vec<crate::tide_terminal::git::WorktreeInfo> {
        self.ports.git.list_worktrees(cwd)
    }

    fn git_repo_root(&self, cwd: &std::path::Path) -> Option<std::path::PathBuf> {
        self.ports.git.repo_root(cwd)
    }

    fn git_branch_exists(&self, cwd: &std::path::Path, name: &str) -> bool {
        self.ports.git.branch_exists(cwd, name)
    }

    fn git_add_worktree(
        &self,
        cwd: &std::path::Path,
        path: &std::path::Path,
        branch: &str,
        new_branch: bool,
    ) -> Result<(), String> {
        self.ports.git.add_worktree(cwd, path, branch, new_branch)
    }

    fn git_remove_worktree(
        &self,
        cwd: &std::path::Path,
        path: &std::path::Path,
        force: bool,
    ) -> Result<(), String> {
        self.ports.git.remove_worktree(cwd, path, force)
    }

    fn git_delete_branch(
        &self,
        cwd: &std::path::Path,
        name: &str,
        force: bool,
    ) -> Result<(), String> {
        self.ports.git.delete_branch(cwd, name, force)
    }

    fn persistence_load_settings(&self) -> crate::state::settings::TideSettings {
        self.ports.persistence.load_settings()
    }

    // ── Geometry queries ──

    fn visual_pane_rects(&self) -> &[(PaneId, Rect)] {
        &self.visual_pane_rects
    }

    fn pane_rects(&self) -> &[(PaneId, Rect)] {
        &self.pane_rects
    }

    fn pane_area_rect(&self) -> Option<Rect> {
        self.pane_area_rect
    }

    fn dock_area_rect(&self) -> Option<Rect> {
        self.dock_area_rect
    }

    fn shared_tab_max_scroll(&self, pane_id: PaneId) -> Option<f32> {
        let rect = self
            .visual_pane_rects
            .iter()
            .find(|(id, _)| *id == pane_id)
            .map(|(_, rect)| *rect)?;

        let (tab_ids, active_pane, pinned_ids, is_stacked, show_comment_badge, is_stage_surface) =
            if self.dock_zoomed_pane() == Some(pane_id) {
                let mut tabs = self.dock.pinned_dock_layout.all_tabs_flat();
                if let Some(tid) = self.focused_terminal_id() {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        tabs.extend(tp.dock_layout.all_tabs_flat());
                    }
                }
                if tabs.len() < 2 {
                    return None;
                }
                (
                    tabs,
                    pane_id,
                    Vec::new(),
                    true,
                    self.can_show_context_comment_badge(pane_id),
                    false,
                )
            } else if let Some(tg) = self
                .dock
                .pinned_dock_layout
                .tab_group_containing(pane_id)
                .or_else(|| {
                    self.terminal_owning(pane_id)
                        .and_then(|tid| match self.panes.get(&tid) {
                            Some(PaneKind::Terminal(tp)) => {
                                tp.dock_layout.tab_group_containing(pane_id)
                            }
                            _ => None,
                        })
                })
            {
                (
                    tg.tabs.clone(),
                    tg.active_pane(),
                    self.dock.pinned_dock_layout.all_pane_ids(),
                    false,
                    self.can_show_context_comment_badge(tg.active_pane()),
                    false,
                )
            } else {
                let stage_pane_ids = self.layout.all_tabs_flat();
                if self.focus.zoomed_pane == Some(pane_id) && stage_pane_ids.len() > 1 {
                    (stage_pane_ids, pane_id, Vec::new(), true, false, true)
                } else if let Some(tg) = self
                    .layout
                    .tab_group_containing(pane_id)
                    .filter(|tg| tg.tabs.len() >= 2)
                {
                    (
                        tg.tabs.clone(),
                        tg.active_pane(),
                        Vec::new(),
                        false,
                        false,
                        true,
                    )
                } else {
                    return None;
                }
            };

        let cell_w = self.window.cached_cell_size.width;
        let mut content_left = rect.x;
        if is_stacked {
            content_left += TAB_H_PAD + cell_w + 6.0;
        }
        let visible_w = (rect.x + rect.width - content_left).max(0.0);
        if visible_w <= 0.0 {
            return Some(0.0);
        }

        let active_tab_cap = crate::header::shared_tab_active_width_cap(visible_w, tab_ids.len());
        let is_focused = self.focus.focused == Some(pane_id);
        let total_tabs_w: f32 = tab_ids
            .iter()
            .map(|tid| {
                let mut label = crate::header::dock_tab_label(&self.panes, *tid);
                if pinned_ids.contains(tid) {
                    label = format!("\u{f08d} {}", label);
                }
                let has_agent_status = crate::header::stage_terminal_dot_visual_state(
                    &self.panes,
                    &self.gateway.detected_agents,
                    *tid,
                    is_stage_surface,
                )
                .is_some();
                let badge_widths: Vec<f32> = if *tid == active_pane {
                    crate::header::active_tab_badges(
                        &self.panes,
                        tid,
                        is_focused,
                        show_comment_badge,
                    )
                    .iter()
                    .map(|badge| badge.text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0)
                    .collect()
                } else {
                    Vec::new()
                };
                crate::header::shared_tab_target_width(
                    label.chars().count() as f32 * cell_w,
                    &badge_widths,
                    has_agent_status,
                    *tid == active_pane,
                    active_tab_cap,
                )
            })
            .sum();

        Some((total_tabs_w - visible_w).max(0.0))
    }

    // ── Sidebar handle drag (mouse_adapter) ──

    fn sidebar_handle_dragging(&self) -> bool {
        self.window.sidebar_handle_dragging
    }

    fn set_sidebar_handle_dragging(&mut self, v: bool) {
        self.window.sidebar_handle_dragging = v;
    }

    fn set_sidebar_side(&mut self, side: crate::LayoutSide) {
        self.window.sidebar_side = side;
    }

    // ── Window state (event_loop_adapter) ──

    fn window_size(&self) -> (u32, u32) {
        self.window.window_size
    }

    fn set_window_size(&mut self, width: u32, height: u32) {
        self.window.window_size = (width, height);
    }

    fn scale_factor(&self) -> f32 {
        self.window.scale_factor
    }

    fn set_scale_factor(&mut self, scale: f32) {
        self.window.scale_factor = scale;
    }

    fn is_fullscreen(&self) -> bool {
        self.window.is_fullscreen
    }

    fn set_fullscreen_state(&mut self, is_fullscreen: bool) {
        self.window.is_fullscreen = is_fullscreen;
    }

    fn is_occluded(&self) -> bool {
        self.window.is_occluded
    }

    fn set_occluded(&mut self, occluded: bool) {
        self.window.is_occluded = occluded;
    }

    fn pending_fullscreen_toggle(&self) -> bool {
        self.window.pending_fullscreen_toggle
    }

    fn clear_pending_fullscreen_toggle(&mut self) {
        self.window.pending_fullscreen_toggle = false;
    }

    fn set_top_inset(&mut self, inset: f32) {
        self.window.top_inset = inset;
    }

    fn reconfigure_surface(&mut self) {
        self.reconfigure_surface();
    }

    fn clock_now(&self) -> std::time::Instant {
        self.ports.clock.now()
    }

    fn is_window_focused(&self) -> bool {
        self.window.is_focused
    }

    fn set_window_focused(&mut self, focused: bool) {
        self.window.is_focused = focused;
        if focused {
            if self.settings.auto_integration
                && self
                    .window
                    .notification_authorization_status
                    .is_unresolved()
            {
                self.queue_notification_permission_request();
            }
        } else {
            self.reroute_backgrounded_wrapped_agent_attention();
        }
    }

    fn set_notification_authorization_status(
        &mut self,
        status: crate::state::NotificationAuthorizationStatus,
    ) {
        self.window.notification_authorization_status = status;
        match status {
            crate::state::NotificationAuthorizationStatus::Denied => {
                log::warn!(
                    "Notification authorization is denied. Open System Settings > Notifications > Tide to allow Tide notifications."
                );
            }
            crate::state::NotificationAuthorizationStatus::Unknown
            | crate::state::NotificationAuthorizationStatus::NotDetermined => {
                log::warn!(
                    "Notification authorization is {:?}. Check System Settings > Notifications > Tide if Tide does not appear in the list.",
                    status
                );
            }
            crate::state::NotificationAuthorizationStatus::Authorized
            | crate::state::NotificationAuthorizationStatus::Provisional
            | crate::state::NotificationAuthorizationStatus::Ephemeral => {}
        }
        self.cache.invalidate_chrome();
        self.request_redraw();
    }

    fn acknowledge_attention_for_focused_pane(&mut self) {
        if let Some(pane_id) = self.focus.focused {
            self.acknowledge_agent_attention(pane_id);
            self.cache.invalidate_chrome();
        }
    }

    fn save_full_session(&mut self) {
        use crate::application::ports::outward::persistence_port::{Session, SessionContextArea};
        let session = Session::from_app(self);
        self.ports.persistence.save_session(&session);
        let context_area = SessionContextArea::from_app(self);
        self.ports
            .persistence
            .save_context_area_session(&context_area);
    }

    fn delete_running_marker(&mut self) {
        self.ports.persistence.delete_running_marker();
    }

    // ── Deferred resize ──

    fn set_resize_deferred(&mut self, millis: u64) {
        self.timing.resize_deferred_at =
            Some(self.ports.clock.now() + std::time::Duration::from_millis(millis));
    }

    fn clear_resize_deferred(&mut self) {
        self.timing.resize_deferred_at = None;
    }
}

// ── ModalPort ──

impl crate::application::ports::inward::ModalPort for App {
    fn modal(&self) -> &crate::state::ModalStack {
        &self.modal
    }
    fn modal_mut(&mut self) -> &mut crate::state::ModalStack {
        &mut self.modal
    }
}

// ── InputStatePort ──

impl crate::application::ports::inward::InputStatePort for App {
    fn last_cursor_pos(&self) -> crate::tide_core::Vec2 {
        self.window.last_cursor_pos
    }
    fn set_last_cursor_pos(&mut self, pos: crate::tide_core::Vec2) {
        self.window.last_cursor_pos = pos;
    }
    fn modifiers(&self) -> crate::tide_core::Modifiers {
        self.window.modifiers
    }
    fn set_modifiers(&mut self, mods: crate::tide_core::Modifiers) {
        self.window.modifiers = mods;
    }
    fn mark_scroll_activity(&mut self) {
        self.input.scroll_at = Some(self.ports.clock.now());
    }
    fn interaction(&self) -> &crate::state::InteractionState {
        &self.interaction
    }
    fn interaction_mut(&mut self) -> &mut crate::state::InteractionState {
        &mut self.interaction
    }

    // ── Batch depth ──

    fn batch_depth(&self) -> u32 {
        self.input.batch_depth
    }

    fn increment_batch_depth(&mut self) {
        self.input.batch_depth += 1;
    }

    fn decrement_batch_depth(&mut self) {
        self.input.batch_depth = self.input.batch_depth.saturating_sub(1);
    }

    // ── Shift double-tap detection ──

    fn shift_tap_clean(&self) -> bool {
        self.input.shift_tap_clean
    }

    fn set_shift_tap_clean(&mut self, clean: bool) {
        self.input.shift_tap_clean = clean;
    }

    fn last_shift_up(&self) -> Option<std::time::Instant> {
        self.input.last_shift_up
    }

    fn set_last_shift_up(&mut self, at: Option<std::time::Instant>) {
        self.input.last_shift_up = at;
    }
}

// ── FileTreePort ──

impl crate::application::ports::inward::FileTreePort for App {
    fn ft(&self) -> &crate::state::FileTreeModel {
        &self.ft
    }
    fn ft_mut(&mut self) -> &mut crate::state::FileTreeModel {
        &mut self.ft
    }
    fn file_tree_max_scroll(&self) -> f32 {
        self.file_tree_max_scroll()
    }
    fn auto_scroll_file_tree_cursor(&mut self) {
        self.auto_scroll_file_tree_cursor()
    }
    fn execute_context_menu_action(&mut self, action_index: usize) {
        self.execute_context_menu_action(action_index)
    }
    fn complete_file_tree_rename(&mut self) {
        self.complete_file_tree_rename()
    }
    fn handle_file_tree_click(&mut self, pos: crate::tide_core::Vec2) {
        self.handle_file_tree_click(pos)
    }
}

// ── RouterPort ──

impl crate::application::ports::inward::RouterPort for App {
    fn route_input(&mut self, input: crate::tide_core::InputEvent) -> crate::tide_input::Action {
        self.router.process(input, &self.pane_rects)
    }
}

// ── GatewayPort ──

impl crate::application::ports::inward::GatewayPort for App {
    fn gateway_notify(&mut self, event: &str, data: serde_json::Value) {
        self.gateway.notify(event, data);
    }
    fn gateway_inc_streams(&mut self) {
        self.gateway.active_streams += 1;
    }
    fn gateway_dec_streams(&mut self) {
        if self.gateway.active_streams > 0 {
            self.gateway.active_streams -= 1;
        }
    }
    fn gateway_subscribe(
        &mut self,
        owner_pane_id: Option<PaneId>,
        tx: std::sync::mpsc::Sender<String>,
        event_filter: Vec<String>,
    ) -> bool {
        self.gateway
            .subscribers
            .push(crate::state::gateway_status::Subscriber {
                tx,
                event_filter,
                owner_pane_id,
            });
        true
    }
    fn take_subscribe_tx(&mut self) -> Option<std::sync::mpsc::Sender<String>> {
        self.pending_subscribe_tx.take()
    }

    fn toggle_auto_integration(&mut self) {
        self.settings.auto_integration = !self.settings.auto_integration;
        crate::tide_terminal::set_auto_integration(self.settings.auto_integration);
        if self.settings.auto_integration {
            self.queue_notification_permission_request();
        }
        self.ports.persistence.save_settings(&self.settings);
        self.cache.chrome_generation += 1;
    }

    fn detected_agents_mut(
        &mut self,
    ) -> &mut std::collections::HashMap<u64, crate::state::gateway_status::AgentInfo> {
        &mut self.gateway.detected_agents
    }

    fn set_agent_notification_snippet(
        &mut self,
        pane_id: u64,
        notification_snippet: Option<String>,
    ) {
        match notification_snippet {
            Some(snippet) => {
                self.agent_notification_snippets.insert(pane_id, snippet);
            }
            None => {
                self.agent_notification_snippets.remove(&pane_id);
            }
        }
    }

    fn handle_terminal_notification(&mut self, pane_id: u64, message: &str) {
        let mut wrapped_agent_name = None;
        let (event_name, status) = match message {
            "tide:agent-attached" => ("agent-attached", None),
            "tide:agent-detached" => ("agent-detached", None),
            "tide:agent-running" => (
                "agent-running",
                Some(crate::state::gateway_status::AgentStatus::Running),
            ),
            "tide:agent-idle" => (
                "agent-idle",
                Some(crate::state::gateway_status::AgentStatus::Idle),
            ),
            "tide:agent-needs-input" => (
                "agent-needs-input",
                Some(crate::state::gateway_status::AgentStatus::NeedsInput),
            ),
            s if s.starts_with("tide:wrapped-agent:") => {
                let mut parts = s.split(':');
                let _ = parts.next();
                let _ = parts.next();
                let agent_name = parts
                    .next()
                    .and_then(crate::state::gateway_status::wrapped_agent_display_name);
                let parsed_status = match parts.next() {
                    Some("agent-attached") => Some(("agent-attached", None)),
                    Some("agent-detached") => Some(("agent-detached", None)),
                    Some("agent-running") => Some((
                        "agent-running",
                        Some(crate::state::gateway_status::AgentStatus::Running),
                    )),
                    Some("agent-idle") => Some((
                        "agent-idle",
                        Some(crate::state::gateway_status::AgentStatus::Idle),
                    )),
                    Some("agent-needs-input") => Some((
                        "agent-needs-input",
                        Some(crate::state::gateway_status::AgentStatus::NeedsInput),
                    )),
                    _ => None,
                };
                if let (Some(agent_name), Some((event_name, status))) = (agent_name, parsed_status)
                {
                    wrapped_agent_name = Some(agent_name);
                    (event_name, status)
                } else {
                    log::debug!("Unknown tide notification: {}", s);
                    return;
                }
            }
            s if s.starts_with("tide:") => {
                log::debug!("Unknown tide notification: {}", s);
                return;
            }
            _ => return, // Non-tide messages: silently ignore
        };
        if event_name == "agent-detached" {
            let agent_name = self
                .gateway
                .detected_agents
                .get(&pane_id)
                .filter(|agent| agent.wrapper_managed)
                .map(|agent| agent.name)
                .or(wrapped_agent_name);
            self.detach_wrapped_agent(pane_id);
            self.cache.invalidate_chrome();
            if let Some(agent_name) = agent_name {
                self.gateway.notify(
                    "agent-status-changed",
                    serde_json::json!({
                        "pane_id": pane_id,
                        "status": event_name,
                        "agent": agent_name,
                    }),
                );
            }
            return;
        }
        if let Some(agent_name) = wrapped_agent_name {
            if let Some(agent) = self.gateway.detected_agents.get_mut(&pane_id) {
                agent.name = agent_name;
                agent.wrapper_managed = true;
                agent.gateway_connected = true;
                agent.status = status;
            } else if self.panes.contains_key(&pane_id)
                || self
                    .ws
                    .workspaces
                    .iter()
                    .any(|workspace| workspace.panes.contains_key(&pane_id))
            {
                self.gateway.detected_agents.insert(
                    pane_id,
                    crate::state::gateway_status::AgentInfo {
                        name: agent_name,
                        pid: 0,
                        wrapper_managed: true,
                        gateway_connected: true,
                        status,
                    },
                );
            } else {
                return;
            }
        } else if let Some(agent) = self.gateway.detected_agents.get_mut(&pane_id) {
            if !agent.wrapper_managed {
                return;
            }
            agent.gateway_connected = true;
            agent.status = status;
        } else {
            return;
        }
        if matches!(
            status,
            Some(crate::state::gateway_status::AgentStatus::Running)
        ) {
            self.agent_notification_snippets.remove(&pane_id);
            self.pending_completion_notification_panes.remove(&pane_id);
        }
        if self.is_terminal_pane_in_any_workspace(pane_id) {
            self.queue_notification_permission_request_if_auto_integration_enabled();
        }
        self.cache.invalidate_chrome();
        if let Some(agent) = self.gateway.detected_agents.get(&pane_id) {
            self.gateway.notify(
                "agent-status-changed",
                serde_json::json!({
                    "pane_id": pane_id,
                    "status": event_name,
                    "agent": agent.name,
                }),
            );
        }
        // Route notification based on user context (UC-1)
        if let Some(s) = status {
            self.route_agent_notification(pane_id, s, None);
        }
    }

    fn route_agent_notification(
        &mut self,
        pane_id: u64,
        status: crate::state::gateway_status::AgentStatus,
        notification_snippet: Option<String>,
    ) {
        use crate::state::gateway_status::AgentStatus;

        let Some(agent) = self.gateway.detected_agents.get(&pane_id) else {
            return;
        };
        if !agent.wrapper_managed {
            return;
        }
        let agent_name = agent.name;
        let notification_title = self
            .wrapped_agent_notification_title(pane_id)
            .unwrap_or_else(|| format!("Tide - {}", agent_name));

        // Refresh the inactive-Workspace projection for every wrapper-managed status
        // change before deciding whether this transition should emit attention.
        let in_active_workspace = self.panes.contains_key(&pane_id);
        if !in_active_workspace {
            if let Some(workspace_idx) = self.find_workspace_for_pane(pane_id) {
                if workspace_idx != self.ws.active {
                    self.refresh_workspace_agent_notification(workspace_idx);
                }
            }
        }

        let notification_snippet = notification_snippet
            .as_deref()
            .and_then(crate::state::gateway_status::normalize_notification_snippet);

        // BR-1: Running status does not trigger notification routing
        if matches!(status, AgentStatus::Running) {
            self.agent_notification_snippets.remove(&pane_id);
            self.notified_panes.remove(&pane_id);
            self.pending_completion_notification_panes.remove(&pane_id);
            while self.ws.workspace_extras.len() <= self.ws.active {
                self.ws.workspace_extras.push(WorkspaceExtras::new());
            }
            return;
        }

        if matches!(status, AgentStatus::Idle) {
            self.notified_panes.remove(&pane_id);
            if let Some(snippet) = notification_snippet.as_ref() {
                self.agent_notification_snippets
                    .insert(pane_id, snippet.to_string());
                self.pending_completion_notification_panes.insert(pane_id);
            }
            while self.ws.workspace_extras.len() <= self.ws.active {
                self.ws.workspace_extras.push(WorkspaceExtras::new());
            }
            let completion_pending = self
                .pending_completion_notification_panes
                .contains(&pane_id);
            let completion_snippet = if completion_pending {
                notification_snippet
                    .or_else(|| self.agent_notification_snippets.get(&pane_id).cloned())
                    .or_else(|| self.visible_wrapped_agent_notification_snippet(pane_id))
            } else {
                None
            };

            let pane_is_current_focus = self.window.is_focused
                && self.focus.focused == Some(pane_id)
                && if self.is_pane_in_dock(pane_id) {
                    self.focus.focus_area == crate::state::FocusArea::Dock
                } else {
                    self.focus.focus_area == crate::state::FocusArea::Stage
                };

            if pane_is_current_focus {
                self.cache.needs_redraw = true;
                return;
            }

            if self.pending_completion_notification_panes.remove(&pane_id) {
                let body = completion_snippet
                    .or_else(|| self.visible_wrapped_agent_notification_snippet(pane_id))
                    .unwrap_or_else(|| format!("{} finished a turn", agent_name));
                self.pending_platform_commands.push(
                    crate::tide_platform::WindowCommand::SendSystemNotification {
                        title: notification_title,
                        body,
                        pane_id,
                    },
                );
                self.agent_notification_snippets.remove(&pane_id);
            }
            self.cache.needs_redraw = true;
            return;
        }

        let cleared_completion_pending =
            self.pending_completion_notification_panes.remove(&pane_id);
        if cleared_completion_pending && notification_snippet.is_none() {
            self.agent_notification_snippets.remove(&pane_id);
        }

        let notification_snippet = notification_snippet
            .or_else(|| self.agent_notification_snippets.get(&pane_id).cloned())
            .or_else(|| self.visible_wrapped_agent_notification_snippet(pane_id));

        if let Some(snippet) = notification_snippet.as_ref() {
            self.agent_notification_snippets
                .insert(pane_id, snippet.clone());
        }

        let pane_is_current_focus = self.window.is_focused
            && self.focus.focused == Some(pane_id)
            && if self.is_pane_in_dock(pane_id) {
                self.focus.focus_area == crate::state::FocusArea::Dock
            } else {
                self.focus.focus_area == crate::state::FocusArea::Stage
            };

        if pane_is_current_focus {
            return;
        }

        // Background notifications are sent whenever the wrapped-agent Terminal
        // is not the current UI focus, or whenever the Tide window is blurred.
        if !self.notified_panes.contains(&pane_id) {
            let body = notification_snippet.unwrap_or_else(|| match status {
                AgentStatus::NeedsInput => format!("{} needs your input", agent_name),
                _ => unreachable!(),
            });
            self.pending_platform_commands.push(
                crate::tide_platform::WindowCommand::SendSystemNotification {
                    title: notification_title,
                    body,
                    pane_id,
                },
            );
            if matches!(status, AgentStatus::NeedsInput) {
                self.pending_platform_commands
                    .push(crate::tide_platform::WindowCommand::RequestUserAttention);
            }
            self.notified_panes.insert(pane_id);
        }

        self.cache.needs_redraw = true;
    }
}

impl App {
    fn wrapped_agent_notification_title(&self, pane_id: PaneId) -> Option<String> {
        if self.panes.contains_key(&pane_id) {
            return Some(format!(
                "Tide - {}",
                crate::ui::pane_title(&self.panes, pane_id)
            ));
        }

        self.ws.workspaces.iter().find_map(|workspace| {
            workspace.panes.contains_key(&pane_id).then(|| {
                format!(
                    "Tide - {}",
                    crate::ui::pane_title(&workspace.panes, pane_id)
                )
            })
        })
    }

    fn visible_wrapped_agent_notification_snippet(&self, pane_id: PaneId) -> Option<String> {
        let pane = self.panes.get(&pane_id).or_else(|| {
            self.ws
                .workspaces
                .iter()
                .find_map(|workspace| workspace.panes.get(&pane_id))
        })?;
        let PaneKind::Terminal(terminal) = pane else {
            return None;
        };

        let lines: Vec<String> = terminal
            .backend
            .grid()
            .cells
            .iter()
            .filter_map(|row| {
                let raw = row.iter().map(|cell| cell.character).collect::<String>();
                crate::state::gateway_status::normalize_notification_snippet(raw.trim_end())
            })
            .collect();

        lines
            .iter()
            .rev()
            .find(|line| line.starts_with('•') || line.starts_with("- ") || line.starts_with("* "))
            .cloned()
            .or_else(|| {
                lines
                    .iter()
                    .rev()
                    .find(|line| !looks_like_terminal_notification_noise(line))
                    .cloned()
            })
            .or_else(|| lines.last().cloned())
    }
}

fn looks_like_terminal_notification_noise(line: &str) -> bool {
    line.starts_with("Tip:") || line.starts_with("model:") || line.starts_with("directory:")
}

// ── PaneAccessPort ──

impl crate::application::ports::inward::PaneAccessPort for App {
    fn pane(&self, id: PaneId) -> Option<&PaneKind> {
        self.panes.get(&id)
    }
    fn pane_mut(&mut self, id: PaneId) -> Option<&mut PaneKind> {
        self.panes.get_mut(&id)
    }
    fn has_pane(&self, id: PaneId) -> bool {
        self.panes.contains_key(&id)
    }
    fn has_pane_in_any_workspace(&self, id: PaneId) -> bool {
        if self.panes.contains_key(&id) {
            return true;
        }
        self.ws
            .workspaces
            .iter()
            .any(|ws| ws.panes.contains_key(&id))
    }
    fn pane_entries(&self) -> Vec<(PaneId, &PaneKind)> {
        self.panes.iter().map(|(&id, pane)| (id, pane)).collect()
    }
    fn pane_title(&self, id: PaneId) -> String {
        crate::ui::pane_title(&self.panes, id)
    }
    fn clear_all_selections(&mut self) {
        for (_, pane) in self.panes.iter_mut() {
            match pane {
                PaneKind::Terminal(p) => p.selection = None,
                PaneKind::Editor(p) => p.selection = None,
                PaneKind::Diff(p) => p.selection = None,
                PaneKind::Browser(_) | PaneKind::Launcher(_) => {}
            }
        }
    }

    fn has_terminals(&self) -> bool {
        self.panes
            .values()
            .any(|pk| matches!(pk, PaneKind::Terminal(_)))
    }

    fn has_dirty_editors(&self) -> bool {
        self.panes.values().any(|pk| {
            if let PaneKind::Editor(ep) = pk {
                ep.editor.is_modified() && ep.editor.file_path().is_some()
            } else {
                false
            }
        })
    }

    fn reset_browser_first_responder_flags(&mut self) {
        for pane in self.panes.values_mut() {
            if let PaneKind::Browser(bp) = pane {
                bp.is_first_responder = false;
            }
        }
    }
}

// ── ImeStatePort ──

impl crate::application::ports::inward::ImeStatePort for App {
    fn ime_clear_composition(&mut self) {
        self.ime.clear_composition();
    }
    fn ime_set_preedit(&mut self, text: &str) {
        self.ime.set_preedit(text);
    }
    fn effective_ime_target(&self) -> Option<PaneId> {
        self.effective_ime_target()
    }
    fn send_text_to_target(&mut self, text: &str) {
        self.send_text_to_target(text);
    }
    fn set_ime_cursor_dirty(&mut self) {
        self.ime.cursor_dirty = true;
    }
    fn reset_cursor_blink(&mut self) {
        self.timing.cursor_blink_at = self.ports.clock.now();
        self.timing.cursor_visible = true;
    }
    fn drain_pending_creates(&mut self) -> Vec<PaneId> {
        self.ime.pending_creates.drain(..).collect()
    }
    fn drain_pending_removes(&mut self) -> Vec<PaneId> {
        self.ime.pending_removes.drain(..).collect()
    }
    fn ime_last_target(&self) -> Option<PaneId> {
        self.ime.last_target
    }
    fn set_ime_last_target(&mut self, target: Option<PaneId>) {
        self.ime.last_target = target;
    }
    fn ime_preedit(&self) -> &str {
        &self.ime.preedit
    }
    fn ime_composing(&self) -> bool {
        self.ime.composing
    }
    fn clear_ime_preedit(&mut self) {
        self.ime.preedit.clear();
    }
    fn set_ime_composing(&mut self, composing: bool) {
        self.ime.composing = composing;
    }
}
