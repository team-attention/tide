use unicode_width::UnicodeWidthChar;

use crate::tide_core::{Rect, Renderer, TerminalBackend};

use crate::pane::{terminal_grid_cols, terminal_grid_origin, PaneKind};
use crate::theme::*;
use crate::App;

use super::bar_offset_for;

/// Render cursor, selection highlights, search highlights, URL underlines, and scrollbars
/// for all panes (both tree panes and the active panel editor).
pub(crate) fn render_cursor_and_highlights(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    visual_pane_rects: &[(u64, Rect)],
    focused: Option<u64>,
    search_focus: Option<u64>,
) {
    // Compute the effective IME target and preedit width for editor cursor offset
    let ime_target = app.effective_ime_target();
    let preedit_width_cells: usize = if !app.ime.preedit.is_empty() {
        app.ime
            .preedit
            .chars()
            .map(|c| c.width().unwrap_or(1))
            .sum()
    } else {
        0
    };

    // Always render cursor (overlay layer) — cursor blinks/moves independently
    for &(id, rect) in visual_pane_rects {
        let pane_bar = bar_offset_for(id, &app.panes, &app.modal.save_confirm);
        match app.panes.get(&id) {
            Some(PaneKind::Terminal(pane)) => {
                let inner = crate::pane::pane_content_rect(
                    rect,
                    terminal_content_top(renderer.cell_size().height) + pane_bar,
                );
                pane.render_graphics(inner, renderer);
                // Only render cursor on the focused pane (and hide when search bar is active
                // or IME preedit is composing — preedit overlay replaces the cursor).
                if focused == Some(id) && search_focus != Some(id) && app.ime.preedit.is_empty() {
                    pane.render_cursor(inner, renderer, p.cursor_accent);
                }
                // Render URL underlines when Cmd/Meta is held
                if app.window.modifiers.meta {
                    pane.render_url_underlines(inner, renderer, p.link_color);
                }
                // Render selection highlight
                if let Some(ref sel) = pane.selection {
                    let cell_size = renderer.cell_size();
                    let (start, end) = if sel.anchor <= sel.end {
                        (sel.anchor, sel.end)
                    } else {
                        (sel.end, sel.anchor)
                    };
                    // Skip rendering if anchor == end (no actual selection)
                    if start != end {
                        let sel_color = p.selection;
                        let grid = pane.backend.grid();
                        let max_rows = (inner.height / cell_size.height).ceil() as usize;
                        let max_cols = terminal_grid_cols(inner, cell_size);
                        let visible_rows = (grid.rows as usize).min(max_rows);
                        let visible_cols = (grid.cols as usize).min(max_cols);
                        // Selection coords are absolute; convert to screen-relative
                        // using display_offset, matching how search highlights work.
                        let history_size = pane.backend.history_size();
                        let display_offset = pane.backend.display_offset();
                        let visible_start = history_size.saturating_sub(display_offset);
                        let visible_end = visible_start + visible_rows;
                        let origin = terminal_grid_origin(inner);
                        // Clamp iteration to visible absolute row range
                        let row_lo = start.0.max(visible_start);
                        let row_hi = end.0.min(visible_end.saturating_sub(1));
                        for row in row_lo..=row_hi {
                            let col_start = if row == start.0 { start.1 } else { 0 };
                            let col_end = if row == end.0 { end.1 } else { visible_cols };
                            if col_start >= col_end {
                                continue;
                            }
                            let visual_row = row - visible_start;
                            let rx = origin.x + col_start as f32 * cell_size.width;
                            let ry = inner.y + visual_row as f32 * cell_size.height;
                            let rw = (col_end - col_start) as f32 * cell_size.width;
                            renderer.draw_rect(Rect::new(rx, ry, rw, cell_size.height), sel_color);
                        }
                    }
                }
                // Render terminal search highlights
                if let Some(ref search) = pane.search {
                    if search.visible && !search.input.is_empty() {
                        let cell_size = renderer.cell_size();
                        let history_size = pane.backend.history_size();
                        let display_offset = pane.backend.display_offset();
                        let grid = pane.backend.grid();
                        let screen_rows = grid.rows as usize;
                        let origin = terminal_grid_origin(inner);
                        // Visible absolute line range
                        let visible_start = history_size.saturating_sub(display_offset);
                        let visible_end = visible_start + screen_rows;
                        for (mi, m) in search.matches.iter().enumerate() {
                            if m.line < visible_start || m.line >= visible_end {
                                continue;
                            }
                            let visual_row = m.line - visible_start;
                            let rx = origin.x + m.col as f32 * cell_size.width;
                            let ry = inner.y + visual_row as f32 * cell_size.height;
                            let rw = m.len as f32 * cell_size.width;
                            let color = if search.current == Some(mi) {
                                p.search_current_bg
                            } else {
                                p.search_match_bg
                            };
                            renderer.draw_rect(Rect::new(rx, ry, rw, cell_size.height), color);
                        }
                    }
                }
            }
            Some(PaneKind::Editor(pane)) => {
                let inner =
                    pane.content_rect(rect, TAB_BAR_HEIGHT + pane_bar, renderer.cell_size());
                if pane.preview_mode {
                    // Render selection highlight in preview mode
                    if let Some(ref sel) = pane.selection {
                        render_preview_selection(pane, inner, renderer, p, sel);
                    }
                    // Render preview search highlights (matches are in preview-line coords)
                    if let Some(ref search) = pane.search {
                        render_preview_search_highlights(pane, inner, renderer, p, search);
                    }
                } else {
                    if focused == Some(id) && search_focus != Some(id) && app.timing.cursor_visible
                    {
                        let pw = if ime_target == Some(id) {
                            preedit_width_cells
                        } else {
                            0
                        };
                        pane.render_cursor(inner, renderer, p.cursor_accent, pw);
                    }
                    // Render editor selection highlight
                    if let Some(ref sel) = pane.selection {
                        render_editor_selection(pane, inner, renderer, p, sel);
                    }
                    // Render editor search highlights
                    if let Some(ref search) = pane.search {
                        render_editor_search_highlights(pane, inner, renderer, p, search);
                    }
                    // Matching bracket highlight
                    if focused == Some(id) {
                        render_bracket_highlight(pane, inner, renderer, p);
                    }
                }
                // Render editor scrollbar with search match markers
                let sb_hovered = matches!(app.interaction.hover_target, Some(crate::state::drag_types::HoverTarget::EditorScrollbar(hid)) if hid == id);
                pane.render_scrollbar(inner, renderer, pane.search.as_ref(), p, sb_hovered);
            }
            Some(PaneKind::Diff(dp)) => {
                let inner = crate::pane::pane_content_rect(rect, TAB_BAR_HEIGHT + pane_bar);
                if let Some(ref sel) = dp.selection {
                    render_diff_selection(dp, inner, renderer, p, sel);
                }
            }
            Some(PaneKind::Browser(_)) => {}
            Some(PaneKind::Launcher(_)) => {}
            None => {}
        }
    }
}

