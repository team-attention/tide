// Completion popup and clipboard (copy/paste/find) operations.

use std::time::Instant;

use tide_core::{PaneId, TerminalBackend};

use crate::pane::PaneKind;
use crate::state::search::SearchState;
use crate::App;

impl App {
    /// Dismiss the completion popup on the given editor pane.
    pub(crate) fn dismiss_completion(&mut self, pane_id: PaneId) {
        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
            if pane.completion.is_some() {
                pane.completion = None;
                self.cache.invalidate_pane(pane_id);
            }
        }
    }

    /// Accept the selected completion item: replace the typed prefix with
    /// the completion text, then dismiss the popup.
    pub(crate) fn accept_completion(&mut self, pane_id: PaneId) {
        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
            if let Some(ref completion) = pane.completion {
                if let Some(text) = completion.insert_text() {
                    let prefix_len = completion.prefix.len();
                    let end = pane.editor.cursor_position();
                    let start = tide_editor::buffer::Position { line: end.line, col: end.col.saturating_sub(prefix_len) };
                    let new_pos = pane.editor.buffer.delete_range(start, end);
                    pane.editor.cursor.set_position(new_pos);
                    pane.editor.insert_text(&text);
                }
            }
            pane.completion = None;
            self.cache.invalidate_pane(pane_id);
        }
    }

    /// Handle GlobalAction::Paste for terminal, editor, and browser panes.
    pub(super) fn handle_paste(&mut self) {
        let target_id = match self.focus.focused {
            Some(id) => id,
            None => return,
        };
        match self.panes.get_mut(&target_id) {
            Some(PaneKind::Terminal(pane)) => {
                if let Ok(mut clipboard) = arboard::Clipboard::new() {
                    if let Ok(text) = clipboard.get_text() {
                        if !text.is_empty() {
                            if pane.backend.display_offset() > 0 {
                                pane.backend.request_scroll_to_bottom();
                            }
                            let bracketed = pane.backend.is_bracketed_paste_mode();
                            let mut data = Vec::new();
                            if bracketed {
                                data.extend_from_slice(b"\x1b[200~");
                                let safe = text.replace("\x1b[201~", "");
                                data.extend_from_slice(safe.as_bytes());
                            } else {
                                data.extend_from_slice(text.as_bytes());
                            }
                            if bracketed {
                                data.extend_from_slice(b"\x1b[201~");
                                data.extend_from_slice(b"\x1b[D\x1b[C");
                            }
                            pane.backend.write(&data);
                            self.input.input_just_sent = true;
                            self.input.input_sent_at = Some(Instant::now());
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

    /// Handle GlobalAction::Copy for terminal and editor panes.
    pub(super) fn handle_copy(&mut self) {
        let target_id = match self.focus.focused {
            Some(id) => id,
            None => return,
        };
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

    /// Handle GlobalAction::Find — open or focus a search bar.
    pub(super) fn handle_find(&mut self) {
        let target_id = match self.focus.focused {
            Some(id) => id,
            None => return,
        };
        let has_search = match self.panes.get(&target_id) {
            Some(PaneKind::Terminal(pane)) => pane.search.is_some(),
            Some(PaneKind::Editor(pane)) => pane.search.is_some(),
            Some(PaneKind::Browser(bp)) => bp.search.is_some(),
            _ => false,
        };
        if has_search {
            self.focus.search_focus = Some(target_id);
        } else {
            match self.panes.get_mut(&target_id) {
                Some(PaneKind::Terminal(pane)) => {
                    pane.search = Some(SearchState::new());
                }
                Some(PaneKind::Editor(pane)) => {
                    pane.search = Some(SearchState::new());
                }
                Some(PaneKind::Browser(bp)) => {
                    bp.search = Some(SearchState::new());
                }
                _ => {}
            }
            self.focus.search_focus = Some(target_id);
        }
    }
}
