//! Focus-area-specific keyboard handling.
//!
//! Handles keyboard events for: file tree navigation, browser URL bar,
//! and search bar.

use tide_core::{FileTreeSource, Key, Modifiers};

use crate::pane::PaneKind;
use crate::App;
use crate::AppCorePort;
use crate::PaneLifecyclePort;

impl App {
    pub(super) fn handle_file_tree_nav_key(&mut self, key: Key, _modifiers: &Modifiers) {
        let entry_count = self
            .ft.tree
            .as_ref()
            .map(|t| t.visible_entries().len())
            .unwrap_or(0);
        if entry_count == 0 {
            self.cache.needs_redraw = true;
            return;
        }

        match key {
            Key::Char('j') | Key::Down => {
                if self.ft.cursor + 1 < entry_count {
                    self.ft.cursor += 1;
                    self.cache.invalidate_chrome();
                    self.auto_scroll_file_tree_cursor();
                }
            }
            Key::Char('k') | Key::Up => {
                if self.ft.cursor > 0 {
                    self.ft.cursor -= 1;
                    self.cache.invalidate_chrome();
                    self.auto_scroll_file_tree_cursor();
                }
            }
            Key::Char('g') => {
                self.ft.cursor = 0;
                self.cache.invalidate_chrome();
                self.auto_scroll_file_tree_cursor();
            }
            Key::Char('G') => {
                if entry_count > 0 {
                    self.ft.cursor = entry_count - 1;
                    self.cache.invalidate_chrome();
                    self.auto_scroll_file_tree_cursor();
                }
            }
            Key::Enter => {
                if let Some(tree) = &self.ft.tree {
                    let entries = tree.visible_entries();
                    if let Some(entry) = entries.get(self.ft.cursor) {
                        if entry.entry.is_dir {
                            let path = entry.entry.path.clone();
                            if let Some(tree) = &mut self.ft.tree {
                                tree.toggle(&path);
                            }
                            self.cache.invalidate_chrome();
                        } else {
                            let path = entry.entry.path.clone();
                            self.open_editor_pane(path);
                        }
                    }
                }
            }
            _ => {}
        }
        self.cache.needs_redraw = true;
    }

    pub(crate) fn auto_scroll_file_tree_cursor(&mut self) {
        if let Some(tree_rect) = self.ft.rect {
            let cell_size = self.cell_size();
            let line_height = cell_size.height * crate::theme::FILE_TREE_LINE_SPACING;
            let padding = crate::theme::PANE_PADDING;

            let cursor_y = padding + self.ft.cursor as f32 * line_height;
            let visible_top = self.ft.scroll;
            let visible_bottom = self.ft.scroll + tree_rect.height - padding * 2.0;

            if cursor_y < visible_top {
                self.ft.scroll_target = cursor_y;
                self.ft.scroll = cursor_y;
            } else if cursor_y + line_height > visible_bottom {
                self.ft.scroll_target =
                    cursor_y + line_height - (tree_rect.height - padding * 2.0);
                self.ft.scroll = self.ft.scroll_target;
            }
        }
    }

