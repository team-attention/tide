//! Keyboard event handling.
//!
//! With native IME, the platform calls ImeCommit for all committed text.
//! KeyDown only fires for keys NOT consumed by the IME (hotkeys, control keys).

mod modal;
mod preview;

use crate::tide_core::{InputEvent, Key, Modifiers};

use crate::state::drag_types::PaneDragState;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::App;
use crate::ClipboardSearchPort;
use crate::ActionPort;
use crate::PaneLifecyclePort;

impl App {
    pub(crate) fn handle_key_down(
        &mut self,
        key: Key,
        modifiers: Modifiers,
        chars: Option<String>,
    ) {
        // Cancel pane drag on Escape
        if !matches!(self.interaction.pane_drag, PaneDragState::Idle) {
            if matches!(key, Key::Escape) {
                self.interaction.pane_drag = PaneDragState::Idle;
                self.cache.needs_redraw = true;
                return;
            }
        }

        // If the key produced text and no command modifiers are held,
        // route via the text input system.
        // Exception 1: navigation keys (arrows, Escape, Enter, Tab, Backspace, Delete)
        // should not be routed as text even if the IME produced chars alongside them
        // (e.g., Korean IME commits composition on arrow press).
        // Exception 2: skip text routing when the active editor is in preview mode
        // AND no search bar is active, so keys like j/k/d/u fall through to
        // the preview scroll handler.
        let is_navigation_key = matches!(key,
            Key::Up | Key::Down | Key::Left | Key::Right |
            Key::Escape | Key::Enter | Key::Tab | Key::Backspace | Key::Delete |
            Key::Home | Key::End | Key::PageUp | Key::PageDown
        );
        if let Some(ref text) = chars {
            if !is_navigation_key && !modifiers.meta && !modifiers.ctrl && !modifiers.alt {
                let in_preview = self.focus.search_focus.is_none()
                    && self.focus.focused
                        .and_then(|id| self.panes.get(&id))
                        .map(|p| matches!(p, PaneKind::Editor(ep) if ep.preview_mode))
                        .unwrap_or(false);
                if !in_preview {
                    self.send_text_to_target(text);
                    self.cache.needs_redraw = true;
                    return;
                }
            }
        }

        // Cmd+Q → quit
        if matches!(key, Key::Char('q'))
            && modifiers.meta
            && !modifiers.ctrl
            && !modifiers.shift
            && !modifiers.alt
        {
            self.save_full_session();
            self.ports.persistence.delete_running_marker();
            std::process::exit(0);
        }

        // Config page interception
        if self.modal.config_page.is_some() {
            self.handle_config_page_key(key, &modifiers);
            return;
        }

        // Context menu interception
        if self.modal.context_menu.is_some() {
            self.handle_context_menu_key(key);
            return;
        }

        // File tree inline rename interception
        if self.modal.file_tree_rename.is_some() {
            self.handle_file_tree_rename_key(key, &modifiers);
            return;
        }

        // Git switcher popup interception
        if self.modal.git_switcher.is_some() {
            self.handle_git_switcher_key(key, &modifiers);
            return;
        }

        // File finder interception
        if self.modal.file_finder.is_some() {
            self.handle_file_finder_key(key, &modifiers);
            return;
        }

        // Save-as input interception
        if self.modal.save_as_input.is_some() {
            self.handle_save_as_key(key, &modifiers);
            return;
        }

        // Branch cleanup bar interception
        if let Some(ref bc) = self.modal.branch_cleanup {
            // Safety: clear stale state if the pane no longer exists
            if !self.panes.contains_key(&bc.pane_id) {
                self.modal.branch_cleanup = None;
            } else {
                match key {
                    Key::Escape => {
                        self.cancel_branch_cleanup();
                    }
                    Key::Enter => {
                        // Enter → Keep (safe default: close without deleting)
                        self.confirm_branch_keep();
                    }
                    _ => {}
                }
                self.cache.needs_redraw = true;
                return;
            }
        }

        // Save confirm bar interception
        if self.modal.save_confirm.is_some() {
            if matches!(key, Key::Escape) {
                self.cancel_save_confirm();
            }
            self.cache.needs_redraw = true;
            return;
        }

        // Completion popup interception: intercept navigation/accept/dismiss keys
        // when the focused editor has an active completion popup.
        if let Some(focused_id) = self.focus.focused {
            if let Some(PaneKind::Editor(pane)) = self.panes.get(&focused_id) {
                if pane.completion.is_some() {
                    match key {
                        Key::Down => {
                            if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&focused_id) {
                                if let Some(ref mut cs) = pane.completion {
                                    cs.select_next();
                                }
                            }
                            self.cache.invalidate_pane(focused_id);
                            self.cache.needs_redraw = true;
                            return;
                        }
                        Key::Up => {
                            if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&focused_id) {
                                if let Some(ref mut cs) = pane.completion {
                                    cs.select_prev();
                                }
                            }
                            self.cache.invalidate_pane(focused_id);
                            self.cache.needs_redraw = true;
                            return;
                        }
                        Key::Tab | Key::Enter => {
                            self.accept_completion(focused_id);
                            self.cache.needs_redraw = true;
                            return;
                        }
                        Key::Escape => {
                            self.dismiss_completion(focused_id);
                            self.cache.needs_redraw = true;
                            return;
                        }
                        Key::Left | Key::Right => {
                            // Cursor movement dismisses completion
                            self.dismiss_completion(focused_id);
                            // Fall through to normal handling
                        }
                        // Backspace shortens the prefix and re-filters (BR-11a).
                        // If prefix becomes empty, dismiss the popup.
                        Key::Backspace => {
                            if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&focused_id) {
                                let should_dismiss = if let Some(ref mut cs) = pane.completion {
                                    cs.prefix.pop();
                                    if cs.prefix.is_empty() {
                                        true
                                    } else {
                                        cs.apply_filter();
                                        cs.is_empty()
                                    }
                                } else {
                                    false
                                };
                                if should_dismiss {
                                    pane.completion = None;
                                }
                            }
                            self.cache.invalidate_pane(focused_id);
                            // Fall through to normal backspace handling
                        }
                        // Printable char keys fall through —
                        // text_routing handles filtering.
                        Key::Char(_) => {}
                        _ => {
                            // Other non-text keys dismiss completion
                            // and fall through to normal handling
                            self.dismiss_completion(focused_id);
                        }
                    }
                }
            }
        }

        // Ctrl+Space: explicit completion trigger
        if modifiers.ctrl && !modifiers.meta && !modifiers.alt && matches!(key, Key::Char(' ')) {
            if let Some(focused_id) = self.focus.focused {
                if matches!(self.panes.get(&focused_id), Some(PaneKind::Editor(_))) {
                    self.trigger_completion_explicit(focused_id);
                    self.cache.needs_redraw = true;
                    return;
                }
            }
        }

        // FocusArea interception
        match self.focus.focus_area {
            FocusArea::FileTree => {
                if matches!(key, Key::Enter) && modifiers.meta {
                    self.handle_file_tree_nav_key(key, &modifiers);
                    return;
                }
                if modifiers.meta || (modifiers.ctrl && modifiers.shift) {
                    let input = InputEvent::KeyPress { key, modifiers };
                    let action = self.router.process(input, &self.pane_rects);
                    if !matches!(action, crate::tide_input::Action::RouteToPane(_)) {
                        self.handle_action(action, Some(input));
                    }
                    self.cache.needs_redraw = true;
                    return;
                }
                self.handle_file_tree_nav_key(key, &modifiers);
                return;
            }
            FocusArea::Stage | FocusArea::Dock => {
                // Browser URL bar keyboard handling
                if let Some(focused_id) = self.focus.focused {
                    let is_browser_url_focused = matches!(
                        self.panes.get(&focused_id),
                        Some(PaneKind::Browser(bp)) if bp.url_input_focused
                    );
                    if is_browser_url_focused {
                        // URL bar editing shortcuts (Cmd+A/C/V/X) must be
                        // handled here, before the global hotkey router
                        // intercepts them as Copy/Paste actions.
                        if modifiers.meta && !modifiers.ctrl && !modifiers.alt {
                            match key {
                                Key::Char('a') | Key::Char('A') => {
                                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused_id) {
                                        let len = bp.url_input_char_len();
                                        bp.url_selection = Some((0, len));
                                        bp.url_input_cursor = len;
                                    }
                                    self.cache.invalidate_chrome();
                                    return;
                                }
                                Key::Char('c') | Key::Char('C') => {
                                    if let Some(PaneKind::Browser(bp)) = self.panes.get(&focused_id) {
                                        let text = bp.url_selected_text()
                                            .unwrap_or_else(|| bp.url_input.clone());
                                        if !text.is_empty() {
                                            let _ = self.ports.clipboard.set_text(&text);
                                        }
                                    }
                                    return;
                                }
                                Key::Char('x') | Key::Char('X') => {
                                    let text = self.panes.get(&focused_id).and_then(|p| {
                                        if let PaneKind::Browser(bp) = p { bp.url_selected_text() } else { None }
                                    });
                                    if let Some(text) = text {
                                        let _ = self.ports.clipboard.set_text(&text);
                                        if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused_id) {
                                            bp.url_delete_selection();
                                        }
                                    }
                                    self.cache.invalidate_chrome();
                                    return;
                                }
                                Key::Char('v') | Key::Char('V') => {
                                    if let Ok(text) = self.ports.clipboard.get_text() {
                                        let text: String = text.chars()
                                            .take_while(|c| *c != '\n' && *c != '\r')
                                            .collect();
                                        if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused_id) {
                                            bp.url_delete_selection();
                                            let byte_off = bp.cursor_byte_offset();
                                            bp.url_input.insert_str(byte_off, &text);
                                            bp.url_input_cursor += text.chars().count();
                                        }
                                    }
                                    self.cache.invalidate_chrome();
                                    return;
                                }
                                _ => {}
                            }
                        }
                        // Global hotkeys take priority over URL bar input
                        if modifiers.meta || (modifiers.ctrl && modifiers.shift) {
                            let input = InputEvent::KeyPress { key, modifiers };
                            let action = self.router.process(input, &self.pane_rects);
                            if !matches!(action, crate::tide_input::Action::RouteToPane(_)) {
                                self.handle_action(action, Some(input));
                                self.cache.needs_redraw = true;
                                return;
                            }
                        }
                        self.handle_browser_url_bar_key(focused_id, key, &modifiers);
                        return;
                    }
                    if let Some(PaneKind::Browser(_)) = self.panes.get(&focused_id) {
                        // Cmd+L → focus URL bar with select-all
                        if modifiers.meta && matches!(key, Key::Char('l') | Key::Char('L')) {
                            if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused_id) {
                                bp.url_input_focused = true;
                                bp.url_input = bp.url.clone();
                                let len = bp.url_input.chars().count();
                                bp.url_input_cursor = len;
                                bp.url_selection = Some((0, len));
                                self.cache.invalidate_chrome();
                            }
                            return;
                        }
                    }
                }

                // Search bar interception (before routing to pane)
                if let Some(search_pane_id) = self.focus.search_focus {
                    self.handle_search_bar_key(search_pane_id, key, &modifiers);
                    return;
                }

                // Fall through to normal routing
            }
        }

        let input = InputEvent::KeyPress { key, modifiers };
        let action = self.router.process(input, &self.pane_rects);
        self.handle_action(action, Some(input));
        self.cache.needs_redraw = true;
    }
}
