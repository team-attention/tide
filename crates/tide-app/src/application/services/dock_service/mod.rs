use crate::tide_core::{DropZone, LayoutEngine, PaneId, SplitDirection};

use crate::pane::PaneKind;
use crate::state::{FocusArea, ViewMode};
use crate::App;
use crate::DockPort;
use crate::LayoutPort;

impl App {
    pub(crate) fn active_terminal_context_is_stacked(&self) -> bool {
        self.focused_terminal_id()
            .and_then(|tid| self.panes.get(&tid))
            .and_then(|pane| match pane {
                PaneKind::Terminal(tp) => Some(tp.dock_view_mode == ViewMode::Stacked),
                _ => None,
            })
            .unwrap_or(self.dock.dock_zoomed)
    }

    pub(crate) fn set_active_terminal_context_stacked(&mut self, stacked: bool) {
        self.dock.dock_zoomed = stacked;
        if let Some(tid) = self.focused_terminal_id() {
            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                tp.dock_view_mode = if stacked {
                    ViewMode::Stacked
                } else {
                    ViewMode::Split
                };
            }
        }
    }

    pub(crate) fn sync_terminal_context_mode_from_terminal(&mut self, terminal_id: PaneId) {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get(&terminal_id) {
            self.dock.dock_zoomed = tp.dock_view_mode == ViewMode::Stacked;
        }
    }
}

impl DockPort for App {
    /// Which Terminal is currently active in Stage.
    /// This only changes on terminal click / HJKL navigate / workspace switch.
    /// Dock operations never change this.
    fn focused_terminal_id(&self) -> Option<PaneId> {
        self.focus.stage_focused
    }

    /// Which Terminal owns this pane via dock_layout?
    fn terminal_owning(&self, pane_id: PaneId) -> Option<PaneId> {
        if let Some(&terminal_id) = self.assoc.associated_terminal.get(&pane_id) {
            if let Some(PaneKind::Terminal(tp)) = self.panes.get(&terminal_id) {
                if tp.dock_layout.all_pane_ids().contains(&pane_id) {
                    return Some(terminal_id);
                }
            }
        }

        for (&id, pane) in &self.panes {
            if let PaneKind::Terminal(tp) = pane {
                if tp.dock_layout.all_pane_ids().contains(&pane_id) {
                    return Some(id);
                }
            }
        }
        None
    }

    /// Check if a pane is in any terminal's Terminal Context Surface.
    fn is_pane_in_dock(&self, pane_id: PaneId) -> bool {
        self.terminal_owning(pane_id).is_some()
    }

    /// Pinned Dock is a legacy model; Terminal Context Surface exposes no pinned panes.
    fn is_pane_pinned(&self, _pane_id: PaneId) -> bool {
        false
    }

    /// Pinned Dock is a legacy model; Terminal Context Surface exposes no pinned panes.
    fn has_pinned_panes(&self) -> bool {
        false
    }

    /// Add a pane to a Terminal's dock.
    /// When `target_terminal` is Some, the pane is placed in that Terminal's dock.
    /// When None, falls back to `focused_terminal_id()` (= stage_focused).
    fn add_pane_to_dock(&mut self, new_pane_id: PaneId, target_terminal: Option<PaneId>) {
        let launcher_to_replace = self.dock_launcher_id().filter(|&lid| lid != new_pane_id);

        if let Some(launcher_id) = launcher_to_replace {
            let tid = target_terminal.or_else(|| self.focused_terminal_id());
            if let Some(tid) = tid {
                if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                    tp.dock_layout.replace_pane(launcher_id, new_pane_id);
                    tp.dock_focused = Some(new_pane_id);
                    tp.dock_layout.set_active_tab(new_pane_id);
                }
                self.panes.remove(&launcher_id);
                self.cleanup_closed_pane_state(launcher_id);
                self.set_dock_visible_with_animation(true);
                self.assoc.associated_terminal.insert(new_pane_id, tid);
            }
            return;
        }

