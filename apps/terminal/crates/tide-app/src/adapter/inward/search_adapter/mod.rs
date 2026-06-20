use crate::tide_core::{PaneId, Rect, Vec2};

use crate::pane::PaneKind;
use crate::search;
use crate::state::search::{SearchField, SearchMatch};
use crate::theme::*;
use crate::AppCorePort;
use crate::FocusNavPort;
use crate::InputStatePort;
use crate::PaneAccessPort;

// ── Trait alias for search adapter ports ──

pub(crate) trait SearchPorts:
    AppCorePort + FocusNavPort + PaneAccessPort + InputStatePort
{
}
impl<T: AppCorePort + FocusNavPort + PaneAccessPort + InputStatePort> SearchPorts for T {}

// ── Search bar click handling ────────────────

/// Check if the current mouse position clicks on a visible search bar.
/// Returns true if the click was consumed.
pub(crate) fn check_search_bar_click(ctx: &mut impl SearchPorts) -> bool {
    let pos = ctx.last_cursor_pos();
    if !ctx.has_renderer() {
        return false;
    }

    // Check all visual pane rects
    let pane_rects: Vec<_> = ctx.visual_pane_rects().to_vec();
    for &(id, rect) in &pane_rects {
        if check_search_bar_at(ctx, pos, id, rect) {
            return true;
        }
    }

    // Click not on any search bar — clear search focus
    if ctx.search_focus().is_some() {
        ctx.set_search_focus(None);
    }

    false
}

fn check_search_bar_at(ctx: &mut impl SearchPorts, pos: Vec2, id: PaneId, rect: Rect) -> bool {
    let (has_search, replace_visible) = match ctx.pane(id) {
        Some(PaneKind::Terminal(p)) => (p.search.as_ref().is_some_and(|s| s.visible), false),
        Some(PaneKind::Editor(p)) => (
            p.search.as_ref().is_some_and(|s| s.visible),
            p.search
                .as_ref()
                .is_some_and(|s| s.visible && s.replace_visible),
        ),
        Some(PaneKind::Diff(_)) | Some(PaneKind::Browser(_)) | Some(PaneKind::Launcher(_)) => {
            (false, false)
        }
        None => (false, false),
    };
    if !has_search {
        return false;
    }

    let bar_w = SEARCH_BAR_WIDTH.min(rect.width - 16.0);
    if bar_w < 80.0 {
        return false;
    }
    let bar_h = if replace_visible {
        SEARCH_BAR_HEIGHT * 2.0
    } else {
        SEARCH_BAR_HEIGHT
    };
    let bar_x = rect.x + rect.width - bar_w - 8.0;
    let bar_y = rect.y + TAB_BAR_HEIGHT + 4.0;
    let bar_rect = Rect::new(bar_x, bar_y, bar_w, bar_h);

    if !bar_rect.contains(pos) {
        return false;
    }

    // Check close button (rightmost SEARCH_BAR_CLOSE_SIZE px)
    let close_x = bar_x + bar_w - SEARCH_BAR_CLOSE_SIZE;
    if pos.x >= close_x {
        // Close search
        match ctx.pane_mut(id) {
            Some(PaneKind::Terminal(pane)) => {
                pane.search = None;
            }
            Some(PaneKind::Editor(pane)) => {
                pane.search = None;
            }
            Some(PaneKind::Diff(_)) | Some(PaneKind::Browser(_)) | Some(PaneKind::Launcher(_)) => {}
            None => {}
        }
        if ctx.search_focus() == Some(id) {
            ctx.set_search_focus(None);
        }
    } else {
        // Focus the search bar
        ctx.set_search_focus(Some(id));
        if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(id) {
            if let Some(ref mut search) = pane.search {
                if replace_visible && pos.y >= bar_y + SEARCH_BAR_HEIGHT {
                    search.focus_replacement();
                } else {
                    search.focus_query();
                }
            }
        }
    }

    true
}

// ── Search bar helpers ──────────────────────

fn editor_visible_rows(ctx: &impl AppCorePort, pane_id: PaneId) -> usize {
    let cs = ctx.cell_size();
    if let Some(&(_, rect)) = ctx
        .visual_pane_rects()
        .iter()
        .find(|(id, _)| *id == pane_id)
    {
        return ((rect.height - TAB_BAR_HEIGHT - PANE_PADDING) / cs.height).floor() as usize;
    }
    30
}

