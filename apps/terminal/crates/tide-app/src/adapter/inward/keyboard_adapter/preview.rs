//! Focus-area-specific keyboard handling.
//!
//! Handles keyboard events for: file tree navigation, browser URL bar,
//! and search bar.

use crate::tide_core::{FileTreeSource, Key, Modifiers};

use super::KeyboardPorts;
use crate::pane::PaneKind;

pub(super) fn handle_file_tree_nav_key(
    ctx: &mut impl KeyboardPorts,
    key: Key,
    _modifiers: &Modifiers,
) {
    let entry_count = ctx
        .ft()
        .tree
        .as_ref()
        .map(|t| t.visible_entries().len())
        .unwrap_or(0);
    if entry_count == 0 {
        ctx.request_redraw();
        return;
    }

    match key {
        Key::Char('j') | Key::Down => {
            if ctx.ft().cursor + 1 < entry_count {
                ctx.ft_mut().cursor += 1;
                ctx.invalidate_chrome();
                ctx.auto_scroll_file_tree_cursor();
            }
        }
        Key::Char('k') | Key::Up => {
            if ctx.ft().cursor > 0 {
                ctx.ft_mut().cursor -= 1;
                ctx.invalidate_chrome();
                ctx.auto_scroll_file_tree_cursor();
            }
        }
        Key::Char('g') => {
            ctx.ft_mut().cursor = 0;
            ctx.invalidate_chrome();
            ctx.auto_scroll_file_tree_cursor();
        }
        Key::Char('G') => {
            if entry_count > 0 {
                ctx.ft_mut().cursor = entry_count - 1;
                ctx.invalidate_chrome();
                ctx.auto_scroll_file_tree_cursor();
            }
        }
        Key::Enter => {
            let action = {
                let ft = ctx.ft();
                if let Some(tree) = &ft.tree {
                    let entries = tree.visible_entries();
                    if let Some(entry) = entries.get(ft.cursor) {
                        if entry.entry.is_dir {
                            Some(FileTreeAction::Toggle(entry.entry.path.clone()))
                        } else {
                            Some(FileTreeAction::OpenFile(entry.entry.path.clone()))
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            };
            match action {
                Some(FileTreeAction::Toggle(path)) => {
                    if let Some(tree) = &mut ctx.ft_mut().tree {
                        tree.toggle(&path);
                    }
                    ctx.invalidate_chrome();
                }
                Some(FileTreeAction::OpenFile(path)) => {
                    ctx.open_editor_pane(path);
                }
                None => {}
            }
        }
        _ => {}
    }
    ctx.request_redraw();
}

enum FileTreeAction {
    Toggle(std::path::PathBuf),
    OpenFile(std::path::PathBuf),
}

pub(super) fn handle_browser_url_bar_key(
    ctx: &mut impl KeyboardPorts,
    pane_id: crate::tide_core::PaneId,
    key: Key,
    modifiers: &Modifiers,
) {
    match key {
        Key::Enter => {
            let url = if let Some(PaneKind::Browser(bp)) = ctx.pane(pane_id) {
                bp.url_input.trim().to_string()
            } else {
                return;
            };
            if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(pane_id) {
                bp.url_input_focused = false;
                bp.url_selection = None;
                bp.navigate(&url);
            }
        }
        Key::Escape => {
            if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(pane_id) {
                bp.url_input = bp.url.clone();
                bp.url_input_cursor = bp.url_input.chars().count();
                bp.url_input_focused = false;
                bp.url_selection = None;
            }
        }
        Key::Backspace => {
            if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(pane_id) {
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
            if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(pane_id) {
                if bp.url_selection.is_some() {
                    bp.url_delete_selection();
                } else if bp.url_input_cursor < bp.url_input_char_len() {
                    let byte_off = bp.cursor_byte_offset();
                    bp.url_input.remove(byte_off);
                }
            }
        }
        Key::Left => {
            if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(pane_id) {
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
            if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(pane_id) {
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
                if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(pane_id) {
                    bp.url_delete_selection();
                    let byte_off = bp.cursor_byte_offset();
                    bp.url_input.insert(byte_off, ch);
                    bp.url_input_cursor += 1;
                }
            }
        }
        _ => {}
    }
    ctx.invalidate_chrome();
}

pub(super) fn handle_search_bar_key(
    ctx: &mut impl KeyboardPorts,
    search_pane_id: crate::tide_core::PaneId,
    key: Key,
    modifiers: &Modifiers,
) -> bool {
    if matches!(key, Key::Char('f') | Key::Char('F'))
        && (modifiers.meta ^ modifiers.ctrl)
        && !modifiers.shift
        && !modifiers.alt
    {
        match ctx.pane_mut(search_pane_id) {
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
        ctx.set_search_focus(None);
        ctx.request_redraw();
        return true;
    }

    let handled = match key {
        Key::Escape => {
            match ctx.pane_mut(search_pane_id) {
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
            ctx.set_search_focus(None);
            true
        }
        Key::Enter => {
            if crate::adapter::inward::search_adapter::search_bar_is_editor_replacement_focused(
                ctx,
                search_pane_id,
            ) {
                if modifiers.meta {
                    crate::adapter::inward::search_adapter::search_bar_replace_all(
                        ctx,
                        search_pane_id,
                    );
                } else {
                    crate::adapter::inward::search_adapter::search_bar_replace_current(
                        ctx,
                        search_pane_id,
                    );
                }
            } else if modifiers.shift {
                crate::adapter::inward::search_adapter::search_prev_match(ctx, search_pane_id);
            } else {
                crate::adapter::inward::search_adapter::search_next_match(ctx, search_pane_id);
            }
            true
        }
        Key::Tab => {
            crate::adapter::inward::search_adapter::search_bar_toggle_replace_field(
                ctx,
                search_pane_id,
                modifiers.shift,
            );
            true
        }
        Key::Backspace => {
            crate::adapter::inward::search_adapter::search_bar_backspace(ctx, search_pane_id);
            true
        }
        Key::Delete => {
            crate::adapter::inward::search_adapter::search_bar_delete(ctx, search_pane_id);
            true
        }
        Key::Left => {
            crate::adapter::inward::search_adapter::search_bar_cursor_left(ctx, search_pane_id);
            true
        }
        Key::Right => {
            crate::adapter::inward::search_adapter::search_bar_cursor_right(ctx, search_pane_id);
            true
        }
        Key::Char(ch) => {
            if !modifiers.ctrl && !modifiers.meta {
                crate::adapter::inward::search_adapter::search_bar_insert(ctx, search_pane_id, ch);
                true
            } else {
                // Let global/app-level modified character shortcuts (for example
                // fullscreen) continue through the normal router.
                false
            }
        }
        _ => true,
    };
    if handled {
        ctx.request_redraw();
    }
    handled
}
