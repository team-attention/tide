mod pane_lifecycle;
mod focus_nav;
mod text_extract;
mod file_ops;
mod dock;

pub(crate) use pane_lifecycle::LauncherChoice;

use std::time::Instant;

use tide_core::{InputEvent, LayoutEngine, Size, SplitDirection, TerminalBackend, Vec2};
use tide_editor::input::EditorAction;
use tide_input::{Action, AreaSlot, GlobalAction};
use crate::search::SearchState;

use crate::pane::PaneKind;
use crate::theme::*;
use crate::ui_state::FocusArea;
use crate::App;

impl App {
    fn cleanup_closed_pane_state(&mut self, pane_id: tide_core::PaneId) {
        self.notify_lsp_did_close(pane_id);
        self.cache.invalidate_pane(pane_id);
        self.interaction.scroll_accumulator.remove(&pane_id);
        self.ime.pending_removes.push(pane_id);
        // Clear IME composition if the closing pane was the composition target.
        // Without this, last_target points to a deleted pane and preedit text is lost.
        if self.ime.last_target == Some(pane_id) {
            self.ime.clear_composition();
            self.ime.last_target = None;
        }
        if let Some(renderer) = self.renderer.as_mut() {
            renderer.remove_pane_cache(pane_id);
        }
        // Clean up terminal association
        self.associated_terminal.remove(&pane_id);
        // If no pane references a retained context, clean it up
        self.cleanup_retained_context(pane_id);
    }

    /// Remove a retained terminal context if no panes reference it anymore.
    pub(crate) fn cleanup_retained_context(&mut self, _closed_pane_id: tide_core::PaneId) {
        // Check if the closed pane's associated terminal is in retained_contexts
        // and no other pane still references it
        let terminal_ids: Vec<tide_core::PaneId> = self.retained_contexts.keys().copied().collect();
        for tid in terminal_ids {
            let still_referenced = self.associated_terminal.values().any(|&v| v == tid);
            if !still_referenced {
                self.retained_contexts.remove(&tid);
            }
        }
    }

    /// Switch primary focus to a pane, setting focus to Stage.
    pub(crate) fn focus_terminal(&mut self, id: tide_core::PaneId) {
        // If the pane is in the Dock, focus it there without disrupting dock state
        if self.is_pane_in_dock(id) {
            self.focus_area = FocusArea::Dock;
            self.focused = Some(id);
            self.router.set_focused(id);
            // Update dock_focused on the owning terminal
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

        self.focus_area = FocusArea::Stage;
        if self.focused == Some(id) {
            return;
        }
        // Dismiss completion on the previously focused editor pane
        if let Some(prev_id) = self.focused {
            self.dismiss_completion(prev_id);
        }
        self.focused = Some(id);
        self.router.set_focused(id);
        // Swap dock state when switching between terminals
        if matches!(self.panes.get(&id), Some(crate::pane::PaneKind::Terminal(_)) | Some(crate::pane::PaneKind::Launcher(_))) {
            self.swap_dock_state(id);
        }
        self.cache.invalidate_chrome();
        self.update_file_tree_cwd();
        // Immediately sync webview visibility so the browser hides/shows
        // without waiting for the next update() tick (which may be gated by
        // is_rapid).
        self.sync_browser_webview_frames();
    }

    /// Dismiss the completion popup on the given editor pane.
    pub(crate) fn dismiss_completion(&mut self, pane_id: tide_core::PaneId) {
        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
            if pane.completion.is_some() {
                pane.completion = None;
                self.cache.invalidate_pane(pane_id);
            }
        }
    }