/// Render selection highlight for an editor pane.
fn render_editor_selection(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    sel: &crate::pane::Selection,
) {
    for rect in editor_selection_rects(pane, inner, renderer.cell_size(), sel) {
        let clipped = rect.clip_to(&inner);
        if clipped.width > 0.0 && clipped.height > 0.0 {
            renderer.draw_rect(clipped, p.selection);
        }
    }
}

pub(crate) fn editor_selection_rects(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    cell_size: crate::tide_core::Size,
    sel: &crate::pane::Selection,
) -> Vec<Rect> {
    let (start, end) = if sel.anchor <= sel.end {
        (sel.anchor, sel.end)
    } else {
        (sel.end, sel.anchor)
    };
    if start == end {
        return Vec::new();
    }

    if pane.effective_soft_wrap() {
        if pane.wrap_map().is_some() {
            let authoring = pane.authoring_rect(inner, cell_size);
            return soft_wrap_editor_selection_rects(pane, authoring, cell_size, start, end);
        }
    }

    let authoring = pane.authoring_rect(inner, cell_size);
    plain_editor_selection_rects(pane, authoring, cell_size, start, end)
}

fn plain_editor_selection_rects(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    cell_size: crate::tide_core::Size,
    start: (usize, usize),
    end: (usize, usize),
) -> Vec<Rect> {
    let mut rects = Vec::new();
    let scroll = pane.editor.scroll_offset();
    let h_scroll = pane.editor.h_scroll_offset();
    let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;
    let visible_rows = (inner.height / cell_size.height).ceil() as usize;
    let scrollbar_reserved = if pane.needs_scrollbar(inner, cell_size.height) {
        SCROLLBAR_WIDTH
    } else {
        0.0
    };
    let visible_cols = ((inner.width - gutter_width - scrollbar_reserved).max(0.0)
        / cell_size.width)
        .ceil() as usize;
    for row in start.0..=end.0 {
        if row < scroll || row >= scroll + visible_rows {
            continue;
        }
        let Some(line_text) = pane.editor.buffer.line(row) else {
            continue;
        };
        let char_count = line_text.chars().count();
        let visual_row = row - scroll;
        let col_start = if row == start.0 {
            start.1.min(char_count)
        } else {
            0
        };
        let col_end = if row == end.0 {
            end.1.min(char_count)
        } else {
            char_count
        };
        if col_start >= col_end {
            continue;
        }
        if col_end <= h_scroll {
            continue;
        }
        let vis_start = if col_start <= h_scroll {
            0
        } else {
            pane.visible_display_width_between_chars(row, line_text, h_scroll, col_start)
        }
        .min(visible_cols);
        let vis_end = pane
            .visible_display_width_between_chars(row, line_text, h_scroll, col_end)
            .min(visible_cols);
        if vis_start >= vis_end {
            continue;
        }
        let rx = inner.x + gutter_width + vis_start as f32 * cell_size.width;
        let ry = inner.y + visual_row as f32 * cell_size.height;
        let rw = (vis_end - vis_start) as f32 * cell_size.width;
        let rect = Rect::new(rx, ry, rw, cell_size.height).clip_to(&inner);
        if rect.width > 0.0 && rect.height > 0.0 {
            rects.push(rect);
        }
    }
    rects
}

