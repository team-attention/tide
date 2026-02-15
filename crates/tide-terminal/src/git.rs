// Git integration: branch detection and status parsing via CLI.

use std::path::Path;
use std::process::Command;

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

/// Detect git branch and status for the given working directory.
/// Returns None if not inside a git repo or git is not available.
pub fn detect_git_info(cwd: &Path) -> Option<GitInfo> {
    let branch = detect_branch(cwd)?;
    let status = detect_status(cwd);
    Some(GitInfo { branch, status })
}

fn detect_branch(cwd: &Path) -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() { None } else { Some(branch) }
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

/// List files with their status from `git status --porcelain`.
pub fn status_files(cwd: &Path) -> Vec<StatusEntry> {
    let output = match Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };

    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .filter(|l| l.len() >= 4)
        .map(|l| StatusEntry {
            status: l[..2].to_string(),
            path: l[3..].to_string(),
        })
        .collect()
}

/// Get unified diff for a single file.
pub fn file_diff(cwd: &Path, path: &str) -> Option<String> {
    let output = Command::new("git")
        .args(["diff", "--", path])
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.is_empty() { None } else { Some(text) }
}

/// List all branches (local and remote).
pub fn list_branches(cwd: &Path) -> Vec<BranchInfo> {
    let output = match Command::new("git")
        .args(["branch", "-a", "--format=%(HEAD) %(refname:short)"])
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };

    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .filter(|l| l.len() >= 2)
        .map(|l| {
            let is_current = l.starts_with('*');
            let name = l[2..].trim().to_string();
            let is_remote = name.starts_with("remotes/") || name.starts_with("origin/");
            BranchInfo { name, is_current, is_remote }
        })
        .collect()
}

fn detect_status(cwd: &Path) -> GitStatus {
    let mut status = GitStatus::default();

    // Count changed files via porcelain status
    if let Ok(output) = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
    {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            status.changed_files = text.lines().filter(|l| !l.is_empty()).count();
        }
    }

    // Get diff stats (additions/deletions)
    if let Ok(output) = Command::new("git")
        .args(["diff", "--numstat"])
        .current_dir(cwd)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
    {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let parts: Vec<&str> = line.split('\t').collect();
                if parts.len() >= 2 {
                    status.additions += parts[0].parse::<usize>().unwrap_or(0);
                    status.deletions += parts[1].parse::<usize>().unwrap_or(0);
                }
            }
        }
    }

    status
}
