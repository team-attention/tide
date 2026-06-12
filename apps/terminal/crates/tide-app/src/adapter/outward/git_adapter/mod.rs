// Git adapter implementations.

pub(crate) mod git_cli;

use std::path::{Path, PathBuf};

use crate::application::ports::outward::git_port::GitPort;

// ── Real implementation (production) ──

pub(crate) struct RealGit;

impl GitPort for RealGit {
    fn detect_git_info(&self, cwd: &Path) -> Option<crate::tide_terminal::git::GitInfo> {
        git_cli::detect_git_info(cwd)
    }
    fn status_files(&self, cwd: &Path) -> Vec<crate::tide_terminal::git::StatusEntry> {
        git_cli::status_files(cwd)
    }
    fn file_diff(&self, cwd: &Path, path: &str) -> Option<String> {
        git_cli::file_diff(cwd, path)
    }
    fn list_branches(&self, cwd: &Path) -> Vec<crate::tide_terminal::git::BranchInfo> {
        git_cli::list_branches(cwd)
    }
    fn list_worktrees(&self, cwd: &Path) -> Vec<crate::tide_terminal::git::WorktreeInfo> {
        git_cli::list_worktrees(cwd)
    }
    fn count_worktrees(&self, cwd: &Path) -> usize {
        git_cli::count_worktrees(cwd)
    }
    fn repo_root(&self, cwd: &Path) -> Option<PathBuf> {
        git_cli::repo_root(cwd)
    }
    fn branch_exists(&self, cwd: &Path, branch: &str) -> bool {
        git_cli::branch_exists(cwd, branch)
    }
    fn add_worktree(
        &self,
        cwd: &Path,
        path: &Path,
        branch: &str,
        new_branch: bool,
    ) -> Result<(), String> {
        git_cli::add_worktree(cwd, path, branch, new_branch)
    }
    fn remove_worktree(&self, cwd: &Path, path: &Path, force: bool) -> Result<(), String> {
        git_cli::remove_worktree(cwd, path, force)
    }
    fn delete_branch(&self, cwd: &Path, branch: &str, force: bool) -> Result<(), String> {
        git_cli::delete_branch(cwd, branch, force)
    }
}

// ── Noop implementation (tests) ──

pub(crate) struct NoopGit;

impl GitPort for NoopGit {
    fn detect_git_info(&self, _cwd: &Path) -> Option<crate::tide_terminal::git::GitInfo> {
        None
    }
    fn status_files(&self, _cwd: &Path) -> Vec<crate::tide_terminal::git::StatusEntry> {
        Vec::new()
    }
    fn file_diff(&self, _cwd: &Path, _path: &str) -> Option<String> {
        None
    }
    fn list_branches(&self, _cwd: &Path) -> Vec<crate::tide_terminal::git::BranchInfo> {
        Vec::new()
    }
    fn list_worktrees(&self, _cwd: &Path) -> Vec<crate::tide_terminal::git::WorktreeInfo> {
        Vec::new()
    }
    fn count_worktrees(&self, _cwd: &Path) -> usize {
        0
    }
    fn repo_root(&self, _cwd: &Path) -> Option<PathBuf> {
        None
    }
    fn branch_exists(&self, _cwd: &Path, _branch: &str) -> bool {
        false
    }
    fn add_worktree(
        &self,
        _cwd: &Path,
        _path: &Path,
        _branch: &str,
        _new_branch: bool,
    ) -> Result<(), String> {
        Ok(())
    }
    fn remove_worktree(&self, _cwd: &Path, _path: &Path, _force: bool) -> Result<(), String> {
        Ok(())
    }
    fn delete_branch(&self, _cwd: &Path, _branch: &str, _force: bool) -> Result<(), String> {
        Ok(())
    }
}
