// FocusArea, FocusState, ViewMode, LayoutSide

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FocusArea {
    FileTree,
    Stage,
    Dock,
}

impl Default for FocusArea {
    fn default() -> Self {
        FocusArea::Stage
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ViewMode {
    Split,
    Stacked,
}

impl Default for ViewMode {
    fn default() -> Self {
        ViewMode::Split
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LayoutSide {
    Left,
    Right,
}

/// Focus tracking — which pane/area has keyboard focus.
pub(crate) struct FocusState {
    pub focused: Option<crate::tide_core::PaneId>,
    pub focus_area: FocusArea,
    pub stage_focused: Option<crate::tide_core::PaneId>,
    pub zoomed_pane: Option<crate::tide_core::PaneId>,
    pub search_focus: Option<crate::tide_core::PaneId>,
}

impl FocusState {
    pub fn new() -> Self {
        Self { focused: None, focus_area: FocusArea::Stage, stage_focused: None, zoomed_pane: None, search_focus: None }
    }
}
