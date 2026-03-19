use std::path::PathBuf;

use tide_core::LayoutEngine;

use crate::pane::browser::BrowserPane;
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::App;
use crate::FileOpsPort;
use crate::DockPort;

use super::LauncherChoice;

impl App {
    pub(crate) fn create_terminal_pane(&mut self, id: tide_core::PaneId, cwd: Option<std::path::PathBuf>) {
        let cell_size = self.cell_size();
        if cell_size.width <= 0.0 || cell_size.height <= 0.0 {
            log::error!("Cannot create terminal pane: cell_size is zero ({:?})", cell_size);
            return;
        }
        let logical = self.logical_size();
        let cols = ((logical.width / 2.0 / cell_size.width).max(1.0).min(1000.0)) as u16;
        let rows = ((logical.height / cell_size.height).max(1.0).min(500.0)) as u16;

        match TerminalPane::with_cwd(id, cols, rows, cwd, self.window.dark_mode) {
            Ok(pane) => {
                self.install_pty_waker(&pane);
                self.panes.insert(id, PaneKind::Terminal(pane));
                self.ime.pending_creates.push(id);
            }
            Err(e) => {
                log::error!("Failed to create terminal pane: {}", e);
            }
        }
    }

    /// Respawn a new shell in a dead terminal pane, preserving its position in the layout.
    pub(crate) fn respawn_terminal(&mut self, id: tide_core::PaneId) {
        // Get the CWD of the dead terminal before removing it
        let cwd = if let Some(PaneKind::Terminal(pane)) = self.panes.get(&id) {
            pane.context.cwd.clone().or_else(|| pane.backend.detect_cwd_fallback())
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
    pub(crate) fn resolve_context_terminal_id(&self) -> Option<tide_core::PaneId> {
        let focused = self.focus.focused?;
        if matches!(self.panes.get(&focused), Some(PaneKind::Terminal(_))) {
            return Some(focused);
        }
        self.assoc.associated_terminal.get(&focused).copied()
    }

    /// Get the CWD of the currently focused pane's context terminal.
    /// Follows the associated_terminal chain, falling back to retained contexts.
    pub(crate) fn focused_terminal_cwd(&self) -> Option<std::path::PathBuf> {
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
    pub(crate) fn new_editor_pane(&mut self) {
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
        if let Some(tid) = self.focused_terminal_id().or(context_terminal) {
            self.add_pane_to_dock(new_id);
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
    pub(crate) fn new_terminal_tab(&mut self) {
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
                // Stage: if focused pane is in a TabGroup, add a new tab there;
                // otherwise create a horizontal split with a new Terminal.
                let in_tab_group = self.layout.tab_group_containing(focused).is_some();
                if in_tab_group {
                    // Add Launcher tab to the same TabGroup for pane type selection
                    let new_id = self.layout.alloc_id();
                    if self.layout.add_tab(focused, new_id) {
                        self.panes.insert(new_id, PaneKind::Launcher(new_id));
                        self.ime.pending_creates.push(new_id);
                        if let Some(tid) = self.resolve_context_terminal_id() {
                            self.assoc.associated_terminal.insert(new_id, tid);
                        }
                        if self.focus.zoomed_pane.is_some() {
                            self.focus.zoomed_pane = Some(new_id);
                        }
                        self.focus.focused = Some(new_id);
                        self.router.set_focused(new_id);
                    } else {
                        // No TabGroup — fall through to split
                        let cwd = self.focused_terminal_cwd();
                        self.layout.insert_pane(focused, new_id, tide_core::SplitDirection::Horizontal, false);
                        if self.focus.zoomed_pane.is_some() {
                            self.focus.zoomed_pane = Some(new_id);
                        }
                        self.create_terminal_pane(new_id, cwd);
                        self.focus_terminal(new_id);
                    }
                } else {
                    let new_id = self.layout.alloc_id();
                    self.layout.insert_pane(focused, new_id, tide_core::SplitDirection::Horizontal, false);
                    if self.focus.zoomed_pane.is_some() {
                        self.focus.zoomed_pane = Some(new_id);
                    }
                    let cwd = self.focused_terminal_cwd();
                    self.create_terminal_pane(new_id, cwd);
                    self.focus_terminal(new_id);
                }
            }
        }

        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Replace a Launcher pane with the chosen pane type.
    pub(crate) fn resolve_launcher(&mut self, launcher_id: tide_core::PaneId, choice: LauncherChoice) {
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
                        } else { None }
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
    pub(crate) fn split_with_launcher(&mut self, direction: tide_core::SplitDirection) {
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
                            tp.dock_layout.split_with_leaf_group(dock_focused, new_id, direction, false);
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
    pub(crate) fn open_browser_pane(&mut self, url: Option<String>) {
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
        if let Some(tid) = self.focused_terminal_id().or(context_terminal) {
            self.add_pane_to_dock(new_id);
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

    /// Replace an existing pane (e.g. a Launcher) with an editor for the given file.
    /// The editor reuses the same layout slot.
    pub(crate) fn replace_pane_with_editor(&mut self, pane_id: tide_core::PaneId, path: PathBuf) {
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
    pub(crate) fn open_editor_pane(&mut self, path: PathBuf) {
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
                if let Some(tid) = self.focused_terminal_id().or(context_terminal) {
                    self.add_pane_to_dock(new_id);
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
    pub(crate) fn open_editor_pane_at_line(&mut self, path: PathBuf, line: Option<usize>) {
        self.open_editor_pane(path);
        if let Some(line) = line {
            if let Some(active_id) = self.focus.focused {
                let visible_rows = self.visible_editor_size(active_id).0;
                if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&active_id) {
                    let target_line = line.saturating_sub(1); // 1-based to 0-based
                    pane.handle_action(
                        tide_editor::input::EditorAction::SetCursor { line: target_line, col: 0 },
                        visible_rows,
                    );
                    pane.editor.ensure_cursor_visible(visible_rows.max(30));
                }
            }
        }
    }
}