fn soft_wrap_editor_selection_rects(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    cell_size: crate::tide_core::Size,
    start: (usize, usize),
    end: (usize, usize),
) -> Vec<Rect> {
    let mut rects = Vec::new();
    let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;
    let visible_rows = (inner.height / cell_size.height).ceil() as usize;
    let scrollbar_reserved = if pane.needs_scrollbar(inner, cell_size.height) {
        SCROLLBAR_WIDTH
    } else {
        0.0
    };
    let visible_cols = ((inner.width - gutter_width - scrollbar_reserved).max(0.0)
        / cell_size.width)
        .ceil()
        .max(0.0) as usize;
    let line_count = pane.editor.buffer.line_count();

    for row in start.0..=end.0 {
        if row >= line_count {
            break;
        }
        let Some(line) = pane.editor.buffer.line(row) else {
            break;
        };
        let char_count = line.chars().count();
        let row_char_start = if row == start.0 {
            start.1.min(char_count)
        } else {
            0
        };
        let row_char_end = if row == end.0 {
            end.1.min(char_count)
        } else {
            char_count
        };
        if row_char_start >= row_char_end {
            continue;
        }

        for (visual_row, start_col, end_col) in pane.soft_wrap_visible_segments_for_char_range(
            row,
            row_char_start,
            row_char_end,
            visible_rows,
        ) {
            let start_col = start_col.min(visible_cols);
            let end_col = end_col.min(visible_cols);
            if start_col >= end_col {
                continue;
            }
            let rx = inner.x + gutter_width + start_col as f32 * cell_size.width;
            let ry = inner.y + visual_row as f32 * cell_size.height;
            let rw = (end_col - start_col) as f32 * cell_size.width;
            let rect = Rect::new(rx, ry, rw, cell_size.height).clip_to(&inner);
            if rect.width > 0.0 && rect.height > 0.0 {
                rects.push(rect);
            }
        }
    }

    rects
}

