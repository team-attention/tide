use tide_core::{LayoutEngine, PaneId};

use crate::pane::PaneKind;
use crate::ui_state::FocusArea;
use crate::App;

impl App {
    /// Resolve which Terminal is currently active.
    /// Also considers Launcher panes in Stage (they resolve to Terminals).
    pub(crate) fn focused_terminal_id(&self) -> Option<PaneId> {
        let focused = self.focused?;
        // 1. Is focused a Terminal or Launcher in Stage?
        if matches!(self.panes.get(&focused), Some(PaneKind::Terminal(_) | PaneKind::Launcher(_))) {
            if self.layout.pane_ids().contains(&focused) {
                return Some(focused);
            }
        }
        // 2. Is focused a pane in some Terminal's dock?
        if let Some(owner) = self.terminal_owning(focused) {
            return Some(owner);
        }
        // 3. Fallback: first Terminal or Launcher in Stage
        self.layout.pane_ids().into_iter()
            .find(|&id| matches!(self.panes.get(&id), Some(PaneKind::Terminal(_) | PaneKind::Launcher(_))))
    }

    /// Which Terminal owns this pane via dock_layout?
    /// Only checks actual dock_layout membership, not associated_terminal
    /// (which tracks CWD context, not layout ownership).
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

    /// Check if a pane is in any terminal's dock_layout.
    pub(crate) fn is_pane_in_dock(&self, pane_id: PaneId) -> bool {
        self.terminal_owning(pane_id).is_some()
    }

    /// Add a pane to the focused Terminal's dock.
    pub(crate) fn add_pane_to_dock(&mut self, new_pane_id: PaneId) {
        if let Some(tid) = self.focused_terminal_id() {
            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                // Find first TabGroup and add as tab, or create new LeafGroup
                if tp.dock_layout.all_pane_ids().is_empty() {
                    // Empty dock — create initial LeafGroup
                    tp.dock_layout.insert_leaf_group(new_pane_id);
                } else if let Some(focused) = tp.dock_focused {
                    // Add as tab in the same TabGroup as the focused pane
                    if !tp.dock_layout.add_tab(focused, new_pane_id) {
                        // Focused pane not in a tab group, add to first group
                        tp.dock_layout.add_tab_to_first_group(new_pane_id);
                    }
                } else {
                    // No focused — add to first TabGroup
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
            let focused_in_dock = self.focused.map(|f| self.terminal_owning(f).is_some()).unwrap_or(false);

            if focused_in_dock {
                // Close + focus owner terminal
                let owner = self.focused_terminal_id();
                self.dock_open = false;
                self.focus_area = FocusArea::Stage;
                if let Some(tid) = owner {
                    self.focused = Some(tid);
                    self.router.set_focused(tid);
                }
            } else {
                // Focus the dock pane
                self.focus_area = FocusArea::Dock;
                if let Some(tid) = self.focused_terminal_id() {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        if let Some(df) = tp.dock_focused {
                            self.focused = Some(df);
                            self.router.set_focused(df);
                        }
                    }
                }
            }
        } else {
            // Open
            if let Some(tid) = self.focused_terminal_id() {
                let has_panes = if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                    !tp.dock_layout.all_pane_ids().is_empty()
                } else { false };

                if has_panes {
                    self.dock_open = true;
                    self.focus_area = FocusArea::Dock;
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        if let Some(df) = tp.dock_focused {
                            self.focused = Some(df);
                            self.router.set_focused(df);
                        }
                    }
                } else {
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

    /// Remove a pane from its owning Terminal's dock.
    pub(crate) fn remove_pane_from_dock(&mut self, pane_id: PaneId) {
        if let Some(tid) = self.terminal_owning(pane_id) {
            // Remove from associated_terminal
            self.associated_terminal.remove(&pane_id);

            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                tp.dock_layout.remove(pane_id);
                let remaining = tp.dock_layout.all_pane_ids();
                if remaining.is_empty() {
                    tp.dock_focused = None;
                    self.dock_open = false;
                    self.focus_area = FocusArea::Stage;
                    self.focused = Some(tid);
                    self.router.set_focused(tid);
                } else {
                    let next = remaining[0];
                    tp.dock_focused = Some(next);
                    tp.dock_layout.set_active_tab(next);
                    self.focused = Some(next);
                    self.router.set_focused(next);
                }
            } else {
                // Owner is not a Terminal (e.g., Launcher in tests)
                // Check if there are remaining associated panes
                let remaining: Vec<PaneId> = self.associated_terminal.iter()
                    .filter(|(_, &t)| t == tid)
                    .map(|(&p, _)| p)
                    .collect();
                if remaining.is_empty() {
                    self.dock_open = false;
                    self.focus_area = FocusArea::Stage;
                    self.focused = Some(tid);
                    self.router.set_focused(tid);
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
        // Collect dock pane IDs from dock_layout
        let mut dock_pane_ids: Vec<PaneId> = if let Some(PaneKind::Terminal(tp)) = self.panes.get(&terminal_id) {
            tp.dock_layout.all_pane_ids()
        } else {
            Vec::new()
        };
        // Also collect panes associated with this terminal via associated_terminal
        let associated: Vec<PaneId> = self.associated_terminal.iter()
            .filter(|(_, &tid)| tid == terminal_id)
            .map(|(&pid, _)| pid)
            .collect();
        for pid in associated {
            if !dock_pane_ids.contains(&pid) {
                dock_pane_ids.push(pid);
            }
        }
        // Close all dock panes
        for pid in dock_pane_ids {
            self.panes.remove(&pid);
            self.cleanup_closed_pane_state(pid);
        }
        // Close the terminal
        self.panes.remove(&terminal_id);
        self.layout.remove(terminal_id);
        self.cleanup_closed_pane_state(terminal_id);
        self.dock_open = false;
    }

    /// Swap Dock content when terminal focus changes.
    /// Dock stays open if any terminal has dock panes (prevents layout jumping).
    /// Closes only when NO terminal has dock panes at all.
    pub(crate) fn swap_dock_state(&mut self, _incoming_terminal: PaneId) {
        // Check if ANY terminal has dock panes — if none, close the dock.
        let any_has_dock = self.panes.values().any(|pk| {
            if let PaneKind::Terminal(tp) = pk {
                !tp.dock_layout.all_pane_ids().is_empty()
            } else { false }
        });
        if !any_has_dock {
            self.dock_open = false;
        }
        self.cache.pane_generations.clear();
        self.cache.invalidate_chrome();
        self.compute_layout();
    }
}
