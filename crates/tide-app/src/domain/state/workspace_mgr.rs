// WorkspaceManager — workspace management state.

use super::SurfaceVisibilityAnimation;
use crate::tide_core::Rect;

pub(crate) struct WorkspaceManager {
    pub workspaces: Vec<crate::Workspace>,
    pub workspace_extras: Vec<crate::WorkspaceExtras>,
    pub workspace_context_artifacts: Vec<crate::ContextArtifactStore>,
    pub active: usize,
    pub show_sidebar: bool,
    pub visibility_animation: Option<SurfaceVisibilityAnimation>,
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
            workspace_context_artifacts: Vec::new(),
            active: 0,
            show_sidebar: false,
            visibility_animation: None,
            sidebar_rect: None,
            width: crate::theme::WORKSPACE_SIDEBAR_WIDTH,
            border_dragging: false,
            drag: None,
        }
    }

    pub(crate) fn begin_visibility_animation(
        &mut self,
        from_width: f32,
        to_width: f32,
        now: std::time::Instant,
    ) {
        self.visibility_animation =
            Some(SurfaceVisibilityAnimation::new(from_width, to_width, now));
    }

    pub(crate) fn rendered_width(&self, now: std::time::Instant) -> f32 {
        self.visibility_animation
            .map(|animation| animation.width_at(now))
            .unwrap_or_else(|| if self.show_sidebar { self.width } else { 0.0 })
    }

    pub(crate) fn finish_visibility_animation_if_complete(&mut self, now: std::time::Instant) {
        if self
            .visibility_animation
            .is_some_and(|animation| animation.is_complete_at(now))
        {
            self.visibility_animation = None;
        }
    }

    pub(crate) fn visible_for_layout(&self) -> bool {
        self.show_sidebar || self.visibility_animation.is_some()
    }
}
