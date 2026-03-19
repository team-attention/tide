use std::path::PathBuf;

use tide_core::LayoutEngine;

use crate::event_handler::drag_drop::PaneDragState;
use crate::pane::PaneKind;
use crate::App;

impl App {
    /// Close a pane tab. If dirty (and has a file path), show save confirm bar instead.
    /// Untitled (new) files and browser panes close immediately without prompting.
    pub(crate) fn close_editor_panel_tab(&mut self, tab_id: tide_core::PaneId) {
        // Browser panes close immediately (no dirty check)
        if matches!(self.panes.get(&tab_id), Some(PaneKind::Browser(_))) {
            self.force_close_editor_panel_tab(tab_id);
            return;
        }
        // Check if editor is dirty -> show save confirm bar (skip for untitled files)
        if let Some(PaneKind::Editor(pane)) = self.panes.get(&tab_id) {
            if pane.editor.is_modified() && pane.editor.file_path().is_some() {
                self.modal.save_confirm = Some(crate::SaveConfirmState { pane_id: tab_id });
                // Ensure this pane is focused so the bar is visible
                self.focus.focused = Some(tab_id);
                self.router.set_focused(tab_id);
                self.cache.invalidate_chrome();
                self.cache.invalidate_pane(tab_id);
                return;
            }
        }
        self.force_close_editor_panel_tab(tab_id);
    }

    /// Force close a pane tab (no dirty check).
    pub(crate) fn force_close_editor_panel_tab(&mut self, tab_id: tide_core::PaneId) {
        // Cancel drag if the closing pane is the drag source
        if self.interaction.pane_drag.source_pane() == Some(tab_id) {
            self.interaction.pane_drag = PaneDragState::Idle;
        }
        // Destroy webview before removing the pane
        if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&tab_id) {
            bp.destroy();
        }
        // Cancel save-as if the target pane is being closed
        if self.modal.save_as_input.as_ref().is_some_and(|s| s.pane_id == tab_id) {
            self.modal.save_as_input = None;
        }
        // Cancel save confirm if the target pane is being closed
        if self.modal.save_confirm.as_ref().is_some_and(|s| s.pane_id == tab_id) {
            self.modal.save_confirm = None;
        }
        // Unwatch the file before removing the pane
        let watch_path = if let Some(PaneKind::Editor(editor)) = self.panes.get(&tab_id) {
            editor.editor.file_path().map(|p| p.to_path_buf())
        } else {
            None
        };
        if let Some(path) = watch_path {
            self.unwatch_file(&path);
        }

        // Check if pane is in a Terminal's dock
        if self.is_pane_in_dock(tab_id) {
            self.retain_terminal_context(tab_id);
            // Remove from dock_layout BEFORE removing from panes,
            // so terminal_owning() can still find the owner terminal.
            self.remove_pane_from_dock(tab_id);
            self.panes.remove(&tab_id);
            self.cleanup_closed_pane_state(tab_id);
            self.cache.invalidate_chrome();
            self.compute_layout();
            return;
        }

        // Determine next focus target BEFORE removal so we can find a
        // layout neighbor while the tree is still intact.
        let next_focus = if self.focus.focused == Some(tab_id) {
            self.layout.right_neighbor_pane(tab_id)
                .or_else(|| {
                    // No right neighbor — pick any remaining pane
                    self.layout.pane_ids().iter()
                        .find(|&&id| id != tab_id)
                        .copied()
                })
        } else {
            None // Focused pane is not being closed
        };

        // Retain terminal context before removing (soft delete)
        self.retain_terminal_context(tab_id);

        // Remove from layout
        self.layout.remove(tab_id);
        self.panes.remove(&tab_id);
        self.cleanup_closed_pane_state(tab_id);

