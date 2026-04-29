// DockState — dock layout state.

use super::focus::ViewMode;
use super::SurfaceVisibilityAnimation;
use crate::theme::TERMINAL_CONTEXT_SURFACE_WIDTH;

pub(crate) struct DockState {
    pub terminal_view_mode: ViewMode,
    pub dock_open: bool,
    pub dock_width: f32,
    pub visibility_animation: Option<SurfaceVisibilityAnimation>,
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
        Self {
            terminal_view_mode: ViewMode::Split,
            dock_open: false,
            dock_width: TERMINAL_CONTEXT_SURFACE_WIDTH,
            visibility_animation: None,
            dock_border_dragging: false,
            dock_split_dragging: false,
            pinned_dock_layout: crate::tide_layout::SplitLayout::new(),
            pinned_dock_ratio: 0.5,
            pinned_border_dragging: false,
            dock_zoomed: true,
        }
    }

    pub fn has_pinned_panes(&self) -> bool {
        !self.pinned_dock_layout.all_pane_ids().is_empty()
    }

    pub fn is_pane_pinned(&self, pane_id: crate::tide_core::PaneId) -> bool {
        self.pinned_dock_layout.all_pane_ids().contains(&pane_id)
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
            .unwrap_or_else(|| if self.dock_open { self.dock_width } else { 0.0 })
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
        self.dock_open || self.visibility_animation.is_some()
    }
}
