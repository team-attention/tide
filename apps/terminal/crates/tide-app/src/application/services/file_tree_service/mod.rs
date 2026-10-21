use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::path::PathBuf;

use crate::tide_core::{FileGitStatus, FileTreeSource, TerminalBackend, Vec2};
use std::ffi::OsStr;

use super::path_identity::normalize_path_for_identity;
use crate::pane::PaneKind;
use crate::theme::*;
use crate::ActionPort;
use crate::App;
use crate::AppCorePort;
use crate::PaneLifecyclePort;

/// Results from the background Git worker (one entry per CWD).
use crate::adapter::outward::git_adapter::git_cli;
use crate::state::background::{
    GitRefreshCause, GitRefreshRepoResult, GitRefreshRequest, GitRefreshResults, GitWorkerMessage,
};

pub(crate) fn sync_terminal_badge_runtime_context(
    context: &mut crate::pane::TerminalContext,
    new_cwd: Option<PathBuf>,
    new_idle: bool,
) -> bool {
    let mut changed = false;

    if new_cwd != context.cwd {
        context.cwd = new_cwd;
        context.git_info = None;
        context.worktree_count = 0;
        context.current_worktree = None;
        changed = true;
    }

    if new_idle != context.shell_idle {
        context.shell_idle = new_idle;
        changed = true;
    }

    changed
}

fn apply_git_refresh_to_context(
    context: &mut crate::pane::TerminalContext,
    result: &GitRefreshRepoResult,
) -> bool {
    let git_changed = match (&context.git_info, &result.git_info) {
        (None, None) => false,
        (Some(_), None) | (None, Some(_)) => true,
        (Some(old), Some(new)) => {
            old.branch != new.branch
                || old.status.changed_files != new.status.changed_files
                || old.status.additions != new.status.additions
                || old.status.deletions != new.status.deletions
    }
    };
    let changed = git_changed
        || context.worktree_count != result.worktree_count
        || context.current_worktree != result.current_worktree;
    context.git_info = result.git_info.clone();
    context.worktree_count = result.worktree_count;
    context.current_worktree = result.current_worktree.clone();
    changed
}

pub(crate) fn latest_git_refresh_requests(
    req_rx: &std::sync::mpsc::Receiver<GitWorkerMessage>,
    mut requests: Vec<GitRefreshRequest>,
) -> Option<Vec<GitRefreshRequest>> {
    while let Ok(message) = req_rx.try_recv() {
        match message {
            GitWorkerMessage::Refresh(newer) => requests = newer,
            GitWorkerMessage::Shutdown => return None,
        }
    }
    Some(requests)
}

/// Decide whether the main thread wants per-file diff data for `cwd`. True when
/// a DiffPane is open for that exact cwd, or for a cwd sharing its repo root.
/// Pure so the gating logic is testable without git. (UC-1 BR-4)
pub(crate) fn cwd_wants_diff(
    cwd: &Path,
    repo_root: Option<&Path>,
    diff_pane_cwds: &HashSet<PathBuf>,
    diff_pane_repo_roots: &HashSet<PathBuf>,
) -> bool {
    diff_pane_cwds.contains(cwd)
        || repo_root.is_some_and(|root| diff_pane_repo_roots.contains(root))
}