        // Apply the pre-computed focus target
        if self.focus.focused == Some(tab_id) {
            if let Some(id) = next_focus {
                self.focus.focused = Some(id);
                self.router.set_focused(id);
            } else {
                self.focus.focused = None;
            }
            self.focus.focus_area = crate::state::FocusArea::Stage;
        }

        // Check if layout is now empty
        if self.layout.pane_ids().is_empty() {
            // If other workspaces exist, close this one instead of exiting
            if self.ws.workspaces.len() > 1 {
                self.close_workspace();
                return;
            }
            self.exit_app();
        }

        self.cache.pane_generations.clear();
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Complete the save-as flow: resolve path, set file_path, detect syntax, save, watch.
    pub(crate) fn complete_save_as(&mut self, pane_id: tide_core::PaneId, filename: &str) {
        let path = if std::path::Path::new(filename).is_absolute() {
            PathBuf::from(filename)
        } else {
            self.resolve_base_dir().join(filename)
        };

        // Create parent dirs if needed
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                let _ = std::fs::create_dir_all(parent);
            }
        }

        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
            pane.editor.buffer.file_path = Some(path.clone());
            pane.editor.detect_and_set_syntax(&path);
            if let Err(e) = pane.editor.buffer.save() {
                log::error!("Failed to save file: {}", e);
            }
            pane.disk_changed = false;
        }

        self.watch_file(&path);
        self.cache.invalidate_chrome();
    }

    /// Close a specific pane by its ID (used by close button clicks).
    pub(crate) fn close_specific_pane(&mut self, pane_id: tide_core::PaneId) {
        // Check if editor is dirty -> show save confirm bar
        if let Some(PaneKind::Editor(pane)) = self.panes.get(&pane_id) {
            if pane.editor.is_modified() && pane.editor.file_path().is_some() {
                self.modal.save_confirm = Some(crate::SaveConfirmState { pane_id });
                self.focus.focused = Some(pane_id);
                self.router.set_focused(pane_id);
                self.cache.invalidate_chrome();
                self.cache.invalidate_pane(pane_id);
                return;
            }
        }

        // Non-terminal panes (editors, browsers, diff, launchers) close immediately
        if matches!(self.panes.get(&pane_id), Some(PaneKind::Editor(_) | PaneKind::Browser(_) | PaneKind::Diff(_) | PaneKind::Launcher(_))) {
            self.force_close_editor_panel_tab(pane_id);
            self.update_file_tree_cwd();
            return;
        }

        // Terminal in dock: close via dock removal path
        if self.is_pane_in_dock(pane_id) {
            self.force_close_editor_panel_tab(pane_id);
            self.update_file_tree_cwd();
            return;
        }

        // Terminal pane in Stage: proceed to force close (with branch cleanup check)
        self.force_close_specific_pane(pane_id);
    }

    /// Force close a specific pane (no dirty check).
    /// May show branch cleanup confirmation for terminals on non-main branches.
    pub(crate) fn force_close_specific_pane(&mut self, pane_id: tide_core::PaneId) {
        // Cancel save-as if the target pane is being closed
        if self.modal.save_as_input.as_ref().is_some_and(|s| s.pane_id == pane_id) {
            self.modal.save_as_input = None;
        }
        // Cancel save confirm
        if self.modal.save_confirm.as_ref().is_some_and(|s| s.pane_id == pane_id) {
            self.modal.save_confirm = None;
        }

        // Non-terminal panes: close directly
        if !matches!(self.panes.get(&pane_id), Some(PaneKind::Terminal(_))) {
            self.force_close_editor_panel_tab(pane_id);
            self.update_file_tree_cwd();
            return;
        }

        // If branch cleanup bar is already showing for this pane, block the close —
        // the user must resolve it via Delete/Keep/Cancel first.
        if self.modal.branch_cleanup.as_ref().is_some_and(|bc| bc.pane_id == pane_id) {
            return;
        }

        // Branch cleanup check: if this is a terminal on a non-main branch,
        // prompt before closing (unless cleanup is already active for another pane).
        if self.modal.branch_cleanup.is_none() {
            if let Some(PaneKind::Terminal(pane)) = self.panes.get(&pane_id) {
                if let (Some(ref gi), Some(ref cwd)) = (&pane.context.git_info, &pane.context.cwd) {
                    let branch = &gi.branch;
                    if branch != "main" && branch != "master" {
                        // Check no other terminal pane is on the same branch
                        let other_on_same = self.panes.iter().any(|(&id, pk)| {
                            if id == pane_id { return false; }
                            if let PaneKind::Terminal(tp) = pk {
                                tp.context.git_info.as_ref()
                                    .map(|g| g.branch == *branch)
                                    .unwrap_or(false)
                            } else {
                                false
                            }
                        });
                        if !other_on_same {
                            // Detect if cwd is in a worktree
                            let worktrees = tide_terminal::git::list_worktrees(cwd);
                            let wt_path = worktrees.iter()
                                .find(|wt| wt.is_current && !wt.is_main)
                                .map(|wt| wt.path.clone());

                            self.modal.branch_cleanup = Some(crate::BranchCleanupState {
                                pane_id,
                                branch: branch.clone(),
                                worktree_path: wt_path,
                                cwd: cwd.clone(),
                            });
                            self.cache.invalidate_chrome();
                            return;
                        }
                    }
                }
            }
        }

        self.close_pane_final(pane_id);
    }

    /// Close a pane unconditionally (no dirty check, no branch cleanup check).
    /// Used by branch cleanup confirm/keep methods after cleanup is resolved.
    fn close_pane_final(&mut self, pane_id: tide_core::PaneId) {
        // Cancel drag if the closing pane is the drag source
        if self.interaction.pane_drag.source_pane() == Some(pane_id) {
            self.interaction.pane_drag = PaneDragState::Idle;
        }
        let remaining = self.layout.pane_ids();
        if remaining.len() <= 1 {
            // If other workspaces exist, close this one instead of exiting
            if self.ws.workspaces.len() > 1 {
                self.close_workspace();
                return;
            }
            // Show native confirmation before closing the app
            if tide_platform::show_close_confirm() {
                self.exit_app();
            }
            return;
        }

        // Determine next focus target BEFORE removal so we can find a
        // layout neighbor while the tree is still intact.
        let next_focus = self.layout.right_neighbor_pane(pane_id)
            .or_else(|| {
                self.layout.pane_ids().iter()
                    .find(|&&id| id != pane_id)
                    .copied()
            });

        // Retain terminal context before removing (soft delete)
        self.retain_terminal_context(pane_id);

        self.layout.remove(pane_id);
        self.panes.remove(&pane_id);
        self.cleanup_closed_pane_state(pane_id);

        if let Some(next) = next_focus {
            self.focus.focused = Some(next);
            self.router.set_focused(next);
            // Stacked mode: move zoom to the next pane instead of dropping mode
            if self.focus.zoomed_pane == Some(pane_id) {
                self.focus.zoomed_pane = Some(next);
            }
        } else {
            self.focus.focused = None;
        }

        self.cache.invalidate_chrome();
        self.compute_layout();
        self.update_file_tree_cwd();
    }

    /// Extract and retain a terminal's context before it is removed from panes.
    /// This allows associated panes to still resolve the terminal's cwd.
    fn retain_terminal_context(&mut self, pane_id: tide_core::PaneId) {
        if let Some(PaneKind::Terminal(pane)) = self.panes.get(&pane_id) {
            // Only retain if some pane still references this terminal
            let has_dependents = self.assoc.associated_terminal.values().any(|&v| v == pane_id);
            if has_dependents {
                self.assoc.retained_contexts.insert(pane_id, pane.context.clone());
            }
        }
    }

    /// Save and close the pane from the save confirm bar.
    pub(crate) fn confirm_save_and_close(&mut self) {
        let pane_id = match self.modal.save_confirm.take() {
            Some(sc) => sc.pane_id,
            None => return,
        };
        // Save
        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
            if pane.editor.file_path().is_none() {
                // Untitled file -> open save-as input
                let base_dir = self.resolve_base_dir();
                let anchor = self.visual_pane_rects.iter()
                    .find(|(id, _)| *id == pane_id)
                    .map(|(_, r)| tide_core::Rect::new(r.x, r.y, r.width, crate::theme::TAB_BAR_HEIGHT))
                    .unwrap_or_else(|| tide_core::Rect::new(0.0, 0.0, 0.0, 0.0));
                self.modal.save_as_input = Some(crate::SaveAsInput::new(pane_id, base_dir, anchor));
                return;
            }
            if let Err(e) = pane.editor.buffer.save() {
                log::error!("Save failed: {}", e);
                return;
            }
            pane.disk_changed = false;
        }
        // Close
        self.force_close_editor_panel_tab(pane_id);
        // Retry pending terminal close (may find more dirty editors)
        if let Some(tid) = self.assoc.pending_terminal_close.take() {
            if self.panes.contains_key(&tid) {
                self.close_specific_pane(tid);
            }
        }
    }

    /// Discard changes and close the pane from the save confirm bar.
    pub(crate) fn confirm_discard_and_close(&mut self) {
        let pane_id = match self.modal.save_confirm.take() {
            Some(sc) => sc.pane_id,
            None => return,
        };
        self.force_close_editor_panel_tab(pane_id);
        // Retry pending terminal close (may find more dirty editors)
        if let Some(tid) = self.assoc.pending_terminal_close.take() {
            if self.panes.contains_key(&tid) {
                self.close_specific_pane(tid);
            }
        }
    }

    /// Cancel the save confirm bar.
    pub(crate) fn cancel_save_confirm(&mut self) {
        if self.modal.clear_save_confirm() {
            self.assoc.pending_terminal_close = None;
            self.cache.invalidate_chrome();
            self.cache.pane_generations.clear();
        }
    }

    /// Delete the branch/worktree and proceed with closing the terminal pane.
    pub(crate) fn confirm_branch_delete(&mut self) {
        let bc = match self.modal.branch_cleanup.take() {
            Some(bc) => bc,
            None => return,
        };
        // Resolve the main worktree path BEFORE closing anything.
        // bc.cwd may be inside a worktree that will be removed.
        let main_cwd = if bc.worktree_path.is_some() {
            let worktrees = tide_terminal::git::list_worktrees(&bc.cwd);
            worktrees.iter()
                .find(|wt| wt.is_main)
                .map(|wt| wt.path.clone())
                .unwrap_or_else(|| bc.cwd.clone())
        } else {
            bc.cwd.clone()
        };
        // Close the pane first so the terminal process releases the directory
        self.close_pane_final(bc.pane_id);
        // Remove worktree if applicable (directory is now free)
        if let Some(ref wt_path) = bc.worktree_path {
            if let Err(e) = tide_terminal::git::remove_worktree(&main_cwd, wt_path, true) {
                log::error!("Failed to remove worktree: {}", e);
            }
        }
        // Delete the branch from the main repo
        if let Err(e) = tide_terminal::git::delete_branch(&main_cwd, &bc.branch, true) {
            log::error!("Failed to delete branch: {}", e);
        }
    }

    /// Keep the branch and proceed with closing the terminal pane.
    pub(crate) fn confirm_branch_keep(&mut self) {
        let bc = match self.modal.branch_cleanup.take() {
            Some(bc) => bc,
            None => return,
        };
        self.close_pane_final(bc.pane_id);
    }

    /// Cancel the branch cleanup (abort the close entirely).
    pub(crate) fn cancel_branch_cleanup(&mut self) {
        if self.modal.clear_branch_cleanup() {
            self.cache.invalidate_chrome();
        }
    }
}