/// Render search match highlights for an editor pane.
fn render_editor_search_highlights(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    search: &crate::state::search::SearchState,
) {
    if pane.effective_soft_wrap() {
        render_editor_search_highlights_soft_wrap(pane, inner, renderer, p, search);
        return;
    }
    if search.visible && !search.input.is_empty() {
        let cell_size = renderer.cell_size();
        let scroll = pane.editor.scroll_offset();
        let h_scroll = pane.editor.h_scroll_offset();
        let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        let visible_rows = (inner.height / cell_size.height).ceil() as usize;
        for (mi, m) in search.matches.iter().enumerate() {
            if m.line < scroll || m.line >= scroll + visible_rows {
                continue;
            }
            if m.col + m.len <= h_scroll {
                continue;
            }
            let visual_row = m.line - scroll;
            let visual_col = if m.col >= h_scroll {
                m.col - h_scroll
            } else {
                0
            };
            let draw_len = if m.col >= h_scroll {
                m.len
            } else {
                m.len - (h_scroll - m.col)
            };
            let rx = inner.x + gutter_width + visual_col as f32 * cell_size.width;
            let ry = inner.y + visual_row as f32 * cell_size.height;
            let rw = draw_len as f32 * cell_size.width;
            let color = if search.current == Some(mi) {
                p.search_current_bg
            } else {
                p.search_match_bg
            };
            renderer.draw_rect(Rect::new(rx, ry, rw, cell_size.height), color);
        }
    }
}

fn render_editor_search_highlights_soft_wrap(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    search: &crate::state::search::SearchState,
) {
    if !search.visible || search.input.is_empty() {
        return;
    }
    let cell_size = renderer.cell_size();
    let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;
    let visible_rows = (inner.height / cell_size.height).ceil() as usize;
    for (mi, m) in search.matches.iter().enumerate() {
        for (visual_row, start_col, end_col) in pane.soft_wrap_visible_segments_for_char_range(
            m.line,
            m.col,
            m.col + m.len,
            visible_rows,
        ) {
            let rx = inner.x + gutter_width + start_col as f32 * cell_size.width;
            let ry = inner.y + visual_row as f32 * cell_size.height;
            let rw = (end_col - start_col) as f32 * cell_size.width;
            let color = if search.current == Some(mi) {
                p.search_current_bg
            } else {
                p.search_match_bg
            };
            renderer.draw_rect(Rect::new(rx, ry, rw, cell_size.height), color);
        }
    }
}

/// Render selection highlight for a diff pane.
/// Selection coordinates use virtual rows (scroll offset + visual row) and columns.
fn render_diff_selection(
    dp: &crate::pane::diff::DiffPane,
    inner: Rect,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    sel: &crate::pane::Selection,
) {
    let cell_size = renderer.cell_size();
    let (start, end) = if sel.anchor <= sel.end {
        (sel.anchor, sel.end)
    } else {
        (sel.end, sel.anchor)
    };
    if start == end {
        return;
    }
    let sel_color = p.selection;
    let scroll = dp.scroll as usize;
    let visible_rows = (inner.height / cell_size.height).ceil() as usize;
    let visible_cols = (inner.width / cell_size.width).ceil() as usize;
    let flat = dp.flat_lines();

    for row in start.0..=end.0 {
        if row < scroll || row >= scroll + visible_rows {
            continue;
        }
        let visual_row = row - scroll;
        let col_start = if row == start.0 { start.1 } else { 0 };
        let col_end = if row == end.0 {
            end.1
        } else {
            flat.get(row)
                .map_or(visible_cols, |l| l.chars().count().max(visible_cols))
        };
        if col_start >= col_end {
            continue;
        }
        let vis_end = col_end.min(visible_cols);
        let rx = inner.x + col_start as f32 * cell_size.width;
        let ry = inner.y + visual_row as f32 * cell_size.height;
        let rw = (vis_end - col_start) as f32 * cell_size.width;
        renderer.draw_rect(Rect::new(rx, ry, rw, cell_size.height), sel_color);
    }
}