fn collect_git_refresh_results_for_cwds(requests: Vec<GitRefreshRequest>) -> GitRefreshResults {
    let mut results: GitRefreshResults = std::collections::HashMap::new();
    for GitRefreshRequest { cwd, wants_diff } in requests {
        // One spawn each for status, numstat, worktrees, repo_root, branch —
        // derive both badge stats and diff data from the shared results instead
        // of re-running `git status` / `git diff --numstat` (P-4).
        let status_entries = git_cli::status_files(&cwd);
        let numstat = git_cli::diff_numstat(&cwd);
        let worktrees = git_cli::list_worktrees(&cwd);
        let repo_root = git_cli::repo_root(&cwd);
        let repository_watch_paths = git_cli::repository_watch_paths(&cwd);
        let branch = git_cli::detect_branch(&cwd);

        let (additions, deletions) = numstat
            .values()
            .fold((0usize, 0usize), |(a, d), &(na, nd)| (a + na, d + nd));
        let git_info = branch.map(|branch| crate::tide_terminal::git::GitInfo {
            branch,
            status: crate::tide_terminal::git::GitStatus {
                changed_files: status_entries.len(),
                additions,
                deletions,
            },
        });

        let worktree_count = worktrees.len();
        let current_worktree = worktrees.iter().find(|wt| wt.is_current).cloned();

        // Per-file diffs only when a DiffPane wants them; always `Some` (possibly
        // empty) for wants-diff cwds so a loading DiffPane can settle on a clean
        // tree (UC-1 BR-4, UC-2 BR-7).
        let (diff_files, diff_cache) = if wants_diff {
            let files: Vec<crate::pane::diff::DiffFileEntry> = status_entries
                .iter()
                .map(|e| {
                    let (add, del) = numstat.get(&e.path).copied().unwrap_or((0, 0));
                    crate::pane::diff::DiffFileEntry {
                        status: e.status.clone(),
                        path: e.path.clone(),
                        additions: add,
                        deletions: del,
                    }
                })
                .collect();
            let mut cache = std::collections::HashMap::new();
            for (i, entry) in files.iter().enumerate() {
                let lines = git_cli::file_diff_lines(&cwd, &entry.path);
                cache.insert(i, lines);
            }
            (Some(files), Some(cache))
        } else {
            (None, None)
        };

        results.insert(
            cwd,
            GitRefreshRepoResult {
                git_info,
                worktree_count,
                current_worktree,
                worktrees,
                repo_root,
                repository_watch_paths,
                status_entries,
                diff_files,
                diff_cache,
            },
        );
    }
    results
}

impl App {
    fn is_app_bundle_directory(path: &std::path::Path, is_dir: bool) -> bool {
        is_dir
            && path
                .extension()
                .and_then(OsStr::to_str)
                .map(|ext| ext.eq_ignore_ascii_case("app"))
                .unwrap_or(false)
    }

    fn log_app_handoff_failure(result: std::io::Result<()>, path: &Path) {
        if let Err(error) = result {
            log::error!("Failed to hand off app bundle {:?}: {}", path, error);
        }
    }

    pub(crate) fn sync_file_tree_path_identity_cache(&mut self) {
        let mut normalized_entry_paths = HashMap::new();
        if let Some(tree) = self.ft.tree.as_ref() {
            for entry in tree.visible_entries() {
                normalized_entry_paths.insert(
                    entry.entry.path.clone(),
                    normalize_path_for_identity(&entry.entry.path),
                );
            }
        }
        self.ft.normalized_entry_paths = normalized_entry_paths;
    }

    pub(crate) fn sync_file_tree_modified_editor_cache(&mut self) {
        let mut modified_editor_paths = HashSet::new();
        let mut modified_editor_dirs = HashSet::new();

        for pane in self.panes.values() {
            let PaneKind::Editor(editor_pane) = pane else {
                continue;
            };
            if !editor_pane.editor.is_modified() {
                continue;
            }
            let Some(file_path) = editor_pane.editor.file_path() else {
                continue;
            };

            let normalized_file_path = normalize_path_for_identity(file_path);
            modified_editor_paths.insert(normalized_file_path.clone());

            let mut ancestor = normalized_file_path.parent();
            while let Some(dir) = ancestor {
                modified_editor_dirs.insert(dir.to_path_buf());
                ancestor = dir.parent();
            }
        }

        self.ft.modified_editor_paths = modified_editor_paths;
        self.ft.modified_editor_dirs = modified_editor_dirs;
    }

    pub(crate) fn effective_file_tree_git_status(
        &self,
        entry_path: &Path,
        is_dir: bool,
    ) -> Option<FileGitStatus> {
        let cached = if is_dir {
            self.ft.dir_git_status.get(entry_path).copied()
        } else {
            self.ft.git_status.get(entry_path).copied()
        };

        cached.or_else(|| self.modified_editor_fallback_file_tree_git_status(entry_path, is_dir))
    }

    fn modified_editor_fallback_file_tree_git_status(
        &self,
        entry_path: &Path,
        is_dir: bool,
    ) -> Option<FileGitStatus> {
        let normalized_entry_path = self.ft.normalized_entry_paths.get(entry_path)?;
        if is_dir {
            self.ft
                .modified_editor_dirs
                .contains(normalized_entry_path)
                .then_some(FileGitStatus::Modified)
        } else {
            self.ft
                .modified_editor_paths
                .contains(normalized_entry_path)
                .then_some(FileGitStatus::Modified)
        }
    }

