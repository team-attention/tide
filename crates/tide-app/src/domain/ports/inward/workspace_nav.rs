// WorkspaceNavPort — workspace, focus area, config, and stacked layout management.
// Source: domain/action/workspace.rs

use tide_core::PaneId;
use tide_input::AreaSlot;

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
    fn handle_navigate(&mut self, direction: tide_input::Direction);
    fn cycle_tab(&mut self, direction: i32);
    fn navigate_panes(&mut self, direction: i32);
}
