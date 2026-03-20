// DockState — dock layout state.

use super::focus::ViewMode;

pub(crate) struct DockState {
    pub terminal_view_mode: ViewMode,
    pub dock_open: bool,
    pub dock_width: f32,
    pub dock_border_dragging: bool,
    pub dock_split_dragging: bool,
    pub pinned_dock_layout: crate::tide_layout::SplitLayout,
    pub pinned_dock_ratio: f32,
    pub pinned_border_dragging: bool,
    /// Whether the Dock is in zoomed (stacked) mode — global, not per-terminal.
    pub dock_zoomed: bool,
}

impl DockState {
    pub fn new() -> Self {
        Self { terminal_view_mode: ViewMode::Split, dock_open: false, dock_width: 400.0, dock_border_dragging: false, dock_split_dragging: false, pinned_dock_layout: crate::tide_layout::SplitLayout::new(), pinned_dock_ratio: 0.5, pinned_border_dragging: false, dock_zoomed: false }
    }

    pub fn has_pinned_panes(&self) -> bool {
        !self.pinned_dock_layout.all_pane_ids().is_empty()
    }

    pub fn is_pane_pinned(&self, pane_id: crate::tide_core::PaneId) -> bool {
        self.pinned_dock_layout.all_pane_ids().contains(&pane_id)
    }
}
