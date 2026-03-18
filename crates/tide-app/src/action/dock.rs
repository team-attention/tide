use tide_core::{LayoutEngine, PaneId, SplitDirection};

use crate::pane::PaneKind;
use crate::ui_state::FocusArea;
use crate::App;

impl App {
    /// Which Terminal is currently active in Stage.
    /// This only changes on terminal click / HJKL navigate / workspace switch.
    /// Dock operations never change this.
    pub(crate) fn focused_terminal_id(&self) -> Option<PaneId> {
        self.stage_focused
    }

    /// Which Terminal owns this pane via dock_layout?
    pub(crate) fn terminal_owning(&self, pane_id: PaneId) -> Option<PaneId> {
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
    pub(crate) fn is_pane_in_dock(&self, pane_id: PaneId) -> bool {
        self.terminal_owning(pane_id).is_some()
            || self.pinned_dock_layout.all_pane_ids().contains(&pane_id)
    }

    /// Check if a pane is in the pinned dock layout.
    pub(crate) fn is_pane_pinned(&self, pane_id: PaneId) -> bool {
        self.pinned_dock_layout.all_pane_ids().contains(&pane_id)
    }

    /// Whether the pinned dock has any panes.
    pub(crate) fn has_pinned_panes(&self) -> bool {
        !self.pinned_dock_layout.all_pane_ids().is_empty()
    }

    /// Add a pane to the focused Terminal's dock.
    pub(crate) fn add_pane_to_dock(&mut self, new_pane_id: PaneId) {
        let launcher_to_replace = self.dock_launcher_id()
            .filter(|&lid| lid != new_pane_id);

        if let Some(launcher_id) = launcher_to_replace {
            let tid = self.focused_terminal_id();
            if let Some(tid) = tid {
                if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                    tp.dock_layout.replace_pane(launcher_id, new_pane_id);
                    tp.dock_focused = Some(new_pane_id);
                    tp.dock_layout.set_active_tab(new_pane_id);
                }
                self.panes.remove(&launcher_id);
                self.cleanup_closed_pane_state(launcher_id);
                self.dock_open = true;
                self.associated_terminal.insert(new_pane_id, tid);
            }
            return;
        }

        if let Some(tid) = self.focused_terminal_id() {
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
            self.dock_open = true;
            self.associated_terminal.insert(new_pane_id, tid);
        }
    }

    /// Toggle Dock visibility (Cmd+4).
    pub(crate) fn toggle_dock(&mut self) {
        if self.dock_open {
            let focused_in_dock = self.focused.map(|f| self.is_pane_in_dock(f)).unwrap_or(false);

            if focused_in_dock {
                // Close + focus Stage terminal
                self.dock_open = false;
                self.focus_area = FocusArea::Stage;
                if let Some(tid) = self.stage_focused {
                    self.focused = Some(tid);
                    self.router.set_focused(tid);
                }
            } else {
                // Focus the dock: try terminal dock pane, then pinned pane
                self.focus_area = FocusArea::Dock;
                if let Some(tid) = self.stage_focused {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        if let Some(df) = tp.dock_focused {
                            self.focused = Some(df);
                            self.router.set_focused(df);
                            self.cache.invalidate_chrome();
                            self.compute_layout();
                            return;
                        }
                    }
                }
                // No terminal dock pane — try pinned
                if let Some(pf) = self.pinned_dock_layout.pane_ids().into_iter().next() {
                    self.focused = Some(pf);
                    self.router.set_focused(pf);
                }
            }
        } else {
            // Open
            let has_terminal_dock = self.stage_focused.map(|tid| {
                if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                    !tp.dock_layout.all_pane_ids().is_empty()
                } else { false }
            }).unwrap_or(false);
            let has_pinned = self.has_pinned_panes();

