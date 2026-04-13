use crate::tide_core::{LayoutEngine, PaneId, SplitDirection};

use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::App;
use crate::DockPort;
use crate::LayoutPort;

impl DockPort for App {
    /// Which Terminal is currently active in Stage.
    /// This only changes on terminal click / HJKL navigate / workspace switch.
    /// Dock operations never change this.
    fn focused_terminal_id(&self) -> Option<PaneId> {
        self.focus.stage_focused
    }

    /// Which Terminal owns this pane via dock_layout?
    fn terminal_owning(&self, pane_id: PaneId) -> Option<PaneId> {
        for (&id, pane) in &self.panes {
            if let PaneKind::Terminal(tp) = pane {
                if tp.dock_layout.all_pane_ids().contains(&pane_id) {
                    return Some(id);
                }
            }
        }
        None
    }

    /// Check if a pane is in any terminal's dock_layout OR in the pinned dock layout.
    fn is_pane_in_dock(&self, pane_id: PaneId) -> bool {
        self.terminal_owning(pane_id).is_some()
            || self
                .dock
                .pinned_dock_layout
                .all_pane_ids()
                .contains(&pane_id)
    }

    /// Check if a pane is in the pinned dock layout.
    fn is_pane_pinned(&self, pane_id: PaneId) -> bool {
        self.dock.is_pane_pinned(pane_id)
    }