fn editor_visible_cols(ctx: &impl AppCorePort, pane_id: PaneId) -> usize {
    let cs = ctx.cell_size();
    let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cs.width;
    if let Some(&(_, rect)) = ctx
        .visual_pane_rects()
        .iter()
        .find(|(id, _)| *id == pane_id)
    {
        let cw = rect.width - 2.0 * PANE_PADDING - 2.0 * gutter_width;
        return (cw / cs.width).floor().max(1.0) as usize;
    }
    80
}

pub(crate) fn search_bar_insert(ctx: &mut impl SearchPorts, pane_id: PaneId, ch: char) {
    let mut query_changed = false;
    match ctx.pane_mut(pane_id) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(ref mut s) = pane.search {
                s.input.insert_char(ch);
                query_changed = true;
            }
        }
        Some(PaneKind::Editor(pane)) => {
            if let Some(ref mut s) = pane.search {
                let editing_query = s.active_field == SearchField::Query;
                s.active_input_mut().insert_char(ch);
                query_changed = editing_query;
            }
        }
        Some(PaneKind::Browser(bp)) => {
            if let Some(ref mut s) = bp.search {
                s.input.insert_char(ch);
                let query = s.input.text.clone();
                if let Some(ref wv) = bp.webview {
                    wv.find_string(&query, true);
                }
            }
            return;
        }
        Some(PaneKind::Diff(_)) | Some(PaneKind::Launcher(_)) => return,
        None => return,
    }
    if query_changed {
        execute_search(ctx, pane_id);
        search_scroll_to_current(ctx, pane_id);
    }
}

pub(crate) fn search_bar_backspace(ctx: &mut impl SearchPorts, pane_id: PaneId) {
    let mut query_changed = false;
    match ctx.pane_mut(pane_id) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(ref mut s) = pane.search {
                s.input.backspace();
                query_changed = true;
            }
        }
        Some(PaneKind::Editor(pane)) => {
            if let Some(ref mut s) = pane.search {
                let editing_query = s.active_field == SearchField::Query;
                s.active_input_mut().backspace();
                query_changed = editing_query;
            }
        }
        Some(PaneKind::Browser(bp)) => {
            if let Some(ref mut s) = bp.search {
                s.input.backspace();
                let query = s.input.text.clone();
                if let Some(ref wv) = bp.webview {
                    if query.is_empty() {
                        wv.clear_find();
                    } else {
                        wv.find_string(&query, true);
                    }
                }
            }
            return;
        }
        Some(PaneKind::Diff(_)) | Some(PaneKind::Launcher(_)) => return,
        None => return,
    }
    if query_changed {
        execute_search(ctx, pane_id);
        search_scroll_to_current(ctx, pane_id);
    }
}

pub(crate) fn search_bar_delete(ctx: &mut impl SearchPorts, pane_id: PaneId) {
    let mut query_changed = false;
    match ctx.pane_mut(pane_id) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(ref mut s) = pane.search {
                s.input.delete_char();
                query_changed = true;
            }
        }
        Some(PaneKind::Editor(pane)) => {
            if let Some(ref mut s) = pane.search {
                let editing_query = s.active_field == SearchField::Query;
                s.active_input_mut().delete_char();
                query_changed = editing_query;
            }
        }
        Some(PaneKind::Browser(bp)) => {
            if let Some(ref mut s) = bp.search {
                s.input.delete_char();
                let query = s.input.text.clone();
                if let Some(ref wv) = bp.webview {
                    if query.is_empty() {
                        wv.clear_find();
                    } else {
                        wv.find_string(&query, true);
                    }
                }
            }
            return;
        }
        Some(PaneKind::Diff(_)) | Some(PaneKind::Launcher(_)) => return,
        None => return,
    }
    if query_changed {
        execute_search(ctx, pane_id);
        search_scroll_to_current(ctx, pane_id);
    }
}

pub(crate) fn search_bar_cursor_left(ctx: &mut impl PaneAccessPort, pane_id: PaneId) {
    match ctx.pane_mut(pane_id) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(ref mut s) = pane.search {
                s.input.move_cursor_left();
            }
        }
        Some(PaneKind::Editor(pane)) => {
            if let Some(ref mut s) = pane.search {
                s.active_input_mut().move_cursor_left();
            }
        }
        Some(PaneKind::Browser(bp)) => {
            if let Some(ref mut s) = bp.search {
                s.input.move_cursor_left();
            }
        }
        Some(PaneKind::Diff(_)) | Some(PaneKind::Launcher(_)) => {}
        None => {}
    }
}

