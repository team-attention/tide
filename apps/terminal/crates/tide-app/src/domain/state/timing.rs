// TimingState — timing/scheduling state.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RuntimeDeadlineKind {
    CursorBlink,
    SessionAutosave,
    DeferredResize,
    AnimationFrame,
    RenderCoalescing,
    FileTreeDebounce,
    RepositoryDebounce,
    AgentObservation,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RuntimeDeadline {
    pub kind: RuntimeDeadlineKind,
    pub at: std::time::Instant,
}

pub(crate) struct TimingState {
    pub last_frame: std::time::Instant,
    pub resize_deferred_at: Option<std::time::Instant>,
    pub last_live_terminal_resize_at: Option<std::time::Instant>,
    pub cursor_blink_at: std::time::Instant,
    pub cursor_visible: bool,
    pub last_session_save: std::time::Instant,
    pub last_cwd: Option<std::path::PathBuf>,
    pub repository_refresh_at: Option<std::time::Instant>,
    pub pending_agent_observations:
        std::collections::HashMap<crate::tide_core::PaneId, std::time::Instant>,
    pub waiting_for_renderer: bool,
}

impl TimingState {
    pub fn new() -> Self {
        let now = std::time::Instant::now();
        Self {
            last_frame: now,
            resize_deferred_at: None,
            last_live_terminal_resize_at: None,
            cursor_blink_at: now,
            cursor_visible: true,
            last_session_save: now,
            last_cwd: None,
            repository_refresh_at: None,
            pending_agent_observations: std::collections::HashMap::new(),
            waiting_for_renderer: false,
        }
    }
}
