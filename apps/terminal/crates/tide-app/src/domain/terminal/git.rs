// Git data types shared across domain, services, and the git adapter.
//
// These are pure data — no I/O. The git CLI calls that produce them live in
// `adapter/outward/git_adapter/git_cli.rs` (the outward adapter), so domain and
// services depend only on these shapes, never on shelling out to `git`.

/// Git repository information for a working directory.
#[derive(Debug, Clone)]
pub struct GitInfo {
    pub branch: String,
    pub status: GitStatus,
}

/// Summary of uncommitted changes.
#[derive(Debug, Clone, Default)]
pub struct GitStatus {
    pub changed_files: usize,
    pub additions: usize,
    pub deletions: usize,
}

/// A single file entry from `git status --porcelain`.
#[derive(Debug, Clone)]
pub struct StatusEntry {
    pub status: String,
    pub path: String,
}

/// Information about a git branch.
#[derive(Debug, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

/// Information about a git worktree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeInfo {
    pub path: std::path::PathBuf,
    pub branch: Option<String>,
    pub commit: String,
    pub is_main: bool,
    pub is_current: bool,
}
