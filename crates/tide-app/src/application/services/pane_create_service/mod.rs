use std::path::PathBuf;

use crate::tide_core::LayoutEngine;

use crate::pane::browser::BrowserPane;
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::drag_types::PaneDragState;
use crate::ActionPort;
use crate::App;
use crate::AppCorePort;
use crate::DockPort;
use crate::FileOpsPort;
use crate::LayoutPort;
use crate::WorkspaceNavPort;

use super::action_service::LauncherChoice;

impl crate::application::ports::inward::PaneLifecyclePort for App {
    fn create_terminal_pane(
        &mut self,
        id: crate::tide_core::PaneId,
        cwd: Option<std::path::PathBuf>,
    ) {
        let cell_size = self.cell_size();
        if cell_size.width <= 0.0 || cell_size.height <= 0.0 {
            log::error!(
                "Cannot create terminal pane: cell_size is zero ({:?})",
                cell_size
            );
            return;
        }
        let logical = self.logical_size();
        let cols = ((logical.width / 2.0 / cell_size.width).max(1.0).min(1000.0)) as u16;
        let rows = ((logical.height / cell_size.height).max(1.0).min(500.0)) as u16;

        match self.ports.terminal_factory.create_terminal(
            id,
            cols,
            rows,
            cwd.as_deref(),
            self.window.dark_mode,
        ) {
            Ok(pane) => {
                self.install_pty_waker(&pane);
                self.panes.insert(id, PaneKind::Terminal(pane));
                self.ime.pending_creates.push(id);
                self.gateway.notify(
                    "pane-created",
                    serde_json::json!({"pane_id": id, "kind": "terminal"}),
                );
            }
            Err(e) => {
                log::error!("Failed to create terminal pane: {}", e);
            }
        }
    }

