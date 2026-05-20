// Workspace, focus, navigation, and config page management.

use crate::tide_core::{PaneId, Rect};
use crate::tide_input::{AreaSlot, Direction};

use crate::pane::PaneKind;
use crate::state::{FocusArea, ViewMode};
use crate::App;
use crate::ClipboardSearchPort;
use crate::DockPort;
use crate::FocusNavPort;
use crate::LayoutPort;

impl App {
    pub(crate) fn set_workspace_sidebar_visible_with_animation(&mut self, visible: bool) {
        let now = self.ports.clock.now();
        let current_width = self.ws.rendered_width(now);
        let target_width = if visible { self.ws.width } else { 0.0 };
        let already_at_target = self.ws.show_sidebar == visible
            && (current_width - target_width).abs() < 0.5
            && self.ws.visibility_animation.is_none();
        self.ws.show_sidebar = visible;
        if already_at_target {
            return;
        }
        self.ws
            .begin_visibility_animation(current_width, target_width, now);
    }

    pub(crate) fn set_file_tree_visible_with_animation(&mut self, visible: bool) {
        let now = self.ports.clock.now();
        let current_width = self.ft.rendered_width(now);
        let target_width = if visible { self.ft.width } else { 0.0 };
        let already_at_target = self.ft.visible == visible
            && (current_width - target_width).abs() < 0.5
            && self.ft.visibility_animation.is_none();
        self.ft.visible = visible;
        if already_at_target {
            return;
        }
        self.ft
            .begin_visibility_animation(current_width, target_width, now);
    }

    pub(crate) fn set_dock_visible_with_animation(&mut self, visible: bool) {
        let now = self.ports.clock.now();
        let current_width = self.terminal_context_surface_rendered_width(now);
        let target_width = if visible {
            self.terminal_context_surface_support_width_for_layout(now)
        } else {
            0.0
        };
        let already_at_target = self.dock.dock_open == visible
            && (current_width - target_width).abs() < 0.5
            && self.dock.visibility_animation.is_none();
        self.dock.dock_open = visible;
        if already_at_target {
            return;
        }
        self.dock
            .begin_visibility_animation(current_width, target_width, now);
    }

    pub(crate) fn surface_visibility_animation_active(&self) -> bool {
        self.ws.visibility_animation.is_some()
            || self.ft.visibility_animation.is_some()
            || self.dock.visibility_animation.is_some()
    }

    pub(crate) fn surface_visibility_animation_frame_due(&self) -> bool {
        self.surface_visibility_animation_active()
    }

    pub(crate) fn begin_split_transition_animation(
        &mut self,
        scope: crate::state::SplitTransitionScope,
        pane_id: PaneId,
    ) {
        let now = self.ports.clock.now();
        self.split_transition_animation = Some(
            crate::state::SplitTransitionAnimation::new_trailing_pane(scope, pane_id, now),
        );
        self.cache.invalidate_chrome();
    }

    pub(crate) fn split_transition_animation_active(&self) -> bool {
        self.split_transition_animation.is_some()
    }

    pub(crate) fn layout_animation_active(&self) -> bool {
        self.surface_visibility_animation_active() || self.split_transition_animation_active()
    }

    pub(crate) fn layout_animation_frame_due(&self) -> bool {
        self.layout_animation_active()
    }