    /// Accept the selected completion item: replace the typed prefix with
    /// the completion text, then dismiss the popup.
    pub(crate) fn accept_completion(&mut self, pane_id: tide_core::PaneId) {
        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
            if let Some(ref completion) = pane.completion {
                if let Some(text) = completion.insert_text() {
                    let prefix_len = completion.prefix.len();
                    // Delete the typed prefix by backspacing
                    for _ in 0..prefix_len {
                        pane.editor.handle_action(EditorAction::Backspace);
                    }
                    // Insert the completion text
                    pane.editor.insert_text(&text);
                }
            }
            pane.completion = None;
            self.cache.invalidate_pane(pane_id);
        }
    }

    /// Resolve the effective target pane for actions like Copy/Paste/Find.
    fn action_target_id(&self) -> Option<tide_core::PaneId> {
        self.focused
    }

    /// Save session and exit the app.
    pub(crate) fn exit_app(&self) {
        self.save_full_session();
        crate::session::delete_running_marker();
        std::process::exit(0);
    }

    /// Resolve an AreaSlot to a FocusArea.
    /// Slot1 = WorkspaceSidebar (handled specially), Slot2 = FileTree,
    /// Slot3 = Stage, Slot4 = Dock.
    fn resolve_slot(&self, slot: AreaSlot) -> FocusArea {
        match slot {
            AreaSlot::Slot1 => FocusArea::Stage, // handled by workspace sidebar toggle
            AreaSlot::Slot2 => FocusArea::FileTree,
            AreaSlot::Slot3 => FocusArea::Stage,
            AreaSlot::Slot4 => FocusArea::Dock,
        }
    }

    /// Handle FocusArea(slot) — toggle:
    /// FileTree: hidden→show+focus / unfocused→focus / focused→hide+Stage
    /// Stage: unfocused→focus
    /// Dock: toggle dock
    pub(crate) fn handle_focus_area(&mut self, target: FocusArea) {
        match target {
            FocusArea::FileTree => {
                if self.focus_area == FocusArea::FileTree {
                    // Focused → hide + return to previous area
                    self.ft.visible = false;
                    // Restore focus to Dock if focused pane is in dock, otherwise Stage
                    if self.focused.map(|f| self.is_pane_in_dock(f)).unwrap_or(false) {
                        self.focus_area = FocusArea::Dock;
                    } else {
                        self.focus_area = FocusArea::Stage;
                    }
                    self.cache.invalidate_chrome();
                    self.compute_layout();
                } else if self.ft.visible {
                    // Visible but not focused → focus
                    self.focus_area = FocusArea::FileTree;
                } else {
                    // Hidden → show + focus
                    self.ft.visible = true;
                    self.focus_area = FocusArea::FileTree;
                    self.update_file_tree_cwd();
                    self.compute_layout();
                }
            }
            FocusArea::Stage => {
                if self.focus_area != FocusArea::Stage {
                    // Find the owner terminal (not the drawer pane)
                    let terminal_id = self.focused_terminal_id();
                    if let Some(tid) = terminal_id {
                        self.focus_terminal(tid);
                    } else {
                        self.focus_area = FocusArea::Stage;
                    }
                }
            }
            FocusArea::Dock => {
                self.toggle_dock();
                // compute_layout() already called inside toggle_dock
            }
        }
        self.cache.invalidate_chrome();
    }

    /// Toggle FileTree visibility only (for titlebar button).
    /// Does NOT move focus on open. Fallback focus on close if FileTree was focused.
    pub(crate) fn toggle_file_tree_visibility(&mut self) {
        if self.ft.visible {
            self.ft.visible = false;
            if self.focus_area == FocusArea::FileTree {
                if self.focused.map(|f| self.is_pane_in_dock(f)).unwrap_or(false) {
                    self.focus_area = FocusArea::Dock;
                } else {
                    self.focus_area = FocusArea::Stage;
                }
            }
        } else {
            self.ft.visible = true;
            self.update_file_tree_cwd();
        }
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    /// Toggle Dock visibility only (for titlebar button).
    /// Does NOT move focus on open. Fallback focus on close if Dock was focused.
    pub(crate) fn toggle_dock_visibility(&mut self) {
        if self.dock_open {
            self.dock_open = false;
            if self.focus_area == FocusArea::Dock {
                let owner = self.focused_terminal_id();
                self.focus_area = FocusArea::Stage;
                if let Some(tid) = owner {
                    self.focused = Some(tid);
                    self.router.set_focused(tid);
                }
            }
        } else {
            // Set dock_open first so ensure_dock_placeholder doesn't early-return
            self.dock_open = true;
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
    }

    /// Handle Navigate(direction) — route based on focus_area.
    fn handle_navigate(&mut self, direction: tide_input::Direction) {
        match self.focus_area {
            FocusArea::FileTree => {
                self.navigate_file_tree(direction);
            }
            FocusArea::Stage | FocusArea::Dock => {
                // HJKL always operates in Stage — navigate between terminals.
                // If focus is in Dock, first resolve the owning Stage terminal.
                let stage_current = self.focused_terminal_id();

                if self.zoomed_pane.is_some() {
                    // Stacked mode: H/L cycle terminals, J/K ignored
                    let dir = match direction {
                        tide_input::Direction::Left => -1,
                        tide_input::Direction::Right => 1,
                        _ => return,
                    };
                    let ids = self.layout.pane_ids();
                    if ids.len() < 2 { return; }
                    let current = stage_current.unwrap_or_else(|| self.focused.unwrap_or(0));
                    if let Some(pos) = ids.iter().position(|&id| id == current) {
                        let next_pos = if dir > 0 {
                            (pos + 1) % ids.len()
                        } else {
                            (pos + ids.len() - 1) % ids.len()
                        };
                        let next_id = ids[next_pos];
                        self.zoomed_pane = Some(next_id);
                        self.focus_terminal(next_id);
                        self.compute_layout();
                    }
                } else {
                    // Split mode: if focus was in Dock, move focus to the owning terminal first
                    if self.focus_area == FocusArea::Dock {
                        if let Some(tid) = stage_current {
                            self.focused = Some(tid);
                            self.router.set_focused(tid);
                        }
                    }
                    self.handle_move_focus(direction);
                }
            }
        }
    }

    /// Handle ToggleStacked — toggle between Split and Stacked ViewMode.
    /// Stage (when focused on terminal): toggles terminal_view_mode and zoomed_pane.
    /// Dock: toggles dock_view_mode (TODO: add dock_view_mode field if needed).
    pub(crate) fn handle_toggle_stacked(&mut self) {
        match self.focus_area {
            FocusArea::Dock => {
                // Toggle Dock zoom: show only the focused dock pane
                if let Some(tid) = self.focused_terminal_id() {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                        tp.dock_zoomed = !tp.dock_zoomed;
                    }
                }
                self.cache.pane_generations.clear();
                self.cache.invalidate_chrome();
                self.compute_layout();
            }
            FocusArea::Stage => {
                // Toggle Stage between Split and Stacked
                if self.terminal_view_mode == crate::ui_state::ViewMode::Split {
                    self.terminal_view_mode = crate::ui_state::ViewMode::Stacked;
                } else {
                    self.terminal_view_mode = crate::ui_state::ViewMode::Split;
                }
                // Update zoomed_pane to match: stacked = zoom focused, split = unzoom
                if self.terminal_view_mode == crate::ui_state::ViewMode::Stacked {
                    self.zoomed_pane = self.focused;
                } else {
                    self.zoomed_pane = None;
                }
                self.cache.pane_generations.clear();
                self.cache.invalidate_chrome();
                self.compute_layout();
            }
            FocusArea::FileTree => {} // no-op
        }
    }

    /// Reorder a pane to the position of another pane (used by tab drag in stacked mode).
    /// Swaps the two panes' positions in the SplitLayout of the current focus area.
    pub(crate) fn reorder_stacked_tab(&mut self, source: tide_core::PaneId, target: tide_core::PaneId) {
        match self.focus_area {
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

    /// Cmd+I/O: cycle tabs within the Dock without changing focus_area.
    /// Updates dock_focused and active tab, but keeps keyboard focus where it is.
    /// No-op if the focused terminal has no dock panes.
    fn cycle_tab(&mut self, direction: i32) {
        let tid = match self.focused_terminal_id() {
            Some(id) => id,
            None => return,
        };
        let pane_ids = match self.panes.get(&tid) {
            Some(PaneKind::Terminal(tp)) => tp.dock_layout.all_tabs_flat(),
            _ => return,
        };
        if pane_ids.len() <= 1 { return; }

        // Find current position in the flat tab list
        let current = match self.panes.get(&tid) {
            Some(PaneKind::Terminal(tp)) => tp.dock_focused,
            _ => None,
        };
        let pos = current.and_then(|c| pane_ids.iter().position(|&id| id == c)).unwrap_or(0);
        let next_pos = if direction > 0 {
            (pos + 1) % pane_ids.len()
        } else {
            (pos + pane_ids.len() - 1) % pane_ids.len()
        };
        let next_id = pane_ids[next_pos];

        // Update dock tab state
        if let Some(PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
            tp.dock_focused = Some(next_id);
            tp.dock_layout.set_active_tab(next_id);
        }
        // If Dock is focused, move the focus cursor too (so border follows)
        if self.focus_area == FocusArea::Dock {
            self.focused = Some(next_id);
            self.router.set_focused(next_id);
        }
        self.dock_open = true;
        self.cache.invalidate_chrome();
        self.compute_layout();
    }

    pub(crate) fn handle_action(&mut self, action: Action, event: Option<InputEvent>) {
        match action {
            Action::RouteToPane(id) => {
                // Update focus
                if let Some(InputEvent::MouseClick { position, .. }) = event {
                    self.focus_terminal(id);

                    // Clicking webview content unfocuses the URL bar
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&id) {
                        if bp.url_input_focused {
                            bp.url_input_focused = false;
                            self.cache.invalidate_chrome();
                        }
                    }

                    // Ctrl+Click / Cmd+Click on terminal -> try to open URL or file at click position
                    let mods = self.modifiers;
                    if mods.ctrl || mods.meta {
                        // Try URL first — open in embedded browser panel
                        if let Some(url) = self.extract_url_at(id, position) {
                            self.open_browser_pane(Some(url));
                            return;
                        }
                        if let Some((path, line)) = self.extract_file_path_at(id, position) {
                            self.open_editor_pane_at_line(path, line);
                            return;
                        }
                    }

                    // Click on editor pane -> move cursor (skip in preview mode)
                    if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&id) {
                        if pane.preview_mode { return; }
                    }
                    let cell_size = self.cell_size();
                    if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&id) {
                        {
                            if let Some(&(_, rect)) = self.visual_pane_rects.iter().find(|(pid, _)| *pid == id) {
                                let content_top = TAB_BAR_HEIGHT;
                                let inner_x = rect.x + PANE_PADDING;
                                let inner_y = rect.y + content_top;
                                let gutter_width = crate::editor_pane::GUTTER_WIDTH_CELLS as f32 * cell_size.width;

                                let content_x = inner_x + gutter_width;
                                let rel_col = ((position.x - content_x) / cell_size.width).floor() as isize;
                                let rel_row = ((position.y - inner_y) / cell_size.height).floor() as isize;

                                if rel_row >= 0 && rel_col >= 0 {
                                    let visible_rows = ((rect.height - content_top - PANE_PADDING) / cell_size.height).floor() as usize;

                                    if pane.effective_soft_wrap() {
                                        // In soft wrap mode, map visual row → logical line via WrapMap
                                        if let Some(wrap_map) = pane.wrap_map() {
                                            let scroll_vr = wrap_map.visual_row_of_line(pane.editor.scroll_offset());
                                            let abs_visual_row = scroll_vr + rel_row as usize;
                                            if let Some(info) = wrap_map.visual_row_to_line_info(abs_visual_row, &pane.editor.buffer.lines) {
                                                // col is relative to the sub-row, add the char offset
                                                // Clamp to char_end to avoid jumping to next visual row
                                                let col = (info.char_offset + rel_col as usize).min(info.char_end);
                                                pane.handle_action(EditorAction::SetCursor { line: info.logical_line, col }, visible_rows);
                                            }
                                        }
                                    } else {
                                        let line = pane.editor.scroll_offset() + rel_row as usize;
                                        let col = pane.editor.h_scroll_offset() + rel_col as usize;
                                        pane.handle_action(EditorAction::SetCursor { line, col }, visible_rows);
                                    }
                                }
                            }
                        }
                    }
                }

                // Forward keyboard input to the pane
                let cs_for_keys = self.cell_size();
                if let Some(InputEvent::KeyPress { key, modifiers }) = event {
                    match self.panes.get_mut(&id) {
                        Some(PaneKind::Terminal(pane)) => {
                            if pane.context.child_dead {
                                // Dead terminal: any key respawns a new shell
                                self.respawn_terminal(id);
                            } else {
                                pane.selection = None; // Clear selection on key input
                                pane.handle_key(&key, &modifiers);
                                self.input_just_sent = true;
                                self.input_sent_at = Some(Instant::now());
                            }
                        }
                        Some(PaneKind::Editor(pane)) => {
                            // Cmd+Shift+M / Ctrl+Shift+M: toggle markdown preview
                            if (modifiers.meta || modifiers.ctrl) && modifiers.shift {
                                if let tide_core::Key::Char('m') | tide_core::Key::Char('M') = &key {
                                    if pane.is_markdown() {
                                        pane.toggle_preview();
                                        self.cache.invalidate_chrome();
                                        self.cache.invalidate_pane(id);
                                        return;
                                    }
                                }
                            }

                            // Preview mode: Escape exits, all other keys ignored.
                            // Scrolling handled by Cmd+D/U (ScrollHalfPage) and mouse/trackpad.
                            if pane.preview_mode {
                                if matches!(key, tide_core::Key::Escape) {
                                    pane.toggle_preview();
                                    self.cache.invalidate_chrome();
                                    self.cache.invalidate_pane(id);
                                }
                                return;
                            }

                            if let Some(action) = tide_editor::key_to_editor_action(&key, &modifiers) {
                                // Handle SelectAll: set selection, don't clear it
                                if matches!(action, tide_editor::EditorActionKind::SelectAll) {
                                    pane.select_all();
                                    return;
                                }
                                // Delete selection on editing actions (insert, backspace, delete, enter)
                                match &action {
                                    tide_editor::EditorActionKind::InsertChar(_)
                                    | tide_editor::EditorActionKind::Backspace
                                    | tide_editor::EditorActionKind::Delete
                                    | tide_editor::EditorActionKind::Enter => {
                                        pane.delete_selection();
                                    }
                                    _ => {}
                                }
                                // Clear selection on movement and editing keys
                                pane.selection = None;
                                let is_save = matches!(action, tide_editor::EditorActionKind::Save);
                                // Intercept Save on untitled files -> open save-as input
                                if is_save && pane.editor.file_path().is_none() {
                                    let base_dir = self.resolve_base_dir();
                                    let anchor = self.visual_pane_rects.iter()
                                        .find(|(pid, _)| *pid == id)
                                        .map(|(_, r)| tide_core::Rect::new(r.x, r.y, r.width, crate::theme::TAB_BAR_HEIGHT))
                                        .unwrap_or_else(|| tide_core::Rect::new(0.0, 0.0, 0.0, 0.0));
                                    self.modal.save_as_input = Some(crate::SaveAsInput::new(id, base_dir, anchor));
                                    return;
                                }
                                let was_modified = pane.editor.is_modified();
                                let cell_size = Some(cs_for_keys);
                                let content_top = TAB_BAR_HEIGHT;
                                let (visible_rows, visible_cols) = if let Some(cs) = cell_size {
                                    let tree_rect = self.visual_pane_rects.iter()
                                        .find(|(pid, _)| *pid == id)
                                        .map(|(_, r)| *r);
                                    if let Some(r) = tree_rect {
                                        let rows = ((r.height - content_top - PANE_PADDING) / cs.height).floor() as usize;
                                        let gutter_width = crate::editor_pane::GUTTER_WIDTH_CELLS as f32 * cs.width;
                                        let cols = ((r.width - 2.0 * PANE_PADDING - 2.0 * gutter_width) / cs.width).floor() as usize;
                                        (rows, cols)
                                    } else {
                                        (30, 80)
                                    }
                                } else {
                                    (30, 80)
                                };
                                pane.handle_action_with_size(action, visible_rows, visible_cols);
                                // Clear disk_changed on save (user's version wins)
                                if is_save {
                                    pane.disk_changed = false;
                                    pane.diff_mode = false;
                                    pane.disk_content = None;
                                    pane.file_deleted = false;
                                }
                                // Redraw tab label when modified indicator changes
                                if pane.editor.is_modified() != was_modified || is_save {
                                    self.cache.invalidate_chrome();
                                }
                                // Refresh git status on save (async via git poller)
                                if is_save {
                                    self.trigger_git_poll();
                                    self.notify_lsp_did_save(id);
                                }
                                // Invalidate cached pane texture and request redraw
                                self.cache.invalidate_pane(id);
                            }
                        }
                        Some(PaneKind::Diff(_)) => {} // Diff pane has no keyboard input
                        Some(PaneKind::Browser(_)) => {} // Browser keyboard handled by webview / URL bar
                        Some(PaneKind::Launcher(_)) => {
                            // Launcher key handling: T/E/O/B to select pane type, Escape to close
                            let choice = match key {
                                tide_core::Key::Char('t') | tide_core::Key::Char('T') => {
                                    Some(crate::action::pane_lifecycle::LauncherChoice::Terminal)
                                }
                                tide_core::Key::Char('e') | tide_core::Key::Char('E') => {
                                    Some(crate::action::pane_lifecycle::LauncherChoice::NewFile)
                                }
                                tide_core::Key::Char('o') | tide_core::Key::Char('O') => {
                                    Some(crate::action::pane_lifecycle::LauncherChoice::OpenFile)
                                }
                                tide_core::Key::Char('b') | tide_core::Key::Char('B') => {
                                    Some(crate::action::pane_lifecycle::LauncherChoice::Browser)
                                }
                                tide_core::Key::Escape => {
                                    self.close_specific_pane(id);
                                    None
                                }
                                _ => None,
                            };
                            if let Some(c) = choice {
                                self.resolve_launcher(id, c);
                            }
                        }
                        None => {}
                    }
                }

                // Forward mouse scroll to pane
                if let Some(InputEvent::MouseScroll { delta, .. }) = event {
                    // Compute actual visible rows/cols for the pane
                    let content_top = TAB_BAR_HEIGHT;
                    let (visible_rows, visible_cols) = {
                        let cs = self.cell_size();
                        let rect = self.visual_pane_rects.iter()
                            .find(|(pid, _)| *pid == id)
                            .map(|(_, r)| *r);
                        if let Some(r) = rect {
                            let rows = ((r.height - content_top - PANE_PADDING) / cs.height).floor() as usize;
                            let gutter_width = crate::editor_pane::GUTTER_WIDTH_CELLS as f32 * cs.width;
                            let cols = ((r.width - 2.0 * PANE_PADDING - 2.0 * gutter_width) / cs.width).floor() as usize;
                            (rows.max(1), cols.max(1))
                        } else {
                            (30, 80)
                        }
                    };
                    match self.panes.get_mut(&id) {
                        Some(PaneKind::Editor(pane)) if pane.preview_mode => {
                            let acc = self.interaction.scroll_accumulator.entry(id).or_insert(0.0);
                            *acc += delta;
                            let lines = acc.trunc() as i32;
                            if lines != 0 {
                                *acc -= lines as f32;
                                let total = pane.preview_line_count();
                                let max_scroll = total.saturating_sub(visible_rows);
                                if lines > 0 {
                                    pane.preview_scroll = pane.preview_scroll.saturating_sub(lines.unsigned_abs() as usize);
                                } else {
                                    pane.preview_scroll = (pane.preview_scroll + lines.unsigned_abs() as usize).min(max_scroll);
                                }
                                self.cache.invalidate_pane(id);
                            }
                        }
                        Some(PaneKind::Editor(pane)) => {
                            // Accumulate sub-pixel scroll deltas (like terminal)
                            let acc = self.interaction.scroll_accumulator.entry(id).or_insert(0.0);
                            *acc += delta;
                            let lines = acc.trunc();
                            if lines.abs() >= 1.0 {
                                *acc -= lines;
                                if lines > 0.0 {
                                    pane.handle_action_with_size(EditorAction::ScrollUp(lines.abs()), visible_rows, visible_cols);
                                } else {
                                    pane.handle_action_with_size(EditorAction::ScrollDown(lines.abs()), visible_rows, visible_cols);
                                }
                                self.cache.invalidate_pane(id);
                            }
                        }
                        Some(PaneKind::Terminal(pane)) => {
                            // Accumulate sub-pixel scroll deltas to prevent jitter
                            let acc = self.interaction.scroll_accumulator.entry(id).or_insert(0.0);
                            *acc += delta;
                            let lines = acc.trunc() as i32;
                            if lines != 0 {
                                *acc -= lines as f32;
                                pane.scroll_display(lines);
                                pane.backend.process();
                                self.cache.invalidate_pane(id);
                            }
                        }
                        Some(PaneKind::Diff(dp)) => {
                            let total = dp.total_lines() as f32;
                            dp.scroll_target = (dp.scroll_target - delta).clamp(0.0, total.max(0.0));
                            dp.scroll = dp.scroll_target;
                            dp.generation = dp.generation.wrapping_add(1);
                            self.cache.invalidate_pane(id);
                        }
                        Some(PaneKind::Browser(_)) => {} // Scroll handled by native WKWebView
                        Some(PaneKind::Launcher(_)) => {}
                        None => {}
                    }
                }
            }
            Action::GlobalAction(global) => {
                self.handle_global_action(global);
            }
            Action::DragBorder(pos) => {
                let logical = self.logical_size();
                let mut left = 0.0_f32;
                let mut right = 0.0_f32;
                if self.ft.visible {
                    match self.sidebar_side {
                        crate::LayoutSide::Left => left += self.ft.width,
                        crate::LayoutSide::Right => right += self.ft.width,
                    }
                }
                let drag_pos = Vec2::new(pos.x - left, pos.y);
                let terminal_area = Size::new(
                    (logical.width - left - right).max(100.0),
                    logical.height,
                );
                self.layout.begin_drag(drag_pos, terminal_area);
                self.layout.drag_border(drag_pos);
                self.compute_layout();
            }
            Action::None => {}
        }
    }

    pub(crate) fn split_pane(&mut self, direction: SplitDirection, cwd: Option<std::path::PathBuf>) {
        if let Some(focused) = self.focused {
            self.split_pane_from(focused, direction, cwd);
        }
    }

    /// Split from a specific source pane, creating a new terminal pane with
    /// proper focus, chrome updates.
    /// Returns the new pane ID on success.
    pub(crate) fn split_pane_from(
        &mut self,
        source: tide_core::PaneId,
        direction: SplitDirection,
        cwd: Option<std::path::PathBuf>,
    ) -> Option<tide_core::PaneId> {
        // Unzoom before splitting so both panes are visible
        if self.zoomed_pane.is_some() {
            self.zoomed_pane = None;
            self.cache.pane_generations.clear();
        }
        let new_id = self.layout.split(source, direction);
        self.create_terminal_pane(new_id, cwd);
        self.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
        Some(new_id)
    }

    pub(crate) fn handle_global_action(&mut self, action: GlobalAction) {
        match action {
            GlobalAction::SplitVertical => {
                self.split_with_launcher(SplitDirection::Vertical);
            }
            GlobalAction::SplitHorizontal => {
                self.split_with_launcher(SplitDirection::Horizontal);
            }
            GlobalAction::SplitHorizontalHere => {
                // Cmd+\: always split Dock right (new TabGroup)
                self.dock_split_new_tab_group(SplitDirection::Horizontal);
            }
            GlobalAction::SplitVerticalHere => {
                // Cmd+Shift+\: always split Dock below (new TabGroup)
                self.dock_split_new_tab_group(SplitDirection::Vertical);
            }
            GlobalAction::ClosePane => {
                if let Some(focused) = self.focused {
                    self.close_specific_pane(focused);
                }
            }
            GlobalAction::FocusArea(slot) => {
                if matches!(slot, AreaSlot::Slot1) {
                    // Cmd+1: toggle workspace sidebar
                    self.ws.show_sidebar = !self.ws.show_sidebar;
                    self.cache.invalidate_chrome();
                    self.compute_layout();
                } else {
                    let target = self.resolve_slot(slot);
                    self.handle_focus_area(target);
                }
            }
            GlobalAction::WorkspacePrev => {
                let len = self.ws.workspaces.len();
                if len > 0 {
                    let prev = if self.ws.active == 0 { len - 1 } else { self.ws.active - 1 };
                    self.switch_workspace(prev);
                }
            }
            GlobalAction::WorkspaceNext => {
                let len = self.ws.workspaces.len();
                if len > 0 {
                    let next = if self.ws.active + 1 >= len { 0 } else { self.ws.active + 1 };
                    self.switch_workspace(next);
                }
            }
            GlobalAction::NewWorkspace => {
                self.new_workspace();
            }
            GlobalAction::CloseWorkspace => {
                self.close_workspace();
            }
            GlobalAction::ToggleFileTree => {
                self.handle_focus_area(FocusArea::FileTree);
            }
            GlobalAction::ToggleWorkspaceSidebar => {
                self.ws.show_sidebar = !self.ws.show_sidebar;
                self.cache.invalidate_chrome();
                self.compute_layout();
            }
            GlobalAction::Navigate(direction) => {
                self.handle_navigate(direction);
            }
            GlobalAction::ToggleZoom => {
                self.handle_toggle_stacked();
            }
            GlobalAction::TabPrev => {
                self.cycle_tab(-1);
            }
            GlobalAction::TabNext => {
                self.cycle_tab(1);
            }
            GlobalAction::NewTab => {
                // Open a new terminal pane next to the focused pane
                self.new_terminal_tab();
            }
            GlobalAction::FileFinder => {
                self.open_file_finder();
            }
            GlobalAction::ToggleFullscreen => {
                self.pending_fullscreen_toggle = true;
            }
            GlobalAction::Paste => {
                if let Some(target_id) = self.action_target_id() {
                    match self.panes.get_mut(&target_id) {
                        Some(PaneKind::Terminal(pane)) => {
                            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                                if let Ok(text) = clipboard.get_text() {
                                    if !text.is_empty() {
                                        // Scroll to bottom so pasted text is visible
                                        if pane.backend.display_offset() > 0 {
                                            pane.backend.request_scroll_to_bottom();
                                        }
                                        let bracketed = pane.backend.is_bracketed_paste_mode();
                                        let mut data = Vec::new();
                                        if bracketed {
                                            data.extend_from_slice(b"\x1b[200~");
                                            // Sanitize: strip the bracket-close sequence from
                                            // clipboard text to prevent pastejacking attacks
                                            // that escape bracketed paste mode.
                                            let safe = text.replace("\x1b[201~", "");
                                            data.extend_from_slice(safe.as_bytes());
                                        } else {
                                            data.extend_from_slice(text.as_bytes());
                                        }
                                        if bracketed {
                                            data.extend_from_slice(b"\x1b[201~");
                                            // Nudge shell to redraw and clear paste standout
                                            // (left + right arrow = net-zero cursor move that
                                            // triggers zsh/bash/fish to re-render without
                                            // the INVERSE highlight on pasted text).
                                            data.extend_from_slice(b"\x1b[D\x1b[C");
                                        }
                                        pane.backend.write(&data);
                                        self.input_just_sent = true;
                                        self.input_sent_at = Some(Instant::now());
                                    }
                                }
                            }
                        }
                        Some(PaneKind::Editor(pane)) => {
                            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                                if let Ok(text) = clipboard.get_text() {
                                    if !text.is_empty() {
                                        pane.delete_selection();
                                        pane.editor.insert_text(&text);
                                    }
                                }
                            }
                        }
                        Some(PaneKind::Browser(bp)) if bp.url_input_focused => {
                            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                                if let Ok(text) = clipboard.get_text() {
                                    if !text.is_empty() {
                                        for ch in text.chars() {
                                            let byte_off = bp.cursor_byte_offset();
                                            bp.url_input.insert(byte_off, ch);
                                            bp.url_input_cursor += 1;
                                        }
                                        self.cache.invalidate_chrome();
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            GlobalAction::Copy => {
                if let Some(target_id) = self.action_target_id() {
                    match self.panes.get(&target_id) {
                        Some(PaneKind::Terminal(pane)) => {
                            if let Some(ref sel) = pane.selection {
                                let text = pane.selected_text(sel);
                                if !text.is_empty() {
                                    if let Ok(mut clipboard) = arboard::Clipboard::new() {
                                        let _ = clipboard.set_text(&text);
                                    }
                                }
                            }
                        }
                        Some(PaneKind::Editor(pane)) => {
                            if let Some(ref sel) = pane.selection {
                                let text = pane.selected_text(sel);
                                if !text.is_empty() {
                                    if let Ok(mut clipboard) = arboard::Clipboard::new() {
                                        let _ = clipboard.set_text(&text);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
            GlobalAction::Find => {
                if let Some(target_id) = self.action_target_id() {
                    let has_search = match self.panes.get(&target_id) {
                        Some(PaneKind::Terminal(pane)) => pane.search.is_some(),
                        Some(PaneKind::Editor(pane)) => pane.search.is_some(),
                        _ => false,
                    };
                    if has_search {
                        self.search_focus = Some(target_id);
                    } else {
                        match self.panes.get_mut(&target_id) {
                            Some(PaneKind::Terminal(pane)) => {
                                pane.search = Some(SearchState::new());
                            }
                            Some(PaneKind::Editor(pane)) => {
                                pane.search = Some(SearchState::new());
                            }
                            _ => {}
                        }
                        self.search_focus = Some(target_id);
                    }
                }
            }
            GlobalAction::FontSizeUp => {
                self.apply_font_size(self.current_font_size + 1.0);
            }
            GlobalAction::FontSizeDown => {
                self.apply_font_size(self.current_font_size - 1.0);
            }
            GlobalAction::FontSizeReset => {
                self.apply_font_size(14.0);
            }
            GlobalAction::NewWindow => {
                if let Ok(exe) = std::env::current_exe() {
                    let _ = std::process::Command::new(exe).spawn();
                }
            }
            GlobalAction::NewFile => {
                self.new_editor_pane();
            }
            GlobalAction::OpenBrowser => {
                self.open_browser_pane(None);
            }
            GlobalAction::BrowserBack => {
                if let Some(focused) = self.focused {
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused) {
                        bp.go_back();
                    }
                }
            }
            GlobalAction::BrowserForward => {
                if let Some(focused) = self.focused {
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused) {
                        bp.go_forward();
                    }
                }
            }
            GlobalAction::OpenConfig => {
                self.toggle_config_page();
            }
            GlobalAction::ToggleTheme => {
                self.dark_mode = !self.dark_mode;
                let border_color = self.palette().border_color;
                if let Some(renderer) = &mut self.renderer {
                    renderer.clear_color = border_color;
                }
                let dark = self.dark_mode;
                for pane in self.panes.values_mut() {
                    match pane {
                        crate::pane::PaneKind::Terminal(tp) => {
                            tp.backend.set_dark_mode(dark);
                        }
                        crate::pane::PaneKind::Editor(ep) => {
                            ep.editor.set_dark_mode(dark);
                        }
                        crate::pane::PaneKind::Diff(_) => {}
                        crate::pane::PaneKind::Browser(_) => {}
                        crate::pane::PaneKind::Launcher(_) => {}
                    }
                }
                self.cache.invalidate_chrome();
                self.cache.layout_generation = self.cache.layout_generation.wrapping_add(1);
                self.cache.pane_generations.clear();
            }
            GlobalAction::ScrollHalfPageUp => {
                self.scroll_half_page(tide_input::Direction::Up);
            }
            GlobalAction::ScrollHalfPageDown => {
                self.scroll_half_page(tide_input::Direction::Down);
            }
            GlobalAction::ToggleStacked => {
                self.handle_toggle_stacked();
            }
        }
    }

    pub(crate) fn toggle_config_page(&mut self) {
        if self.modal.config_page.is_some() {
            self.close_config_page();
        } else {
            self.open_config_page();
        }
        self.cache.needs_redraw = true;
    }

    fn open_config_page(&mut self) {
        use tide_input::{GlobalAction as GA, KeybindingMap};

        let map = self.router.keybinding_map.as_ref();
        let all_actions = GA::all_actions();

        let bindings: Vec<(GA, tide_input::Hotkey)> = all_actions
            .into_iter()
            .map(|action| {
                let hotkey = map
                    .and_then(|m| m.hotkey_for(&action).cloned())
                    .or_else(|| {
                        let defaults = KeybindingMap::new();
                        defaults.hotkey_for(&action).cloned()
                    })
                    .unwrap_or(tide_input::Hotkey::new(
                        tide_core::Key::Char('?'),
                        false, false, false, false,
                    ));
                (action, hotkey)
            })
            .collect();

        let worktree_pattern = self.settings.worktree.base_dir_pattern
            .clone()
            .unwrap_or_default();

        let copy_files = self.settings.worktree.copy_files
            .as_ref()
            .map(|v| v.join(", "))
            .unwrap_or_default();

        self.modal.config_page = Some(crate::ConfigPageState::new(bindings, worktree_pattern, copy_files));
        self.cache.invalidate_chrome();
    }

    pub(crate) fn close_config_page(&mut self) {
        let page = match self.modal.config_page.take() {
            Some(p) => p,
            None => return,
        };

        if page.dirty {
            // Save keybinding overrides
            let defaults = tide_input::KeybindingMap::default_bindings();
            let overrides: Vec<crate::settings::KeybindingOverride> = page
                .bindings
                .iter()
                .filter(|(action, hotkey)| {
                    // Only save if different from default
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
                    crate::settings::KeybindingOverride::from_binding(hotkey, action)
                })
                .collect();

            self.settings.keybindings = overrides;

            // Save worktree pattern
            let wt_text = page.worktree_input.text.trim().to_string();
            self.settings.worktree.base_dir_pattern = if wt_text.is_empty() {
                None
            } else {
                Some(wt_text)
            };

            // Save copy files
            let cf_text = page.copy_files_input.text.trim().to_string();
            self.settings.worktree.copy_files = if cf_text.is_empty() {
                None
            } else {
                let files: Vec<String> = cf_text
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                if files.is_empty() { None } else { Some(files) }
            };

            crate::settings::save_settings(&self.settings);

            // Rebuild keybinding map on router
            let map = crate::settings::build_keybinding_map(&self.settings);
            if map.bindings.len() == tide_input::KeybindingMap::default_bindings().len()
                && self.settings.keybindings.is_empty()
            {
                self.router.keybinding_map = None;
            } else {
                self.router.keybinding_map = Some(map);
            }
        }

        self.cache.invalidate_chrome();
    }

    /// Navigate between panes in the layout (cycle through all panes).
    fn navigate_panes(&mut self, direction: i32) {
        let current_id = match self.focused {
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
        self.focused = Some(new_pane);
        self.router.set_focused(new_pane);
        // Keep zoom on the new pane so it stays fullscreen
        if self.zoomed_pane.is_some() {
            self.zoomed_pane = Some(new_pane);
        }
        self.cache.invalidate_chrome();
        self.compute_layout();
    }
}
