// Workspace, focus, navigation, and config page management.

use crate::tide_core::{PaneId};
use crate::tide_input::AreaSlot;

use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::App;
use crate::ClipboardSearchPort;
use crate::DockPort;
use crate::FocusNavPort;
use crate::LayoutPort;

impl crate::application::ports::inward::WorkspaceNavPort for App {
    fn focus_terminal(&mut self, id: PaneId) {
        // Dock pane (pinned or terminal-owned): focus it, don't change stage_focused
        if self.is_pane_in_dock(id) {
            self.focus.focus_area = FocusArea::Dock;
            self.focus.focused = Some(id);
            self.router.set_focused(id);
            // Update dock_focused on the owning terminal (if not pinned)
            if let Some(tid) = self.terminal_owning(id) {
                if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                    tp.dock_focused = Some(id);
                    tp.dock_layout.set_active_tab(id);
                }
            }
            // If pinned, set active tab in pinned layout
            if self.is_pane_pinned(id) {
                self.dock.pinned_dock_layout.set_active_tab(id);
            }
            self.cache.invalidate_chrome();
            self.sync_browser_webview_frames();
            return;
        }

        // Stage pane: update stage_focused
        self.focus.focus_area = FocusArea::Stage;
        let prev_stage = self.focus.stage_focused;
        if matches!(self.panes.get(&id), Some(PaneKind::Terminal(_)) | Some(PaneKind::Launcher(_))) {
            self.focus.stage_focused = Some(id);
        }
        if self.focus.focused == Some(id) && prev_stage == self.focus.stage_focused {
            return;
        }
        if let Some(prev_id) = self.focus.focused {
            self.dismiss_completion(prev_id);
        }
        self.focus.focused = Some(id);
        self.router.set_focused(id);
        // Stacked mode: keep zoom on the newly focused Stage terminal
        if self.focus.zoomed_pane.is_some() && !self.is_pane_in_dock(id) {
            self.focus.zoomed_pane = Some(id);
        }
        // Swap dock state when switching between terminals
        if prev_stage != self.focus.stage_focused {
            self.swap_dock_state(id);
        }
        self.cache.invalidate_chrome();
        self.update_file_tree_cwd();
        self.sync_browser_webview_frames();
    }

    /// Resolve an AreaSlot to a FocusArea.
    fn resolve_slot(&self, slot: AreaSlot) -> FocusArea {
        match slot {
            AreaSlot::Slot1 => FocusArea::Stage,
            AreaSlot::Slot2 => FocusArea::FileTree,
            AreaSlot::Slot3 => FocusArea::Stage,
            AreaSlot::Slot4 => FocusArea::Dock,
        }
    }

    fn handle_focus_area(&mut self, target: FocusArea) {
        match target {
            FocusArea::FileTree => {
                if self.focus.focus_area == FocusArea::FileTree {
                    self.ft.visible = false;
                    if self.focus.focused.map(|f| self.is_pane_in_dock(f)).unwrap_or(false) {
                        self.focus.focus_area = FocusArea::Dock;
                    } else {
                        self.focus.focus_area = FocusArea::Stage;
                    }
                    self.cache.invalidate_chrome();
                    self.compute_layout();
                } else if self.ft.visible {
                    self.focus.focus_area = FocusArea::FileTree;
                } else {
                    self.ft.visible = true;
                    self.focus.focus_area = FocusArea::FileTree;
                    self.update_file_tree_cwd();
                    self.compute_layout();
                }
            }
            FocusArea::Stage => {
                if self.focus.focus_area != FocusArea::Stage {
                    let terminal_id = self.focused_terminal_id();
                    if let Some(tid) = terminal_id {
                        self.focus_terminal(tid);
                    } else {
                        self.focus.focus_area = FocusArea::Stage;
                    }
                }
            }
            FocusArea::Dock => {
                self.toggle_dock();
            }
        }
        self.cache.invalidate_chrome();
    }

    fn toggle_file_tree_visibility(&mut self) {
        if self.ft.visible {
            self.ft.visible = false;
            if self.focus.focus_area == FocusArea::FileTree {
                if self.focus.focused.map(|f| self.is_pane_in_dock(f)).unwrap_or(false) {
                    self.focus.focus_area = FocusArea::Dock;
                } else {
                    self.focus.focus_area = FocusArea::Stage;
                }
            }
        } else {
            self.ft.visible = true;
            self.update_file_tree_cwd();
        }
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    fn toggle_dock_visibility(&mut self) {
        if self.dock.dock_open {
            self.dock.dock_open = false;
            if self.focus.focus_area == FocusArea::Dock {
                let owner = self.focused_terminal_id();
                self.focus.focus_area = FocusArea::Stage;
                if let Some(tid) = owner {
                    self.focus.focused = Some(tid);
                    self.router.set_focused(tid);
                }
            }
        } else {
            self.dock.dock_open = true;
            if let Some(tid) = self.focused_terminal_id() {
                let has_panes = if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                    !tp.dock_layout.all_pane_ids().is_empty()
                } else {
                    false
                };
                if !has_panes {
                    self.ensure_dock_placeholder();
                }
            }
        }
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    fn handle_navigate(&mut self, direction: crate::tide_input::Direction) {
        match self.focus.focus_area {
            FocusArea::FileTree => {
                self.navigate_file_tree(direction);
            }
            FocusArea::Stage | FocusArea::Dock => {
                let stage_current = self.focused_terminal_id();

                if self.focus.zoomed_pane.is_some() {
                    let dir = match direction {
                        crate::tide_input::Direction::Left => -1,
                        crate::tide_input::Direction::Right => 1,
                        _ => return,
                    };
                    let ids = self.layout.pane_ids();
                    if ids.len() < 2 { return; }
                    let current = stage_current.unwrap_or_else(|| self.focus.focused.unwrap_or(0));
                    if let Some(pos) = ids.iter().position(|&id| id == current) {
                        let next_pos = if dir > 0 {
                            (pos + 1) % ids.len()
                        } else {
                            (pos + ids.len() - 1) % ids.len()
                        };
                        let next_id = ids[next_pos];
                        self.focus.zoomed_pane = Some(next_id);
                        self.focus_terminal(next_id);
                        self.compute_layout();
                    }
                } else {
                    if self.focus.focus_area == FocusArea::Dock {
                        if let Some(tid) = stage_current {
                            self.focus.focused = Some(tid);
                            self.router.set_focused(tid);
                        }
                    }
                    self.handle_move_focus(direction);
                }
            }
        }
    }

    fn handle_toggle_stacked(&mut self) {
        match self.focus.focus_area {
            FocusArea::Dock => {
                self.dock.dock_zoomed = !self.dock.dock_zoomed;
                self.cache.pane_generations.clear();
                self.cache.invalidate_chrome();
                self.compute_layout();
            }
            FocusArea::Stage => {
                if self.dock.terminal_view_mode == crate::state::ViewMode::Split {
                    self.dock.terminal_view_mode = crate::state::ViewMode::Stacked;
                } else {
                    self.dock.terminal_view_mode = crate::state::ViewMode::Split;
                }
                if self.dock.terminal_view_mode == crate::state::ViewMode::Stacked {
                    self.focus.zoomed_pane = self.focus.focused;
                } else {
                    self.focus.zoomed_pane = None;
                }
                self.cache.pane_generations.clear();
                self.cache.invalidate_chrome();
                self.compute_layout();
            }
            FocusArea::FileTree => {}
        }
    }

    fn reorder_stacked_tab(&mut self, source: PaneId, target: PaneId) {
        match self.focus.focus_area {
            FocusArea::Stage => {
                self.layout.swap_panes(source, target);
            }
            FocusArea::Dock => {
                if let Some(tid) = self.focused_terminal_id() {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                        tp.dock_layout.swap_panes(source, target);
                    }
                }
            }
            _ => {}
        }
        self.cache.invalidate_chrome();
    }

    fn cycle_tab(&mut self, direction: i32) {
        let tid = match self.focus.stage_focused {
            Some(id) => id,
            None => return,
        };

        let mut pane_ids: Vec<PaneId> = self.dock.pinned_dock_layout.all_tabs_flat();
        let terminal_tabs = match self.panes.get(&tid) {
            Some(PaneKind::Terminal(tp)) => tp.dock_layout.all_tabs_flat(),
            _ => Vec::new(),
        };
        pane_ids.extend(terminal_tabs);
        if pane_ids.len() <= 1 { return; }

        let current = self.focus.focused.filter(|id| pane_ids.contains(id));
        let pos = current.and_then(|c| pane_ids.iter().position(|&id| id == c)).unwrap_or(0);
        let next_pos = if direction > 0 {
            (pos + 1) % pane_ids.len()
        } else {
            (pos + pane_ids.len() - 1) % pane_ids.len()
        };
        let next_id = pane_ids[next_pos];

        self.focus.focus_area = FocusArea::Dock;
        self.focus.focused = Some(next_id);
        self.router.set_focused(next_id);
        if self.is_pane_pinned(next_id) {
            self.dock.pinned_dock_layout.set_active_tab(next_id);
        } else if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
            tp.dock_focused = Some(next_id);
            tp.dock_layout.set_active_tab(next_id);
        }
        self.dock.dock_open = true;
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    fn navigate_panes(&mut self, direction: i32) {
        let current_id = match self.focus.focused {
            Some(id) => id,
            None => return,
        };
        let pane_ids = self.layout.pane_ids();
        if pane_ids.len() < 2 { return; }
        let idx = match pane_ids.iter().position(|&id| id == current_id) {
            Some(i) => i,
            None => return,
        };
        let len = pane_ids.len();
        let new_idx = if direction > 0 {
            (idx + 1) % len
        } else {
            (idx + len - 1) % len
        };
        let new_pane = pane_ids[new_idx];
        self.cache.invalidate_pane(current_id);
        self.cache.invalidate_pane(new_pane);
        self.focus.focused = Some(new_pane);
        self.router.set_focused(new_pane);
        if self.focus.zoomed_pane.is_some() {
            self.focus.zoomed_pane = Some(new_pane);
        }
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    fn toggle_config_page(&mut self) {
        if self.modal.config_page.is_some() {
            self.close_config_page();
        } else {
            self.open_config_page();
        }
        self.cache.needs_redraw = true;
    }

    fn close_config_page(&mut self) {
        let page = match self.modal.config_page.take() {
            Some(p) => p,
            None => return,
        };

        if page.dirty {
            let defaults = crate::tide_input::KeybindingMap::default_bindings();
            let overrides: Vec<crate::state::settings::KeybindingOverride> = page
                .bindings
                .iter()
                .filter(|(action, hotkey)| {
                    !defaults.iter().any(|(dh, da)| {
                        da.action_key() == action.action_key()
                            && dh.key_name() == hotkey.key_name()
                            && dh.shift == hotkey.shift
                            && dh.ctrl == hotkey.ctrl
                            && dh.meta == hotkey.meta
                            && dh.alt == hotkey.alt
                    })
                })
                .map(|(action, hotkey)| {
                    crate::state::settings::KeybindingOverride::from_binding(hotkey, action)
                })
                .collect();

            self.settings.keybindings = overrides;

            let wt_text = page.worktree_input.text.trim().to_string();
            self.settings.worktree.base_dir_pattern = if wt_text.is_empty() {
                None
            } else {
                Some(wt_text)
            };

            let cf_text = page.copy_files_input.text.trim().to_string();
            self.settings.worktree.copy_files = if cf_text.is_empty() {
                None
            } else {
                let files: Vec<String> = cf_text
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                if files.is_empty() { None } else { Some(files) }
            };

            self.ports.persistence.save_settings(&self.settings);

            let map = crate::state::settings::build_keybinding_map(&self.settings);
            if map.bindings.len() == crate::tide_input::KeybindingMap::default_bindings().len()
                && self.settings.keybindings.is_empty()
            {
                self.router.keybinding_map = None;
            } else {
                self.router.keybinding_map = Some(map);
            }
        }

        self.cache.invalidate_chrome();
    }
}

impl App {
    fn open_config_page(&mut self) {
        use crate::tide_input::{GlobalAction as GA, KeybindingMap};

        let map = self.router.keybinding_map.as_ref();
        let all_actions = GA::all_actions();

        let bindings: Vec<(GA, crate::tide_input::Hotkey)> = all_actions
            .into_iter()
            .map(|action| {
                let hotkey = map
                    .and_then(|m| m.hotkey_for(&action).cloned())
                    .or_else(|| {
                        let defaults = KeybindingMap::new();
                        defaults.hotkey_for(&action).cloned()
                    })
                    .unwrap_or(crate::tide_input::Hotkey::new(
                        crate::tide_core::Key::Char('?'),
                        false, false, false, false,
                    ));
                (action, hotkey)
            })
            .collect();

        let worktree_pattern = self.settings.worktree.base_dir_pattern
            .clone()
            .unwrap_or_default();

        let copy_files = self.settings.worktree.copy_files
            .as_ref()
            .map(|v| v.join(", "))
            .unwrap_or_default();

        self.modal.config_page = Some(crate::ConfigPageState::new(bindings, worktree_pattern, copy_files));
        self.cache.invalidate_chrome();
    }
}
