use tide_core::LayoutEngine;

use crate::event_handler::drag_drop::PaneDragState;
use crate::pane::PaneKind;
use crate::App;
use crate::DockPort;
use crate::LayoutPort;
use crate::ActionPort;
use crate::PaneLifecyclePort;

impl App {
    /// Close a pane unconditionally (no dirty check, no branch cleanup check).
    /// Used by branch cleanup confirm/keep methods after cleanup is resolved.
    pub(super) fn close_pane_final(&mut self, pane_id: tide_core::PaneId) {
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
    pub(super) fn retain_terminal_context(&mut self, pane_id: tide_core::PaneId) {
        if let Some(PaneKind::Terminal(pane)) = self.panes.get(&pane_id) {
            // Only retain if some pane still references this terminal
            let has_dependents = self.assoc.associated_terminal.values().any(|&v| v == pane_id);
            if has_dependents {
                self.assoc.retained_contexts.insert(pane_id, pane.context.clone());
            }
        }
    }
}
