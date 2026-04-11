// AppCorePort — core App helpers: sizing, font, dock zoom, cache invalidation, geometry queries.
// Source: app.rs

use crate::header::HeaderHitZone;
use crate::tide_core::{PaneId, Rect, Size};

pub(crate) trait AppCorePort {
    // ── Sizing ──
    fn dock_zoomed_pane(&self) -> Option<PaneId>;
    fn logical_size(&self) -> Size;
    fn cell_size(&self) -> Size;
    fn apply_font_size(&mut self, size: f32);
    fn flush_pending_font_size(&mut self);

    // ── Cache invalidation (adapters call these; implementation handles internals) ──
    fn invalidate_chrome(&mut self);
    fn invalidate_pane(&mut self, id: PaneId);
    fn invalidate_all_panes(&mut self);
    fn request_redraw(&mut self);
    fn queue_show_window(&mut self);
    fn sync_file_tree_modified_editor_cache(&mut self);

    // ── State queries ──
    fn has_renderer(&self) -> bool;
    fn top_inset(&self) -> f32;
    fn sidebar_side(&self) -> crate::LayoutSide;
    fn gateway_listening(&self) -> bool;
    /// Returns (connected_agents, total_agents) for gateway badge sizing.
    fn gateway_agent_counts(&self) -> (usize, usize);

    // ── Header hit zones ──
    fn header_hit_zones(&self) -> Vec<HeaderHitZone>;

    // ── Outward port delegates ──
    fn read_file_to_string(&self, path: &std::path::Path) -> Result<String, String>;
    fn git_list_branches(
        &self,
        cwd: &std::path::Path,
    ) -> Vec<crate::tide_terminal::git::BranchInfo>;
    fn git_list_worktrees(
        &self,
        cwd: &std::path::Path,
    ) -> Vec<crate::tide_terminal::git::WorktreeInfo>;
    fn git_repo_root(&self, cwd: &std::path::Path) -> Option<std::path::PathBuf>;
    fn git_branch_exists(&self, cwd: &std::path::Path, name: &str) -> bool;
    fn git_add_worktree(
        &self,
        cwd: &std::path::Path,
        path: &std::path::Path,
        branch: &str,
        new_branch: bool,
    ) -> Result<(), String>;
    fn git_remove_worktree(
        &self,
        cwd: &std::path::Path,
        path: &std::path::Path,
        force: bool,
    ) -> Result<(), String>;
    fn git_delete_branch(
        &self,
        cwd: &std::path::Path,
        name: &str,
        force: bool,
    ) -> Result<(), String>;
    fn persistence_load_settings(&self) -> crate::state::settings::TideSettings;

    // ── Geometry queries ──
    fn visual_pane_rects(&self) -> &[(PaneId, Rect)];
    fn pane_rects(&self) -> &[(PaneId, Rect)];
    fn pane_area_rect(&self) -> Option<Rect>;
    fn dock_area_rect(&self) -> Option<Rect>;
    fn shared_tab_max_scroll(&self, pane_id: PaneId) -> Option<f32>;

    // ── Sidebar handle drag (mouse_adapter) ──
    fn sidebar_handle_dragging(&self) -> bool;
    fn set_sidebar_handle_dragging(&mut self, v: bool);
    fn set_sidebar_side(&mut self, side: crate::LayoutSide);

    // ── Window state (event_loop_adapter) ──
    fn window_size(&self) -> (u32, u32);
    fn set_window_size(&mut self, width: u32, height: u32);
    fn scale_factor(&self) -> f32;
    fn set_scale_factor(&mut self, scale: f32);
    fn is_fullscreen(&self) -> bool;
    fn set_fullscreen_state(&mut self, is_fullscreen: bool);
    fn is_occluded(&self) -> bool;
    fn set_occluded(&mut self, occluded: bool);
    fn pending_fullscreen_toggle(&self) -> bool;
    fn clear_pending_fullscreen_toggle(&mut self);
    fn set_top_inset(&mut self, inset: f32);
    fn reconfigure_surface(&mut self);
    fn clock_now(&self) -> std::time::Instant;
    fn is_window_focused(&self) -> bool;
    fn set_window_focused(&mut self, focused: bool);
    fn save_full_session(&mut self);
    fn delete_running_marker(&mut self);

    // ── Deferred resize (event_loop_adapter) ──
    fn set_resize_deferred(&mut self, millis: u64);
    fn clear_resize_deferred(&mut self);
}