    pub(crate) fn update_file_tree_cwd(&mut self) {
        if !self.ft.visible {
            return;
        }

        let cwd = self.focused_terminal_cwd();

        if let Some(cwd) = cwd {
            if self.timing.last_cwd.as_ref() != Some(&cwd) {
                self.timing.last_cwd = Some(cwd.clone());
                // Use git root as tree root when inside a repo (sticky);
                // otherwise follow CWD directly.
                // Use cached repo_root from the git poller — never call git synchronously.
                let tree_root = match self.bg.cached_repo_roots.get(&cwd) {
                    Some(Some(root)) => root.clone(),
                    Some(None) => cwd, // not in a git repo
                    None => cwd,       // not cached yet — will update when poller finishes
                };
                let current_root = self.ft.tree.as_ref().map(|t| t.root().to_path_buf());
                if current_root.as_ref() != Some(&tree_root) {
                    if let Some(tree) = self.ft.tree.as_mut() {
                        tree.set_root(tree_root);
                    }
                    self.sync_file_tree_path_identity_cache();
                    self.ft.scroll = 0.0;
                    self.ft.scroll_target = 0.0;
                    self.cache.invalidate_chrome();
                    // File tree git status will be updated when git poller results arrive.
                }
            }
        }
    }

    /// Apply pre-computed git status entries to the file tree.
    /// Called from consume_git_refresh_results with data from the background thread.
    fn apply_file_tree_git_status(
        &mut self,
        git_root: &std::path::Path,
        entries: &[crate::tide_terminal::git::StatusEntry],
    ) {
        let tree_root = match self.ft.tree.as_ref() {
            Some(tree) => tree.root().to_path_buf(),
            None => return,
        };

        let mut status_map: HashMap<PathBuf, FileGitStatus> = HashMap::new();

        for entry in entries {
            let git_status = parse_git_status_code(&entry.status);
            if let Some(gs) = git_status {
                let rel = if entry.path.ends_with('/') {
                    &entry.path[..entry.path.len() - 1]
                } else {
                    &entry.path
                };
                let abs_path = git_root.join(rel);
                status_map.insert(abs_path, gs);
            }
        }

        let mut dir_status: HashMap<PathBuf, FileGitStatus> = HashMap::new();
        for (path, &status) in &status_map {
            if path.is_dir() {
                let entry = dir_status.entry(path.clone()).or_insert(status);
                *entry = merge_git_status(*entry, status);
            }
            let mut ancestor = path.parent();
            while let Some(dir) = ancestor {
                if dir < tree_root {
                    break;
                }
                let entry = dir_status.entry(dir.to_path_buf()).or_insert(status);
                *entry = merge_git_status(*entry, status);
                if dir == tree_root {
                    break;
                }
                ancestor = dir.parent();
            }
        }

        self.ft.git_status = status_map;
        self.ft.dir_git_status = dir_status;
        self.ft.git_root = Some(git_root.to_path_buf());
    }

    /// Request one explicit Git refresh. Calls are coalesced by the worker.
    pub(crate) fn request_git_refresh(&self, _cause: GitRefreshCause) {
        if let Some(ref tx) = self.bg.git_worker_tx {
            let requests = self.git_refresh_requests();
            let _ = tx.send(GitWorkerMessage::Refresh(requests));
            }
        }

    pub(crate) fn reconcile_repository_watches(&mut self) {
        let desired = self
            .git_refresh_cwds()
            .into_iter()
            .filter_map(|cwd| self.bg.repository_watch_paths.get(&cwd).cloned().flatten())
            .fold(HashMap::new(), |mut desired, paths| {
                *desired.entry(paths).or_insert(0) += 1;
                desired
            });
        self.ports.repository_watcher.reconcile(desired);
    }

    pub(crate) fn drain_repository_changes(&mut self, now: std::time::Instant) -> bool {
        if self.ports.repository_watcher.drain_changes().is_empty() {
            return false;
        }
        self.timing.repository_refresh_at = Some(now + std::time::Duration::from_millis(100));
        true
    }

