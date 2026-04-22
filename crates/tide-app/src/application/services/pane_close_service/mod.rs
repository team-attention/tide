use crate::tide_core::LayoutEngine;

use crate::pane::PaneKind;
use crate::state::drag_types::PaneDragState;
use crate::App;
use crate::LayoutPort;

impl App {
    pub(super) fn next_stage_focus_after_close(
        &self,
        pane_id: crate::tide_core::PaneId,
    ) -> Option<crate::tide_core::PaneId> {
        if let Some(tg) = self.layout.tab_group_containing(pane_id) {
            if let Some(idx) = tg.tabs.iter().position(|&id| id == pane_id) {
                if idx + 1 < tg.tabs.len() {
                    return Some(tg.tabs[idx + 1]);
                }
                if idx > 0 {
                    return Some(tg.tabs[idx - 1]);
                }
            }
        }

        self.layout.right_neighbor_pane(pane_id).or_else(|| {
            self.layout
                .pane_ids()
                .iter()
                .find(|&&id| id != pane_id)
                .copied()
        })
    }

    /// Close a pane unconditionally (no dirty check, no branch cleanup check).
    /// Used by branch cleanup confirm/keep methods after cleanup is resolved.
    pub(super) fn close_pane_final(&mut self, pane_id: crate::tide_core::PaneId) {
        // Cancel drag if the closing pane is the drag source
        if self.interaction.pane_drag.source_pane() == Some(pane_id) {
            self.interaction.pane_drag = PaneDragState::Idle;
            self.interaction.drop_preview_start = None;
        }
        self.interaction.tab_scroll_offset.remove(&pane_id);
        self.interaction.tab_scroll_last_at.remove(&pane_id);
        self.interaction.tab_scroll_last_direction.remove(&pane_id);
        self.interaction.tab_manual_scroll.remove(&pane_id);
        let remaining = self.layout.all_pane_ids();
        if remaining.len() <= 1 {
            // If other workspaces exist, close this one instead of exiting
            if self.ws.workspaces.len() > 1 {
                self.close_workspace();
                return;
            }
            // Show native confirmation before closing the app
            if crate::tide_platform::show_close_confirm() {
                self.save_full_session();
                self.pending_platform_commands
                    .push(crate::tide_platform::WindowCommand::CloseWindow);
                self.tide_window_close_requested = true;
            }
            return;
        }

        // Decrement active_streams if closing a streaming render pane
        if let Some(PaneKind::Browser(bp)) = self.panes.get(&pane_id) {
            if bp.render_mode && bp.streaming && self.gateway.active_streams > 0 {
                self.gateway.active_streams -= 1;
            }
        }

        // Determine next focus target BEFORE removal so we can find a
        // layout neighbor while the tree is still intact.
        let next_focus = self.next_stage_focus_after_close(pane_id);

        // Retain terminal context before removing (soft delete)
        self.retain_terminal_context(pane_id);

        self.layout.remove(pane_id);
        self.panes.remove(&pane_id);
        self.cleanup_closed_pane_state(pane_id);

        // Emit pane-closed event for subscribers
        self.gateway
            .notify("pane-closed", serde_json::json!({"pane_id": pane_id}));

        // If the closed pane was stage_focused, move it to the next target
        if self.focus.stage_focused == Some(pane_id) {
            self.focus.stage_focused = next_focus;
        }

        if let Some(next) = next_focus {
            self.focus.focused = Some(next);
            self.router.set_focused(next);
            // Stacked mode: move zoom to the next pane instead of dropping mode
            if self.focus.zoomed_pane == Some(pane_id) {
                self.focus.zoomed_pane = Some(next);
            }
            self.gateway
                .notify("focus-changed", serde_json::json!({"pane_id": next}));
        } else {
            self.focus.focused = None;
        }

        self.cache.invalidate_chrome();
        self.compute_layout();
        self.update_file_tree_cwd();
    }

    /// Extract and retain a terminal's context before it is removed from panes.
    /// This allows associated panes to still resolve the terminal's cwd.
    pub(super) fn retain_terminal_context(&mut self, pane_id: crate::tide_core::PaneId) {
        if let Some(PaneKind::Terminal(pane)) = self.panes.get(&pane_id) {
            // Only retain if some pane still references this terminal
            let has_dependents = self
                .assoc
                .associated_terminal
                .values()
                .any(|&v| v == pane_id);
            if has_dependents {
                self.assoc
                    .retained_contexts
                    .insert(pane_id, pane.context.clone());
            }
        }
    }
}
