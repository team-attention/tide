// ClockPort — abstracts time for testability.

use std::time::Instant;

pub(crate) trait ClockPort {
    fn now(&self) -> Instant;
}
