// BackgroundServices — git poll, workspace search, event loop waker.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

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

/// One job for the background workspace-scan worker (FileFinder). `entries` is
/// shared (Arc) so dispatching never clones the file list. Both kinds keep
/// filesystem reads off the app thread (P-1 `/` search, P-2 `#` symbols).
pub(crate) enum WorkspaceScanRequest {
    /// `/` text search across workspace files, correlated by `query_id`.
    Search {
        query_id: u64,
        base_dir: PathBuf,
        entries: Arc<Vec<PathBuf>>,
        query: String,
    },
    /// `#` workspace-symbol index build, correlated by `request_id`.
    Symbols {
        request_id: u64,
        base_dir: PathBuf,
        entries: Arc<Vec<PathBuf>>,
    },
}

/// Results from the background workspace-scan worker, correlated by id.
pub(crate) enum WorkspaceScanResult {
    Search {
        query_id: u64,
        hits: Vec<crate::state::WorkspaceSearchHit>,
    },
    Symbols {
        request_id: u64,
        symbols: Vec<crate::state::SymbolMatch>,
    },
}

/// What to do on the app thread after a worktree is successfully added.
#[derive(Clone, Debug)]
pub(crate) enum WorktreeFollowUp {
    None,
    /// `cd` the terminal into the new worktree if its shell is idle.
    CdTerminalIfIdle {
        pane_id: crate::tide_core::PaneId,
    },
    /// Split a new terminal pane rooted in the new worktree.
    SplitPane {
        pane_id: crate::tide_core::PaneId,
    },
}

/// A worktree mutation to run off the app thread (the slow git part). Follow-ups
/// (copy files, cd/split, errors) are applied on the app thread when the result
/// arrives. (P-5)
pub(crate) enum WorktreeJob {
    Add {
        cwd: PathBuf,
        wt_path: PathBuf,
        branch: String,
        new_branch: bool,
        root: PathBuf,
        follow_up: WorktreeFollowUp,
    },
    Remove {
        main_cwd: PathBuf,
        wt_path: PathBuf,
        delete_branch: Option<String>,
        force: bool,
    },
}

/// Result of a worktree job, applied on the app thread.
pub(crate) enum WorktreeJobResult {
    Added {
        result: Result<(), String>,
        root: PathBuf,
        wt_path: PathBuf,
        follow_up: WorktreeFollowUp,
    },
    Removed {
        result: Result<(), String>,
        wt_path: PathBuf,
    },
}

pub(crate) struct BackgroundServices {
    pub event_loop_waker: Option<crate::tide_platform::WakeCallback>,
    pub git_poll_rx: Option<std::sync::mpsc::Receiver<GitPollResults>>,
    pub git_poll_cwd_tx: Option<std::sync::mpsc::Sender<Vec<GitPollRequest>>>,
    pub git_poll_handle: Option<std::thread::JoinHandle<()>>,
    pub git_poll_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub cached_repo_roots: HashMap<PathBuf, Option<PathBuf>>,
    /// Latest worktree list per repo root, from the git poller. Lets the Git
    /// Switcher open without spawning git on the app thread (P-5).
    pub cached_worktrees: HashMap<PathBuf, Vec<crate::tide_terminal::git::WorktreeInfo>>,

    // ── Workspace-scan worker (FileFinder `/` search + `#` symbols) ──
    pub workspace_scan_tx: Option<std::sync::mpsc::Sender<WorkspaceScanRequest>>,
    pub workspace_scan_rx: Option<std::sync::mpsc::Receiver<WorkspaceScanResult>>,
    pub workspace_scan_handle: Option<std::thread::JoinHandle<()>>,
    pub workspace_scan_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,

    // ── Worktree mutation worker (add/remove off the app thread, P-5) ──
    pub worktree_job_tx: Option<std::sync::mpsc::Sender<WorktreeJob>>,
    pub worktree_job_rx: Option<std::sync::mpsc::Receiver<WorktreeJobResult>>,
    pub worktree_job_handle: Option<std::thread::JoinHandle<()>>,
    pub worktree_job_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
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
            cached_worktrees: HashMap::new(),
            workspace_scan_tx: None,
            workspace_scan_rx: None,
            workspace_scan_handle: None,
            workspace_scan_stop: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            worktree_job_tx: None,
            worktree_job_rx: None,
            worktree_job_handle: None,
            worktree_job_stop: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }
}