    pub(crate) fn refresh_repository_if_due(&mut self, now: std::time::Instant) -> bool {
        if !self
            .timing
            .repository_refresh_at
            .is_some_and(|deadline| deadline <= now)
        {
            return false;
        }
        self.timing.repository_refresh_at = None;
        self.request_git_refresh(GitRefreshCause::RepositoryChanged);
        true
    }

    /// Build the poller work list: every polled cwd, tagged with whether an open
    /// DiffPane wants per-file diff data for it (P-4 wants-diff gating).
    fn git_refresh_requests(&self) -> Vec<GitRefreshRequest> {
        let diff_pane_cwds: HashSet<PathBuf> = self
            .panes
            .values()
            .filter_map(|pane| match pane {
                PaneKind::Diff(dp) => Some(dp.cwd.clone()),
                _ => None,
            })
            .collect();
        let diff_pane_repo_roots: HashSet<PathBuf> = diff_pane_cwds
            .iter()
            .filter_map(|cwd| self.bg.cached_repo_roots.get(cwd).cloned().flatten())
            .collect();

        self.git_refresh_cwds()
            .into_iter()
            .map(|cwd| {
                let repo_root = self.bg.cached_repo_roots.get(&cwd).cloned().flatten();
                let wants_diff = cwd_wants_diff(
                    &cwd,
                    repo_root.as_deref(),
                    &diff_pane_cwds,
                    &diff_pane_repo_roots,
                );
                GitRefreshRequest { cwd, wants_diff }
            })
            .collect()
    }

    pub(crate) fn git_refresh_cwds(&self) -> HashSet<PathBuf> {
        let mut cwds: HashSet<PathBuf> = self
            .panes
            .values()
            .filter_map(|pane| {
                if let PaneKind::Terminal(p) = pane {
                    p.context.cwd.clone()
                } else {
                    None
                }
            })
            .collect();

        cwds.extend(self.ws.workspaces.iter().flat_map(|workspace| {
            workspace.panes.values().filter_map(|pane| match pane {
                PaneKind::Terminal(terminal) => terminal.context.cwd.clone(),
                _ => None,
            })
        }));

        for ctx in self.assoc.retained_contexts.values() {
            if let Some(cwd) = ctx.cwd.clone() {
                cwds.insert(cwd);
            }
        }

        cwds
    }

    pub(crate) fn file_tree_max_scroll(&self) -> f32 {
        let entry_count = self
            .ft
            .tree
            .as_ref()
            .map(|t| t.visible_entries().len())
            .unwrap_or(0);
        let cell_size = self.cell_size();
        let logical = self.logical_size();
        let tree_height = logical.height - self.window.top_inset - FILE_TREE_HEADER_HEIGHT;
        let content_height = entry_count as f32 * cell_size.height * FILE_TREE_LINE_SPACING;
        (content_height - tree_height).max(0.0)
    }

    /// Consume Git information produced by the background worker.
    pub(crate) fn update_terminal_badges(&mut self) {
        if self.consume_git_refresh_results() {
            self.cache.invalidate_chrome();
        }
    }

