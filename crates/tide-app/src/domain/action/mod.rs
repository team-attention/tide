mod pane_create;
mod pane_close;
mod focus_nav;
mod text_extract;
mod file_ops;
mod dock;
mod workspace;
mod search;

/// Launcher type selection choices.
pub(crate) enum LauncherChoice {
    Terminal,
    NewFile,
    OpenFile,
    Browser,
}

use std::time::Instant;

use tide_core::{InputEvent, LayoutEngine, PaneId, Size, SplitDirection, TerminalBackend, Vec2};
use tide_editor::input::EditorAction;
use tide_input::{Action, AreaSlot, GlobalAction};

use crate::pane::PaneKind;
use crate::theme::*;
use crate::state::FocusArea;
use crate::App;
use crate::ClipboardSearchPort;
use crate::FileOpsPort;
use crate::DockPort;
use crate::FocusNavPort;
use crate::TextExtractPort;
use crate::AppCorePort;
use crate::LayoutPort;
use crate::WorkspaceNavPort;
use crate::ActionPort;
use crate::PaneLifecyclePort;

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
        self.ports.gpu.remove_pane_cache(pane_id);
        // Clean up terminal association
        self.assoc.associated_terminal.remove(&pane_id);
        // If no pane references a retained context, clean it up
        self.cleanup_retained_context(pane_id);
    }

    /// Resolve the effective target pane for actions like Copy/Paste/Find.
    fn action_target_id(&self) -> Option<tide_core::PaneId> {
        action_target_id(self.focus.focused)
    }
}

impl crate::domain::ports::inward::ActionPort for App {
    fn cleanup_retained_context(&mut self, _closed_pane_id: tide_core::PaneId) {
        // Check if the closed pane's associated terminal is in retained_contexts
        // and no other pane still references it
        let terminal_ids: Vec<tide_core::PaneId> = self.assoc.retained_contexts.keys().copied().collect();
        for tid in terminal_ids {
            let still_referenced = self.assoc.associated_terminal.values().any(|&v| v == tid);
            if !still_referenced {
                self.assoc.retained_contexts.remove(&tid);
            }
        }
    }

    fn exit_app(&self) {
        self.save_full_session();
        self.ports.persistence.delete_running_marker();
        std::process::exit(0);
    }

    fn handle_action(&mut self, action: Action, event: Option<InputEvent>) {
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
                    let mods = self.window.modifiers;
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
                                let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;

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
                                self.input.input_just_sent = true;
                                self.input.input_sent_at = Some(self.ports.clock.now());
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
                                        let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cs.width;
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
                                    Some(crate::action::LauncherChoice::Terminal)
                                }
                                tide_core::Key::Char('e') | tide_core::Key::Char('E') => {
                                    Some(crate::action::LauncherChoice::NewFile)
                                }
                                tide_core::Key::Char('o') | tide_core::Key::Char('O') => {
                                    Some(crate::action::LauncherChoice::OpenFile)
                                }
                                tide_core::Key::Char('b') | tide_core::Key::Char('B') => {
                                    Some(crate::action::LauncherChoice::Browser)
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
                            let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cs.width;
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
                    match self.window.sidebar_side {
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

    fn split_pane(&mut self, direction: SplitDirection, cwd: Option<std::path::PathBuf>) {
        if let Some(focused) = self.focus.focused {
            self.split_pane_from(focused, direction, cwd);
        }
    }

    /// Split from a specific source pane, creating a new terminal pane with
    /// proper focus, chrome updates.
    /// Returns the new pane ID on success.
    fn split_pane_from(
        &mut self,
        source: tide_core::PaneId,
        direction: SplitDirection,
        cwd: Option<std::path::PathBuf>,
    ) -> Option<tide_core::PaneId> {
        // Unzoom before splitting so both panes are visible
        if self.focus.zoomed_pane.is_some() {
            self.focus.zoomed_pane = None;
            self.cache.pane_generations.clear();
        }
        let new_id = self.layout.split(source, direction);
        self.create_terminal_pane(new_id, cwd);
        self.focus.focused = Some(new_id);
        self.router.set_focused(new_id);
        self.cache.invalidate_chrome();
        self.compute_layout();
        Some(new_id)
    }

    fn handle_global_action(&mut self, action: GlobalAction) {
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
                if let Some(focused) = self.focus.focused {
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
                self.window.pending_fullscreen_toggle = true;
            }
            GlobalAction::Paste => {
                self.handle_paste();
            }
            GlobalAction::Copy => {
                self.handle_copy();
            }
            GlobalAction::Find => {
                self.handle_find();
            }
            GlobalAction::FontSizeUp => {
                self.apply_font_size(self.window.current_font_size + 1.0);
            }
            GlobalAction::FontSizeDown => {
                self.apply_font_size(self.window.current_font_size - 1.0);
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
                if let Some(focused) = self.focus.focused {
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused) {
                        bp.go_back();
                    }
                }
            }
            GlobalAction::BrowserForward => {
                if let Some(focused) = self.focus.focused {
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused) {
                        bp.go_forward();
                    }
                }
            }
            GlobalAction::BrowserReload => {
                if let Some(focused) = self.focus.focused {
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused) {
                        bp.reload();
                    }
                }
            }
            GlobalAction::OpenConfig => {
                self.toggle_config_page();
            }
            GlobalAction::ToggleTheme => {
                self.window.dark_mode = !self.window.dark_mode;
                let border_color = self.palette().border_color;
                self.ports.gpu.set_clear_color(border_color);
                let dark = self.window.dark_mode;
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
            GlobalAction::ToggleDockPin => {
                self.toggle_dock_pin();
            }
        }
    }

    // toggle_config_page, open_config_page, close_config_page, navigate_panes → workspace.rs
}

/// Resolve the effective target pane for actions like Copy/Paste/Find.
fn action_target_id(focused: Option<tide_core::PaneId>) -> Option<tide_core::PaneId> {
    focused
}

// ── Pane lifecycle helpers (formerly in pane_lifecycle/mod.rs) ──

impl App {
    /// Add a pane to the right of the focused pane.
    /// Splits the focused pane horizontally.
    fn add_pane_to_right(&mut self, focused: tide_core::PaneId, new_id: tide_core::PaneId) {
        self.layout.insert_pane(focused, new_id, tide_core::SplitDirection::Horizontal, false);
    }

    /// Route a non-terminal pane next to the correct pane.
    /// If focused is a terminal → add to right (split horizontally).
    /// If focused is non-terminal → add as vertical split next to the same pane.
    fn add_to_non_terminal_group(&mut self, focused: tide_core::PaneId, new_id: tide_core::PaneId) {
        if matches!(self.panes.get(&focused), Some(crate::pane::PaneKind::Terminal(_))) {
            self.add_pane_to_right(focused, new_id);
        } else {
            self.layout.insert_pane(focused, new_id, tide_core::SplitDirection::Vertical, false);
        }
    }
}
