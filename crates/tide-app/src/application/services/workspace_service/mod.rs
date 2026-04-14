// Workspace, focus, navigation, and config page management.

use crate::tide_core::PaneId;
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
            self.interaction.tab_scroll_last_at.remove(&id);
            self.interaction.tab_scroll_last_direction.remove(&id);
            self.interaction.tab_manual_scroll.remove(&id);
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
            self.notified_panes.remove(&id);
            self.refresh_workspace_agent_notification(self.ws.active);
            self.cache.invalidate_chrome();
            self.sync_browser_webview_frames();
            self.reroute_backgrounded_wrapped_agent_attention();
            return;
        }

        // Stage pane: update stage_focused
        self.focus.focus_area = FocusArea::Stage;
        let prev_stage = self.focus.stage_focused;
        if matches!(
            self.panes.get(&id),
            Some(PaneKind::Terminal(_)) | Some(PaneKind::Launcher(_))
        ) {
            self.focus.stage_focused = Some(id);
        }
        if self.focus.focused == Some(id) && prev_stage == self.focus.stage_focused {
            self.notified_panes.remove(&id);
            self.refresh_workspace_agent_notification(self.ws.active);
            return;
        }
        if let Some(prev_id) = self.focus.focused {
            self.dismiss_completion(prev_id);
        }
        self.focus.focused = Some(id);
        self.router.set_focused(id);
        self.interaction.tab_scroll_last_at.remove(&id);
        self.interaction.tab_scroll_last_direction.remove(&id);
        self.interaction.tab_manual_scroll.remove(&id);
        // Update TabGroup active tab when focusing a Stage pane in a LeafGroup
        self.layout.set_active_tab(id);
        // Stacked mode: keep zoom on the newly focused Stage terminal
        if self.focus.zoomed_pane.is_some() && !self.is_pane_in_dock(id) {
            self.focus.zoomed_pane = Some(id);
        }
        // Swap dock state when switching between terminals
        if prev_stage != self.focus.stage_focused {
            self.swap_dock_state(id);
        }
        self.notified_panes.remove(&id);
        self.refresh_workspace_agent_notification(self.ws.active);
        self.cache.invalidate_chrome();
        self.update_file_tree_cwd();
        self.sync_browser_webview_frames();
        self.reroute_backgrounded_wrapped_agent_attention();
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
                    if self
                        .focus
                        .focused
                        .map(|f| self.is_pane_in_dock(f))
                        .unwrap_or(false)
                    {
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
        self.reroute_backgrounded_wrapped_agent_attention();
    }

    fn toggle_file_tree_visibility(&mut self) {
        if self.ft.visible {
            self.ft.visible = false;
            if self.focus.focus_area == FocusArea::FileTree {
                if self
                    .focus
                    .focused
                    .map(|f| self.is_pane_in_dock(f))
                    .unwrap_or(false)
                {
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
        self.reroute_backgrounded_wrapped_agent_attention();
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
        self.reroute_backgrounded_wrapped_agent_attention();
    }

    fn handle_navigate(&mut self, direction: crate::tide_input::Direction) {
        match self.focus.focus_area {
            FocusArea::FileTree => {
                self.navigate_file_tree(direction);
            }
            FocusArea::Stage => {
                if self.focus.zoomed_pane.is_some() {
                    let dir = match direction {
                        crate::tide_input::Direction::Left | crate::tide_input::Direction::Up => -1,
                        crate::tide_input::Direction::Right
                        | crate::tide_input::Direction::Down => 1,
                    };
                    let ids = self.layout.all_tabs_flat();
                    if ids.len() < 2 {
                        return;
                    }
                    let current = self.focus.focused.unwrap_or(0);
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
                    self.handle_move_focus(direction);
                }
            }
            FocusArea::Dock => {
                // Dock stacked mode: cycle through all dock tabs
                if self.dock.dock_zoomed {
                    let dir = match direction {
                        crate::tide_input::Direction::Left | crate::tide_input::Direction::Up => -1,
                        crate::tide_input::Direction::Right
                        | crate::tide_input::Direction::Down => 1,
                    };
                    let tid = match self.focus.stage_focused {
                        Some(id) => id,
                        None => return,
                    };
                    let mut pane_ids: Vec<PaneId> = self.dock.pinned_dock_layout.all_tabs_flat();
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        pane_ids.extend(tp.dock_layout.all_tabs_flat());
                    }
                    if pane_ids.len() < 2 {
                        return;
                    }
                    // Use dock_focused (not self.focus.focused which may be a Stage pane)
                    let current = self
                        .panes
                        .get(&tid)
                        .and_then(|pk| {
                            if let PaneKind::Terminal(tp) = pk {
                                tp.dock_focused
                            } else {
                                None
                            }
                        })
                        .or_else(|| {
                            self.dock
                                .pinned_dock_layout
                                .all_tabs_flat()
                                .into_iter()
                                .next()
                        })
                        .unwrap_or(0);
                    if let Some(pos) = pane_ids.iter().position(|&id| id == current) {
                        let next_pos = if dir > 0 {
                            (pos + 1) % pane_ids.len()
                        } else {
                            (pos + pane_ids.len() - 1) % pane_ids.len()
                        };
                        let next_id = pane_ids[next_pos];
                        self.focus.focused = Some(next_id);
                        self.router.set_focused(next_id);
                        if self.is_pane_pinned(next_id) {
                            self.dock.pinned_dock_layout.set_active_tab(next_id);
                        } else if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                            tp.dock_focused = Some(next_id);
                            tp.dock_layout.set_active_tab(next_id);
                        }
                        self.cache.invalidate_chrome();
                        self.compute_layout();
                    }
                    return;
                }
                // Spatial navigation within Dock panes only
                let current_id = match self.focus.focused {
                    Some(id) => id,
                    None => return,
                };
                // Collect dock pane rects from pane_rects (exclude stage panes)
                let stage_ids: std::collections::HashSet<PaneId> =
                    self.layout.pane_ids().into_iter().collect();
                let dock_rects: Vec<(PaneId, crate::tide_core::Rect)> = self
                    .pane_rects
                    .iter()
                    .filter(|(id, _)| !stage_ids.contains(id))
                    .copied()
                    .collect();
                if dock_rects.len() < 2 {
                    return;
                }

                let current_rect = match dock_rects.iter().find(|(id, _)| *id == current_id) {
                    Some((_, r)) => *r,
                    None => return,
                };
                let cx = current_rect.x + current_rect.width / 2.0;
                let cy = current_rect.y + current_rect.height / 2.0;

                let mut best: Option<(PaneId, f32)> = None;
                for &(id, rect) in &dock_rects {
                    if id == current_id {
                        continue;
                    }
                    let ox = rect.x + rect.width / 2.0;
                    let oy = rect.y + rect.height / 2.0;
                    let dx = ox - cx;
                    let dy = oy - cy;

                    let (valid, overlaps, dist) = match direction {
                        crate::tide_input::Direction::Left => (
                            dx < -1.0,
                            rect.y < current_rect.y + current_rect.height
                                && rect.y + rect.height > current_rect.y,
                            dx.abs(),
                        ),
                        crate::tide_input::Direction::Right => (
                            dx > 1.0,
                            rect.y < current_rect.y + current_rect.height
                                && rect.y + rect.height > current_rect.y,
                            dx.abs(),
                        ),
                        crate::tide_input::Direction::Up => (
                            dy < -1.0,
                            rect.x < current_rect.x + current_rect.width
                                && rect.x + rect.width > current_rect.x,
                            dy.abs(),
                        ),
                        crate::tide_input::Direction::Down => (
                            dy > 1.0,
                            rect.x < current_rect.x + current_rect.width
                                && rect.x + rect.width > current_rect.x,
                            dy.abs(),
                        ),
                    };

                    if !valid {
                        continue;
                    }
                    let score = if overlaps { dist } else { dist + 100000.0 };
                    if best.is_none_or(|(_, d)| score < d) {
                        best = Some((id, score));
                    }
                }

                if let Some((next_id, _)) = best {
                    self.focus_terminal(next_id);
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
        match self.focus.focus_area {
            FocusArea::Stage => {
                // Cycle within the current TabGroup only (not across TabGroups).
                let current = match self.focus.focused {
                    Some(id) => id,
                    None => return,
                };
                let tg = match self.layout.tab_group_containing(current) {
                    Some(tg) => tg.clone(),
                    None => return, // bare Leaf, no tabs to cycle
                };
                if tg.tabs.len() <= 1 {
                    return;
                }
                let pos = tg.tabs.iter().position(|&id| id == current).unwrap_or(0);
                let next_pos = if direction > 0 {
                    (pos + 1) % tg.tabs.len()
                } else {
                    (pos + tg.tabs.len() - 1) % tg.tabs.len()
                };
                let next_id = tg.tabs[next_pos];
                self.focus_terminal(next_id);
            }
            FocusArea::Dock => {
                // Cycle through Dock tabs (pinned + terminal dock)
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
                if pane_ids.len() <= 1 {
                    return;
                }

                let current = self.focus.focused.filter(|id| pane_ids.contains(id));
                let pos = current
                    .and_then(|c| pane_ids.iter().position(|&id| id == c))
                    .unwrap_or(0);
                let next_pos = if direction > 0 {
                    (pos + 1) % pane_ids.len()
                } else {
                    (pos + pane_ids.len() - 1) % pane_ids.len()
                };
                let next_id = pane_ids[next_pos];

                self.focus.focus_area = FocusArea::Dock;
                self.focus.focused = Some(next_id);
                self.router.set_focused(next_id);
                self.interaction.tab_scroll_last_at.remove(&next_id);
                self.interaction.tab_scroll_last_direction.remove(&next_id);
                self.interaction.tab_manual_scroll.remove(&next_id);
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
            FocusArea::FileTree => {
                // No tab cycling in file tree
            }
        }
    }

    fn navigate_panes(&mut self, direction: i32) {
        let current_id = match self.focus.focused {
            Some(id) => id,
            None => return,
        };
        let pane_ids = self.layout.pane_ids();
        if pane_ids.len() < 2 {
            return;
        }
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
                if files.is_empty() {
                    None
                } else {
                    Some(files)
                }
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

    // ── Workspace state queries (click_adapter) ──

    fn ws_sidebar_rect(&self) -> Option<crate::tide_core::Rect> {
        self.ws.sidebar_rect
    }

    fn ws_workspaces_len(&self) -> usize {
        self.ws.workspaces.len()
    }

    fn ws_sidebar_geometry(&self) -> Option<crate::state::drag_types::WsSidebarGeometry> {
        crate::adapter::inward::drag_drop_adapter::ws_sidebar_geometry(self)
    }

    fn move_pane_to_workspace(&mut self, pane_id: PaneId, target_idx: usize) {
        App::move_pane_to_workspace(self, pane_id, target_idx);
    }

    // ── Workspace drag & state (mouse_adapter) ──

    fn ws_drag(&self) -> Option<(usize, f32, usize)> {
        self.ws.drag
    }

    fn ws_set_drag(&mut self, drag: Option<(usize, f32, usize)>) {
        self.ws.drag = drag;
    }

    fn ws_take_drag(&mut self) -> Option<(usize, f32, usize)> {
        self.ws.drag.take()
    }

    fn ws_border_dragging(&self) -> bool {
        self.ws.border_dragging
    }

    fn set_ws_border_dragging(&mut self, v: bool) {
        self.ws.border_dragging = v;
    }

    fn ws_set_width(&mut self, w: f32) {
        self.ws.width = w;
    }

    fn ws_active(&self) -> usize {
        self.ws.active
    }

    fn ws_show_sidebar(&self) -> bool {
        self.ws.show_sidebar
    }

    fn set_ws_show_sidebar(&mut self, v: bool) {
        self.ws.show_sidebar = v;
    }

    fn new_workspace(&mut self) {
        App::new_workspace(self);
    }

    fn switch_workspace(&mut self, idx: usize) {
        App::switch_workspace(self, idx);
    }

    fn activate_notification_target(&mut self, pane_id: PaneId) {
        let Some(target_workspace) = self.find_workspace_for_pane(pane_id) else {
            return;
        };

        if target_workspace != self.ws.active {
            self.switch_workspace(target_workspace);
        }

        if self.panes.contains_key(&pane_id) {
            self.focus_pane_for_notification_activation(pane_id);
        }
    }

    fn ws_reorder(&mut self, src: usize, target: usize) {
        let ws = self.ws.workspaces.remove(src);
        self.ws.workspaces.insert(target, ws);
        if self.ws.active == src {
            self.ws.active = target;
        } else if src < self.ws.active && target >= self.ws.active {
            self.ws.active -= 1;
        } else if src > self.ws.active && target <= self.ws.active {
            self.ws.active += 1;
        }
    }

    fn workspace_sidebar_item_rect(&self, idx: usize) -> Option<crate::tide_core::Rect> {
        crate::adapter::inward::drag_drop_adapter::workspace_sidebar_item_rect(self, idx)
    }
}

impl App {
    fn focus_pane_for_notification_activation(&mut self, id: PaneId) {
        if let Some(prev) = self.focus.focused {
            if prev != id {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&prev) {
                    bp.url_input_focused = false;
                    bp.url_selection = None;
                }
            }
        }

        if self.is_pane_in_dock(id) {
            self.focus.focus_area = FocusArea::Dock;
            self.focus.focused = Some(id);
            self.router.set_focused(id);
            self.interaction.tab_scroll_last_at.remove(&id);
            self.interaction.tab_scroll_last_direction.remove(&id);
            self.interaction.tab_manual_scroll.remove(&id);
            if let Some(tid) = self.terminal_owning(id) {
                if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                    tp.dock_focused = Some(id);
                    tp.dock_layout.set_active_tab(id);
                }
            }
            if self.is_pane_pinned(id) {
                self.dock.pinned_dock_layout.set_active_tab(id);
            }
            self.cache.invalidate_chrome();
            self.sync_browser_webview_frames();
            return;
        }

        self.focus.focus_area = FocusArea::Stage;
        let prev_stage = self.focus.stage_focused;
        if matches!(
            self.panes.get(&id),
            Some(PaneKind::Terminal(_)) | Some(PaneKind::Launcher(_))
        ) {
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
        self.interaction.tab_scroll_last_at.remove(&id);
        self.interaction.tab_scroll_last_direction.remove(&id);
        self.interaction.tab_manual_scroll.remove(&id);
        self.layout.set_active_tab(id);
        if self.focus.zoomed_pane.is_some() && !self.is_pane_in_dock(id) {
            self.focus.zoomed_pane = Some(id);
        }
        if prev_stage != self.focus.stage_focused {
            self.swap_dock_state(id);
        }
        self.cache.invalidate_chrome();
        self.update_file_tree_cwd();
        self.sync_browser_webview_frames();
    }

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
                        false,
                        false,
                        false,
                        false,
                    ));
                (action, hotkey)
            })
            .collect();

        let worktree_pattern = self
            .settings
            .worktree
            .base_dir_pattern
            .clone()
            .unwrap_or_default();

        let copy_files = self
            .settings
            .worktree
            .copy_files
            .as_ref()
            .map(|v| v.join(", "))
            .unwrap_or_default();

        self.modal.config_page = Some(crate::ConfigPageState::new(
            bindings,
            worktree_pattern,
            copy_files,
        ));
        self.cache.invalidate_chrome();
    }
}
