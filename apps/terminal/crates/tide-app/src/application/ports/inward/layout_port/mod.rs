// LayoutPort — layout computation, hit testing, and geometry queries.
// Source: layout_compute.rs

use crate::tide_core::{PaneId, Vec2};

pub(crate) trait LayoutPort {
    fn compute_layout(&mut self);
    fn sync_browser_webview_frames(&mut self);
    fn layout_snapshot(&self) -> Option<crate::tide_layout::LayoutSnapshot>;
    fn layout_set_split_ratio(&mut self, pane_id: u64, ratio: f32) -> bool;
    fn update_cursor_icon(&self, window: &crate::tide_platform::WindowProxy);
    fn file_finder_item_at(&self, pos: Vec2) -> Option<usize>;
    fn git_switcher_item_at(&self, pos: Vec2) -> Option<usize>;
    fn git_switcher_contains(&self, pos: Vec2) -> bool;
    fn git_switcher_button_at(&self, pos: Vec2) -> Option<crate::SwitcherButton>;
    fn file_finder_contains(&self, pos: Vec2) -> bool;
    fn save_as_contains(&self, pos: Vec2) -> bool;
    fn context_menu_item_at(&self, pos: Vec2) -> Option<usize>;
    fn palette(&self) -> &'static crate::theme::ThemePalette;

    // ── Layout tree manipulation (click_adapter) ──
    fn layout_remove(&mut self, id: PaneId);
    fn layout_insert_at_root(&mut self, id: PaneId, zone: crate::tide_core::DropZone);
    fn layout_insert_pane(
        &mut self,
        target: PaneId,
        source: PaneId,
        direction: crate::tide_core::SplitDirection,
        insert_first: bool,
    );
    fn layout_swap_panes(&mut self, a: PaneId, b: PaneId) -> bool;

    // ── Hit-test helpers (from drag_drop_adapter, used by click_adapter) ──
    fn pane_at_tab_bar(&self, pos: Vec2) -> Option<PaneId>;
    fn pane_tab_close_at(&self, pos: Vec2) -> Option<PaneId>;
    fn pane_maximize_at(&self, pos: Vec2) -> Option<PaneId>;

    // ── Drag helpers (mouse_adapter) ──
    fn layout_end_drag(&mut self);
    fn layout_drag_border(&mut self, pos: Vec2);
    fn router_is_dragging_border(&self) -> bool;
    fn router_end_drag(&mut self);
    fn compute_drop_destination(
        &self,
        mouse: Vec2,
        source: PaneId,
    ) -> Option<crate::state::drag_types::DropDestination>;
    fn compute_drop_preview_rect(
        &self,
        source: PaneId,
        target: &Option<crate::state::drag_types::DropDestination>,
    ) -> Option<crate::tide_core::Rect>;
    fn layout_simulate_drop(
        &self,
        source: PaneId,
        target: Option<PaneId>,
        zone: crate::tide_core::DropZone,
        source_in_tree: bool,
        window_size: crate::tide_core::Size,
    ) -> Option<crate::tide_core::Rect>;
}
