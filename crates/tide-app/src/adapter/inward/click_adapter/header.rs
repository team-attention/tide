use crate::tide_core::{Rect, SplitDirection, TerminalBackend};

use crate::header::{HeaderHitAction, HeaderHitZone};
use crate::pane::PaneKind;
use crate::{App, DockPort, FileOpsPort, GitSwitcherMode, GitSwitcherState, shell_escape};
use crate::LayoutPort;
use crate::WorkspaceNavPort;
use crate::ActionPort;
use crate::PaneLifecyclePort;

impl App {
    /// Check if the current cursor position clicks on a header badge or close button.
    /// Returns true if the click was consumed.
    pub(crate) fn check_header_click(&mut self) -> bool {
        let pos = self.window.last_cursor_pos;
        let zones: Vec<HeaderHitZone> = self.header_hit_zones.clone();
        for zone in &zones {
            if zone.rect.contains(pos) {
                match zone.action {
                    HeaderHitAction::Close => {
                        self.close_specific_pane(zone.pane_id);
                        self.cache.needs_redraw = true;
                        return true;
                    }
                    HeaderHitAction::GitBranch => {
                        self.open_git_switcher(zone.pane_id, GitSwitcherMode::Branches, zone.rect);
                        self.cache.needs_redraw = true;
                        return true;
                    }
                    HeaderHitAction::GitStatus => {
                        let cwd = if let Some(PaneKind::Terminal(pane)) = self.panes.get(&zone.pane_id) {
                            pane.context.cwd.clone()
                        } else {
                            None
                        };
                        if let Some(cwd) = cwd {
                            self.open_diff_pane(cwd);
                        }
                        self.cache.needs_redraw = true;
                        return true;
                    }
                    HeaderHitAction::EditorCompare => {
                        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&zone.pane_id) {
                            if let Some(path) = pane.editor.file_path().map(|p| p.to_path_buf()) {
                                match self.ports.fs.read_to_string(&path) {
                                    Ok(content) => {
                                        let lines: Vec<String> = content.lines().map(String::from).collect();
                                        pane.disk_content = Some(lines);
                                        pane.diff_mode = true;
                                    }
                                    Err(e) => {
                                        log::error!("Failed to read disk content for diff: {}", e);
                                    }
                                }
                            }
                        }
                        self.cache.invalidate_chrome();
                        self.cache.invalidate_pane(zone.pane_id);
                        return true;
                    }
                    HeaderHitAction::EditorBack => {
                        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&zone.pane_id) {
                            pane.diff_mode = false;
                            pane.disk_content = None;
                        }
                        self.cache.invalidate_chrome();
                        self.cache.invalidate_pane(zone.pane_id);
                        return true;
                    }
                    HeaderHitAction::MarkdownPreview => {
                        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&zone.pane_id) {
                            pane.toggle_preview();
                        }
                        self.cache.invalidate_chrome();
                        self.cache.invalidate_pane(zone.pane_id);
                        return true;
                    }
                    HeaderHitAction::EditorFileName => {
                        // Allow drag from editor filename area
                        self.interaction.pane_drag = crate::state::drag_types::PaneDragState::PendingDrag {
                            source_pane: zone.pane_id,
                            press_pos: self.window.last_cursor_pos,
                        };
                        self.focus_terminal(zone.pane_id);
                        self.cache.needs_redraw = true;
                        return true;
                    }
                    HeaderHitAction::DiffRefresh => {
                        if let Some(PaneKind::Diff(dp)) = self.panes.get_mut(&zone.pane_id) {
                            dp.refresh();
                        }
                        self.cache.invalidate_chrome();
                        self.cache.invalidate_pane(zone.pane_id);
                        return true;
                    }
                    HeaderHitAction::Maximize => {
                        // Toggle zoom for this pane
                        self.focus_terminal(zone.pane_id);
                        if self.is_pane_in_dock(zone.pane_id) {
                            self.dock.dock_zoomed = !self.dock.dock_zoomed;
                        } else {
                            // Stage pane: toggle zoomed_pane
                            if self.focus.zoomed_pane == Some(zone.pane_id) {
                                self.focus.zoomed_pane = None;
                            } else {
                                self.focus.zoomed_pane = Some(zone.pane_id);
                            }
                        }
                        self.cache.invalidate_chrome();
                        self.cache.pane_generations.clear();
                        self.compute_layout();
                        self.cache.needs_redraw = true;
                        return true;
                    }
                    HeaderHitAction::DockTab(target_pane_id) => {
                        // Switch tab immediately for visual feedback, but also
                        // set PendingDrag to allow drag-and-drop reordering.
                        self.focus_terminal(target_pane_id);
                        self.interaction.pane_drag = crate::state::drag_types::PaneDragState::PendingDrag {
                            source_pane: target_pane_id,
                            press_pos: self.window.last_cursor_pos,
                        };
                        self.cache.invalidate_chrome();
                        self.cache.pane_generations.clear();
                        self.compute_layout();
                        self.cache.needs_redraw = true;
                        return true;
                    }
                    HeaderHitAction::StageTab(target_pane_id) => {
                        // Switch zoomed pane in Stage stacked mode
                        self.focus.zoomed_pane = Some(target_pane_id);
                        self.focus_terminal(target_pane_id);
                        self.cache.pane_generations.clear();
                        self.compute_layout();
                        self.cache.needs_redraw = true;
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Open the git switcher popup (works even when a process is running).
    /// Clicking the same badge again closes the popup (toggle behavior).
    fn open_git_switcher(&mut self, pane_id: crate::tide_core::PaneId, mode: GitSwitcherMode, anchor_rect: Rect) {
        // Cancel any in-progress drag when opening a modal
        self.interaction.pane_drag = crate::state::drag_types::PaneDragState::Idle;
        // Toggle: close if already open for the same pane and mode
        if let Some(ref gs) = self.modal.git_switcher {
            if gs.pane_id == pane_id && gs.mode == mode {
                self.modal.git_switcher = None;
                return;
            }
        }
        if let Some(PaneKind::Terminal(pane)) = self.panes.get(&pane_id) {
            let shell_busy = !pane.context.shell_idle;
            if let Some(ref cwd) = pane.context.cwd {
                let branches = self.ports.git.list_branches(cwd);
                let worktrees = self.ports.git.list_worktrees(cwd);
                let mut gs = GitSwitcherState::new(
                    pane_id, mode, branches, worktrees, anchor_rect,
                );
                gs.shell_busy = shell_busy;
                self.modal.git_switcher = Some(gs);
            }
        }
    }

    /// Get the cwd of the terminal pane associated with the git switcher.
    fn git_switcher_pane_cwd(&self) -> Option<std::path::PathBuf> {
        let gs = self.modal.git_switcher.as_ref()?;
        match self.panes.get(&gs.pane_id) {
            Some(PaneKind::Terminal(p)) => p.context.cwd.clone(),
            _ => None,
        }
    }

    /// Handle a git switcher popup button click.
    pub(crate) fn handle_git_switcher_button(&mut self, btn: crate::SwitcherButton) {
        match btn {
            crate::SwitcherButton::Switch(fi) => {
                let gs = match self.modal.git_switcher.as_ref() {
                    Some(gs) => gs,
                    None => return,
                };
                let pane_id = gs.pane_id;

                if gs.is_create_row(fi) {
                    // Create row
                    let query = gs.input.text.trim().to_string();
                    let mode = gs.mode;
                    let cwd = self.git_switcher_pane_cwd();
                    self.modal.git_switcher = None;
                    if let Some(cwd) = cwd {
                        match mode {
                            crate::GitSwitcherMode::Branches => {
                                if let Some(PaneKind::Terminal(pane)) = self.panes.get_mut(&pane_id) {
                                    if pane.context.shell_idle {
                                        let cmd = format!("git checkout -b {}\n", shell_escape(&query));
                                        pane.backend.write(cmd.as_bytes());
                                    }
                                }
                            }
                            crate::GitSwitcherMode::Worktrees => {
                                let root = self.ports.git.repo_root(&cwd).unwrap_or_else(|| cwd.clone());
                                let settings = self.ports.persistence.load_settings();
                                let wt_path = settings.worktree.compute_worktree_path(&root, &query);
                                let new_branch = !self.ports.git.branch_exists(&cwd, &query);
                                match self.ports.git.add_worktree(&cwd, &wt_path, &query, new_branch) {
                                    Ok(()) => {
                                        settings.worktree.copy_files_to_worktree(&root, &wt_path);
                                        if let Some(PaneKind::Terminal(pane)) = self.panes.get_mut(&pane_id) {
                                            if pane.context.shell_idle {
                                                let cmd = format!("cd {}\n", shell_escape(&wt_path.to_string_lossy()));
                                                pane.backend.write(cmd.as_bytes());
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        log::error!("Failed to create worktree: {}", e);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    match gs.mode {
                        crate::GitSwitcherMode::Branches => {
                            let action = {
                                let entry_idx = match gs.filtered_branches.get(fi) {
                                    Some(&i) => i,
                                    None => { self.modal.git_switcher = None; return; }
                                };
                                let branch = &gs.branches[entry_idx];
                                if branch.is_current { self.modal.git_switcher = None; return; }
                                let has_wt = gs.worktree_branch_names.contains(&branch.name);
                                if has_wt {
                                    let wt_path = gs.worktrees.iter()
                                        .find(|wt| wt.branch.as_deref() == Some(&branch.name))
                                        .map(|wt| wt.path.to_string_lossy().to_string());
                                    (branch.name.clone(), wt_path)
                                } else {
                                    (branch.name.clone(), None)
                                }
                            };
                            self.modal.git_switcher = None;
                            if let Some(PaneKind::Terminal(pane)) = self.panes.get_mut(&pane_id) {
                                if pane.context.shell_idle {
                                    let cmd = if let Some(wt_path) = action.1 {
                                        format!("cd {}\n", shell_escape(&wt_path))
                                    } else {
                                        format!("git checkout {}\n", shell_escape(&action.0))
                                    };
                                    pane.backend.write(cmd.as_bytes());
                                }
                            }
                        }
                        crate::GitSwitcherMode::Worktrees => {
                            let action = gs.filtered_worktrees.get(fi).and_then(|&entry_idx| {
                                let wt = gs.worktrees.get(entry_idx)?;
                                Some(wt.path.to_string_lossy().to_string())
                            });
                            self.modal.git_switcher = None;
                            if let Some(path) = action {
                                if let Some(PaneKind::Terminal(pane)) = self.panes.get_mut(&pane_id) {
                                    if pane.context.shell_idle {
                                        let cmd = format!("cd {}\n", shell_escape(&path));
                                        pane.backend.write(cmd.as_bytes());
                                    }
                                }
                            }
                        }
                    }
                }
            }
            crate::SwitcherButton::Delete(fi) => {
                let (is_create, already_confirmed, mode) = match self.modal.git_switcher.as_ref() {
                    Some(gs) => (gs.is_create_row(fi), gs.delete_confirm == Some(fi), gs.mode),
                    None => return,
                };
                if is_create { return; }

                if !already_confirmed {
                    if let Some(ref mut gs) = self.modal.git_switcher {
                        gs.delete_confirm = Some(fi);
                    }
                    self.cache.invalidate_chrome();
                    return;
                }
                if let Some(ref mut gs) = self.modal.git_switcher {
                    gs.delete_confirm = None;
                }

                let cwd = self.git_switcher_pane_cwd();

                match mode {
                    crate::GitSwitcherMode::Branches => {
                        let (branch_name, wt_path) = {
                            let gs = self.modal.git_switcher.as_ref().unwrap();
                            let entry_idx = match gs.filtered_branches.get(fi) {
                                Some(&i) => i,
                                None => return,
                            };
                            let branch = &gs.branches[entry_idx];
                            if branch.is_current { return; }
                            let wt_path = gs.worktrees.iter()
                                .find(|wt| wt.branch.as_deref() == Some(&branch.name))
                                .map(|wt| wt.path.clone());
                            (branch.name.clone(), wt_path)
                        };
                        if let Some(cwd) = cwd {
                            if let Some(ref wt_path) = wt_path {
                                if let Err(e) = self.ports.git.remove_worktree(&cwd, wt_path, true) {
                                    log::error!("Failed to remove worktree: {}", e);
                                }
                            }
                            if let Err(e) = self.ports.git.delete_branch(&cwd, &branch_name, true) {
                                log::error!("Failed to delete branch: {}", e);
                            }
                        }
                    }
                    crate::GitSwitcherMode::Worktrees => {
                        let (wt_path, branch_name, is_main) = {
                            let gs = self.modal.git_switcher.as_ref().unwrap();
                            let entry_idx = match gs.filtered_worktrees.get(fi) {
                                Some(&i) => i,
                                None => return,
                            };
                            let wt = &gs.worktrees[entry_idx];
                            if wt.is_current || wt.is_main { return; }
                            (wt.path.clone(), wt.branch.clone(), wt.is_main)
                        };
                        if let Some(cwd) = cwd {
                            if !is_main {
                                if let Err(e) = self.ports.git.remove_worktree(&cwd, &wt_path, true) {
                                    log::error!("Failed to remove worktree: {}", e);
                                }
                                if let Some(ref branch) = branch_name {
                                    if branch != "main" && branch != "master" {
                                        if let Err(e) = self.ports.git.delete_branch(&cwd, branch, true) {
                                            log::error!("Failed to delete branch: {}", e);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                self.refresh_git_switcher();
                self.cache.invalidate_chrome();
                return;
            }
            crate::SwitcherButton::NewPane(fi) => {
                let gs = match self.modal.git_switcher.as_ref() {
                    Some(gs) => gs,
                    None => return,
                };
                let pane_id = gs.pane_id;

                if gs.is_create_row(fi) {
                    let query = gs.input.text.trim().to_string();
                    let mode = gs.mode;
                    let cwd = self.git_switcher_pane_cwd();
                    self.modal.git_switcher = None;
                    if let Some(cwd) = cwd {
                        match mode {
                            crate::GitSwitcherMode::Branches => {
                                if let Some(new_id) = self.split_pane_from(pane_id, SplitDirection::Horizontal, Some(cwd)) {
                                    if let Some(PaneKind::Terminal(pane)) = self.panes.get_mut(&new_id) {
                                        let cmd = format!("git checkout -b {}\n", shell_escape(&query));
                                        pane.backend.write(cmd.as_bytes());
                                    }
                                }
                            }
                            crate::GitSwitcherMode::Worktrees => {
                                let root = self.ports.git.repo_root(&cwd).unwrap_or_else(|| cwd.clone());
                                let settings = self.ports.persistence.load_settings();
                                let wt_path = settings.worktree.compute_worktree_path(&root, &query);
                                let new_branch = !self.ports.git.branch_exists(&cwd, &query);
                                match self.ports.git.add_worktree(&cwd, &wt_path, &query, new_branch) {
                                    Ok(()) => {
                                        settings.worktree.copy_files_to_worktree(&root, &wt_path);
                                        self.split_pane_from(pane_id, SplitDirection::Horizontal, Some(wt_path));
                                    }
                                    Err(e) => {
                                        log::error!("Failed to create worktree: {}", e);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    match gs.mode {
                        crate::GitSwitcherMode::Branches => {
                            let action = {
                                let entry_idx = match gs.filtered_branches.get(fi) {
                                    Some(&i) => i,
                                    None => { self.modal.git_switcher = None; return; }
                                };
                                let branch = &gs.branches[entry_idx];
                                if branch.is_current { self.modal.git_switcher = None; return; }
                                let has_wt = gs.worktree_branch_names.contains(&branch.name);
                                if has_wt {
                                    let wt_path = gs.worktrees.iter()
                                        .find(|wt| wt.branch.as_deref() == Some(&branch.name))
                                        .map(|wt| wt.path.clone());
                                    (branch.name.clone(), wt_path)
                                } else {
                                    (branch.name.clone(), None)
                                }
                            };
                            let pane_cwd = self.panes.get(&pane_id)
                                .and_then(|pk| if let PaneKind::Terminal(p) = pk { p.context.cwd.clone() } else { None });
                            self.modal.git_switcher = None;
                            if let Some(wt_path) = action.1 {
                                self.split_pane_from(pane_id, SplitDirection::Horizontal, Some(wt_path));
                            } else {
                                if let Some(new_id) = self.split_pane_from(pane_id, SplitDirection::Horizontal, pane_cwd) {
                                    if let Some(PaneKind::Terminal(pane)) = self.panes.get_mut(&new_id) {
                                        let cmd = format!("git checkout {}\n", shell_escape(&action.0));
                                        pane.backend.write(cmd.as_bytes());
                                    }
                                }
                            }
                        }
                        crate::GitSwitcherMode::Worktrees => {
                            let wt_path = gs.filtered_worktrees.get(fi).and_then(|&entry_idx| {
                                let wt = gs.worktrees.get(entry_idx)?;
                                Some(wt.path.clone())
                            });
                            self.modal.git_switcher = None;
                            if let Some(wt_path) = wt_path {
                                self.split_pane_from(pane_id, SplitDirection::Horizontal, Some(wt_path));
                            }
                        }
                    }
                }
            }
        }
        self.cache.invalidate_chrome();
    }

    /// Refresh the git switcher popup in-place after a delete operation.
    fn refresh_git_switcher(&mut self) {
        let gs = match self.modal.git_switcher.as_ref() {
            Some(gs) => gs,
            None => return,
        };
        let pane_id = gs.pane_id;
        let mode = gs.mode;
        let input_text = gs.input.text.clone();
        let input_cursor = gs.input.cursor;
        let anchor_rect = gs.anchor_rect;
        let shell_busy = gs.shell_busy;

        let cwd = match self.panes.get(&pane_id) {
            Some(PaneKind::Terminal(p)) => p.context.cwd.clone(),
            _ => None,
        };
        if let Some(cwd) = cwd {
            let branches = self.ports.git.list_branches(&cwd);
            let worktrees = self.ports.git.list_worktrees(&cwd);
            let mut new_gs = GitSwitcherState::new(
                pane_id, mode, branches, worktrees, anchor_rect,
            );
            new_gs.shell_busy = shell_busy;
            new_gs.input.text = input_text;
            new_gs.input.cursor = input_cursor;
            if !new_gs.input.is_empty() {
                let query_lower = new_gs.input.text.to_lowercase();
                new_gs.filtered_branches = new_gs.branches.iter().enumerate()
                    .filter(|(_, b)| b.name.to_lowercase().contains(&query_lower))
                    .map(|(i, _)| i)
                    .collect();
                new_gs.filtered_worktrees = new_gs.worktrees.iter().enumerate()
                    .filter(|(_, wt)| {
                        let branch_match = wt.branch.as_ref()
                            .map(|b| b.to_lowercase().contains(&query_lower))
                            .unwrap_or_else(|| "(detached)".contains(&query_lower));
                        let path_match = wt.path.to_string_lossy().to_lowercase().contains(&query_lower);
                        branch_match || path_match
                    })
                    .map(|(i, _)| i)
                    .collect();
            }
            let len = new_gs.current_filtered_len();
            if new_gs.selected >= len && len > 0 {
                new_gs.selected = len - 1;
            }
            self.modal.git_switcher = Some(new_gs);
        }
    }
}
