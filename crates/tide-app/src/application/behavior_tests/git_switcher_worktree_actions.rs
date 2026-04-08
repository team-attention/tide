// Spec: docs/specs/git-switcher-worktree-actions.md

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use crate::application::ports::outward::GitPort;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_terminal::git::{GitInfo, StatusEntry, WorktreeInfo};
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn test_window_proxy() -> crate::tide_platform::WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    crate::tide_platform::WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

fn app_with_terminal() -> (App, u64) {
    let mut app = test_app();
    let (layout, pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(pane_id, 80, 24, None, true).unwrap();
    app.panes.insert(pane_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(pane_id);
    app.focus.focus_area = FocusArea::Stage;
    (app, pane_id)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum GitMutation {
    RemoveWorktree {
        cwd: PathBuf,
        path: PathBuf,
        force: bool,
    },
    DeleteBranch {
        cwd: PathBuf,
        branch: String,
        force: bool,
    },
}

struct RecordingGit {
    worktrees: Vec<WorktreeInfo>,
    mutations: Arc<Mutex<Vec<GitMutation>>>,
    list_worktree_calls: Arc<AtomicUsize>,
}

impl GitPort for RecordingGit {
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
        self.worktrees.clone()
    }

    fn count_worktrees(&self, _cwd: &Path) -> usize {
        self.worktrees.len()
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

    fn remove_worktree(&self, cwd: &Path, path: &Path, force: bool) -> Result<(), String> {
        self.mutations
            .lock()
            .unwrap()
            .push(GitMutation::RemoveWorktree {
                cwd: cwd.to_path_buf(),
                path: path.to_path_buf(),
                force,
            });
        Ok(())
    }

    fn delete_branch(&self, cwd: &Path, branch: &str, force: bool) -> Result<(), String> {
        self.mutations
            .lock()
            .unwrap()
            .push(GitMutation::DeleteBranch {
                cwd: cwd.to_path_buf(),
                branch: branch.to_string(),
                force,
            });
        Ok(())
    }
}

// --- UC-1: ActivateWorktreeFromGitSwitcherRow ---

#[test]
fn clicking_git_switcher_row_runs_the_default_switch_action() {
    // UC-1 BR-1: Clicking a GitSwitcher row outside its action buttons activates the row's default switch action
    let (mut app, pane_id) = app_with_terminal();
    let repo_root = PathBuf::from("/tmp/tide-git-switcher-row");
    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&pane_id) {
        pane.context.cwd = Some(repo_root.clone());
        pane.context.shell_idle = true;
    }

    app.modal.git_switcher = Some(crate::GitSwitcherState::new(
        pane_id,
        vec![
            WorktreeInfo {
                path: repo_root.clone(),
                branch: Some("main".to_string()),
                commit: "abc123".to_string(),
                is_main: true,
                is_current: true,
            },
            WorktreeInfo {
                path: repo_root.join(".worktree/feature-row"),
                branch: Some("feature/row".to_string()),
                commit: "def456".to_string(),
                is_main: false,
                is_current: false,
            },
        ],
        crate::tide_core::Rect::new(32.0, 20.0, 120.0, 24.0),
    ));

    let geometry = app.modal.git_switcher.as_ref().unwrap().geometry(
        app.window.cached_cell_size.height,
        960.0,
        640.0,
    );
    app.window.last_cursor_pos = crate::tide_core::Vec2::new(
        geometry.popup_x + 36.0,
        geometry.list_top + geometry.line_height + geometry.line_height / 2.0,
    );

    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );

    assert!(app.modal.git_switcher.is_none());
}

// --- UC-2: DeleteWorktreeFromGitSwitcher ---

#[test]
fn deleting_git_switcher_worktree_uses_the_main_worktree_as_git_root() {
    // UC-2 BR-2: GitSwitcher resolves the main worktree path before removing a worktree and deleting its branch
    let (mut app, pane_id) = app_with_terminal();
    let main_worktree = PathBuf::from("/tmp/tide-main-repo");
    let current_worktree = PathBuf::from("/tmp/tide-main-repo/.worktree/feature-current");
    let delete_worktree = PathBuf::from("/tmp/tide-main-repo/.worktree/feature-delete");
    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&pane_id) {
        pane.context.cwd = Some(current_worktree.clone());
        pane.context.shell_idle = true;
    }

    let listed_worktrees = vec![
        WorktreeInfo {
            path: main_worktree.clone(),
            branch: Some("main".to_string()),
            commit: "aaa111".to_string(),
            is_main: true,
            is_current: false,
        },
        WorktreeInfo {
            path: current_worktree.clone(),
            branch: Some("feature/current".to_string()),
            commit: "bbb222".to_string(),
            is_main: false,
            is_current: true,
        },
        WorktreeInfo {
            path: delete_worktree.clone(),
            branch: Some("feature/delete".to_string()),
            commit: "ccc333".to_string(),
            is_main: false,
            is_current: false,
        },
    ];
    let mutations = Arc::new(Mutex::new(Vec::new()));
    let list_worktree_calls = Arc::new(AtomicUsize::new(0));
    app.ports.git = Box::new(RecordingGit {
        worktrees: listed_worktrees.clone(),
        mutations: mutations.clone(),
        list_worktree_calls: list_worktree_calls.clone(),
    });
    app.modal.git_switcher = Some(crate::GitSwitcherState::new(
        pane_id,
        listed_worktrees,
        crate::tide_core::Rect::new(32.0, 20.0, 120.0, 24.0),
    ));
    let baseline_list_calls = list_worktree_calls.load(Ordering::Relaxed);

    crate::adapter::inward::click_adapter::header::handle_git_switcher_button(
        &mut app,
        crate::SwitcherButton::Delete(2),
    );
    assert_eq!(
        app.modal
            .git_switcher
            .as_ref()
            .and_then(|gs| gs.delete_confirm),
        Some(2)
    );

    crate::adapter::inward::click_adapter::header::handle_git_switcher_button(
        &mut app,
        crate::SwitcherButton::Delete(2),
    );

    let mutations = mutations.lock().unwrap().clone();
    assert!(mutations.contains(&GitMutation::RemoveWorktree {
        cwd: main_worktree.clone(),
        path: delete_worktree,
        force: true,
    }));
    assert!(mutations.contains(&GitMutation::DeleteBranch {
        cwd: main_worktree,
        branch: "feature/delete".to_string(),
        force: true,
    }));
    assert_eq!(
        list_worktree_calls.load(Ordering::Relaxed),
        baseline_list_calls,
        "delete should reuse the git switcher snapshot instead of re-querying worktrees"
    );
}