    /// Consume Git information from the background worker (non-blocking).
    /// Returns true if any pane's git info actually changed.
    /// Called when the Git worker wakes the event loop,
    /// and from update_terminal_badges() during normal frame rendering.
    pub(crate) fn consume_git_refresh_results(&mut self) -> bool {
        let rx = match self.bg.git_refresh_rx {
            Some(ref rx) => rx,
            None => return false,
        };
        let mut latest = None;
        while let Ok(result) = rx.try_recv() {
            latest = Some(result);
        }
        let git_results = match latest {
            Some(r) => r,
            None => return false,
        };

        let mut changed = false;

        // Update cached repo roots and terminal contexts in active and cold Workspaces.
        let pane_ids: Vec<crate::tide_core::PaneId> = self.panes.keys().copied().collect();
        for id in &pane_ids {
            if let Some(PaneKind::Terminal(pane)) = self.panes.get_mut(id) {
                if let Some(ref cwd) = pane.context.cwd {
                    if let Some(result) = git_results.get(cwd) {
                        let git_changed = match (&pane.context.git_info, &result.git_info) {
                            (None, None) => false,
                            (Some(_), None) | (None, Some(_)) => true,
                            (Some(old), Some(new)) => {
                                old.branch != new.branch
                                    || old.status.changed_files != new.status.changed_files
                                    || old.status.additions != new.status.additions
                                    || old.status.deletions != new.status.deletions
                            }
                        };
                        if git_changed {
                            pane.context.git_info = result.git_info.clone();
                            changed = true;
                        }
                        if pane.context.worktree_count != result.worktree_count {
                            pane.context.worktree_count = result.worktree_count;
                            changed = true;
                        }
                        if pane.context.current_worktree != result.current_worktree {
                            pane.context.current_worktree = result.current_worktree.clone();
                            changed = true;
                        }
                    }
                }
            }
        }
        for workspace in &mut self.ws.workspaces {
            for pane in workspace.panes.values_mut() {
                if let PaneKind::Terminal(terminal) = pane {
                    if let Some(result) = terminal
                        .context
                        .cwd
                        .as_ref()
                        .and_then(|cwd| git_results.get(cwd))
                    {
                        changed |= apply_git_refresh_to_context(&mut terminal.context, result);
                    }
                }
            }
        }
        for context in self.assoc.retained_contexts.values_mut() {
            if let Some(result) = context.cwd.as_ref().and_then(|cwd| git_results.get(cwd)) {
                changed |= apply_git_refresh_to_context(context, result);
            }
        }

        // Update cached repo roots (for update_file_tree_cwd) and the per-repo
        // worktree list (for the Git Switcher — opens without spawning git, P-5).
        for (cwd, result) in &git_results {
            self.bg
                .cached_repo_roots
                .insert(cwd.clone(), result.repo_root.clone());
            self.bg
                .repository_watch_paths
                .insert(cwd.clone(), result.repository_watch_paths.clone());
            if let Some(ref root) = result.repo_root {
                self.bg
                    .cached_worktrees
                    .insert(root.clone(), result.worktrees.clone());
            }
        }

        self.reconcile_repository_watches();

        // Update file tree git status from poller results
        if let Some(tree) = self.ft.tree.as_ref() {
            let tree_root = tree.root().to_path_buf();
            // Find the result whose repo_root matches the current tree root
            for result in git_results.values() {
                if result.repo_root.as_ref() == Some(&tree_root) {
                    self.apply_file_tree_git_status(&tree_root, &result.status_entries);
                    changed = true;
                    break;
                }
            }
        }

        // Refresh open DiffPanes with pre-computed diff data
        for (cwd, result) in &git_results {
            if let (Some(ref files), Some(ref cache)) = (&result.diff_files, &result.diff_cache) {
                for pane in self.panes.values_mut() {
                    if let PaneKind::Diff(dp) = pane {
                        // Match: DiffPane.cwd equals poller CWD, or both share the same repo root
                        let matches = dp.cwd == *cwd
                            || (result.repo_root.is_some()
                                && self
                                    .bg
                                    .cached_repo_roots
                                    .get(&dp.cwd)
                                    .and_then(|r| r.as_ref())
                                    == result.repo_root.as_ref());
                        if matches {
                            dp.apply_poll_data(files.clone(), cache.clone());
                            changed = true;
                        }
                    }
                }
            }
        }

        // Trigger file tree CWD update with newly cached repo roots
        if self.ft.visible {
            let cwd = self.focus.focused.and_then(|id| match self.panes.get(&id) {
                Some(PaneKind::Terminal(p)) => p.context.cwd.clone(),
                _ => None,
            });
            if let Some(cwd) = cwd {
                if let Some(Some(root)) = self.bg.cached_repo_roots.get(&cwd) {
                    let current_root = self.ft.tree.as_ref().map(|t| t.root().to_path_buf());
                    if current_root.as_ref() != Some(root) {
                        let root = root.clone();
                        if let Some(tree) = self.ft.tree.as_mut() {
                            tree.set_root(root);
                        }
                        self.sync_file_tree_path_identity_cache();
                        self.ft.scroll = 0.0;
                        self.ft.scroll_target = 0.0;
                        changed = true;
                    }
                }
            }
        }

        changed
    }