    fn terminal_context_navigation_target(
        &self,
        terminal_id: PaneId,
        direction: Direction,
    ) -> Option<PaneId> {
        let terminal = match self.panes.get(&terminal_id) {
            Some(PaneKind::Terminal(terminal)) => terminal,
            _ => return None,
        };

        let all_ids = terminal.dock_layout.all_pane_ids();
        if all_ids.len() < 2 {
            return None;
        }

        let current = terminal
            .dock_focused
            .filter(|pane_id| all_ids.contains(pane_id))
            .or_else(|| {
                self.focus
                    .focused
                    .filter(|pane_id| all_ids.contains(pane_id))
            })
            .or_else(|| terminal.dock_layout.pane_ids().first().copied())
            .or_else(|| all_ids.first().copied())?;

        if terminal.dock_view_mode == ViewMode::Stacked {
            let pane_ids = terminal.dock_layout.all_tabs_flat();
            if pane_ids.len() < 2 {
                return None;
            }
            let pos = pane_ids
                .iter()
                .position(|&pane_id| pane_id == current)
                .unwrap_or(0);
            let next_pos = match direction {
                Direction::Left | Direction::Up => (pos + pane_ids.len() - 1) % pane_ids.len(),
                Direction::Right | Direction::Down => (pos + 1) % pane_ids.len(),
            };
            return Some(pane_ids[next_pos]);
        }

        let visible_ids = terminal.dock_layout.pane_ids();
        let dock_rects: Vec<(PaneId, Rect)> = self
            .pane_rects
            .iter()
            .filter(|(pane_id, _)| visible_ids.contains(pane_id))
            .copied()
            .collect();
        directional_rect_neighbor(current, direction, &dock_rects)
    }

    fn set_terminal_context_active_pane(&mut self, terminal_id: PaneId, pane_id: PaneId) {
        if let Some(PaneKind::Terminal(terminal)) = self.panes.get_mut(&terminal_id) {
            terminal.dock_focused = Some(pane_id);
            terminal.dock_layout.set_active_tab(pane_id);
        }
        self.interaction.tab_scroll_last_at.remove(&pane_id);
        self.interaction.tab_scroll_last_direction.remove(&pane_id);
        self.interaction.tab_manual_scroll.remove(&pane_id);
    }
}

fn directional_rect_neighbor(
    current_id: PaneId,
    direction: Direction,
    pane_rects: &[(PaneId, Rect)],
) -> Option<PaneId> {
    if pane_rects.len() < 2 {
        return None;
    }

    let current_rect = pane_rects
        .iter()
        .find(|(pane_id, _)| *pane_id == current_id)
        .map(|(_, rect)| *rect)?;
    let cx = current_rect.x + current_rect.width / 2.0;
    let cy = current_rect.y + current_rect.height / 2.0;

    let mut best: Option<(PaneId, f32)> = None;
    for &(pane_id, rect) in pane_rects {
        if pane_id == current_id {
            continue;
        }

        let ox = rect.x + rect.width / 2.0;
        let oy = rect.y + rect.height / 2.0;
        let dx = ox - cx;
        let dy = oy - cy;

        let (valid, overlaps, distance) = match direction {
            Direction::Left => (
                dx < -1.0,
                rect.y < current_rect.y + current_rect.height
                    && rect.y + rect.height > current_rect.y,
                dx.abs(),
            ),
            Direction::Right => (
                dx > 1.0,
                rect.y < current_rect.y + current_rect.height
                    && rect.y + rect.height > current_rect.y,
                dx.abs(),
            ),
            Direction::Up => (
                dy < -1.0,
                rect.x < current_rect.x + current_rect.width
                    && rect.x + rect.width > current_rect.x,
                dy.abs(),
            ),
            Direction::Down => (
                dy > 1.0,
                rect.x < current_rect.x + current_rect.width
                    && rect.x + rect.width > current_rect.x,
                dy.abs(),
            ),
        };

        if !valid {
            continue;
        }

        let score = if overlaps {
            distance
        } else {
            distance + 100000.0
        };
        if best.is_none_or(|(_, best_score)| score < best_score) {
            best = Some((pane_id, score));
        }
    }

    best.map(|(pane_id, _)| pane_id)
}

