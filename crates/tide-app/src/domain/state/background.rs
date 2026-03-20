// BackgroundServices — git poll, event loop waker.

pub(crate) struct BackgroundServices {
    pub event_loop_waker: Option<crate::tide_platform::WakeCallback>,
    pub git_poll_rx: Option<std::sync::mpsc::Receiver<crate::update::file_tree::GitPollResults>>,
    pub git_poll_cwd_tx: Option<std::sync::mpsc::Sender<Vec<std::path::PathBuf>>>,
    pub git_poll_handle: Option<std::thread::JoinHandle<()>>,
    pub git_poll_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub cached_repo_roots: std::collections::HashMap<std::path::PathBuf, Option<std::path::PathBuf>>,
}

impl BackgroundServices {
    pub fn new() -> Self {
        Self {
            event_loop_waker: None,
            git_poll_rx: None,
            git_poll_cwd_tx: None,
            git_poll_handle: None,
            git_poll_stop: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cached_repo_roots: std::collections::HashMap::new(),
        }
    }
}
