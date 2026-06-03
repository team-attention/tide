// SurfaceVisibilityAnimation — pure width animation state for side surfaces.

use std::time::{Duration, Instant};

use crate::tide_core::PaneId;

pub(crate) const SURFACE_VISIBILITY_ANIMATION_DURATION: Duration = Duration::from_millis(240);
pub(crate) const SPLIT_TRANSITION_ANIMATION_DURATION: Duration = Duration::from_millis(180);
pub(crate) const SPLIT_TRANSITION_INITIAL_RATIO: f32 = 0.9;
pub(crate) const SPLIT_TRANSITION_SETTLED_RATIO: f32 = 0.5;

#[cfg_attr(test, derive(Debug))]
#[derive(Clone, Copy)]
pub(crate) struct SurfaceVisibilityAnimation {
    from_width: f32,
    to_width: f32,
    started_at: Instant,
    duration: Duration,
}

impl SurfaceVisibilityAnimation {
    pub(crate) fn new(from_width: f32, to_width: f32, started_at: Instant) -> Self {
        Self {
            from_width,
            to_width,
            started_at,
            duration: SURFACE_VISIBILITY_ANIMATION_DURATION,
        }
    }

    pub(crate) fn width_at(&self, now: Instant) -> f32 {
        let elapsed = now.saturating_duration_since(self.started_at);
        if elapsed >= self.duration {
            return self.to_width;
        }
        let t = elapsed.as_secs_f32() / self.duration.as_secs_f32();
        let eased = ease_out_cubic(t.clamp(0.0, 1.0));
        self.from_width + (self.to_width - self.from_width) * eased
    }

    pub(crate) fn is_complete_at(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.started_at) >= self.duration
    }
}

fn ease_out_cubic(t: f32) -> f32 {
    1.0 - (1.0 - t).powi(3)
}

#[cfg_attr(test, derive(Debug))]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum SplitTransitionScope {
    Stage,
    TerminalContextSurface { terminal_id: PaneId },
}

#[cfg_attr(test, derive(Debug))]
#[derive(Clone, Copy)]
pub(crate) enum SplitTransitionKind {
    Opening,
    Closing,
}

#[cfg_attr(test, derive(Debug))]
#[derive(Clone, Copy)]
pub(crate) struct SplitTransitionAnimation {
    pub scope: SplitTransitionScope,
    pub pane_id: PaneId,
    kind: SplitTransitionKind,
    from_ratio: f32,
    to_ratio: f32,
    started_at: Instant,
    duration: Duration,
}

impl SplitTransitionAnimation {
    pub(crate) fn new_trailing_pane(
        scope: SplitTransitionScope,
        pane_id: PaneId,
        started_at: Instant,
    ) -> Self {
        Self {
            scope,
            pane_id,
            kind: SplitTransitionKind::Opening,
            from_ratio: SPLIT_TRANSITION_INITIAL_RATIO,
            to_ratio: SPLIT_TRANSITION_SETTLED_RATIO,
            started_at,
            duration: SPLIT_TRANSITION_ANIMATION_DURATION,
        }
    }

    pub(crate) fn new_closing_pane(
        scope: SplitTransitionScope,
        pane_id: PaneId,
        from_ratio: f32,
        to_ratio: f32,
        started_at: Instant,
    ) -> Self {
        Self {
            scope,
            pane_id,
            kind: SplitTransitionKind::Closing,
            from_ratio,
            to_ratio,
            started_at,
            duration: SPLIT_TRANSITION_ANIMATION_DURATION,
        }
    }

    pub(crate) fn is_closing(&self) -> bool {
        matches!(self.kind, SplitTransitionKind::Closing)
    }

    pub(crate) fn ratio_at(&self, now: Instant) -> f32 {
        let elapsed = now.saturating_duration_since(self.started_at);
        if elapsed >= self.duration {
            return self.to_ratio;
        }
        let t = elapsed.as_secs_f32() / self.duration.as_secs_f32();
        let eased = ease_out_cubic(t.clamp(0.0, 1.0));
        self.from_ratio + (self.to_ratio - self.from_ratio) * eased
    }

    pub(crate) fn is_complete_at(&self, now: Instant) -> bool {
        now.saturating_duration_since(self.started_at) >= self.duration
    }
}