    /// Start the background Git refresh worker.
    /// Collects unique CWDs from terminal panes and queries git info off the main thread.
    pub(crate) fn start_git_refresh_worker(&mut self) {
        if self.bg.git_worker_handle.is_some() {
            return;
        }

        let (tx, rx) = std::sync::mpsc::channel();
        self.bg.git_refresh_rx = Some(rx);

        let waker = self.bg.event_loop_waker.clone();

        // The main thread sends refresh requests (cwd + wants_diff) via this channel.
        // The worker drains to the latest request set before each run so quick
        // repo switches coalesce to the newest work (P-4).
        let (cwd_tx, cwd_rx) = std::sync::mpsc::channel::<GitWorkerMessage>();

        let handle = std::thread::spawn(move || {
            while let Ok(message) = cwd_rx.recv() {
                let mut requests = match message {
                    GitWorkerMessage::Refresh(requests) => requests,
                    GitWorkerMessage::Shutdown => break,
                };

                loop {
                    let Some(latest) = latest_git_refresh_requests(&cwd_rx, requests) else {
                        return;
                    };
                    requests = latest;
                    let results = collect_git_refresh_results_for_cwds(requests.clone());
                    let Some(newest) = latest_git_refresh_requests(&cwd_rx, requests.clone())
                    else {
                        return;
                    };
                    if newest != requests {
                        requests = newest;
                        continue;
                    }

                    let _ = tx.send(results);
                    if let Some(ref w) = waker {
                        w();
                    }
                    break;
                }
            }
        });

        self.bg.git_worker_handle = Some(handle);
        // Store cwd_tx — we need it accessible. Add a field.
        self.bg.git_worker_tx = Some(cwd_tx);
    }

    /// Execute a context menu action.
    pub(crate) fn execute_context_menu_action(&mut self, action_index: usize) {
        let menu = match self.modal.context_menu.take() {
            Some(m) => m,
            None => return,
        };

        match menu.target {
            crate::ContextMenuTarget::FileTreeEntry {
                entry_index,
                path,
                is_dir,
                is_app_bundle,
                shell_idle,
            } => self.execute_file_tree_context_menu_action(
                action_index,
                entry_index,
                path,
                is_dir,
                is_app_bundle,
                shell_idle,
            ),
            crate::ContextMenuTarget::WorkspaceSidebarItem { ws_index } => {
                self.execute_workspace_context_menu_action(action_index, ws_index)
            }
            crate::ContextMenuTarget::EditorSymbol {
                pane_id,
                identifier,
                line,
                character,
            } => self.execute_editor_symbol_context_menu_action(
                action_index,
                pane_id,
                &identifier,
                line,
                character,
            ),
        }
    }

    /// Run "Go to Definition" / "Find References" from the editor right-click
    /// menu. Prefer real LSP navigation (`textDocument/definition` /
    /// `references`); fall back to the integrated finder's symbol/text search
    /// when no language server is serving the file.
    fn execute_editor_symbol_context_menu_action(
        &mut self,
        action_index: usize,
        pane_id: crate::tide_core::PaneId,
        identifier: &str,
        line: usize,
        character: usize,
    ) {
        let action = match crate::ContextMenuAction::editor_symbol_items().get(action_index) {
            Some(a) => *a,
            None => return,
        };
        let uri = match self.panes.get(&pane_id) {
            Some(crate::PaneKind::Editor(pane)) => pane
                .editor
                .file_path()
                .map(crate::tide_lsp::manager::path_to_uri),
            _ => None,
        };
        let lsp_ready = uri
            .as_ref()
            .map(|u| self.ports.lsp.supports_navigation(u))
            .unwrap_or(false);
        match action {
            crate::ContextMenuAction::GoToDefinition => {
                if let (true, Some(u)) = (lsp_ready, uri.as_ref()) {
                    self.ports
                        .lsp
                        .request_definition(u, line as u32, character as u32);
                } else {
                    let query = self.editor_definition_query(pane_id, identifier);
                    self.open_file_finder_with_query(&query, None);
                }
            }
            crate::ContextMenuAction::FindReferences => {
                if let (true, Some(u)) = (lsp_ready, uri.as_ref()) {
                    self.ports
                        .lsp
                        .request_references(u, line as u32, character as u32);
                } else {
                    let query = Self::editor_references_query(identifier);
                    self.open_file_finder_with_query(&query, None);
                }
            }
            _ => {}
        }
    }

