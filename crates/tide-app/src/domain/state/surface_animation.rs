// SurfaceVisibilityAnimation — pure width animation state for side surfaces.

use std::time::{Duration, Instant};

pub(crate) const SURFACE_VISIBILITY_ANIMATION_DURATION: Duration = Duration::from_millis(240);

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
