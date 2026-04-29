// DockPort — dock layout and terminal management.
// Source: domain/action/dock.rs

use crate::tide_core::{PaneId, SplitDirection};

pub(crate) trait DockPort {
    fn focused_terminal_id(&self) -> Option<PaneId>;
    fn terminal_owning(&self, pane_id: PaneId) -> Option<PaneId>;
    fn is_pane_in_dock(&self, pane_id: PaneId) -> bool;
    fn is_pane_pinned(&self, pane_id: PaneId) -> bool;
    fn has_pinned_panes(&self) -> bool;
    fn add_pane_to_dock(&mut self, new_pane_id: PaneId, target_terminal: Option<PaneId>);
    fn toggle_dock(&mut self);
    fn remove_pane_from_dock(&mut self, pane_id: PaneId);
    fn cascade_close_terminal(&mut self, terminal_id: PaneId);
    fn ensure_dock_placeholder(&mut self);
    fn dock_launcher_id(&self) -> Option<PaneId>;
    fn dock_split_new_tab_group(&mut self, direction: SplitDirection);
    fn swap_dock_state(&mut self, incoming_terminal: PaneId);
    fn toggle_dock_pin(&mut self);

    // ── Dock state queries/mutations (click_adapter) ──
    fn dock_zoomed(&self) -> bool;
    fn set_dock_zoomed(&mut self, zoomed: bool);
    fn dock_open(&self) -> bool;
    fn associated_terminal(&self, id: PaneId) -> Option<PaneId>;
    fn set_associated_terminal(&mut self, pane: PaneId, terminal: PaneId);

    // ── Dock layout manipulation (for handle_drop) ──
    fn dock_layout_insert_at_root(
        &mut self,
        terminal_id: PaneId,
        source: PaneId,
        zone: crate::tide_core::DropZone,
    );
    fn dock_layout_set_focused(&mut self, terminal_id: PaneId, pane_id: PaneId);
    fn dock_layout_set_active_tab(&mut self, terminal_id: PaneId, pane_id: PaneId);
    fn dock_layout_remove(&mut self, terminal_id: PaneId, pane_id: PaneId);
    fn dock_layout_set_split_ratio(
        &mut self,
        terminal_id: PaneId,
        pane_id: PaneId,
        ratio: f32,
    ) -> bool;
    fn dock_layout_split_with_leaf_group(
        &mut self,
        terminal_id: PaneId,
        target: PaneId,
        source: PaneId,
        direction: SplitDirection,
        insert_first: bool,
    );
    fn dock_layout_swap_panes(&mut self, terminal_id: PaneId, a: PaneId, b: PaneId) -> bool;
    fn dock_layout_tab_group_sibling(&self, terminal_id: PaneId, pane_id: PaneId)
        -> Option<PaneId>;
    fn dock_tab_group_contains_multiple(&self, pane_id: PaneId) -> bool;

    // ── Dock drag state (mouse_adapter) ──
    fn dock_border_dragging(&self) -> bool;
    fn set_dock_border_dragging(&mut self, v: bool);
    fn dock_split_dragging(&self) -> bool;
    fn set_dock_split_dragging(&mut self, v: bool);
    fn set_dock_width(&mut self, w: f32);
    fn animate_dock_width(&mut self, w: f32) -> f32;
    fn dock_begin_split_drag(
        &mut self,
        local_pos: crate::tide_core::Vec2,
        dock_size: crate::tide_core::Size,
    ) -> bool;
    fn dock_drag_split_border(&mut self, local_pos: crate::tide_core::Vec2);
    fn dock_end_split_drag(&mut self);
}