    fn execute_file_tree_context_menu_action(
        &mut self,
        action_index: usize,
        entry_index: usize,
        path: PathBuf,
        is_dir: bool,
        is_app_bundle: bool,
        shell_idle: bool,
    ) {
        let items = crate::ContextMenuAction::items(is_dir, is_app_bundle, shell_idle);
        let action = match items.get(action_index) {
            Some(a) => *a,
            None => return,
        };

        match action {
            crate::ContextMenuAction::CdHere => {
                let path_str = path.to_string_lossy();
                let cmd = format!("cd {}\n", crate::shell_escape(&path_str));
                // Find the focused terminal pane
                if let Some(tid) = self.focus.focused {
                    if let Some(crate::PaneKind::Terminal(pane)) = self.panes.get_mut(&tid) {
                        pane.backend.write(cmd.as_bytes());
                    }
                }
            }
            crate::ContextMenuAction::OpenTerminalHere => {
                self.split_pane(crate::tide_core::SplitDirection::Vertical, Some(path));
            }
            crate::ContextMenuAction::OpenApp => {
                let result = self.ports.process.open_with_default_app(&path);
                Self::log_app_handoff_failure(result, &path);
            }
            crate::ContextMenuAction::Delete => {
                let result = if is_dir {
                    self.ports.fs.remove_dir_all(&path)
                } else {
                    self.ports.fs.remove_file(&path)
                };
                if let Err(e) = result {
                    log::error!("Failed to delete {:?}: {}", path, e);
                }
                if let Some(tree) = self.ft.tree.as_mut() {
                    tree.refresh();
                }
                self.sync_file_tree_path_identity_cache();
                self.request_git_refresh(crate::state::background::GitRefreshCause::TideMutation);
                self.cache.invalidate_chrome();
            }
            crate::ContextMenuAction::RevealInFinder => {
                if Self::is_app_bundle_directory(&path, is_dir) {
                    let _ = self.ports.process.reveal_in_finder(&path);
                } else if is_dir {
                    let _ = self.ports.process.open_with_default_app(&path);
                } else {
                    let _ = self.ports.process.reveal_in_finder(&path);
                }
            }
            crate::ContextMenuAction::Rename => {
                let file_name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                self.modal.file_tree_rename = Some(crate::FileTreeRenameState {
                    entry_index,
                    original_path: path,
                    input: crate::InputLine::with_text(file_name),
                });
                self.cache.invalidate_chrome();
            }
            // Editor-only actions never reach the file-tree menu.
            crate::ContextMenuAction::GoToDefinition | crate::ContextMenuAction::FindReferences => {
            }
        }
        self.cache.needs_redraw = true;
    }

    /// Complete an inline file tree rename: move the file, refresh the tree.
    pub(crate) fn complete_file_tree_rename(&mut self) {
        let rename = match self.modal.file_tree_rename.take() {
            Some(r) => r,
            None => return,
        };

        let new_name = rename.input.text.trim().to_string();
        if new_name.is_empty()
            || new_name
                == rename
                    .original_path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default()
        {
            // No change or empty — cancel
            self.cache.invalidate_chrome();
            return;
        }

        let new_path = rename
            .original_path
            .parent()
            .map(|p| p.join(&new_name))
            .unwrap_or_else(|| PathBuf::from(&new_name));

        if let Err(e) = self.ports.fs.rename(&rename.original_path, &new_path) {
            log::error!(
                "Failed to rename {:?} → {:?}: {}",
                rename.original_path,
                new_path,
                e
            );
        }
        if let Some(tree) = self.ft.tree.as_mut() {
            tree.refresh();
        }
        self.sync_file_tree_path_identity_cache();
        self.request_git_refresh(crate::state::background::GitRefreshCause::TideMutation);
        self.cache.invalidate_chrome();
    }

    pub(crate) fn auto_scroll_file_tree_cursor(&mut self) {
        if let Some(tree_rect) = self.ft.rect {
            let cell_size = self.cell_size();
            let line_height = cell_size.height * crate::theme::FILE_TREE_LINE_SPACING;
            let padding = crate::theme::PANE_PADDING;

            let cursor_y = padding + self.ft.cursor as f32 * line_height;
            let visible_top = self.ft.scroll;
            let visible_bottom = self.ft.scroll + tree_rect.height - padding * 2.0;

            if cursor_y < visible_top {
                self.ft.scroll_target = cursor_y;
                self.ft.scroll = cursor_y;
            } else if cursor_y + line_height > visible_bottom {
                self.ft.scroll_target = cursor_y + line_height - (tree_rect.height - padding * 2.0);
                self.ft.scroll = self.ft.scroll_target;
            }
        }
    }

