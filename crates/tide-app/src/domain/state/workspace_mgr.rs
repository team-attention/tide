// WorkspaceManager — workspace management state.

use tide_core::Rect;

pub(crate) struct WorkspaceManager {
    pub workspaces: Vec<crate::Workspace>,
    pub workspace_extras: Vec<crate::WorkspaceExtras>,
    pub active: usize,
    pub show_sidebar: bool,
    pub sidebar_rect: Option<Rect>,
    pub width: f32,
    pub border_dragging: bool,
    pub drag: Option<(usize, f32, usize)>,
}

impl WorkspaceManager {
    pub fn new() -> Self {
        Self {
            workspaces: Vec::new(),
            workspace_extras: Vec::new(),
            active: 0,
            show_sidebar: false,
            sidebar_rect: None,
            width: crate::theme::WORKSPACE_SIDEBAR_WIDTH,
            border_dragging: false,
            drag: None,
        }
    }
}