    /// Respawn a new shell in a dead terminal pane, preserving its position in the layout.
    fn respawn_terminal(&mut self, id: crate::tide_core::PaneId) {
        // Get the CWD of the dead terminal before removing it
        let cwd = if let Some(PaneKind::Terminal(pane)) = self.panes.get(&id) {
            pane.context
                .cwd
                .clone()
                .or_else(|| pane.backend.detect_cwd_fallback())
        } else {
            None
        };
        // Remove old terminal and create a new one in-place
        self.panes.remove(&id);
        self.create_terminal_pane(id, cwd);
        // Clear IME composition if the recreated pane was the target.
        if self.ime.last_target == Some(id) {
            self.ime.clear_composition();
            self.ime.last_target = None;
        }
        self.cache.invalidate_pane(id);
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Resolve the context terminal for the currently focused pane.
    /// If focused is a terminal, returns it. Otherwise follows the association chain.
    fn resolve_context_terminal_id(&self) -> Option<crate::tide_core::PaneId> {
        // CLI caller pane takes precedence — the agent explicitly told us which terminal it runs in.
        if let Some(caller) = self.pending_cli_caller_pane {
            if matches!(self.panes.get(&caller), Some(PaneKind::Terminal(_))) {
                return Some(caller);
            }
        }
        let focused = self.focus.focused?;
        if matches!(self.panes.get(&focused), Some(PaneKind::Terminal(_))) {
            return Some(focused);
        }
        self.assoc.associated_terminal.get(&focused).copied()
    }

    /// Get the CWD of the currently focused pane's context terminal.
    /// Follows the associated_terminal chain, falling back to retained contexts.
    fn focused_terminal_cwd(&self) -> Option<std::path::PathBuf> {
        let focused = self.focus.focused?;
        // If focused pane is a terminal, use its CWD
        if let Some(PaneKind::Terminal(p)) = self.panes.get(&focused) {
            return p.backend.detect_cwd_fallback();
        }
        // Follow association chain
        if let Some(&terminal_id) = self.assoc.associated_terminal.get(&focused) {
            // Live terminal
            if let Some(PaneKind::Terminal(p)) = self.panes.get(&terminal_id) {
                return p.backend.detect_cwd_fallback();
            }
            // Retained context from closed terminal
            if let Some(ctx) = self.assoc.retained_contexts.get(&terminal_id) {
                return ctx.cwd.clone();
            }
        }
        // Fall back to last known CWD
        self.timing.last_cwd.clone()
    }

    /// Create a new empty editor pane next to the focused pane.
    fn new_editor_pane(&mut self) {
        let focused = match self.focus.focused {
            Some(id) => id,
            None => return,
        };
        let context_terminal = self.resolve_context_terminal_id();
        let new_id = self.layout.alloc_id();
        let mut pane = EditorPane::new_empty(new_id);
        pane.editor.set_dark_mode(self.window.dark_mode);
        self.panes.insert(new_id, PaneKind::Editor(pane));
        self.ime.pending_creates.push(new_id);
        // Route to Dock if an owner terminal exists
        if let Some(tid) = context_terminal.or_else(|| self.focused_terminal_id()) {
            self.add_pane_to_dock(new_id, Some(tid));
            self.assoc.associated_terminal.insert(new_id, tid);
            self.focus.focus_area = crate::state::FocusArea::Dock;
        } else {
            self.add_to_non_terminal_group(focused, new_id);
            if let Some(tid) = context_terminal {
                self.assoc.associated_terminal.insert(new_id, tid);
            }
            self.focus.focus_area = crate::state::FocusArea::Stage;
        }
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Create a new pane. Routes by FocusArea:
    /// - Stage → create Terminal directly (no Launcher)
    /// - Dock → add Launcher tab to current TabGroup in Dock
    fn new_terminal_tab(&mut self) {
        let focused = match self.focus.focused {
            Some(id) => id,
            None => return,
        };

        match self.focus.focus_area {
            crate::state::FocusArea::Dock => {
                // Dock: Launcher for multi-type pane selection
                let new_id = self.layout.alloc_id();
                self.panes.insert(new_id, PaneKind::Launcher(new_id));
                self.ime.pending_creates.push(new_id);
                if let Some(tid) = self.focused_terminal_id() {
                    self.assoc.associated_terminal.insert(new_id, tid);
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                        if let Some(dock_focused) = tp.dock_focused {
                            tp.dock_layout.add_tab(dock_focused, new_id);
                        } else {
                            tp.dock_layout.insert_leaf_group(new_id);
                        }
                        tp.dock_focused = Some(new_id);
                        tp.dock_layout.set_active_tab(new_id);
                    }
                    self.dock.dock_open = true;
                    self.focus.focus_area = crate::state::FocusArea::Dock;
                }
                self.focus.focused = Some(new_id);
                self.router.set_focused(new_id);
            }
            _ => {
                // Stage: always add a new Terminal as a tab in the focused TabGroup.
                // If focused pane is a bare Leaf, add_tab converts it to a LeafGroup.
                let new_id = self.layout.alloc_id();
                self.layout.add_tab(focused, new_id);
                if self.focus.zoomed_pane.is_some() {
                    self.focus.zoomed_pane = Some(new_id);
                }
                let cwd = self.focused_terminal_cwd();
                self.create_terminal_pane(new_id, cwd);
                self.focus_terminal(new_id);
            }
        }

        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Replace a Launcher pane with the chosen pane type.
    fn resolve_launcher(&mut self, launcher_id: crate::tide_core::PaneId, choice: LauncherChoice) {
        let context_terminal = self.resolve_context_terminal_id();
        match choice {
            LauncherChoice::Terminal => {
                // Remove the old launcher's IME proxy before creating the replacement.
                // The new pane reuses the same PaneId, so without this the platform's
                // ime_proxies map still holds the stale launcher proxy and
                // create_ime_proxy() skips creation — leaving first responder on the
                // old proxy and routing keyboard input to the wrong pane.
                self.ime.pending_removes.push(launcher_id);
                // Use owning terminal's CWD if in dock, otherwise home directory
                let cwd = context_terminal
                    .and_then(|tid| {
                        if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                            tp.context.cwd.clone()
                        } else {
                            None
                        }
                    })
                    .or_else(|| self.ports.fs.home_dir());
                // Terminal resolves don't get association (they ARE terminals)
                self.assoc.associated_terminal.remove(&launcher_id);
                self.panes.remove(&launcher_id);
                self.create_terminal_pane(launcher_id, cwd);
            }
            LauncherChoice::NewFile => {
                self.ime.pending_removes.push(launcher_id);
                let mut pane = crate::pane::editor::EditorPane::new_empty(launcher_id);
                pane.editor.set_dark_mode(self.window.dark_mode);
                self.panes.insert(launcher_id, PaneKind::Editor(pane));
                self.ime.pending_creates.push(launcher_id);
                if let Some(tid) = context_terminal {
                    self.assoc.associated_terminal.insert(launcher_id, tid);
                }
            }
            LauncherChoice::OpenFile => {
                // Keep the launcher alive — the file finder will replace it
                // with the selected file's editor pane (same layout slot).
                self.open_file_finder_with_replace(Some(launcher_id));
                return;
            }
            LauncherChoice::Browser => {
                self.ime.pending_removes.push(launcher_id);
                let pane = crate::pane::browser::BrowserPane::new(launcher_id);
                self.panes.insert(launcher_id, PaneKind::Browser(pane));
                self.ime.pending_creates.push(launcher_id);
                if let Some(tid) = context_terminal {
                    self.assoc.associated_terminal.insert(launcher_id, tid);
                }
            }
        }
        self.focus.focused = Some(launcher_id);
        self.router.set_focused(launcher_id);
        self.cache.invalidate_chrome();
        self.cache.pane_generations.clear();
        self.compute_layout();
    }

    /// Split the focused pane.
    /// Routes to the correct layout based on focus_area:
    /// - Stage → create Terminal directly in main layout
    /// - Dock → split in dock layout (new LeafGroup with Launcher)
    fn split_with_launcher(&mut self, direction: crate::tide_core::SplitDirection) {
        let focused = match self.focus.focused {
            Some(id) => id,
            None => return,
        };
        match self.focus.focus_area {
            crate::state::FocusArea::Dock => {
                // Split in the dock layout (Launcher for multi-type selection)
                if let Some(tid) = self.focused_terminal_id() {
                    let new_id = self.layout.alloc_id();
                    self.panes.insert(new_id, PaneKind::Launcher(new_id));
                    self.ime.pending_creates.push(new_id);
                    self.assoc.associated_terminal.insert(new_id, tid);
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                        if let Some(dock_focused) = tp.dock_focused {
                            tp.dock_layout.split_with_leaf_group(
                                dock_focused,
                                new_id,
                                direction,
                                false,
                            );
                        } else {
                            tp.dock_layout.insert_leaf_group(new_id);
                        }
                        tp.dock_focused = Some(new_id);
                    }
                    self.focus.focused = Some(new_id);
                    self.router.set_focused(new_id);
                }
            }
            _ => {
                // Unzoom Stage if stacked
                if self.focus.zoomed_pane.is_some() {
                    self.focus.zoomed_pane = None;
                    self.cache.pane_generations.clear();
                }
                // Stage: create Terminal directly
                let cwd = self.focused_terminal_cwd();
                let new_id = self.layout.split(focused, direction);
                self.create_terminal_pane(new_id, cwd);
                self.focus.focused = Some(new_id);
                self.router.set_focused(new_id);
                self.focus.focus_area = crate::state::FocusArea::Stage;
            }
        }
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Open a browser pane next to the focused pane.
    fn open_browser_pane(&mut self, url: Option<String>) {
        let focused = match self.focus.focused {
            Some(id) => id,
            None => return,
        };
        let context_terminal = self.resolve_context_terminal_id();
        let new_id = self.layout.alloc_id();
        let pane = match url {
            Some(ref u) => BrowserPane::with_url(new_id, u.clone()),
            None => BrowserPane::new(new_id),
        };
        self.panes.insert(new_id, PaneKind::Browser(pane));
        self.ime.pending_creates.push(new_id);
        if let Some(tid) = context_terminal.or_else(|| self.focused_terminal_id()) {
            self.add_pane_to_dock(new_id, Some(tid));
            self.assoc.associated_terminal.insert(new_id, tid);
            self.focus.focus_area = crate::state::FocusArea::Dock;
        } else {
            // Add to the same TabGroup as the focused pane (not a split)
            if !self.layout.add_tab(focused, new_id) {
                // Fallback: create a split if no TabGroup exists
                self.add_to_non_terminal_group(focused, new_id);
            }
            if self.focus.zoomed_pane.is_some() {
                self.focus.zoomed_pane = Some(new_id);
            }
            if let Some(tid) = context_terminal {
                self.assoc.associated_terminal.insert(new_id, tid);
            }
            self.focus.focus_area = crate::state::FocusArea::Stage;
        }
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Open a render-mode browser pane in the dock (generative UI).
    fn open_render_pane(&mut self, title: String, html: String) -> crate::tide_core::PaneId {
        let context_terminal = self.resolve_context_terminal_id();
        let new_id = self.layout.alloc_id();
        let pane = BrowserPane::new_render(new_id, title, html);
        self.panes.insert(new_id, PaneKind::Browser(pane));
        self.ime.pending_creates.push(new_id);
        if let Some(tid) = context_terminal.or_else(|| self.focused_terminal_id()) {
            self.add_pane_to_dock(new_id, Some(tid));
            self.assoc.associated_terminal.insert(new_id, tid);
            self.focus.focus_area = crate::state::FocusArea::Dock;
        } else {
            let focused = self.focus.focused.unwrap_or(0);
            if !self.layout.add_tab(focused, new_id) {
                self.add_to_non_terminal_group(focused, new_id);
            }
            self.focus.focus_area = crate::state::FocusArea::Stage;
        }
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
        self.gateway.notify(
            "pane-created",
            serde_json::json!({"pane_id": new_id, "kind": "render"}),
        );
        new_id
    }

    /// Open a streaming render-mode browser pane in the dock.
    fn open_render_stream_pane(&mut self, title: String) -> crate::tide_core::PaneId {
        let context_terminal = self.resolve_context_terminal_id();
        let new_id = self.layout.alloc_id();
        let pane = BrowserPane::new_render_stream(new_id, title);
        self.panes.insert(new_id, PaneKind::Browser(pane));
        self.ime.pending_creates.push(new_id);
        if let Some(tid) = context_terminal.or_else(|| self.focused_terminal_id()) {
            self.add_pane_to_dock(new_id, Some(tid));
            self.assoc.associated_terminal.insert(new_id, tid);
            self.focus.focus_area = crate::state::FocusArea::Dock;
        } else {
            let focused = self.focus.focused.unwrap_or(0);
            if !self.layout.add_tab(focused, new_id) {
                self.add_to_non_terminal_group(focused, new_id);
            }
            self.focus.focus_area = crate::state::FocusArea::Stage;
        }
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.gateway.active_streams += 1;
        self.cache.invalidate_chrome();
        self.compute_layout();
        self.gateway.notify(
            "pane-created",
            serde_json::json!({"pane_id": new_id, "kind": "render-stream"}),
        );
        new_id
    }

    /// Replace an existing pane (e.g. a Launcher) with an editor for the given file.
    /// The editor reuses the same layout slot.
    fn replace_pane_with_editor(&mut self, pane_id: crate::tide_core::PaneId, path: PathBuf) {
        // Check if already open anywhere -> activate & focus (and close the launcher)
        for (&id, pane) in &self.panes {
            if let PaneKind::Editor(editor) = pane {
                if editor.editor.file_path() == Some(path.as_path()) {
                    // File already open — remove the launcher, then focus existing editor.
                    // Remove from dock_layout directly (not remove_pane_from_dock
                    // which would overwrite focused/focus_area).
                    if let Some(tid) = self.terminal_owning(pane_id) {
                        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                            tp.dock_layout.remove(pane_id);
                            // If the launcher was dock_focused, point to the existing editor
                            if tp.dock_focused == Some(pane_id) {
                                tp.dock_focused = Some(id);
                                tp.dock_layout.set_active_tab(id);
                            }
                        }
                    } else {
                        self.layout.remove(pane_id);
                    }
                    self.panes.remove(&pane_id);
                    self.assoc.associated_terminal.remove(&pane_id);
                    self.cleanup_closed_pane_state(pane_id);
                    // Now focus the existing editor
                    self.cache.invalidate_pane(id);
                    self.focus.focused = Some(id);
                    self.router.set_focused(id);
                    if self.is_pane_in_dock(id) {
                        self.focus.focus_area = crate::state::FocusArea::Dock;
                        if let Some(tid) = self.terminal_owning(id) {
                            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                                tp.dock_focused = Some(id);
                                tp.dock_layout.set_active_tab(id);
                            }
                        }
                    } else {
                        self.focus.focus_area = crate::state::FocusArea::Stage;
                    }
                    self.cache.invalidate_chrome();
                    self.compute_layout();
                    return;
                }
            }
        }

        let context_terminal = self.resolve_context_terminal_id();
        // Replace the pane in-place: swap PaneKind from Launcher to Editor
        match EditorPane::open(pane_id, &path) {
            Ok(mut pane) => {
                pane.editor.set_dark_mode(self.window.dark_mode);
                self.panes.insert(pane_id, PaneKind::Editor(pane));
                // Clear IME composition if the replaced pane was the target.
                if self.ime.last_target == Some(pane_id) {
                    self.ime.clear_composition();
                    self.ime.last_target = None;
                }
                self.focus.focused = Some(pane_id);
                self.router.set_focused(pane_id);
                if let Some(tid) = context_terminal {
                    self.assoc.associated_terminal.insert(pane_id, tid);
                }
                // Preserve focus area: if pane is in dock, stay in Dock
                if self.is_pane_in_dock(pane_id) {
                    self.focus.focus_area = crate::state::FocusArea::Dock;
                } else {
                    self.focus.focus_area = crate::state::FocusArea::Stage;
                }
                self.sync_file_tree_modified_editor_cache();
                self.cache.invalidate_chrome();
                self.cache.pane_generations.clear();
                self.watch_file(&path);
                self.notify_lsp_did_open(pane_id);
                self.compute_layout();
            }
            Err(e) => {
                log::error!("Failed to open editor for {:?}: {}", path, e);
            }
        }
    }