pub(crate) fn search_bar_cursor_right(ctx: &mut impl PaneAccessPort, pane_id: PaneId) {
    match ctx.pane_mut(pane_id) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(ref mut s) = pane.search {
                s.input.move_cursor_right();
            }
        }
        Some(PaneKind::Editor(pane)) => {
            if let Some(ref mut s) = pane.search {
                s.active_input_mut().move_cursor_right();
            }
        }
        Some(PaneKind::Browser(bp)) => {
            if let Some(ref mut s) = bp.search {
                s.input.move_cursor_right();
            }
        }
        Some(PaneKind::Diff(_)) | Some(PaneKind::Launcher(_)) => {}
        None => {}
    }
}

pub(crate) fn search_bar_toggle_replace_field(
    ctx: &mut impl PaneAccessPort,
    pane_id: PaneId,
    reverse: bool,
) {
    let Some(PaneKind::Editor(pane)) = ctx.pane_mut(pane_id) else {
        return;
    };
    let Some(ref mut search) = pane.search else {
        return;
    };

    if reverse || search.is_replacement_focused() {
        search.focus_query();
    } else {
        search.focus_replacement();
    }
}

pub(crate) fn search_bar_is_editor_replacement_focused(
    ctx: &impl PaneAccessPort,
    pane_id: PaneId,
) -> bool {
    matches!(
        ctx.pane(pane_id),
        Some(PaneKind::Editor(pane))
            if pane
                .search
                .as_ref()
                .is_some_and(|search| search.is_replacement_focused())
    )
}

fn editor_byte_col_for_char_col(line: &str, char_col: usize) -> usize {
    line.char_indices()
        .nth(char_col)
        .map(|(idx, _)| idx)
        .unwrap_or(line.len())
}

fn replace_editor_match(
    editor: &mut crate::pane::editor::EditorPane,
    search_match: &SearchMatch,
    replacement: &str,
) -> bool {
    let Some(line_text) = editor
        .editor
        .buffer
        .line(search_match.line)
        .map(str::to_string)
    else {
        return false;
    };
    let start_col = editor_byte_col_for_char_col(&line_text, search_match.col);
    let end_col = editor_byte_col_for_char_col(&line_text, search_match.col + search_match.len);
    let start = crate::tide_editor::EditorPosition {
        line: search_match.line,
        col: start_col,
    };
    let end = crate::tide_editor::EditorPosition {
        line: search_match.line,
        col: end_col,
    };
    let replace_start = editor.editor.buffer.delete_range(start, end);
    let replace_end = editor.editor.buffer.insert_text(replace_start, replacement);
    editor.editor.cursor.set_position(replace_end);
    editor.editor.cursor.desired_col = replace_end.col;
    editor.selection = None;
    true
}

pub(crate) fn search_bar_replace_current(ctx: &mut impl SearchPorts, pane_id: PaneId) {
    let mut replaced = false;
    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(pane_id) {
        if pane.preview_mode {
            return;
        }
        let (replacement, target_match) = {
            let Some(ref mut search) = pane.search else {
                return;
            };
            if search.matches.is_empty() && !search.input.is_empty() {
                search::execute_search_editor(search, &pane.editor.buffer.lines);
            }
            (
                search.replacement.text.clone(),
                search
                    .current
                    .and_then(|index| search.matches.get(index))
                    .cloned(),
            )
        };

        if let Some(search_match) = target_match {
            replaced = replace_editor_match(pane, &search_match, &replacement);
        }

        if replaced {
            if let Some(ref mut search) = pane.search {
                search::execute_search_editor(search, &pane.editor.buffer.lines);
                search.focus_replacement();
            }
        }
    }

    if replaced {
        search_scroll_to_current(ctx, pane_id);
    }
}

pub(crate) fn search_bar_replace_all(ctx: &mut impl SearchPorts, pane_id: PaneId) {
    let mut replaced = false;
    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(pane_id) {
        if pane.preview_mode {
            return;
        }
        let (replacement, matches) = {
            let Some(ref mut search) = pane.search else {
                return;
            };
            if search.matches.is_empty() && !search.input.is_empty() {
                search::execute_search_editor(search, &pane.editor.buffer.lines);
            }
            (search.replacement.text.clone(), search.matches.clone())
        };

        for search_match in matches.iter().rev() {
            replaced |= replace_editor_match(pane, search_match, &replacement);
        }

        if replaced {
            if let Some(ref mut search) = pane.search {
                search::execute_search_editor(search, &pane.editor.buffer.lines);
                search.focus_replacement();
            }
        }
    }

    if replaced {
        search_scroll_to_current(ctx, pane_id);
    }
}

