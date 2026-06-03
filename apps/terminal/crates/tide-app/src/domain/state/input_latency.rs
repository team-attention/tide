// InputLatencyState — input latency tracking.

pub(crate) struct InputLatencyState {
    pub input_just_sent: bool,
    pub input_sent_at: Option<std::time::Instant>,
    pub scroll_at: Option<std::time::Instant>,
    pub batch_depth: u32,
    pub last_shift_up: Option<std::time::Instant>,
    pub shift_tap_clean: bool,
}

impl InputLatencyState {
    pub fn new() -> Self {
        Self {
            input_just_sent: false,
            input_sent_at: None,
            scroll_at: None,
            batch_depth: 0,
            last_shift_up: None,
            shift_tap_clean: false,
        }
    }
}