            if has_terminal_dock || has_pinned {
                self.dock_open = true;
                self.focus_area = FocusArea::Dock;
                // Focus terminal dock pane first, then pinned
                if has_terminal_dock {
                    if let Some(tid) = self.stage_focused {
                        if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                            if let Some(df) = tp.dock_focused {
                                self.focused = Some(df);
                                self.router.set_focused(df);
                            }
                        }
                    }
                } else if let Some(pf) = self.pinned_dock_layout.pane_ids().into_iter().next() {
                    self.focused = Some(pf);
                    self.router.set_focused(pf);
                }
            } else if let Some(_tid) = self.stage_focused {
                // Create Launcher
                let new_id = self.layout.alloc_id();
                self.panes.insert(new_id, PaneKind::Launcher(new_id));
                self.ime.pending_creates.push(new_id);
                self.add_pane_to_dock(new_id);
                self.focus_area = FocusArea::Dock;
                self.focused = Some(new_id);
                self.router.set_focused(new_id);
            }
        }
        // Safety: ensure something is focused
        if self.focused.is_none() {
            if let Some(tid) = self.layout.pane_ids().into_iter()
                .find(|&id| matches!(self.panes.get(&id), Some(PaneKind::Terminal(_)))) {
                self.focused = Some(tid);
                self.router.set_focused(tid);
                self.focus_area = FocusArea::Stage;
            }
        }
        self.cache.pane_generations.clear();
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Remove a pane from its owning Terminal's dock or the pinned dock.
    pub(crate) fn remove_pane_from_dock(&mut self, pane_id: PaneId) {
        let was_pinned = self.is_pane_pinned(pane_id);

        if was_pinned {
            self.pinned_dock_layout.remove(pane_id);
            self.associated_terminal.remove(&pane_id);
            // Check if dock should close
            if !self.has_pinned_panes() {
                let any_has_dock = self.panes.values().any(|pk| {
                    if let PaneKind::Terminal(tp) = pk {
                        !tp.dock_layout.all_pane_ids().is_empty()
                    } else { false }
                });
                if !any_has_dock {
                    self.dock_open = false;
                }
            }
            // Move focus to terminal dock or stage
            if self.focused == Some(pane_id) {
                if let Some(tid) = self.stage_focused {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        if let Some(df) = tp.dock_focused {
                            self.focused = Some(df);
                            self.router.set_focused(df);
                            return;
                        }
                    }
                    // Try next pinned pane
                    if let Some(next) = self.pinned_dock_layout.pane_ids().into_iter().next() {
                        self.focused = Some(next);
                        self.router.set_focused(next);
                        return;
                    }
                    self.focused = Some(tid);
                    self.router.set_focused(tid);
                    self.focus_area = FocusArea::Stage;
                }
            }
            return;
        }

        if let Some(tid) = self.terminal_owning(pane_id) {
            self.associated_terminal.remove(&pane_id);

            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                tp.dock_layout.remove(pane_id);
                let remaining = tp.dock_layout.all_pane_ids();
                if remaining.is_empty() {
                    tp.dock_focused = None;
                    if !self.has_pinned_panes() {
                        self.dock_open = false;
                    }
                    self.focus_area = FocusArea::Stage;
                    if let Some(st) = self.stage_focused {
                        self.focused = Some(st);
                        self.router.set_focused(st);
                    }
                } else {
                    let visible = tp.dock_layout.pane_ids();
                    let next = tp.dock_focused
                        .filter(|f| remaining.contains(f))
                        .or_else(|| visible.first().copied())
                        .unwrap_or(remaining[0]);
                    tp.dock_focused = Some(next);
                    tp.dock_layout.set_active_tab(next);
                    self.focused = Some(next);
                    self.router.set_focused(next);
                }
            } else {
                let remaining: Vec<PaneId> = self.associated_terminal.iter()
                    .filter(|(_, &t)| t == tid)
                    .map(|(&p, _)| p)
                    .collect();
                if remaining.is_empty() {
                    self.dock_open = false;
                    self.focus_area = FocusArea::Stage;
                    if let Some(st) = self.stage_focused {
                        self.focused = Some(st);
                        self.router.set_focused(st);
                    }
                } else {
                    let next = remaining[0];
                    self.focused = Some(next);
                    self.router.set_focused(next);
                }
            }
        }
    }

    /// Close a Terminal and cascade to all its dock panes.
    pub(crate) fn cascade_close_terminal(&mut self, terminal_id: PaneId) {
        let mut dock_pane_ids: Vec<PaneId> = if let Some(PaneKind::Terminal(tp)) = self.panes.get(&terminal_id) {
            tp.dock_layout.all_pane_ids()
        } else {
            Vec::new()
        };
        let associated: Vec<PaneId> = self.associated_terminal.iter()
            .filter(|(_, &tid)| tid == terminal_id)
            .map(|(&pid, _)| pid)
            .collect();
        for pid in associated {
            if !dock_pane_ids.contains(&pid) {
                dock_pane_ids.push(pid);
            }
        }
        for pid in dock_pane_ids {
            self.pinned_dock_layout.remove(pid);
            self.panes.remove(&pid);
            self.cleanup_closed_pane_state(pid);
        }
        self.panes.remove(&terminal_id);
        self.layout.remove(terminal_id);
        self.cleanup_closed_pane_state(terminal_id);
        self.dock_open = false;
    }

    /// If Dock is open and empty (no terminal dock panes, no pinned panes),
    /// create a placeholder Launcher.
    /// If pinned panes exist, remove any placeholder Launchers.
    pub(crate) fn ensure_dock_placeholder(&mut self) {
        if !self.dock_open { return; }
        if self.has_pinned_panes() {
            // Remove placeholder Launchers — pinned panes fill that role
            if let Some(tid) = self.stage_focused {
                let launchers: Vec<PaneId> = if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                    tp.dock_layout.all_pane_ids().into_iter()
                        .filter(|&pid| matches!(self.panes.get(&pid), Some(PaneKind::Launcher(_))))
                        .collect()
                } else { Vec::new() };
                for lid in launchers {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                        tp.dock_layout.remove(lid);
                    }
                    self.panes.remove(&lid);
                    self.cleanup_closed_pane_state(lid);
                }
            }
            return;
        }
        let tid = match self.stage_focused {
            Some(id) => id,
            None => return,
        };
        let is_empty = matches!(self.panes.get(&tid), Some(PaneKind::Terminal(tp)) if tp.dock_layout.all_pane_ids().is_empty());
        if !is_empty { return; }

        let new_id = self.layout.alloc_id();
        self.panes.insert(new_id, PaneKind::Launcher(new_id));
        self.ime.pending_creates.push(new_id);
        let prev_focused = self.focused;
        self.focused = Some(tid);
        self.add_pane_to_dock(new_id);
        self.focused = prev_focused;
    }

    /// Returns the dock_focused PaneId if it's a Launcher (placeholder).
    pub(crate) fn dock_launcher_id(&self) -> Option<PaneId> {
        let tid = self.stage_focused?;
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
    pub(crate) fn dock_split_new_tab_group(&mut self, direction: SplitDirection) {
        let tid = match self.stage_focused {
            Some(id) => id,
            None => return,
        };

        let new_id = self.layout.alloc_id();
        self.panes.insert(new_id, PaneKind::Launcher(new_id));
        self.ime.pending_creates.push(new_id);
        self.associated_terminal.insert(new_id, tid);

        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
            if let Some(dock_focused) = tp.dock_focused {
                tp.dock_layout.split_with_leaf_group(dock_focused, new_id, direction, false);
            } else {
                tp.dock_layout.insert_leaf_group(new_id);
            }
            tp.dock_focused = Some(new_id);
        }

        self.dock_open = true;
        self.focus_area = FocusArea::Dock;
        self.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Swap Dock content when terminal focus changes.
    pub(crate) fn swap_dock_state(&mut self, _incoming_terminal: PaneId) {
        // Reset dock zoom on all terminals
        for (_, pk) in &mut self.panes {
            if let PaneKind::Terminal(tp) = pk {
                tp.dock_zoomed = false;
            }
        }
        let any_has_dock = self.panes.values().any(|pk| {
            if let PaneKind::Terminal(tp) = pk {
                !tp.dock_layout.all_pane_ids().is_empty()
            } else { false }
        });
        if !any_has_dock && !self.has_pinned_panes() {
            self.dock_open = false;
        }
        self.ensure_dock_placeholder();
        self.cache.pane_generations.clear();
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Toggle pin state on the currently focused dock pane.
    pub(crate) fn toggle_dock_pin(&mut self) {
        let pane_id = match self.focused {
            Some(id) if self.is_pane_in_dock(id) => id,
            _ => return,
        };

        if self.is_pane_pinned(pane_id) {
            // Unpin: move from pinned_dock_layout to associated terminal's dock_layout
            self.pinned_dock_layout.remove(pane_id);
            let target_tid = self.associated_terminal.get(&pane_id).copied()
                .or_else(|| self.stage_focused);
            if let Some(tid) = target_tid {
                let is_current = self.stage_focused == Some(tid);
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
                self.associated_terminal.insert(pane_id, tid);
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
                self.associated_terminal.insert(pane_id, owner_tid);
            }
            // Add to pinned dock layout
            if self.pinned_dock_layout.all_pane_ids().is_empty() {
                self.pinned_dock_layout.insert_leaf_group(pane_id);
            } else {
                self.pinned_dock_layout.add_tab_to_first_group(pane_id);
            }
            self.pinned_dock_layout.set_active_tab(pane_id);
        }
        // focused stays on pane_id — it's still a valid pane, just moved
        self.cache.invalidate_chrome();
        self.cache.pane_generations.clear();
        self.compute_layout();
    }
}
