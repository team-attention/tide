// WorkspaceNavPort — workspace, focus area, config, and stacked layout management.
// Source: domain/action/workspace.rs

use crate::tide_core::PaneId;
use crate::tide_input::AreaSlot;

use crate::state::FocusArea;

pub(crate) trait WorkspaceNavPort {
    fn focus_terminal(&mut self, id: PaneId);
    fn handle_focus_area(&mut self, target: FocusArea);
    fn toggle_file_tree_visibility(&mut self);
    fn toggle_dock_visibility(&mut self);
    fn handle_toggle_stacked(&mut self);
    fn reorder_stacked_tab(&mut self, source: PaneId, target: PaneId);
    fn toggle_config_page(&mut self);
    fn close_config_page(&mut self);
    fn resolve_slot(&self, slot: AreaSlot) -> FocusArea;
    fn handle_navigate(&mut self, direction: crate::tide_input::Direction);
    fn cycle_tab(&mut self, direction: i32);
    fn navigate_panes(&mut self, direction: i32);

    // ── Workspace state queries (click_adapter) ──
    fn ws_sidebar_rect(&self) -> Option<crate::tide_core::Rect>;
    fn ws_workspaces_len(&self) -> usize;
    fn ws_sidebar_geometry(&self) -> Option<crate::state::drag_types::WsSidebarGeometry>;
    fn move_pane_to_workspace(&mut self, pane_id: crate::tide_core::PaneId, target_idx: usize);

    // ── Workspace drag & state (mouse_adapter) ──
    fn ws_drag(&self) -> Option<(usize, f32, usize)>;
    fn ws_set_drag(&mut self, drag: Option<(usize, f32, usize)>);
    fn ws_take_drag(&mut self) -> Option<(usize, f32, usize)>;
    fn ws_border_dragging(&self) -> bool;
    fn set_ws_border_dragging(&mut self, v: bool);
    fn ws_set_width(&mut self, w: f32);
    fn ws_active(&self) -> usize;
    fn ws_show_sidebar(&self) -> bool;
    fn set_ws_show_sidebar(&mut self, v: bool);
    fn new_workspace(&mut self);
    fn switch_workspace(&mut self, idx: usize);
    fn activate_notification_target(&mut self, pane_id: PaneId);
    fn ws_reorder(&mut self, src: usize, target: usize);
    fn workspace_sidebar_item_rect(&self, idx: usize) -> Option<crate::tide_core::Rect>;
}
