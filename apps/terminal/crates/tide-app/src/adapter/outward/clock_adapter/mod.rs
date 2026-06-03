// Clock adapter implementations.

use crate::application::ports::outward::clock_port::ClockPort;
use std::time::Instant;

/// Real clock implementation using std::time::Instant.
pub(crate) struct SystemClock;

impl ClockPort for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Fixed clock for tests — always returns the same instant.
pub(crate) struct FixedClock {
    pub instant: Instant,
}

impl ClockPort for FixedClock {
    fn now(&self) -> Instant {
        self.instant
    }
}