    /// Open a file in a split next to the focused pane.
    /// If focused is a terminal → add to right (split if needed).
    /// If focused is non-terminal → add as split next to the same pane.
    /// If already open, focus it.
    fn open_editor_pane(&mut self, path: PathBuf) {
        let focused = match self.focus.focused {
            Some(id) => id,
            None => return,
        };

        // Check if already open anywhere -> focus
        for (&id, pane) in &self.panes {
            if let PaneKind::Editor(editor) = pane {
                if editor.editor.file_path() == Some(path.as_path()) {
                    self.cache.invalidate_pane(id);
                    self.focus.focused = Some(id);
                    self.router.set_focused(id);
                    // If the pane is in a dock, open Dock and focus there
                    if self.is_pane_in_dock(id) {
                        self.dock.dock_open = true;
                        self.focus.focus_area = crate::state::FocusArea::Dock;
                        // Update dock_focused on the owning terminal
                        if let Some(tid) = self.terminal_owning(id) {
                            if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                                tp.dock_focused = Some(id);
                                tp.dock_layout.set_active_tab(id);
                            }
                        }
                    } else {
                        self.focus.focus_area = crate::state::FocusArea::Stage;
                    }
                    self.cache.invalidate_chrome();
                    self.compute_layout();
                    return;
                }
            }
        }