    pub(crate) fn handle_file_tree_click(&mut self, position: Vec2) {
        enum FileTreeClickResult {
            LaunchBundle(PathBuf),
            OpenEditor(PathBuf),
        }

        // Dismiss context menu and complete/cancel rename on any left click
        self.modal.context_menu = None;
        if self.modal.file_tree_rename.is_some() {
            self.complete_file_tree_rename();
        }

        if !self.ft.visible {
            return;
        }
        let ft_rect = match self.ft.rect {
            Some(r) => r,
            None => return,
        };
        if position.x < ft_rect.x || position.x >= ft_rect.x + ft_rect.width {
            return;
        }

        let cell_size = self.cell_size();

        let line_height = cell_size.height * FILE_TREE_LINE_SPACING;
        // Account for inset content rect and header offset.
        let content_y = self
            .ft
            .rect
            .map(|r| r.y + PANE_CORNER_RADIUS)
            .unwrap_or(self.window.top_inset + PANE_CORNER_RADIUS);
        let adjusted_y = position.y - content_y - FILE_TREE_HEADER_HEIGHT;
        let index = ((adjusted_y + self.ft.scroll) / line_height) as usize;

        // Extract click info from file tree (borrow released before open_editor_pane)
        let click_result = if let Some(tree) = self.ft.tree.as_mut() {
            let entries = tree.visible_entries();
            if index < entries.len() {
                let entry = entries[index].clone();
                if Self::is_app_bundle_directory(&entry.entry.path, entry.entry.is_dir) {
                    Some(FileTreeClickResult::LaunchBundle(entry.entry.path.clone()))
                } else if entry.entry.is_dir {
                    tree.toggle(&entry.entry.path);
                    self.sync_file_tree_path_identity_cache();
                    self.cache.invalidate_chrome();
                    None
                } else {
                    Some(FileTreeClickResult::OpenEditor(entry.entry.path.clone()))
                }
            } else {
                None
            }
        } else {
            None
        };

        if let Some(click_result) = click_result {
            match click_result {
                FileTreeClickResult::LaunchBundle(path) => {
                    let result = self.ports.process.open_with_default_app(&path);
                    Self::log_app_handoff_failure(result, &path);
                }
                FileTreeClickResult::OpenEditor(path) => {
                    let _ = self.open_editor_pane_in_context(path, self.focus.stage_focused);
                }
            }
        }
    }
}

/// Merge two git statuses with priority: Conflict > Modified > rest.
fn merge_git_status(a: FileGitStatus, b: FileGitStatus) -> FileGitStatus {
    use FileGitStatus::*;
    match (a, b) {
        (Conflict, _) | (_, Conflict) => Conflict,
        (Modified, _) | (_, Modified) => Modified,
        _ => a,
    }
}

/// Parse a 2-char git porcelain status code into a FileGitStatus.
fn parse_git_status_code(code: &str) -> Option<FileGitStatus> {
    let bytes = code.as_bytes();
    if bytes.len() < 2 {
        return None;
    }
    let x = bytes[0]; // index (staging area)
    let y = bytes[1]; // working tree

    // Conflict states: both modified, or various add/delete combos
    if (x == b'U' || y == b'U') || (x == b'A' && y == b'A') || (x == b'D' && y == b'D') {
        return Some(FileGitStatus::Conflict);
    }

    // Untracked
    if x == b'?' && y == b'?' {
        return Some(FileGitStatus::Untracked);
    }

    // Added (new file in index)
    if x == b'A' {
        return Some(FileGitStatus::Added);
    }

    // Deleted
    if x == b'D' || y == b'D' {
        return Some(FileGitStatus::Deleted);
    }

    // Modified (either in index or working tree)
    if x == b'M' || y == b'M' || x == b'R' || x == b'C' {
        return Some(FileGitStatus::Modified);
    }

    None
}
