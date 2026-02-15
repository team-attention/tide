use tide_core::{FileTreeSource, Renderer, Vec2};

use crate::pane::PaneKind;
use crate::theme::*;
use crate::App;

impl App {
    pub(crate) fn update_file_tree_cwd(&mut self) {
        if !self.show_file_tree {
            return;
        }

        let cwd = self.focused.and_then(|id| {
            match self.panes.get(&id) {
                Some(PaneKind::Terminal(p)) => p.backend.detect_cwd_fallback(),
                _ => None,
            }
        });

        if let Some(cwd) = cwd {
            if self.last_cwd.as_ref() != Some(&cwd) {
                self.last_cwd = Some(cwd.clone());
                if let Some(tree) = self.file_tree.as_mut() {
                    tree.set_root(cwd);
                }
                self.file_tree_scroll = 0.0;
                self.file_tree_scroll_target = 0.0;
                self.chrome_generation += 1;
            }
        }
    }

    pub(crate) fn file_tree_max_scroll(&self) -> f32 {
        let entry_count = self
            .file_tree
            .as_ref()
            .map(|t| t.visible_entries().len())
            .unwrap_or(0);
        let cell_size = match self.renderer.as_ref() {
            Some(r) => r.cell_size(),
            None => return 0.0,
        };
        let logical = self.logical_size();
        let content_height = PANE_PADDING + entry_count as f32 * cell_size.height * FILE_TREE_LINE_SPACING;
        (content_height - logical.height).max(0.0)
    }

    /// Poll CWD, git info, and shell idle state for all terminal panes.
    /// Bumps chrome_generation if anything changed.
    pub(crate) fn update_terminal_badges(&mut self) {
        let mut changed = false;
        let pane_ids: Vec<tide_core::PaneId> = self.panes.keys().copied().collect();
        for id in pane_ids {
            if let Some(PaneKind::Terminal(pane)) = self.panes.get_mut(&id) {
                // CWD
                let new_cwd = pane.backend.detect_cwd_fallback();
                if new_cwd != pane.cwd {
                    pane.cwd = new_cwd;
                    changed = true;
                }

                // Git info (only if CWD is available)
                let new_git = pane.cwd.as_ref().and_then(|cwd| {
                    tide_terminal::git::detect_git_info(cwd)
                });
                let git_changed = match (&pane.git_info, &new_git) {
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
                    pane.git_info = new_git;
                    changed = true;
                }

                // Shell idle
                let new_idle = pane.backend.is_shell_idle();
                if new_idle != pane.shell_idle {
                    pane.shell_idle = new_idle;
                    changed = true;
                }
            }
        }
        if changed {
            self.chrome_generation += 1;
        }
    }

    pub(crate) fn handle_file_tree_click(&mut self, position: Vec2) {
        if !self.show_file_tree || position.x >= self.file_tree_width {
            return;
        }

        let cell_size = match self.renderer.as_ref() {
            Some(r) => r.cell_size(),
            None => return,
        };

        let line_height = cell_size.height * FILE_TREE_LINE_SPACING;
        // Account for padding offset (no gap — tree is flush with window edge)
        let adjusted_y = position.y - PANE_PADDING;
        let index = ((adjusted_y + self.file_tree_scroll) / line_height) as usize;

        // Extract click info from file tree (borrow released before open_editor_pane)
        let click_result = if let Some(tree) = self.file_tree.as_mut() {
            let entries = tree.visible_entries();
            if index < entries.len() {
                let entry = entries[index].clone();
                if entry.entry.is_dir {
                    tree.toggle(&entry.entry.path);
                    self.chrome_generation += 1;
                    None
                } else {
                    Some(entry.entry.path.clone())
                }
            } else {
                None
            }
        } else {
            None
        };

        if let Some(path) = click_result {
            self.open_editor_pane(path);
        }
    }
}