    pub(super) fn handle_browser_url_bar_key(
        &mut self,
        pane_id: tide_core::PaneId,
        key: Key,
        modifiers: &Modifiers,
    ) {
        match key {
            Key::Enter => {
                let url = if let Some(PaneKind::Browser(bp)) = self.panes.get(&pane_id) {
                    bp.url_input.trim().to_string()
                } else {
                    return;
                };
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&pane_id) {
                    bp.url_input_focused = false;
                    bp.url_selection = None;
                    bp.navigate(&url);
                }
            }
            Key::Escape => {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&pane_id) {
                    bp.url_input = bp.url.clone();
                    bp.url_input_cursor = bp.url_input.chars().count();
                    bp.url_input_focused = false;
                    bp.url_selection = None;
                }
            }
            Key::Backspace => {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&pane_id) {
                    if bp.url_selection.is_some() {
                        bp.url_delete_selection();
                    } else if bp.url_input_cursor > 0 {
                        bp.url_input_cursor -= 1;
                        let byte_off = bp.cursor_byte_offset();
                        bp.url_input.remove(byte_off);
                    }
                }
            }
            Key::Delete => {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&pane_id) {
                    if bp.url_selection.is_some() {
                        bp.url_delete_selection();
                    } else if bp.url_input_cursor < bp.url_input_char_len() {
                        let byte_off = bp.cursor_byte_offset();
                        bp.url_input.remove(byte_off);
                    }
                }
            }
            Key::Left => {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&pane_id) {
                    if modifiers.meta {
                        // Cmd+Left: move to start
                        bp.url_input_cursor = 0;
                    } else if let Some((s, e)) = bp.url_selection {
                        // Arrow clears selection, cursor goes to start
                        bp.url_input_cursor = s.min(e);
                    } else if bp.url_input_cursor > 0 {
                        bp.url_input_cursor -= 1;
                    }
                    bp.url_selection = None;
                }
            }
            Key::Right => {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&pane_id) {
                    if modifiers.meta {
                        // Cmd+Right: move to end
                        bp.url_input_cursor = bp.url_input_char_len();
                    } else if let Some((s, e)) = bp.url_selection {
                        bp.url_input_cursor = s.max(e);
                    } else if bp.url_input_cursor < bp.url_input_char_len() {
                        bp.url_input_cursor += 1;
                    }
                    bp.url_selection = None;
                }
            }
            Key::Char(ch) => {
                if !modifiers.ctrl && !modifiers.meta {
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&pane_id) {
                        bp.url_delete_selection();
                        let byte_off = bp.cursor_byte_offset();
                        bp.url_input.insert(byte_off, ch);
                        bp.url_input_cursor += 1;
                    }
                }
            }
            _ => {}
        }
        self.cache.invalidate_chrome();
    }

    pub(super) fn handle_search_bar_key(
        &mut self,
        search_pane_id: tide_core::PaneId,
        key: Key,
        modifiers: &Modifiers,
    ) {
        if matches!(key, Key::Char('f') | Key::Char('F'))
            && (modifiers.meta || modifiers.ctrl)
            && !(modifiers.meta && modifiers.ctrl)
        {
            match self.panes.get_mut(&search_pane_id) {
                Some(PaneKind::Terminal(pane)) => {
                    pane.search = None;
                }
                Some(PaneKind::Editor(pane)) => {
                    pane.search = None;
                }
                Some(PaneKind::Browser(bp)) => {
                    if let Some(ref wv) = bp.webview {
                        wv.clear_find();
                    }
                    bp.search = None;
                }
                Some(PaneKind::Diff(_)) | Some(PaneKind::Launcher(_)) => {}
                None => {}
            }
            self.focus.search_focus = None;
            return;
        }

        match key {
            Key::Escape => {
                match self.panes.get_mut(&search_pane_id) {
                    Some(PaneKind::Terminal(pane)) => {
                        pane.search = None;
                    }
                    Some(PaneKind::Editor(pane)) => {
                        pane.search = None;
                    }
                    Some(PaneKind::Browser(bp)) => {
                        if let Some(ref wv) = bp.webview {
                            wv.clear_find();
                        }
                        bp.search = None;
                    }
                    Some(PaneKind::Diff(_)) | Some(PaneKind::Launcher(_)) => {}
                    None => {}
                }
                self.focus.search_focus = None;
            }
            Key::Enter => {
                if modifiers.shift {
                    self.search_prev_match(search_pane_id);
                } else {
                    self.search_next_match(search_pane_id);
                }
            }
            Key::Backspace => {
                self.search_bar_backspace(search_pane_id);
            }
            Key::Delete => {
                self.search_bar_delete(search_pane_id);
            }
            Key::Left => {
                self.search_bar_cursor_left(search_pane_id);
            }
            Key::Right => {
                self.search_bar_cursor_right(search_pane_id);
            }
            Key::Char(ch) => {
                if !modifiers.ctrl && !modifiers.meta {
                    self.search_bar_insert(search_pane_id, ch);
                }
            }
            _ => {}
        }
        self.cache.needs_redraw = true;
    }
}