fn execute_search(ctx: &mut impl PaneAccessPort, pane_id: PaneId) {
    match ctx.pane_mut(pane_id) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(ref mut s) = pane.search {
                search::execute_search_terminal(s, &pane.backend);
            }
        }
        Some(PaneKind::Editor(pane)) => {
            if pane.preview_mode {
                pane.execute_preview_search();
            } else {
                if let Some(ref mut s) = pane.search {
                    search::execute_search_editor(s, &pane.editor.buffer.lines);
                }
            }
        }
        Some(PaneKind::Diff(_)) | Some(PaneKind::Browser(_)) | Some(PaneKind::Launcher(_)) => {}
        None => {}
    }
}

/// Scroll the viewport to show the current match (without advancing).
fn search_scroll_to_current(ctx: &mut impl SearchPorts, pane_id: PaneId) {
    let visible_rows = editor_visible_rows(ctx, pane_id);
    let visible_cols = editor_visible_cols(ctx, pane_id);
    match ctx.pane_mut(pane_id) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(ref s) = pane.search {
                if let Some(idx) = s.current {
                    let match_line = s.matches[idx].line;
                    let history_size = pane.backend.history_size();
                    let rows = pane.backend.current_rows() as usize;
                    let screen_start = history_size + rows;
                    if match_line < screen_start {
                        let desired_offset = screen_start
                            .saturating_sub(match_line)
                            .saturating_sub(rows / 2);
                        let current_offset = pane.backend.display_offset();
                        let delta = desired_offset as i32 - current_offset as i32;
                        if delta != 0 {
                            pane.backend.scroll_display(delta);
                        }
                    }
                }
            }
        }
        Some(PaneKind::Editor(pane)) => {
            let match_info = pane.search.as_ref().and_then(|s| {
                s.current
                    .map(|idx| (s.matches[idx].line, s.matches[idx].col, s.matches[idx].len))
            });
            if let Some((m_line, m_col, m_len)) = match_info {
                if pane.preview_mode {
                    let line_count = pane.preview_line_count();
                    let max_scroll = line_count.saturating_sub(visible_rows);
                    pane.preview_scroll = m_line.saturating_sub(visible_rows / 2).min(max_scroll);
                } else if pane.effective_soft_wrap() {
                    let visual_row = pane.soft_wrap_visual_row_of_line(m_line).unwrap_or(m_line);
                    pane.center_soft_wrap_visual_row(visual_row, visible_rows);
                } else {
                    let line_count = pane.editor.buffer.line_count();
                    let max_scroll = line_count.saturating_sub(visible_rows);
                    let offset = m_line.saturating_sub(visible_rows / 2).min(max_scroll);
                    pane.editor.set_scroll_offset(offset);
                    let h_scroll = pane.editor.h_scroll_offset();
                    if m_col < h_scroll {
                        pane.editor.set_h_scroll_offset(m_col.saturating_sub(4));
                    } else if m_col + m_len > h_scroll + visible_cols {
                        pane.editor.set_h_scroll_offset(
                            (m_col + m_len)
                                .saturating_sub(visible_cols)
                                .saturating_add(4),
                        );
                    }
                }
            }
        }
        Some(PaneKind::Diff(_)) | Some(PaneKind::Browser(_)) | Some(PaneKind::Launcher(_)) => {}
        None => {}
    }
}