/// Render selection highlight for a markdown preview pane.
fn render_preview_selection(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    sel: &crate::pane::Selection,
) {
    let cell_size = renderer.cell_size();
    for rect in preview_selection_rects(pane, inner, cell_size, sel) {
        let clipped = rect.clip_to(&inner);
        if clipped.width > 0.0 && clipped.height > 0.0 {
            renderer.draw_rect(clipped, p.selection);
        }
    }
}

/// Selection rects for the Markdown preview. Origin matches the centered
/// readable column used by the preview renderer (`content_inset`), so the
/// highlight sits exactly under the glyphs rather than in the left margin.
pub(crate) fn preview_selection_rects(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    cell_size: crate::tide_core::Size,
    sel: &crate::pane::Selection,
) -> Vec<Rect> {
    let (start, end) = if sel.anchor <= sel.end {
        (sel.anchor, sel.end)
    } else {
        (sel.end, sel.anchor)
    };
    if start == end {
        return Vec::new();
    }
    let scroll = pane.preview_scroll;
    let h_scroll = pane.preview_h_scroll;
    let visible_rows = (inner.height / cell_size.height).ceil() as usize;
    let content_inset = pane.preview_content_inset_for_target(inner, cell_size);

    let mut rects = Vec::new();
    for row in start.0..=end.0 {
        if row < scroll || row >= scroll + visible_rows {
            continue;
        }
        let visual_row = row - scroll;
        let line_width = pane.preview_line_display_width(row);
        let col_start = if row == start.0 { start.1.min(line_width) } else { 0 };
        let col_end = if row == end.0 {
            end.1.min(line_width)
        } else {
            line_width
        };
        if col_start >= col_end {
            continue;
        }
        // Apply horizontal scroll offset: skip columns before h_scroll
        let vis_start = col_start.saturating_sub(h_scroll);
        let vis_end = col_end.saturating_sub(h_scroll);
        if vis_start >= vis_end {
            continue;
        }
        let rx = inner.x + content_inset + vis_start as f32 * cell_size.width;
        let ry = inner.y + visual_row as f32 * cell_size.height;
        let rw = (vis_end - vis_start) as f32 * cell_size.width;
        rects.push(Rect::new(rx, ry, rw, cell_size.height));
    }
    rects
}

/// Render matching bracket highlights for an editor pane.
fn render_bracket_highlight(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    if pane.effective_soft_wrap() {
        render_bracket_highlight_soft_wrap(pane, inner, renderer, p);
        return;
    }
    let Some((open_pos, close_pos)) = pane.editor.matching_bracket() else {
        return;
    };
    let cell_size = renderer.cell_size();
    let scroll = pane.editor.scroll_offset();
    let h_scroll = pane.editor.h_scroll_offset();
    let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;
    let visible_rows = (inner.height / cell_size.height).ceil() as usize;
    let border_w = 1.0_f32;

    for bracket_pos in [open_pos, close_pos] {
        if bracket_pos.line < scroll || bracket_pos.line >= scroll + visible_rows {
            continue;
        }
        // Convert byte offset to char index for visual positioning
        let char_col = if let Some(line_text) = pane.editor.buffer.line(bracket_pos.line) {
            let byte_col = bracket_pos.col.min(line_text.len());
            line_text[..byte_col].chars().count()
        } else {
            continue;
        };
        if char_col < h_scroll {
            continue;
        }
        let visual_col = char_col - h_scroll;
        let visual_row = bracket_pos.line - scroll;
        let rx = inner.x + gutter_width + visual_col as f32 * cell_size.width;
        let ry = inner.y + visual_row as f32 * cell_size.height;
        let rw = cell_size.width;
        let rh = cell_size.height;

        // Background fill
        renderer.draw_rect(Rect::new(rx, ry, rw, rh), p.bracket_match_bg);
        // Border (top, bottom, left, right)
        renderer.draw_rect(Rect::new(rx, ry, rw, border_w), p.bracket_match_border);
        renderer.draw_rect(
            Rect::new(rx, ry + rh - border_w, rw, border_w),
            p.bracket_match_border,
        );
        renderer.draw_rect(Rect::new(rx, ry, border_w, rh), p.bracket_match_border);
        renderer.draw_rect(
            Rect::new(rx + rw - border_w, ry, border_w, rh),
            p.bracket_match_border,
        );
    }
}