        if let Some(tid) = target_terminal.or_else(|| self.focused_terminal_id()) {
            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                if tp.dock_layout.all_pane_ids().is_empty() {
                    tp.dock_layout.insert_at_root(new_pane_id, DropZone::Right);
                } else if let Some(focused) = tp.dock_focused {
                    if !tp.dock_layout.insert_pane(
                        focused,
                        new_pane_id,
                        SplitDirection::Vertical,
                        false,
                    ) {
                        tp.dock_layout.insert_at_root(new_pane_id, DropZone::Right);
                    }
                } else {
                    tp.dock_layout.insert_at_root(new_pane_id, DropZone::Right);
                }
                tp.dock_focused = Some(new_pane_id);
                tp.dock_layout.set_active_tab(new_pane_id);
            }
            self.set_dock_visible_with_animation(true);
            self.assoc.associated_terminal.insert(new_pane_id, tid);
        }
    }

    /// Toggle Dock visibility/focus.
    fn toggle_dock(&mut self) {
        if self.dock.dock_open {
            let focused_in_dock = self
                .focus
                .focused
                .map(|f| self.is_pane_in_dock(f))
                .unwrap_or(false);

            if focused_in_dock {
                // Close + focus Stage terminal
                self.set_dock_visible_with_animation(false);
                self.focus.focus_area = FocusArea::Stage;
                if let Some(tid) = self.focus.stage_focused {
                    self.focus.focused = Some(tid);
                    self.router.set_focused(tid);
                }
            } else {
                // Focus the active Terminal Context Surface.
                self.focus.focus_area = FocusArea::Dock;
                if let Some(tid) = self.focus.stage_focused {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        if let Some(df) = tp.dock_focused {
                            self.focus.focused = Some(df);
                            self.router.set_focused(df);
                            self.cache.invalidate_chrome();
                            self.compute_layout();
                            return;
                        }
                    }
                }
            }
        } else {
            // Open
            let has_terminal_dock = self
                .focus
                .stage_focused
                .map(|tid| {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        !tp.dock_layout.all_pane_ids().is_empty()
                    } else {
                        false
                    }
                })
                .unwrap_or(false);

            if has_terminal_dock {
                self.set_dock_visible_with_animation(true);
                self.focus.focus_area = FocusArea::Dock;
                if let Some(tid) = self.focus.stage_focused {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        if let Some(df) = tp.dock_focused {
                            self.focus.focused = Some(df);
                            self.router.set_focused(df);
                        }
                    }
                }
            } else if let Some(_tid) = self.focus.stage_focused {
                // Create Launcher
                let new_id = self.layout.alloc_id();
                self.panes.insert(new_id, PaneKind::Launcher(new_id));
                self.ime.pending_creates.push(new_id);
                self.add_pane_to_dock(new_id, None);
                self.dock.dock_open = false;
                self.dock.visibility_animation = None;
                self.set_dock_visible_with_animation(true);
                self.focus.focus_area = FocusArea::Dock;
                self.focus.focused = Some(new_id);
                self.router.set_focused(new_id);
            }
        }
        // Safety: ensure something is focused
        if self.focus.focused.is_none() {
            if let Some(tid) = self
                .layout
                .pane_ids()
                .into_iter()
                .find(|&id| matches!(self.panes.get(&id), Some(PaneKind::Terminal(_))))
            {
                self.focus.focused = Some(tid);
                self.router.set_focused(tid);
                self.focus.focus_area = FocusArea::Stage;
            }
        }
        self.cache.pane_generations.clear();
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Remove a context Pane from its owning Terminal and clear legacy storage.
    fn remove_pane_from_dock(&mut self, pane_id: PaneId) {
        if let Some(tid) = self.terminal_owning(pane_id) {
            let stacked_focus_fallback = match self.panes.get(&tid) {
                Some(PaneKind::Terminal(tp)) if tp.dock_view_mode == ViewMode::Stacked => {
                    App::focus_before_or_after_in_order(pane_id, &tp.dock_layout.all_tabs_flat())
                }
                _ => None,
            };
            self.assoc.associated_terminal.remove(&pane_id);

            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                tp.dock_layout.remove(pane_id);
                let remaining = tp.dock_layout.all_pane_ids();
                if remaining.is_empty() {
                    tp.dock_focused = None;
                    self.set_dock_visible_with_animation(false);
                    self.focus.focus_area = FocusArea::Stage;
                    if let Some(st) = self.focus.stage_focused {
                        self.focus.focused = Some(st);
                        self.router.set_focused(st);
                    }
                } else {
                    let visible = tp.dock_layout.pane_ids();
                    let next = stacked_focus_fallback
                        .filter(|fallback| remaining.contains(fallback))
                        .or_else(|| tp.dock_focused.filter(|f| remaining.contains(f)))
                        .or_else(|| visible.first().copied())
                        .unwrap_or(remaining[0]);
                    tp.dock_focused = Some(next);
                    tp.dock_layout.set_active_tab(next);
                    self.focus.focused = Some(next);
                    self.router.set_focused(next);
                }
            } else {
                let remaining: Vec<PaneId> = self
                    .assoc
                    .associated_terminal
                    .iter()
                    .filter(|(_, &t)| t == tid)
                    .map(|(&p, _)| p)
                    .collect();
                if remaining.is_empty() {
                    self.set_dock_visible_with_animation(false);
                    self.focus.focus_area = FocusArea::Stage;
                    if let Some(st) = self.focus.stage_focused {
                        self.focus.focused = Some(st);
                        self.router.set_focused(st);
                    }
                } else {
                    let next = remaining[0];
                    self.focus.focused = Some(next);
                    self.router.set_focused(next);
                }
            }
        }
    }

    /// Close a Terminal and cascade to all its dock panes.
    fn cascade_close_terminal(&mut self, terminal_id: PaneId) {
        let mut dock_pane_ids: Vec<PaneId> =
            if let Some(PaneKind::Terminal(tp)) = self.panes.get(&terminal_id) {
                tp.dock_layout.all_pane_ids()
            } else {
                Vec::new()
            };
        let associated: Vec<PaneId> = self
            .assoc
            .associated_terminal
            .iter()
            .filter(|(_, &tid)| tid == terminal_id)
            .map(|(&pid, _)| pid)
            .collect();
        for pid in associated {
            if !dock_pane_ids.contains(&pid) {
                dock_pane_ids.push(pid);
            }
        }
        for pid in dock_pane_ids {
            self.dock.pinned_dock_layout.remove(pid);
            self.panes.remove(&pid);
            self.cleanup_closed_pane_state(pid);
        }
        self.panes.remove(&terminal_id);
        self.layout.remove(terminal_id);
        self.cleanup_closed_pane_state(terminal_id);
        self.set_dock_visible_with_animation(false);
    }

    /// If Dock is open and the active Terminal Context Surface is empty,
    /// create a placeholder Launcher.
    fn ensure_dock_placeholder(&mut self) {
        if !self.dock.dock_open {
            return;
        }
        let opening_animation = self.dock.visibility_animation;
        let tid = match self.focus.stage_focused {
            Some(id) => id,
            None => return,
        };
        let is_empty = matches!(self.panes.get(&tid), Some(PaneKind::Terminal(tp)) if tp.dock_layout.all_pane_ids().is_empty());
        if !is_empty {
            return;
        }

        let new_id = self.layout.alloc_id();
        self.panes.insert(new_id, PaneKind::Launcher(new_id));
        self.ime.pending_creates.push(new_id);
        let prev_focused = self.focus.focused;
        self.focus.focused = Some(tid);
        self.add_pane_to_dock(new_id, None);
        if opening_animation.is_some() {
            self.dock.visibility_animation = opening_animation;
        }
        self.focus.focused = prev_focused;
    }

    /// Returns the dock_focused PaneId if it's a Launcher (placeholder).
    fn dock_launcher_id(&self) -> Option<PaneId> {
        let tid = self.focus.stage_focused?;
        if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
            if let Some(focused_id) = tp.dock_focused {
                if matches!(self.panes.get(&focused_id), Some(PaneKind::Launcher(_))) {
                    return Some(focused_id);
                }
            }
        }
        None
    }

    /// Split the active Terminal Context Surface and focus a Launcher in the new slot.
    fn dock_split_new_tab_group(&mut self, direction: SplitDirection) {
        let tid = match self.focus.stage_focused {
            Some(id) => id,
            None => return,
        };
        self.set_active_terminal_context_stacked(false);
        let new_id = self.layout.alloc_id();
        self.panes.insert(new_id, PaneKind::Launcher(new_id));
        self.ime.pending_creates.push(new_id);
        self.assoc.associated_terminal.insert(new_id, tid);
        let mut created_split = false;
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
            let had_existing = !tp.dock_layout.all_pane_ids().is_empty();
            if !had_existing {
                tp.dock_layout.insert_at_root(new_id, DropZone::Bottom);
            } else if let Some(focused) = tp.dock_focused {
                if !tp
                    .dock_layout
                    .insert_pane(focused, new_id, direction, false)
                {
                    tp.dock_layout.insert_at_root(new_id, DropZone::Bottom);
                }
                created_split = true;
            } else {
                tp.dock_layout.insert_at_root(new_id, DropZone::Bottom);
                created_split = true;
            }
            tp.dock_focused = Some(new_id);
            tp.dock_layout.set_active_tab(new_id);
        }
        if created_split {
            self.begin_split_transition_animation(
                crate::state::SplitTransitionScope::TerminalContextSurface { terminal_id: tid },
                new_id,
            );
        }
        self.set_dock_visible_with_animation(true);
        self.focus.focus_area = FocusArea::Dock;
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// In stacked Terminal Context Surface chrome, add a Launcher by splitting the
    /// last context Pane so the new item becomes the final stacked tab.
    fn dock_split_last_with_launcher(&mut self, direction: SplitDirection) {
        let tid = match self.focus.stage_focused {
            Some(id) => id,
            None => return,
        };
        let new_id = self.layout.alloc_id();
        self.panes.insert(new_id, PaneKind::Launcher(new_id));
        self.ime.pending_creates.push(new_id);
        self.assoc.associated_terminal.insert(new_id, tid);

        let mut created_split = false;
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
            let target = tp.dock_layout.all_tabs_flat().last().copied();
            if let Some(target) = target {
                if !tp.dock_layout.insert_pane(target, new_id, direction, false) {
                    tp.dock_layout.insert_at_root(new_id, DropZone::Bottom);
                }
                created_split = true;
            } else {
                tp.dock_layout.insert_at_root(new_id, DropZone::Bottom);
            }
            tp.dock_focused = Some(new_id);
            tp.dock_layout.set_active_tab(new_id);
            tp.dock_view_mode = ViewMode::Stacked;
            self.dock.dock_zoomed = true;
        }

        if created_split {
            self.begin_split_transition_animation(
                crate::state::SplitTransitionScope::TerminalContextSurface { terminal_id: tid },
                new_id,
            );
        }
        self.set_dock_visible_with_animation(true);
        self.focus.focus_area = FocusArea::Dock;
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Swap Dock content when terminal focus changes.
    fn swap_dock_state(&mut self, incoming_terminal: PaneId) {
        self.sync_terminal_context_mode_from_terminal(incoming_terminal);
        let any_has_dock = self.panes.values().any(|pk| {
            if let PaneKind::Terminal(tp) = pk {
                !tp.dock_layout.all_pane_ids().is_empty()
            } else {
                false
            }
        });
        if !any_has_dock {
            self.set_dock_visible_with_animation(false);
        }
        self.ensure_dock_placeholder();
        self.cache.pane_generations.clear();
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    // ── Dock state queries/mutations (click_adapter) ──

    fn dock_zoomed(&self) -> bool {
        self.active_terminal_context_is_stacked()
    }

    fn set_dock_zoomed(&mut self, zoomed: bool) {
        self.set_active_terminal_context_stacked(zoomed);
        if zoomed {
            self.set_dock_visible_with_animation(true);
        }
    }

    fn dock_open(&self) -> bool {
        self.dock.dock_open
    }

    fn associated_terminal(&self, id: PaneId) -> Option<PaneId> {
        self.assoc.associated_terminal.get(&id).copied()
    }

    fn set_associated_terminal(&mut self, pane: PaneId, terminal: PaneId) {
        self.assoc.associated_terminal.insert(pane, terminal);
    }

    // ── Dock layout manipulation (for handle_drop) ──

    fn dock_layout_insert_at_root(
        &mut self,
        terminal_id: PaneId,
        source: PaneId,
        zone: crate::tide_core::DropZone,
    ) {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            if zone != crate::tide_core::DropZone::Center {
                tp.dock_view_mode = ViewMode::Split;
                self.dock.dock_zoomed = false;
                tp.dock_layout.insert_at_root(source, zone);
            }
            tp.dock_focused = Some(source);
        }
    }

    fn dock_layout_set_focused(&mut self, terminal_id: PaneId, pane_id: PaneId) {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            tp.dock_focused = Some(pane_id);
        }
    }

    fn dock_layout_set_active_tab(&mut self, terminal_id: PaneId, pane_id: PaneId) {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            tp.dock_layout.set_active_tab(pane_id);
        }
    }

    fn dock_layout_remove(&mut self, terminal_id: PaneId, pane_id: PaneId) {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            tp.dock_layout.remove(pane_id);
        }
    }

    fn dock_layout_set_split_ratio(
        &mut self,
        terminal_id: PaneId,
        pane_id: PaneId,
        ratio: f32,
    ) -> bool {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            tp.dock_layout.set_split_ratio(pane_id, ratio)
        } else {
            false
        }
    }

    fn dock_layout_split_with_leaf_group(
        &mut self,
        terminal_id: PaneId,
        target: PaneId,
        source: PaneId,
        direction: SplitDirection,
        insert_first: bool,
    ) {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            tp.dock_view_mode = ViewMode::Split;
            self.dock.dock_zoomed = false;
            if !tp
                .dock_layout
                .insert_pane(target, source, direction, insert_first)
            {
                tp.dock_layout.insert_at_root(source, DropZone::Bottom);
            }
            tp.dock_focused = Some(source);
        }
    }

    fn dock_layout_swap_panes(&mut self, terminal_id: PaneId, a: PaneId, b: PaneId) -> bool {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            tp.dock_layout.swap_panes(a, b)
        } else {
            false
        }
    }

    fn dock_layout_tab_group_sibling(
        &self,
        terminal_id: PaneId,
        pane_id: PaneId,
    ) -> Option<PaneId> {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get(&terminal_id) {
            tp.dock_layout
                .tab_group_containing(pane_id)
                .and_then(|tg| tg.tabs.iter().find(|&&t| t != pane_id).copied())
        } else {
            None
        }
    }

    fn dock_tab_group_contains_multiple(&self, pane_id: PaneId) -> bool {
        self.terminal_owning(pane_id)
            .and_then(|terminal_id| match self.panes.get(&terminal_id) {
                Some(PaneKind::Terminal(tp)) => tp
                    .dock_layout
                    .tab_group_containing(pane_id)
                    .map(|tg| tg.tabs.len() > 1),
                _ => None,
            })
            .unwrap_or(false)
    }

    // ── Dock drag state (mouse_adapter) ──

    fn dock_border_dragging(&self) -> bool {
        self.dock.dock_border_dragging
    }

    fn set_dock_border_dragging(&mut self, v: bool) {
        self.dock.dock_border_dragging = v;
    }

    fn dock_split_dragging(&self) -> bool {
        self.dock.dock_split_dragging
    }

    fn set_dock_split_dragging(&mut self, v: bool) {
        self.dock.dock_split_dragging = v;
    }

    fn set_dock_width(&mut self, w: f32) {
        self.dock.dock_width = w;
    }

    fn animate_dock_width(&mut self, w: f32) -> f32 {
        let now = self.ports.clock.now();
        let from_width = self.terminal_context_surface_rendered_width(now);
        self.dock.dock_open = true;
        self.dock.dock_width = w;
        if (from_width - w).abs() < 0.5 && self.dock.visibility_animation.is_none() {
            return from_width;
        }
        self.dock.begin_visibility_animation(from_width, w, now);
        from_width
    }

    fn dock_begin_split_drag(
        &mut self,
        local_pos: crate::tide_core::Vec2,
        dock_size: crate::tide_core::Size,
    ) -> bool {
        if let Some(tid) = self.focused_terminal_id() {
            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                tp.dock_layout.begin_drag(local_pos, dock_size);
                return tp.dock_layout.is_dragging();
            }
        }
        false
    }

    fn dock_drag_split_border(&mut self, local_pos: crate::tide_core::Vec2) {
        if let Some(tid) = self.focused_terminal_id() {
            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                tp.dock_layout.drag_border(local_pos);
            }
        }
    }

    fn dock_end_split_drag(&mut self) {
        if let Some(tid) = self.focused_terminal_id() {
            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                tp.dock_layout.end_drag();
            }
        }
    }

    /// Toggle pin state on the currently focused dock pane.
    fn toggle_dock_pin(&mut self) {
        self.cache.invalidate_chrome();
        self.cache.pane_generations.clear();
        self.compute_layout();
    }
}