impl crate::application::ports::inward::WorkspaceNavPort for App {
    fn focus_terminal(&mut self, id: PaneId) {
        // Dock pane: focus the active Terminal Context Surface, don't change stage_focused.
        if self.is_pane_in_dock(id) {
            self.focus.focus_area = FocusArea::Dock;
            self.focus.focused = Some(id);
            self.router.set_focused(id);
            self.interaction.tab_scroll_last_at.remove(&id);
            self.interaction.tab_scroll_last_direction.remove(&id);
            self.interaction.tab_manual_scroll.remove(&id);
            // Update dock_focused on the owning terminal.
            if let Some(tid) = self.terminal_owning(id) {
                if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                    tp.dock_focused = Some(id);
                    tp.dock_layout.set_active_tab(id);
                }
            }
            if self.window.is_focused && self.pane_has_unresolved_wrapped_agent_attention(id) {
                self.acknowledge_agent_attention(id);
            } else {
                self.notified_panes.remove(&id);
                self.refresh_workspace_agent_notification(self.ws.active);
            }
            self.cache.invalidate_chrome();
            self.sync_browser_webview_frames();
            self.reroute_backgrounded_wrapped_agent_attention_excluding(Some(id));
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
            if self.window.is_focused && self.pane_has_unresolved_wrapped_agent_attention(id) {
                self.acknowledge_agent_attention(id);
            } else {
                self.notified_panes.remove(&id);
                self.refresh_workspace_agent_notification(self.ws.active);
            }
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
        // Compatibility no-op for normalized Stage layouts; Dock still owns active TabGroup state.
        self.layout.set_active_tab(id);
        // Stacked mode: keep zoom on the newly focused Stage terminal
        if self.focus.zoomed_pane.is_some() && !self.is_pane_in_dock(id) {
            self.focus.zoomed_pane = Some(id);
        }
        if matches!(self.panes.get(&id), Some(PaneKind::Terminal(_))) {
            self.sync_terminal_context_mode_from_terminal(id);
        }
        // Swap dock state when switching between terminals
        if prev_stage != self.focus.stage_focused {
            self.swap_dock_state(id);
        }
        if self.window.is_focused && self.pane_has_unresolved_wrapped_agent_attention(id) {
            self.acknowledge_agent_attention(id);
        } else {
            self.notified_panes.remove(&id);
            self.refresh_workspace_agent_notification(self.ws.active);
        }
        self.cache.invalidate_chrome();
        self.update_file_tree_cwd();
        self.sync_browser_webview_frames();
        self.reroute_backgrounded_wrapped_agent_attention_excluding(Some(id));
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
                    self.set_file_tree_visible_with_animation(false);
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
                    self.set_file_tree_visible_with_animation(true);
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
            self.set_file_tree_visible_with_animation(false);
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
            self.set_file_tree_visible_with_animation(true);
            self.update_file_tree_cwd();
        }
        self.cache.invalidate_chrome();
        self.compute_layout();
        self.reroute_backgrounded_wrapped_agent_attention();
    }

    fn toggle_dock_visibility(&mut self) {
        if self.dock.dock_open {
            self.set_dock_visible_with_animation(false);
            if self.focus.focus_area == FocusArea::Dock {
                let owner = self.focused_terminal_id();
                self.focus.focus_area = FocusArea::Stage;
                if let Some(tid) = owner {
                    self.focus.focused = Some(tid);
                    self.router.set_focused(tid);
                }
            }
        } else {
            self.set_dock_visible_with_animation(true);
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
                    let ids = self.layout.pane_ids();
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
                let Some(terminal_id) = self.focus.stage_focused else {
                    return;
                };
                if let Some(next_id) =
                    self.terminal_context_navigation_target(terminal_id, direction)
                {
                    self.focus_terminal(next_id);
                    self.compute_layout();
                }
            }
        }
    }

    fn dock_navigate(&mut self, direction: crate::tide_input::Direction) {
        if !self.dock.dock_open {
            return;
        }

        if self.focus.focus_area == FocusArea::Dock {
            self.handle_navigate(direction);
            return;
        }

        let saved_area = self.focus.focus_area;
        let saved_focused = self.focus.focused;
        let saved_stage_focused = self.focus.stage_focused;
        let Some(terminal_id) = self.focus.stage_focused else {
            return;
        };

        self.compute_layout();
        let Some(next_id) = self.terminal_context_navigation_target(terminal_id, direction) else {
            return;
        };

        self.set_terminal_context_active_pane(terminal_id, next_id);
        self.focus.focus_area = saved_area;
        self.focus.focused = saved_focused;
        self.focus.stage_focused = saved_stage_focused;
        if let Some(focused) = saved_focused {
            self.router.set_focused(focused);
        }
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    fn handle_toggle_stacked(&mut self) {
        match self.focus.focus_area {
            FocusArea::Dock => {
                let next_stacked = !self.active_terminal_context_is_stacked();
                self.set_active_terminal_context_stacked(next_stacked);
                if next_stacked {
                    if let Some(tid) = self.focused_terminal_id() {
                        if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                            if let Some(active) = tp
                                .dock_focused
                                .or_else(|| tp.dock_layout.pane_ids().first().copied())
                            {
                                self.focus.focused = Some(active);
                                self.router.set_focused(active);
                            }
                        }
                    }
                }
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
                if self.focus.zoomed_pane.is_none() {
                    return;
                }
                let current = match self.focus.focused {
                    Some(id) => id,
                    None => return,
                };
                let pane_ids = self.layout.pane_ids();
                if pane_ids.len() <= 1 {
                    return;
                }
                let pos = pane_ids.iter().position(|&id| id == current).unwrap_or(0);
                let next_pos = if direction > 0 {
                    (pos + 1) % pane_ids.len()
                } else {
                    (pos + pane_ids.len() - 1) % pane_ids.len()
                };
                let next_id = pane_ids[next_pos];
                self.focus.zoomed_pane = Some(next_id);
                self.focus_terminal(next_id);
                self.compute_layout();
            }
            FocusArea::Dock => {
                // Cycle through the focused Stage Terminal's Terminal Context Surface.
                let tid = match self.focus.stage_focused {
                    Some(id) => id,
                    None => return,
                };

                let pane_ids: Vec<PaneId> = match self.panes.get(&tid) {
                    Some(PaneKind::Terminal(tp)) => tp.dock_layout.all_tabs_flat(),
                    _ => Vec::new(),
                };
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
                if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                    tp.dock_focused = Some(next_id);
                    tp.dock_layout.set_active_tab(next_id);
                }
                self.set_dock_visible_with_animation(true);
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
            self.pending_platform_commands
                .push(crate::tide_platform::WindowCommand::BroadcastSettingsChanged);

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
        self.set_workspace_sidebar_visible_with_animation(v);
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

    fn rename_workspace(&mut self, idx: usize, name: String) {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return;
        }
        if idx >= self.ws.workspaces.len() {
            return;
        }
        self.ws.workspaces[idx].name = trimmed.to_string();
        self.cache.invalidate_chrome();
    }

    fn workspace_name(&self, idx: usize) -> Option<String> {
        self.ws.workspaces.get(idx).map(|w| w.name.clone())
    }

    fn complete_workspace_rename(&mut self) {
        let state = match self.modal.workspace_rename.take() {
            Some(s) => s,
            None => return,
        };
        let new_name = state.input.text.trim().to_string();
        if new_name.is_empty() {
            // No change — modal is already cleared by `.take()`.
            self.cache.invalidate_chrome();
            return;
        }
        if state.ws_index < self.ws.workspaces.len() {
            self.ws.workspaces[state.ws_index].name = new_name;
        }
        self.cache.invalidate_chrome();
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

impl App {
    pub(crate) fn execute_workspace_context_menu_action(
        &mut self,
        action_index: usize,
        ws_index: usize,
    ) {
        let items = crate::ContextMenuAction::workspace_items();
        let action = match items.get(action_index) {
            Some(a) => *a,
            None => return,
        };

        if ws_index >= self.ws.workspaces.len() {
            return;
        }

        match action {
            crate::ContextMenuAction::Rename => {
                let current = self.ws.workspaces[ws_index].name.clone();
                self.modal.workspace_rename = Some(crate::WorkspaceRenameState {
                    ws_index,
                    input: crate::InputLine::with_text(current),
                });
                self.cache.invalidate_chrome();
            }
            _ => {}
        }
        self.cache.needs_redraw = true;
    }
}