pub(crate) fn search_next_match(ctx: &mut impl SearchPorts, pane_id: PaneId) {
    let visible_rows = editor_visible_rows(ctx, pane_id);
    let visible_cols = editor_visible_cols(ctx, pane_id);
    match ctx.pane_mut(pane_id) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(ref mut s) = pane.search {
                s.next_match();
                if let Some(idx) = s.current {
                    let match_line = s.matches[idx].line;
                    let history_size = pane.backend.history_size();
                    let rows = pane.backend.current_rows() as usize;
                    let screen_start = history_size + rows;
                    if match_line < screen_start {
                        let desired_offset = screen_start
                            .saturating_sub(match_line)
                            .saturating_sub(rows / 2);
                        let current_offset = pane.backend.display_offset();
                        let delta = desired_offset as i32 - current_offset as i32;
                        if delta != 0 {
                            pane.backend.scroll_display(delta);
                        }
                    }
                }
            }
        }
        Some(PaneKind::Editor(pane)) => {
            let match_info = if let Some(ref mut s) = pane.search {
                s.next_match();
                s.current
                    .map(|idx| (s.matches[idx].line, s.matches[idx].col, s.matches[idx].len))
            } else {
                None
            };
            if let Some((m_line, m_col, m_len)) = match_info {
                if pane.preview_mode {
                    let line_count = pane.preview_line_count();
                    let max_scroll = line_count.saturating_sub(visible_rows);
                    pane.preview_scroll = m_line.saturating_sub(visible_rows / 2).min(max_scroll);
                } else if pane.effective_soft_wrap() {
                    let visual_row = pane.soft_wrap_visual_row_of_line(m_line).unwrap_or(m_line);
                    pane.center_soft_wrap_visual_row(visual_row, visible_rows);
                } else {
                    let line_count = pane.editor.buffer.line_count();
                    let max_scroll = line_count.saturating_sub(visible_rows);
                    let offset = m_line.saturating_sub(visible_rows / 2).min(max_scroll);
                    pane.editor.set_scroll_offset(offset);
                    let h_scroll = pane.editor.h_scroll_offset();
                    if m_col < h_scroll {
                        pane.editor.set_h_scroll_offset(m_col.saturating_sub(4));
                    } else if m_col + m_len > h_scroll + visible_cols {
                        pane.editor.set_h_scroll_offset(
                            (m_col + m_len)
                                .saturating_sub(visible_cols)
                                .saturating_add(4),
                        );
                    }
                }
            }
        }
        Some(PaneKind::Browser(bp)) => {
            if let Some(ref s) = bp.search {
                let query = s.input.text.clone();
                if !query.is_empty() {
                    if let Some(ref wv) = bp.webview {
                        wv.find_string(&query, true);
                    }
                }
            }
        }
        Some(PaneKind::Diff(_)) | Some(PaneKind::Launcher(_)) => {}
        None => {}
    }
}

pub(crate) fn search_prev_match(ctx: &mut impl SearchPorts, pane_id: PaneId) {
    let visible_rows = editor_visible_rows(ctx, pane_id);
    let visible_cols = editor_visible_cols(ctx, pane_id);
    match ctx.pane_mut(pane_id) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(ref mut s) = pane.search {
                s.prev_match();
                if let Some(idx) = s.current {
                    let match_line = s.matches[idx].line;
                    let history_size = pane.backend.history_size();
                    let rows = pane.backend.current_rows() as usize;
                    let screen_start = history_size + rows;
                    if match_line < screen_start {
                        let desired_offset = screen_start
                            .saturating_sub(match_line)
                            .saturating_sub(rows / 2);
                        let current_offset = pane.backend.display_offset();
                        let delta = desired_offset as i32 - current_offset as i32;
                        if delta != 0 {
                            pane.backend.scroll_display(delta);
                        }
                    }
                }
            }
        }
        Some(PaneKind::Editor(pane)) => {
            let match_info = if let Some(ref mut s) = pane.search {
                s.prev_match();
                s.current
                    .map(|idx| (s.matches[idx].line, s.matches[idx].col, s.matches[idx].len))
            } else {
                None
            };
            if let Some((m_line, m_col, m_len)) = match_info {
                if pane.preview_mode {
                    let line_count = pane.preview_line_count();
                    let max_scroll = line_count.saturating_sub(visible_rows);
                    pane.preview_scroll = m_line.saturating_sub(visible_rows / 2).min(max_scroll);
                } else if pane.effective_soft_wrap() {
                    let visual_row = pane.soft_wrap_visual_row_of_line(m_line).unwrap_or(m_line);
                    pane.center_soft_wrap_visual_row(visual_row, visible_rows);
                } else {
                    let line_count = pane.editor.buffer.line_count();
                    let max_scroll = line_count.saturating_sub(visible_rows);
                    let offset = m_line.saturating_sub(visible_rows / 2).min(max_scroll);
                    pane.editor.set_scroll_offset(offset);
                    let h_scroll = pane.editor.h_scroll_offset();
                    if m_col < h_scroll {
                        pane.editor.set_h_scroll_offset(m_col.saturating_sub(4));
                    } else if m_col + m_len > h_scroll + visible_cols {
                        pane.editor.set_h_scroll_offset(
                            (m_col + m_len)
                                .saturating_sub(visible_cols)
                                .saturating_add(4),
                        );
                    }
                }
            }
        }
        Some(PaneKind::Browser(bp)) => {
            if let Some(ref s) = bp.search {
                let query = s.input.text.clone();
                if !query.is_empty() {
                    if let Some(ref wv) = bp.webview {
                        wv.find_string(&query, false);
                    }
                }
            }
        }
        Some(PaneKind::Diff(_)) | Some(PaneKind::Launcher(_)) => {}
        None => {}
    }
}
