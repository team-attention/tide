// BackgroundServices — file watch, git poll, LSP.

pub(crate) struct BackgroundServices {
    pub file_watcher: Option<notify::RecommendedWatcher>,
    pub file_watch_rx: Option<std::sync::mpsc::Receiver<notify::Result<notify::Event>>>,
    pub file_watch_dirty: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub event_loop_waker: Option<tide_platform::WakeCallback>,
    pub git_poll_rx: Option<std::sync::mpsc::Receiver<crate::update::file_tree::GitPollResults>>,
    pub git_poll_cwd_tx: Option<std::sync::mpsc::Sender<Vec<std::path::PathBuf>>>,
    pub git_poll_handle: Option<std::thread::JoinHandle<()>>,
    pub git_poll_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub cached_repo_roots: std::collections::HashMap<std::path::PathBuf, Option<std::path::PathBuf>>,
    pub lsp: Option<tide_lsp::LspManager>,
}

impl BackgroundServices {
    pub fn new() -> Self {
        Self { file_watcher: None, file_watch_rx: None, file_watch_dirty: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)), event_loop_waker: None, git_poll_rx: None, git_poll_cwd_tx: None, git_poll_handle: None, git_poll_stop: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)), cached_repo_roots: std::collections::HashMap::new(), lsp: None }
    }
}
