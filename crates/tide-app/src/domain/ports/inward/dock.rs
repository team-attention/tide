// DockPort — dock layout and terminal management.
// Source: domain/action/dock.rs

use crate::tide_core::{PaneId, SplitDirection};

pub(crate) trait DockPort {
    fn focused_terminal_id(&self) -> Option<PaneId>;
    fn terminal_owning(&self, pane_id: PaneId) -> Option<PaneId>;
    fn is_pane_in_dock(&self, pane_id: PaneId) -> bool;
    fn is_pane_pinned(&self, pane_id: PaneId) -> bool;
    fn has_pinned_panes(&self) -> bool;
    fn add_pane_to_dock(&mut self, new_pane_id: PaneId);
    fn toggle_dock(&mut self);
    fn remove_pane_from_dock(&mut self, pane_id: PaneId);
    fn cascade_close_terminal(&mut self, terminal_id: PaneId);
    fn ensure_dock_placeholder(&mut self);
    fn dock_launcher_id(&self) -> Option<PaneId>;
    fn dock_split_new_tab_group(&mut self, direction: SplitDirection);
    fn swap_dock_state(&mut self, incoming_terminal: PaneId);
    fn toggle_dock_pin(&mut self);
}
