// BackgroundServices — git poll, event loop waker.

use std::collections::HashMap;
use std::path::PathBuf;

/// Results from the background git poller (one entry per CWD).
pub(crate) type GitPollResults = HashMap<PathBuf, GitPollCwdResult>;

/// One unit of work for the background git poller: a cwd and whether the main
/// thread wants per-file diff data for it (true only when a DiffPane is open
/// for that cwd/repo — see `App::git_poll_requests`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GitPollRequest {
    pub cwd: PathBuf,
    pub wants_diff: bool,
}

pub(crate) struct GitPollCwdResult {
    pub git_info: Option<crate::tide_terminal::git::GitInfo>,
    pub worktree_count: usize,
    pub current_worktree: Option<crate::tide_terminal::git::WorktreeInfo>,
    /// The full worktree list for this cwd's repo (consumed by the Git Switcher
    /// so opening it never spawns git on the app thread).
    pub worktrees: Vec<crate::tide_terminal::git::WorktreeInfo>,
    pub repo_root: Option<PathBuf>,
    pub status_entries: Vec<crate::tide_terminal::git::StatusEntry>,
    /// Pre-computed diff file entries. `Some` (possibly empty) only when the
    /// request had `wants_diff` set, so a loading DiffPane can settle on a
    /// clean tree; `None` when no DiffPane wanted diff data for this cwd.
    pub diff_files: Option<Vec<crate::pane::diff::DiffFileEntry>>,
    /// Pre-computed diff line cache (keyed by file index) for open DiffPanes.
    pub diff_cache: Option<HashMap<usize, Vec<crate::pane::diff::DiffLine>>>,
}

pub(crate) struct BackgroundServices {
    pub event_loop_waker: Option<crate::tide_platform::WakeCallback>,
    pub git_poll_rx: Option<std::sync::mpsc::Receiver<GitPollResults>>,
    pub git_poll_cwd_tx: Option<std::sync::mpsc::Sender<Vec<GitPollRequest>>>,
    pub git_poll_handle: Option<std::thread::JoinHandle<()>>,
    pub git_poll_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub cached_repo_roots: HashMap<PathBuf, Option<PathBuf>>,
}

impl BackgroundServices {
    pub fn new() -> Self {
        Self {
            event_loop_waker: None,
            git_poll_rx: None,
            git_poll_cwd_tx: None,
            git_poll_handle: None,
            git_poll_stop: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cached_repo_roots: HashMap::new(),
        }
    }
}