fn render_bracket_highlight_soft_wrap(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    let Some((open_pos, close_pos)) = pane.editor.matching_bracket() else {
        return;
    };
    let cell_size = renderer.cell_size();
    let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;
    let visible_rows = (inner.height / cell_size.height).ceil() as usize;
    let border_w = 1.0_f32;

    for bracket_pos in [open_pos, close_pos] {
        let char_col = if let Some(line_text) = pane.editor.buffer.line(bracket_pos.line) {
            let byte_col = bracket_pos.col.min(line_text.len());
            line_text[..byte_col].chars().count()
        } else {
            continue;
        };
        for (visual_row, start_col, end_col) in pane.soft_wrap_visible_segments_for_char_range(
            bracket_pos.line,
            char_col,
            char_col + 1,
            visible_rows,
        ) {
            let rx = inner.x + gutter_width + start_col as f32 * cell_size.width;
            let ry = inner.y + visual_row as f32 * cell_size.height;
            let rw = (end_col - start_col) as f32 * cell_size.width;
            let rh = cell_size.height;

            renderer.draw_rect(Rect::new(rx, ry, rw, rh), p.bracket_match_bg);
            renderer.draw_rect(Rect::new(rx, ry, rw, border_w), p.bracket_match_border);
            renderer.draw_rect(
                Rect::new(rx, ry + rh - border_w, rw, border_w),
                p.bracket_match_border,
            );
            renderer.draw_rect(Rect::new(rx, ry, border_w, rh), p.bracket_match_border);
            renderer.draw_rect(
                Rect::new(rx + rw - border_w, ry, border_w, rh),
                p.bracket_match_border,
            );
        }
    }
}

/// Render search match highlights for a preview-mode editor pane.
/// Match coordinates are in preview-line space (line = preview line index,
/// col/len = display-cell units), so no buffer-to-preview mapping is needed.
fn render_preview_search_highlights(
    pane: &crate::pane::editor::EditorPane,
    inner: Rect,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    search: &crate::state::search::SearchState,
) {
    if !search.visible || search.input.is_empty() {
        return;
    }
    let cell_size = renderer.cell_size();
    let scroll = pane.preview_scroll;
    let h_scroll = pane.preview_h_scroll;
    let visible_rows = (inner.height / cell_size.height).ceil() as usize;

    for (mi, m) in search.matches.iter().enumerate() {
        if m.line < scroll || m.line >= scroll + visible_rows {
            continue;
        }
        // m.col and m.len are in display-cell units; apply h_scroll
        if m.col + m.len <= h_scroll {
            continue;
        }
        let visual_row = m.line - scroll;
        let visual_col = if m.col >= h_scroll {
            m.col - h_scroll
        } else {
            0
        };
        let draw_len = if m.col >= h_scroll {
            m.len
        } else {
            m.len - (h_scroll - m.col)
        };
        let rx = inner.x + visual_col as f32 * cell_size.width;
        let ry = inner.y + visual_row as f32 * cell_size.height;
        let rw = draw_len as f32 * cell_size.width;
        let color = if search.current == Some(mi) {
            p.search_current_bg
        } else {
            p.search_match_bg
        };
        renderer.draw_rect(Rect::new(rx, ry, rw, cell_size.height), color);
    }
}