        let context_terminal = self.resolve_context_terminal_id();
        // Create new editor pane, routed to a split next to the focused pane
        let new_id = self.layout.alloc_id();
        match EditorPane::open(new_id, &path) {
            Ok(mut pane) => {
                pane.editor.set_dark_mode(self.window.dark_mode);
                self.panes.insert(new_id, PaneKind::Editor(pane));
                self.ime.pending_creates.push(new_id);
                if let Some(tid) = context_terminal.or_else(|| self.focused_terminal_id()) {
                    self.add_pane_to_dock(new_id, Some(tid));
                    self.assoc.associated_terminal.insert(new_id, tid);
                    self.focus.focus_area = crate::state::FocusArea::Dock;
                } else {
                    self.add_to_non_terminal_group(focused, new_id);
                    if let Some(tid) = context_terminal {
                        self.assoc.associated_terminal.insert(new_id, tid);
                    }
                    self.focus.focus_area = crate::state::FocusArea::Stage;
                }
                self.sync_file_tree_modified_editor_cache();
                self.focus.focused = Some(new_id);
                self.router.set_focused(new_id);
                self.cache.invalidate_chrome();
                // Watch the file for external changes
                self.watch_file(&path);
                self.notify_lsp_did_open(new_id);
                self.compute_layout();
            }
            Err(e) => {
                log::error!("Failed to open editor for {:?}: {}", path, e);
            }
        }
    }

    /// Open a file in the editor and jump to a specific line.
    fn open_editor_pane_at_line(&mut self, path: PathBuf, line: Option<usize>) {
        self.open_editor_pane(path);
        if let Some(line) = line {
            if let Some(active_id) = self.focus.focused {
                let visible_rows =
                    crate::adapter::inward::text_routing_adapter::visible_editor_size(
                        self, active_id,
                    )
                    .0;
                if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&active_id) {
                    let target_line = line.saturating_sub(1); // 1-based to 0-based
                    pane.handle_action(
                        crate::tide_editor::input::EditorAction::SetCursor {
                            line: target_line,
                            col: 0,
                        },
                        visible_rows,
                    );
                    pane.editor.ensure_cursor_visible(visible_rows.max(30));
                }
            }
        }
    }

    // ── Closing ──

    fn close_editor_panel_tab(&mut self, tab_id: crate::tide_core::PaneId) {
        // Browser panes close immediately (no dirty check)
        if matches!(self.panes.get(&tab_id), Some(PaneKind::Browser(_))) {
            self.force_close_editor_panel_tab(tab_id);
            return;
        }
        // Check if editor is dirty -> show save confirm bar (skip for untitled files)
        if let Some(PaneKind::Editor(pane)) = self.panes.get(&tab_id) {
            if pane.editor.is_modified() && pane.editor.file_path().is_some() {
                self.modal.save_confirm = Some(crate::SaveConfirmState { pane_id: tab_id });
                // Ensure this pane is focused so the bar is visible
                self.focus.focused = Some(tab_id);
                self.router.set_focused(tab_id);
                self.cache.invalidate_chrome();
                self.cache.invalidate_pane(tab_id);
                return;
            }
        }
        self.force_close_editor_panel_tab(tab_id);
    }

    fn force_close_editor_panel_tab(&mut self, tab_id: crate::tide_core::PaneId) {
        // Cancel drag if the closing pane is the drag source
        if self.interaction.pane_drag.source_pane() == Some(tab_id) {
            self.interaction.pane_drag = PaneDragState::Idle;
            self.interaction.drop_preview_start = None;
        }
        self.interaction.tab_scroll_offset.remove(&tab_id);
        // Destroy webview before removing the pane
        if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&tab_id) {
            bp.destroy();
        }
        // Cancel save-as if the target pane is being closed
        if self
            .modal
            .save_as_input
            .as_ref()
            .is_some_and(|s| s.pane_id == tab_id)
        {
            self.modal.save_as_input = None;
        }
        // Cancel save confirm if the target pane is being closed
        if self
            .modal
            .save_confirm
            .as_ref()
            .is_some_and(|s| s.pane_id == tab_id)
        {
            self.modal.save_confirm = None;
        }
        // Unwatch the file before removing the pane
        let watch_path = if let Some(PaneKind::Editor(editor)) = self.panes.get(&tab_id) {
            editor.editor.file_path().map(|p| p.to_path_buf())
        } else {
            None
        };
        if let Some(path) = watch_path {
            self.unwatch_file(&path);
        }

        // Check if pane is in a Terminal's dock
        if self.is_pane_in_dock(tab_id) {
            self.retain_terminal_context(tab_id);
            // Remove from dock_layout BEFORE removing from panes,
            // so terminal_owning() can still find the owner terminal.
            self.remove_pane_from_dock(tab_id);
            self.panes.remove(&tab_id);
            self.cleanup_closed_pane_state(tab_id);
            self.sync_file_tree_modified_editor_cache();
            self.cache.invalidate_chrome();
            self.compute_layout();
            return;
        }

        // Determine next focus target BEFORE removal so we can find a
        // layout neighbor while the tree is still intact.
        let next_focus = if self.focus.focused == Some(tab_id) {
            self.layout.right_neighbor_pane(tab_id).or_else(|| {
                // No right neighbor — pick any remaining pane
                self.layout
                    .pane_ids()
                    .iter()
                    .find(|&&id| id != tab_id)
                    .copied()
            })
        } else {
            None // Focused pane is not being closed
        };

        // Retain terminal context before removing (soft delete)
        self.retain_terminal_context(tab_id);

        // Remove from layout
        self.layout.remove(tab_id);
        self.panes.remove(&tab_id);
        self.cleanup_closed_pane_state(tab_id);
        self.sync_file_tree_modified_editor_cache();

        // Apply the pre-computed focus target
        if self.focus.focused == Some(tab_id) {
            if let Some(id) = next_focus {
                self.focus.focused = Some(id);
                self.router.set_focused(id);
            } else {
                self.focus.focused = None;
            }
            self.focus.focus_area = crate::state::FocusArea::Stage;
        }

        // Check if layout is now empty
        if self.layout.pane_ids().is_empty() {
            // If other workspaces exist, close this one instead of exiting
            if self.ws.workspaces.len() > 1 {
                self.close_workspace();
                return;
            }
            self.exit_app();
        }

        self.cache.pane_generations.clear();
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    fn complete_save_as(&mut self, pane_id: crate::tide_core::PaneId, filename: &str) {
        let path = if std::path::Path::new(filename).is_absolute() {
            PathBuf::from(filename)
        } else {
            self.resolve_base_dir().join(filename)
        };

        // Create parent dirs if needed
        if let Some(parent) = path.parent() {
            if !parent.exists() {
                let _ = std::fs::create_dir_all(parent);
            }
        }

        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
            pane.editor.buffer.file_path = Some(path.clone());
            pane.editor.detect_and_set_syntax(&path);
            if let Err(e) = pane.editor.buffer.save() {
                log::error!("Failed to save file: {}", e);
            }
            pane.disk_changed = false;
        }

        self.watch_file(&path);
        self.sync_file_tree_modified_editor_cache();
        self.cache.invalidate_chrome();
    }

    fn close_specific_pane(&mut self, pane_id: crate::tide_core::PaneId) {
        // Check if editor is dirty -> show save confirm bar
        if let Some(PaneKind::Editor(pane)) = self.panes.get(&pane_id) {
            if pane.editor.is_modified() && pane.editor.file_path().is_some() {
                self.modal.save_confirm = Some(crate::SaveConfirmState { pane_id });
                self.focus.focused = Some(pane_id);
                self.router.set_focused(pane_id);
                self.cache.invalidate_chrome();
                self.cache.invalidate_pane(pane_id);
                return;
            }
        }

        // Non-terminal panes (editors, browsers, diff, launchers) close immediately
        if matches!(
            self.panes.get(&pane_id),
            Some(
                PaneKind::Editor(_)
                    | PaneKind::Browser(_)
                    | PaneKind::Diff(_)
                    | PaneKind::Launcher(_)
            )
        ) {
            self.force_close_editor_panel_tab(pane_id);
            self.update_file_tree_cwd();
            return;
        }

        // Terminal in dock: close via dock removal path
        if self.is_pane_in_dock(pane_id) {
            self.force_close_editor_panel_tab(pane_id);
            self.update_file_tree_cwd();
            return;
        }

        // Terminal pane in Stage: proceed to force close (with branch cleanup check)
        self.force_close_specific_pane(pane_id);
    }

    fn force_close_specific_pane(&mut self, pane_id: crate::tide_core::PaneId) {
        // Cancel save-as if the target pane is being closed
        if self
            .modal
            .save_as_input
            .as_ref()
            .is_some_and(|s| s.pane_id == pane_id)
        {
            self.modal.save_as_input = None;
        }
        // Cancel save confirm
        if self
            .modal
            .save_confirm
            .as_ref()
            .is_some_and(|s| s.pane_id == pane_id)
        {
            self.modal.save_confirm = None;
        }

        // Non-terminal panes: close directly
        if !matches!(self.panes.get(&pane_id), Some(PaneKind::Terminal(_))) {
            self.force_close_editor_panel_tab(pane_id);
            self.update_file_tree_cwd();
            return;
        }

        // If branch cleanup bar is already showing for this pane, block the close —
        // the user must resolve it via Delete/Keep/Cancel first.
        if self
            .modal
            .branch_cleanup
            .as_ref()
            .is_some_and(|bc| bc.pane_id == pane_id)
        {
            return;
        }

        // Worktree cleanup check: if this is a terminal in a git worktree on a
        // non-main branch, prompt before closing so the user can delete the
        // worktree + branch. Non-worktree branches close without prompting.
        if self.modal.branch_cleanup.is_none() {
            if let Some(PaneKind::Terminal(pane)) = self.panes.get(&pane_id) {
                if let (Some(ref gi), Some(ref cwd), Some(ref current_worktree)) = (
                    &pane.context.git_info,
                    &pane.context.cwd,
                    &pane.context.current_worktree,
                ) {
                    let branch = &gi.branch;
                    let cache_matches_cwd = cwd.starts_with(&current_worktree.path);
                    if cache_matches_cwd
                        && branch != "main"
                        && branch != "master"
                        && !current_worktree.is_main
                    {
                        // Check no other terminal pane is on the same branch
                        let other_on_same = self.panes.iter().any(|(&id, pk)| {
                            if id == pane_id {
                                return false;
                            }
                            if let PaneKind::Terminal(tp) = pk {
                                tp.context
                                    .git_info
                                    .as_ref()
                                    .map(|g| g.branch == *branch)
                                    .unwrap_or(false)
                            } else {
                                false
                            }
                        });
                        if !other_on_same {
                            self.modal.branch_cleanup = Some(crate::BranchCleanupState {
                                pane_id,
                                branch: branch.clone(),
                                worktree_path: current_worktree.path.clone(),
                                cwd: cwd.clone(),
                            });
                            self.cache.invalidate_chrome();
                            return;
                        }
                    }
                }
            }
        }

        self.close_pane_final(pane_id);
    }

    fn confirm_save_and_close(&mut self) {
        let pane_id = match self.modal.save_confirm.take() {
            Some(sc) => sc.pane_id,
            None => return,
        };
        // Save
        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
            if pane.editor.file_path().is_none() {
                // Untitled file -> open save-as input
                let base_dir = self.resolve_base_dir();
                let anchor = self
                    .visual_pane_rects
                    .iter()
                    .find(|(id, _)| *id == pane_id)
                    .map(|(_, r)| {
                        crate::tide_core::Rect::new(r.x, r.y, r.width, crate::theme::TAB_BAR_HEIGHT)
                    })
                    .unwrap_or_else(|| crate::tide_core::Rect::new(0.0, 0.0, 0.0, 0.0));
                self.modal.save_as_input = Some(crate::SaveAsInput::new(pane_id, base_dir, anchor));
                return;
            }
            if let Err(e) = pane.editor.buffer.save() {
                log::error!("Save failed: {}", e);
                return;
            }
            pane.disk_changed = false;
        }
        // Close
        self.force_close_editor_panel_tab(pane_id);
        // Retry pending terminal close (may find more dirty editors)
        if let Some(tid) = self.assoc.pending_terminal_close.take() {
            if self.panes.contains_key(&tid) {
                self.close_specific_pane(tid);
            }
        }
    }

    fn confirm_discard_and_close(&mut self) {
        let pane_id = match self.modal.save_confirm.take() {
            Some(sc) => sc.pane_id,
            None => return,
        };
        self.force_close_editor_panel_tab(pane_id);
        // Retry pending terminal close (may find more dirty editors)
        if let Some(tid) = self.assoc.pending_terminal_close.take() {
            if self.panes.contains_key(&tid) {
                self.close_specific_pane(tid);
            }
        }
    }

    fn cancel_save_confirm(&mut self) {
        if self.modal.clear_save_confirm() {
            self.assoc.pending_terminal_close = None;
            self.cache.invalidate_chrome();
            self.cache.pane_generations.clear();
        }
    }

    fn confirm_branch_delete(&mut self) {
        let bc = match self.modal.branch_cleanup.take() {
            Some(bc) => bc,
            None => return,
        };
        // Resolve the main worktree path BEFORE closing anything.
        // bc.cwd may be inside a worktree that will be removed.
        let worktrees = self.ports.git.list_worktrees(&bc.cwd);
        let main_cwd = worktrees
            .iter()
            .find(|wt| wt.is_main)
            .map(|wt| wt.path.clone())
            .unwrap_or_else(|| bc.cwd.clone());
        // Close the pane first so the terminal process releases the directory
        self.close_pane_final(bc.pane_id);
        // Remove worktree (directory is now free)
        if let Err(e) = self
            .ports
            .git
            .remove_worktree(&main_cwd, &bc.worktree_path, true)
        {
            log::error!("Failed to remove worktree: {}", e);
        }
        // Delete the branch from the main repo
        if let Err(e) = self.ports.git.delete_branch(&main_cwd, &bc.branch, true) {
            log::error!("Failed to delete branch: {}", e);
        }
    }

    fn confirm_branch_keep(&mut self) {
        let bc = match self.modal.branch_cleanup.take() {
            Some(bc) => bc,
            None => return,
        };
        self.close_pane_final(bc.pane_id);
    }

    fn cancel_branch_cleanup(&mut self) {
        if self.modal.clear_branch_cleanup() {
            self.cache.invalidate_chrome();
        }
    }
}
