// GitPort — git operations (branch, worktree, diff, status).

use std::path::{Path, PathBuf};

pub(crate) trait GitPort {
    fn detect_git_info(&self, cwd: &Path) -> Option<crate::tide_terminal::git::GitInfo>;
    fn status_files(&self, cwd: &Path) -> Vec<crate::tide_terminal::git::StatusEntry>;
    fn file_diff(&self, cwd: &Path, path: &str) -> Option<String>;
    fn list_branches(&self, cwd: &Path) -> Vec<crate::tide_terminal::git::BranchInfo>;
    fn list_worktrees(&self, cwd: &Path) -> Vec<crate::tide_terminal::git::WorktreeInfo>;
    fn count_worktrees(&self, cwd: &Path) -> usize;
    fn repo_root(&self, cwd: &Path) -> Option<PathBuf>;
    fn branch_exists(&self, cwd: &Path, branch: &str) -> bool;
    fn add_worktree(&self, cwd: &Path, path: &Path, branch: &str, new_branch: bool) -> Result<(), String>;
    fn remove_worktree(&self, cwd: &Path, path: &Path, force: bool) -> Result<(), String>;
    fn delete_branch(&self, cwd: &Path, branch: &str, force: bool) -> Result<(), String>;
}