    /// Whether the pinned dock has any panes.
    fn has_pinned_panes(&self) -> bool {
        !self.dock.pinned_dock_layout.all_pane_ids().is_empty()
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
                self.dock.dock_open = true;
                self.assoc.associated_terminal.insert(new_pane_id, tid);
            }
            return;
        }

        if let Some(tid) = target_terminal.or_else(|| self.focused_terminal_id()) {
            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                if tp.dock_layout.all_pane_ids().is_empty() {
                    tp.dock_layout.insert_leaf_group(new_pane_id);
                } else if let Some(focused) = tp.dock_focused {
                    if !tp.dock_layout.add_tab(focused, new_pane_id) {
                        tp.dock_layout.add_tab_to_first_group(new_pane_id);
                    }
                } else {
                    tp.dock_layout.add_tab_to_first_group(new_pane_id);
                }
                tp.dock_focused = Some(new_pane_id);
                tp.dock_layout.set_active_tab(new_pane_id);
            }
            self.dock.dock_open = true;
            self.assoc.associated_terminal.insert(new_pane_id, tid);
        }
    }

    /// Toggle Dock visibility (Cmd+4).
    fn toggle_dock(&mut self) {
        if self.dock.dock_open {
            let focused_in_dock = self
                .focus
                .focused
                .map(|f| self.is_pane_in_dock(f))
                .unwrap_or(false);

            if focused_in_dock {
                // Close + focus Stage terminal
                self.dock.dock_open = false;
                self.focus.focus_area = FocusArea::Stage;
                if let Some(tid) = self.focus.stage_focused {
                    self.focus.focused = Some(tid);
                    self.router.set_focused(tid);
                }
            } else {
                // Focus the dock: try terminal dock pane, then pinned pane
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
                // No terminal dock pane — try pinned
                if let Some(pf) = self.dock.pinned_dock_layout.pane_ids().into_iter().next() {
                    self.focus.focused = Some(pf);
                    self.router.set_focused(pf);
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
            let has_pinned = self.has_pinned_panes();

            if has_terminal_dock || has_pinned {
                self.dock.dock_open = true;
                self.focus.focus_area = FocusArea::Dock;
                // Focus terminal dock pane first, then pinned
                if has_terminal_dock {
                    if let Some(tid) = self.focus.stage_focused {
                        if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                            if let Some(df) = tp.dock_focused {
                                self.focus.focused = Some(df);
                                self.router.set_focused(df);
                            }
                        }
                    }
                } else if let Some(pf) = self.dock.pinned_dock_layout.pane_ids().into_iter().next()
                {
                    self.focus.focused = Some(pf);
                    self.router.set_focused(pf);
                }
            } else if let Some(_tid) = self.focus.stage_focused {
                // Create Launcher
                let new_id = self.layout.alloc_id();
                self.panes.insert(new_id, PaneKind::Launcher(new_id));
                self.ime.pending_creates.push(new_id);
                self.add_pane_to_dock(new_id, None);
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

    /// Remove a pane from its owning Terminal's dock or the pinned dock.
    fn remove_pane_from_dock(&mut self, pane_id: PaneId) {
        let was_pinned = self.is_pane_pinned(pane_id);

        if was_pinned {
            self.dock.pinned_dock_layout.remove(pane_id);
            self.assoc.associated_terminal.remove(&pane_id);
            // Check if dock should close
            if !self.has_pinned_panes() {
                let any_has_dock = self.panes.values().any(|pk| {
                    if let PaneKind::Terminal(tp) = pk {
                        !tp.dock_layout.all_pane_ids().is_empty()
                    } else {
                        false
                    }
                });
                if !any_has_dock {
                    self.dock.dock_open = false;
                }
            }
            // Move focus to terminal dock or stage
            if self.focus.focused == Some(pane_id) {
                if let Some(tid) = self.focus.stage_focused {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        if let Some(df) = tp.dock_focused {
                            self.focus.focused = Some(df);
                            self.router.set_focused(df);
                            return;
                        }
                    }
                    // Try next pinned pane
                    if let Some(next) = self.dock.pinned_dock_layout.pane_ids().into_iter().next() {
                        self.focus.focused = Some(next);
                        self.router.set_focused(next);
                        return;
                    }
                    self.focus.focused = Some(tid);
                    self.router.set_focused(tid);
                    self.focus.focus_area = FocusArea::Stage;
                }
            }
            return;
        }

        if let Some(tid) = self.terminal_owning(pane_id) {
            self.assoc.associated_terminal.remove(&pane_id);

            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                tp.dock_layout.remove(pane_id);
                let remaining = tp.dock_layout.all_pane_ids();
                if remaining.is_empty() {
                    tp.dock_focused = None;
                    if !self.has_pinned_panes() {
                        self.dock.dock_open = false;
                    }
                    self.focus.focus_area = FocusArea::Stage;
                    if let Some(st) = self.focus.stage_focused {
                        self.focus.focused = Some(st);
                        self.router.set_focused(st);
                    }
                } else {
                    let visible = tp.dock_layout.pane_ids();
                    let next = tp
                        .dock_focused
                        .filter(|f| remaining.contains(f))
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
                    self.dock.dock_open = false;
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
        self.dock.dock_open = false;
    }

    /// If Dock is open and empty (no terminal dock panes, no pinned panes),
    /// create a placeholder Launcher.
    /// If pinned panes exist, remove any placeholder Launchers.
    fn ensure_dock_placeholder(&mut self) {
        if !self.dock.dock_open {
            return;
        }
        if self.has_pinned_panes() {
            // Remove placeholder Launchers — pinned panes fill that role
            if let Some(tid) = self.focus.stage_focused {
                let launchers: Vec<PaneId> = if let Some(PaneKind::Terminal(tp)) =
                    self.panes.get(&tid)
                {
                    tp.dock_layout
                        .all_pane_ids()
                        .into_iter()
                        .filter(|&pid| matches!(self.panes.get(&pid), Some(PaneKind::Launcher(_))))
                        .collect()
                } else {
                    Vec::new()
                };
                for lid in launchers {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                        tp.dock_layout.remove(lid);
                        // Clear stale dock_focused so fallback chain works
                        if tp.dock_focused == Some(lid) {
                            tp.dock_focused = None;
                        }
                    }
                    self.panes.remove(&lid);
                    self.cleanup_closed_pane_state(lid);
                }
            }
            return;
        }
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

    /// Split Dock with a new TabGroup.
    fn dock_split_new_tab_group(&mut self, direction: SplitDirection) {
        let tid = match self.focus.stage_focused {
            Some(id) => id,
            None => return,
        };

        let new_id = self.layout.alloc_id();
        self.panes.insert(new_id, PaneKind::Launcher(new_id));
        self.ime.pending_creates.push(new_id);
        self.assoc.associated_terminal.insert(new_id, tid);

        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
            if let Some(dock_focused) = tp.dock_focused {
                tp.dock_layout
                    .split_with_leaf_group(dock_focused, new_id, direction, false);
            } else {
                tp.dock_layout.insert_leaf_group(new_id);
            }
            tp.dock_focused = Some(new_id);
        }

        self.dock.dock_open = true;
        // Focus moves to Dock so user can interact with the new Launcher.
        self.focus.focus_area = FocusArea::Dock;
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Swap Dock content when terminal focus changes.
    fn swap_dock_state(&mut self, _incoming_terminal: PaneId) {
        // dock_zoomed is global (on DockState), so no per-terminal transfer needed.
        let any_has_dock = self.panes.values().any(|pk| {
            if let PaneKind::Terminal(tp) = pk {
                !tp.dock_layout.all_pane_ids().is_empty()
            } else {
                false
            }
        });
        if !any_has_dock && !self.has_pinned_panes() {
            self.dock.dock_open = false;
        }
        self.ensure_dock_placeholder();
        self.cache.pane_generations.clear();
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    // ── Dock state queries/mutations (click_adapter) ──

    fn dock_zoomed(&self) -> bool {
        self.dock.dock_zoomed
    }

    fn set_dock_zoomed(&mut self, zoomed: bool) {
        self.dock.dock_zoomed = zoomed;
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

    fn pinned_layout_remove(&mut self, id: PaneId) {
        self.dock.pinned_dock_layout.remove(id);
    }

    fn dock_layout_insert_at_root(
        &mut self,
        terminal_id: PaneId,
        source: PaneId,
        zone: crate::tide_core::DropZone,
    ) {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            tp.dock_layout.insert_at_root(source, zone);
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

    fn dock_layout_add_tab_to_first_group(&mut self, terminal_id: PaneId, pane_id: PaneId) {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            tp.dock_layout.add_tab_to_first_group(pane_id);
        }
    }

    fn dock_layout_insert_leaf_group(&mut self, terminal_id: PaneId, pane_id: PaneId) {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            tp.dock_layout.insert_leaf_group(pane_id);
        }
    }

    fn dock_layout_all_pane_ids_empty(&self, terminal_id: PaneId) -> bool {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get(&terminal_id) {
            tp.dock_layout.all_pane_ids().is_empty()
        } else {
            true
        }
    }

    fn dock_layout_add_tab(&mut self, terminal_id: PaneId, target: PaneId, source: PaneId) -> bool {
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&terminal_id) {
            tp.dock_layout.add_tab(target, source)
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
            tp.dock_layout
                .split_with_leaf_group(target, source, direction, insert_first);
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
        if self.is_pane_pinned(pane_id) {
            return self
                .dock
                .pinned_dock_layout
                .tab_group_containing(pane_id)
                .map(|tg| tg.tabs.len() > 1)
                .unwrap_or(false);
        }

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

    fn pinned_layout_set_active_tab(&mut self, pane_id: PaneId) {
        self.dock.pinned_dock_layout.set_active_tab(pane_id);
    }

    fn pinned_layout_add_tab_to_first_group(&mut self, pane_id: PaneId) {
        self.dock.pinned_dock_layout.add_tab_to_first_group(pane_id);
    }

    fn pinned_layout_add_tab(&mut self, target: PaneId, source: PaneId) -> bool {
        self.dock.pinned_dock_layout.add_tab(target, source)
    }

    fn pinned_layout_split_with_leaf_group(
        &mut self,
        target: PaneId,
        source: PaneId,
        direction: SplitDirection,
        insert_first: bool,
    ) {
        self.dock
            .pinned_dock_layout
            .split_with_leaf_group(target, source, direction, insert_first);
    }

    fn pinned_layout_tab_group_sibling(&self, pane_id: PaneId) -> Option<PaneId> {
        self.dock
            .pinned_dock_layout
            .tab_group_containing(pane_id)
            .and_then(|tg| tg.tabs.iter().find(|&&t| t != pane_id).copied())
    }

    // ── Dock drag state (mouse_adapter) ──

    fn dock_border_dragging(&self) -> bool {
        self.dock.dock_border_dragging
    }

    fn set_dock_border_dragging(&mut self, v: bool) {
        self.dock.dock_border_dragging = v;
    }

    fn dock_pinned_border_dragging(&self) -> bool {
        self.dock.pinned_border_dragging
    }

    fn set_dock_pinned_border_dragging(&mut self, v: bool) {
        self.dock.pinned_border_dragging = v;
    }

    fn dock_split_dragging(&self) -> bool {
        self.dock.dock_split_dragging
    }

    fn set_dock_split_dragging(&mut self, v: bool) {
        self.dock.dock_split_dragging = v;
    }

    fn dock_pinned_ratio(&self) -> f32 {
        self.dock.pinned_dock_ratio
    }

    fn set_dock_pinned_ratio(&mut self, ratio: f32) {
        self.dock.pinned_dock_ratio = ratio;
    }

    fn set_dock_width(&mut self, w: f32) {
        self.dock.dock_width = w;
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
        let pane_id = match self.focus.focused {
            Some(id) if self.is_pane_in_dock(id) => id,
            _ => return,
        };

        if self.is_pane_pinned(pane_id) {
            // Unpin: move from pinned_dock_layout to associated terminal's dock_layout
            self.dock.pinned_dock_layout.remove(pane_id);
            let target_tid = self
                .assoc
                .associated_terminal
                .get(&pane_id)
                .copied()
                .or_else(|| self.focus.stage_focused);
            if let Some(tid) = target_tid {
                let is_current = self.focus.stage_focused == Some(tid);
                if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                    if tp.dock_layout.all_pane_ids().is_empty() {
                        tp.dock_layout.insert_leaf_group(pane_id);
                    } else {
                        tp.dock_layout.add_tab_to_first_group(pane_id);
                    }
                    if is_current {
                        tp.dock_focused = Some(pane_id);
                        tp.dock_layout.set_active_tab(pane_id);
                    }
                }
                self.assoc.associated_terminal.insert(pane_id, tid);
            }
        } else {
            // Pin: move from terminal's dock_layout to pinned_dock_layout
            if let Some(owner_tid) = self.terminal_owning(pane_id) {
                if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&owner_tid) {
                    tp.dock_layout.remove(pane_id);
                    if tp.dock_focused == Some(pane_id) {
                        let remaining = tp.dock_layout.all_pane_ids();
                        tp.dock_focused = remaining.first().copied();
                        if let Some(next) = tp.dock_focused {
                            tp.dock_layout.set_active_tab(next);
                        }
                    }
                }
                self.assoc.associated_terminal.insert(pane_id, owner_tid);
            }
            // Add to pinned dock layout
            if self.dock.pinned_dock_layout.all_pane_ids().is_empty() {
                self.dock.pinned_dock_layout.insert_leaf_group(pane_id);
            } else {
                self.dock.pinned_dock_layout.add_tab_to_first_group(pane_id);
            }
            self.dock.pinned_dock_layout.set_active_tab(pane_id);
        }
        // focused stays on pane_id — it's still a valid pane, just moved
        self.cache.invalidate_chrome();
        self.cache.pane_generations.clear();
        self.compute_layout();
    }
}
