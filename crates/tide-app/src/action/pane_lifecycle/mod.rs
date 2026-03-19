mod create;
mod close;

use crate::App;

/// Launcher type selection choices.
pub(crate) enum LauncherChoice {
    Terminal,
    NewFile,
    OpenFile,
    Browser,
}

impl App {
    /// Add a pane to the right of the focused pane.
    /// Splits the focused pane horizontally.
    fn add_pane_to_right(&mut self, focused: tide_core::PaneId, new_id: tide_core::PaneId) {
        self.layout.insert_pane(focused, new_id, tide_core::SplitDirection::Horizontal, false);
    }

    /// Route a non-terminal pane next to the correct pane.
    /// If focused is a terminal → add to right (split horizontally).
    /// If focused is non-terminal → add as vertical split next to the same pane.
    fn add_to_non_terminal_group(&mut self, focused: tide_core::PaneId, new_id: tide_core::PaneId) {
        if matches!(self.panes.get(&focused), Some(crate::pane::PaneKind::Terminal(_))) {
            self.add_pane_to_right(focused, new_id);
        } else {
            self.layout.insert_pane(focused, new_id, tide_core::SplitDirection::Vertical, false);
        }
    }
}
