// Spec: docs/specs/pane-close-responsiveness.md

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use crate::application::ports::outward::GitPort;
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::LayoutEngine;
use crate::tide_terminal::git::{GitInfo, GitStatus, StatusEntry, WorktreeInfo};
use crate::App;
use crate::PaneLifecyclePort;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_stage_terminal_and_editor() -> (App, u64, u64) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;

    let editor_id = app
        .layout
        .split(terminal_id, crate::tide_core::SplitDirection::Vertical);
    app.panes.insert(
        editor_id,
        PaneKind::Editor(EditorPane::new_empty(editor_id)),
    );

    (app, terminal_id, editor_id)
}

struct CountingGit {
    list_worktree_calls: Arc<AtomicUsize>,
}

impl GitPort for CountingGit {
    fn detect_git_info(&self, _cwd: &Path) -> Option<GitInfo> {
        None
    }

    fn status_files(&self, _cwd: &Path) -> Vec<StatusEntry> {
        Vec::new()
    }

    fn file_diff(&self, _cwd: &Path, _path: &str) -> Option<String> {
        None
    }

    fn list_branches(&self, _cwd: &Path) -> Vec<crate::tide_terminal::git::BranchInfo> {
        Vec::new()
    }

    fn list_worktrees(&self, _cwd: &Path) -> Vec<WorktreeInfo> {
        self.list_worktree_calls.fetch_add(1, Ordering::Relaxed);
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

// --- UC-1: CacheCurrentWorktreeForTerminalPane ---

#[test]
fn consume_git_poll_results_updates_terminal_current_worktree_context() {
    // UC-1 BR-1: consume_git_poll_results copies the current WorktreeInfo into TerminalContext
    let (mut app, terminal_id, _editor_id) = app_with_stage_terminal_and_editor();
    let cwd = PathBuf::from("/tmp/tide-pane-close-cache");
    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&terminal_id) {
        pane.context.cwd = Some(cwd.clone());
    }

    let (tx, rx) = std::sync::mpsc::channel();
    app.bg.git_poll_rx = Some(rx);

    let current_worktree = WorktreeInfo {
        path: cwd.clone(),
        branch: Some("feature/cache-close".to_string()),
        commit: "abc123".to_string(),
        is_main: false,
        is_current: true,
    };
    let mut results: crate::state::background::GitPollResults = HashMap::new();
    results.insert(
        cwd.clone(),
        crate::state::background::GitPollCwdResult {
            git_info: Some(GitInfo {
                branch: "feature/cache-close".to_string(),
                status: GitStatus::default(),
            }),
            worktree_count: 2,
            current_worktree: Some(current_worktree.clone()),
            worktrees: vec![current_worktree.clone()],
            repo_root: Some(PathBuf::from("/tmp/tide-main-repo")),
            status_entries: vec![],
            diff_files: None,
            diff_cache: None,
        },
    );
    tx.send(results).unwrap();

    assert!(app.consume_git_poll_results());
    let pane = match app.panes.get(&terminal_id) {
        Some(PaneKind::Terminal(pane)) => pane,
        _ => panic!("expected terminal pane"),
    };
    assert_eq!(pane.context.current_worktree, Some(current_worktree));
    assert_eq!(pane.context.worktree_count, 2);
}

// --- UC-2: CloseStageTerminalPane ---

#[test]
fn closing_stage_terminal_uses_cached_branch_cleanup_without_sync_git_query() {
    // UC-2 BR-2: Stage Terminal Pane close must not synchronously call GitPort::list_worktrees
    // UC-2 BR-3: Cached non-main current WorktreeInfo still opens the branch cleanup bar
    let (mut app, terminal_id, _editor_id) = app_with_stage_terminal_and_editor();
    let git_calls = Arc::new(AtomicUsize::new(0));
    app.ports.git = Box::new(CountingGit {
        list_worktree_calls: git_calls.clone(),
    });

    let cwd = PathBuf::from("/tmp/tide-feature-worktree");
    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&terminal_id) {
        pane.context.cwd = Some(cwd.clone());
        pane.context.git_info = Some(GitInfo {
            branch: "feature/cache-close".to_string(),
            status: GitStatus::default(),
        });
        pane.context.current_worktree = Some(WorktreeInfo {
            path: cwd.clone(),
            branch: Some("feature/cache-close".to_string()),
            commit: "abc123".to_string(),
            is_main: false,
            is_current: true,
        });
    }

    app.focus.focused = Some(terminal_id);
    app.close_specific_pane(terminal_id);

    assert_eq!(git_calls.load(Ordering::Relaxed), 0);
    let branch_cleanup = app
        .modal
        .branch_cleanup
        .as_ref()
        .expect("expected branch cleanup prompt");
    assert_eq!(branch_cleanup.pane_id, terminal_id);
    assert_eq!(branch_cleanup.worktree_path, cwd);
    assert!(app.panes.contains_key(&terminal_id));
}

#[test]
fn closing_stage_terminal_without_cached_worktree_info_skips_sync_git_query() {
    // UC-2 BR-4: Missing cached current WorktreeInfo skips the branch cleanup bar instead of blocking the close path
    let (mut app, terminal_id, editor_id) = app_with_stage_terminal_and_editor();
    let git_calls = Arc::new(AtomicUsize::new(0));
    app.ports.git = Box::new(CountingGit {
        list_worktree_calls: git_calls.clone(),
    });

    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&terminal_id) {
        pane.context.cwd = Some(PathBuf::from("/tmp/tide-missing-cache"));
        pane.context.git_info = Some(GitInfo {
            branch: "feature/missing-cache".to_string(),
            status: GitStatus::default(),
        });
        pane.context.current_worktree = None;
    }

    app.focus.focused = Some(terminal_id);
    app.close_specific_pane(terminal_id);

    assert_eq!(git_calls.load(Ordering::Relaxed), 0);
    assert!(app.modal.branch_cleanup.is_none());
    assert!(!app.panes.contains_key(&terminal_id));
    assert_eq!(app.focus.focused, Some(editor_id));
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn closing_stage_terminal_with_stale_cached_worktree_info_skips_branch_cleanup_prompt() {
    // UC-2 BR-5: Stale cached current WorktreeInfo whose path no longer contains the current CWD skips the branch cleanup bar
    let (mut app, terminal_id, editor_id) = app_with_stage_terminal_and_editor();
    let git_calls = Arc::new(AtomicUsize::new(0));
    app.ports.git = Box::new(CountingGit {
        list_worktree_calls: git_calls.clone(),
    });

    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&terminal_id) {
        pane.context.cwd = Some(PathBuf::from("/tmp/tide-other-worktree/subdir"));
        pane.context.git_info = Some(GitInfo {
            branch: "feature/stale-cache".to_string(),
            status: GitStatus::default(),
        });
        pane.context.current_worktree = Some(WorktreeInfo {
            path: PathBuf::from("/tmp/tide-feature-worktree"),
            branch: Some("feature/stale-cache".to_string()),
            commit: "abc123".to_string(),
            is_main: false,
            is_current: true,
        });
    }

    app.focus.focused = Some(terminal_id);
    app.close_specific_pane(terminal_id);

    assert_eq!(git_calls.load(Ordering::Relaxed), 0);
    assert!(app.modal.branch_cleanup.is_none());
    assert!(!app.panes.contains_key(&terminal_id));
    assert_eq!(app.focus.focused, Some(editor_id));
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}
