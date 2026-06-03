// TimingState — timing/scheduling state.

pub(crate) struct TimingState {
    pub last_frame: std::time::Instant,
    pub wrapped_agent_blink_at: std::time::Instant,
    pub last_child_check: std::time::Instant,
    pub resize_deferred_at: Option<std::time::Instant>,
    pub last_live_terminal_resize_at: Option<std::time::Instant>,
    pub badge_check_at: Option<std::time::Instant>,
    pub cursor_blink_at: std::time::Instant,
    pub cursor_visible: bool,
    pub last_session_save: std::time::Instant,
    pub last_cwd: Option<std::path::PathBuf>,
}

impl TimingState {
    pub fn new() -> Self {
        let now = std::time::Instant::now();
        Self {
            last_frame: now,
            wrapped_agent_blink_at: now,
            last_child_check: now,
            resize_deferred_at: None,
            last_live_terminal_resize_at: None,
            badge_check_at: None,
            cursor_blink_at: now,
            cursor_visible: true,
            last_session_save: now,
            last_cwd: None,
        }
    }
}
