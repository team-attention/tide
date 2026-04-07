//! Mouse text selection — start and drag.

use crate::tide_core::{Rect, Vec2};

use crate::pane::{PaneKind, Selection};
use crate::theme::*;
use crate::AppCorePort;
use crate::FocusNavPort;
use crate::InputStatePort;
use crate::PaneAccessPort;

fn editor_hit_cell(
    pane: &crate::pane::editor::EditorPane,
    rect: Rect,
    pos: Vec2,
    cell_size: crate::tide_core::Size,
    content_top_offset: f32,
) -> Option<(usize, usize)> {
    let content_rect = crate::pane::pane_content_rect(rect, content_top_offset);
    let target_rect = if pane.preview_mode {
        content_rect
    } else {
        pane.authoring_rect(content_rect, cell_size)
    };
    if !target_rect.contains(pos) {
        return None;
    }

    let gutter_width = if pane.preview_mode {
        0.0
    } else {
        crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width
    };
    let content_x = target_rect.x + gutter_width;
    let rel_col = ((pos.x - content_x) / cell_size.width).floor() as isize;
    let rel_row = ((pos.y - target_rect.y) / cell_size.height).floor() as isize;
    if rel_row >= 0 && rel_col >= 0 {
        Some((rel_row as usize, rel_col as usize))
    } else {
        None
    }
}

fn live_preview_buffer_col(
    pane: &crate::pane::editor::EditorPane,
    line: usize,
    visual_col: usize,
) -> usize {
    if !pane.live_preview {
        return visual_col;
    }
    if let Some(ref lpm) = pane.live_preview_map {
        let cursor_line = pane.editor.cursor_position().line;
        let line_content = pane.editor.buffer.line(line).unwrap_or("");
        lpm.visual_to_buffer_col(
            line,
            visual_col,
            cursor_line,
            line_content,
            &pane.editor.buffer.lines,
        )
    } else {
        visual_col
    }
}

/// Begin text selection on mouse-down. Clears any existing selection in all
/// panes, then anchors a new one in the clicked pane. Returns `true` if a
/// selection was started.
pub(super) fn start_text_selection(
    ctx: &mut (impl AppCorePort + InputStatePort + PaneAccessPort),
) -> bool {
    let mods = ctx.modifiers();
    let content_top_offset = TAB_BAR_HEIGHT;
    if mods.ctrl || mods.meta {
        return false;
    }

    let pos = ctx.last_cursor_pos();
    let rects: Vec<_> = ctx.visual_pane_rects().to_vec();
    let hit = rects.iter().find(|(_, r)| {
        let content = crate::pane::pane_content_rect(*r, content_top_offset);
        content.contains(pos)
    });
    let pid = match hit {
        Some((id, _)) => *id,
        None => return false,
    };

    let shift_held = mods.shift;

    // Compute click position in cell coordinates for each pane type
    let term_cell = crate::adapter::inward::click_adapter::hit_test::pixel_to_cell(ctx, pos, pid);
    let cell_size_cached = ctx.cell_size();
    let editor_cell = {
        let cs = cell_size_cached;
        if let Some((_, rect)) = rects.iter().find(|(id, _)| *id == pid) {
            match ctx.pane(pid) {
                Some(PaneKind::Editor(pane)) => {
                    editor_hit_cell(pane, *rect, pos, cs, content_top_offset)
                }
                _ => None,
            }
        } else {
            None
        }
    };

    // Diff pane cell: virtual row (scroll + visual), col
    let diff_cell = {
        let cs = cell_size_cached;
        if let Some((_, rect)) = rects.iter().find(|(id, _)| *id == pid) {
            let cx = rect.x + PANE_PADDING;
            let cy = rect.y + content_top_offset;
            let rc = ((pos.x - cx) / cs.width).floor() as isize;
            let rr = ((pos.y - cy) / cs.height).floor() as isize;
            if rr >= 0 && rc >= 0 {
                // Convert visual row to virtual row using scroll offset
                if let Some(PaneKind::Diff(dp)) = ctx.pane(pid) {
                    let virtual_row = dp.scroll as usize + rr as usize;
                    Some((virtual_row, rc as usize))
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };

    // Shift+click: extend existing selection instead of starting a new one
    if shift_held {
        match ctx.pane_mut(pid) {
            Some(PaneKind::Terminal(pane)) => {
                if let (Some(ref mut sel), Some(cell)) = (&mut pane.selection, term_cell) {
                    let visible_start = pane
                        .backend
                        .history_size()
                        .saturating_sub(pane.backend.display_offset());
                    sel.end = (cell.0 + visible_start, cell.1);
                    return true;
                }
            }
            Some(PaneKind::Editor(pane)) => {
                if pane.preview_mode {
                    if let Some((rr, rc)) = editor_cell {
                        if let Some(ref mut sel) = pane.selection {
                            sel.end = (pane.preview_scroll + rr, pane.preview_h_scroll + rc);
                            return true;
                        }
                    }
                } else if pane.effective_soft_wrap() {
                    if let Some((rr, rc)) = editor_cell {
                        if let Some(wrap_map) = pane.wrap_map() {
                            let abs_vr = pane.soft_wrap_visual_scroll() + rr;
                            if let Some(info) =
                                wrap_map.visual_row_to_line_info(abs_vr, &pane.editor.buffer.lines)
                            {
                                let visual_col = (info.char_offset + rc).min(info.char_end);
                                let col =
                                    live_preview_buffer_col(pane, info.logical_line, visual_col);
                                if let Some(ref mut sel) = pane.selection {
                                    sel.end = (info.logical_line, col);
                                    return true;
                                }
                            }
                        }
                    }
                } else if let Some((rr, rc)) = editor_cell {
                    let line = pane.editor.scroll_offset() + rr;
                    let visual_col = pane.editor.h_scroll_offset() + rc;
                    let col = live_preview_buffer_col(pane, line, visual_col);
                    if let Some(ref mut sel) = pane.selection {
                        sel.end = (line, col);
                        return true;
                    }
                }
            }
            Some(PaneKind::Diff(dp)) => {
                if let (Some(ref mut sel), Some((vr, vc))) = (&mut dp.selection, diff_cell) {
                    sel.end = (vr, vc);
                    return true;
                }
            }
            _ => {}
        }
        // No existing selection to extend — fall through to create a new one
    }

    // Clear all existing selections
    ctx.clear_all_selections();

    match ctx.pane_mut(pid) {
        Some(PaneKind::Terminal(pane)) => {
            if let Some(cell) = term_cell {
                let visible_start = pane
                    .backend
                    .history_size()
                    .saturating_sub(pane.backend.display_offset());
                let abs = (cell.0 + visible_start, cell.1);
                pane.selection = Some(Selection {
                    anchor: abs,
                    end: abs,
                });
            }
        }
        Some(PaneKind::Browser(_)) => {}
        Some(PaneKind::Editor(pane)) => {
            if pane.preview_mode {
                if let Some((rr, rc)) = editor_cell {
                    let line = pane.preview_scroll + rr;
                    let col = pane.preview_h_scroll + rc;
                    pane.selection = Some(Selection {
                        anchor: (line, col),
                        end: (line, col),
                    });
                }
            } else if pane.effective_soft_wrap() {
                if let Some((rr, rc)) = editor_cell {
                    if let Some(wrap_map) = pane.wrap_map() {
                        let abs_vr = pane.soft_wrap_visual_scroll() + rr;
                        if let Some(info) =
                            wrap_map.visual_row_to_line_info(abs_vr, &pane.editor.buffer.lines)
                        {
                            let visual_col = (info.char_offset + rc).min(info.char_end);
                            let col = live_preview_buffer_col(pane, info.logical_line, visual_col);
                            pane.selection = Some(Selection {
                                anchor: (info.logical_line, col),
                                end: (info.logical_line, col),
                            });
                        }
                    }
                }
            } else if let Some((rr, rc)) = editor_cell {
                let line = pane.editor.scroll_offset() + rr;
                let visual_col = pane.editor.h_scroll_offset() + rc;
                let col = live_preview_buffer_col(pane, line, visual_col);
                pane.selection = Some(Selection {
                    anchor: (line, col),
                    end: (line, col),
                });
            }
        }
        Some(PaneKind::Diff(dp)) => {
            if let Some((vr, vc)) = diff_cell {
                dp.selection = Some(Selection {
                    anchor: (vr, vc),
                    end: (vr, vc),
                });
            }
        }
        Some(PaneKind::Launcher(_)) => {}
        None => {}
    }
    true
}

/// Extend text selection while dragging (mouse move with left button held).
pub(super) fn handle_selection_drag(ctx: &mut (impl AppCorePort + PaneAccessPort), pos: Vec2) {
    let cell_size = ctx.cell_size();
    let drag_top_offset = TAB_BAR_HEIGHT;

    let pane_rects: Vec<_> = ctx.visual_pane_rects().to_vec();
    for (pid, rect) in pane_rects {
        let content = crate::pane::pane_content_rect(rect, drag_top_offset);
        if !content.contains(pos) {
            continue;
        }
        let cell = crate::adapter::inward::click_adapter::hit_test::pixel_to_cell(ctx, pos, pid);
        let editor_cell = {
            match ctx.pane(pid) {
                Some(PaneKind::Editor(pane)) => {
                    editor_hit_cell(pane, rect, pos, cell_size, drag_top_offset)
                }
                _ => None,
            }
        };

        match ctx.pane_mut(pid) {
            Some(PaneKind::Terminal(pane)) => {
                if let (Some(ref mut sel), Some(c)) = (&mut pane.selection, cell) {
                    let visible_start = pane
                        .backend
                        .history_size()
                        .saturating_sub(pane.backend.display_offset());
                    sel.end = (c.0 + visible_start, c.1);
                }
            }
            Some(PaneKind::Browser(_)) => {}
            Some(PaneKind::Editor(pane)) => {
                if pane.preview_mode {
                    if let Some(ref mut sel) = &mut pane.selection {
                        if let Some((rr, rc)) = editor_cell {
                            sel.end = (pane.preview_scroll + rr, pane.preview_h_scroll + rc);
                        }
                    }
                } else if pane.effective_soft_wrap() {
                    if let Some((rel_row, rel_col)) = editor_cell {
                        let mapped = pane.wrap_map().and_then(|wrap_map| {
                            let abs_vr = pane.soft_wrap_visual_scroll() + rel_row;
                            wrap_map.visual_row_to_line_info(abs_vr, &pane.editor.buffer.lines)
                        });
                        if let Some(info) = mapped {
                            let visual_col = (info.char_offset + rel_col).min(info.char_end);
                            let col = live_preview_buffer_col(pane, info.logical_line, visual_col);
                            if let Some(ref mut sel) = pane.selection {
                                sel.end = (info.logical_line, col);
                            }
                        }
                    }
                } else if let Some((rel_row, rel_col)) = editor_cell {
                    let line = pane.editor.scroll_offset() + rel_row;
                    let visual_col = pane.editor.h_scroll_offset() + rel_col;
                    let col = live_preview_buffer_col(pane, line, visual_col);
                    if let Some(ref mut sel) = pane.selection {
                        sel.end = (line, col);
                    }
                }
            }
            Some(PaneKind::Diff(dp)) => {
                let cx = rect.x + PANE_PADDING;
                let cy = rect.y + drag_top_offset;
                let rc = ((pos.x - cx) / cell_size.width).floor() as isize;
                let rr = ((pos.y - cy) / cell_size.height).floor() as isize;
                if rr >= 0 && rc >= 0 {
                    let virtual_row = dp.scroll as usize + rr as usize;
                    if let Some(ref mut sel) = dp.selection {
                        sel.end = (virtual_row, rc as usize);
                    }
                }
            }
            Some(PaneKind::Launcher(_)) => {}
            None => {}
        }
    }
    ctx.request_redraw();
}

/// Extend URL-bar selection while dragging.
pub(super) fn handle_url_bar_drag(
    ctx: &mut (impl FocusNavPort + AppCorePort + PaneAccessPort),
    pos: Vec2,
) {
    if let Some(focused_id) = ctx.focused_pane() {
        let is_url_focused = matches!(
            ctx.pane(focused_id),
            Some(PaneKind::Browser(bp)) if bp.url_input_focused
        );
        if is_url_focused {
            let cell_w = ctx.cell_size().width;
            let rects: Vec<_> = ctx.visual_pane_rects().to_vec();
            if let Some((_, rect)) = rects.iter().find(|(id, _)| *id == focused_id) {
                let nav_x = rect.x + PANE_PADDING;
                let url_text_x = nav_x + 8.0 + cell_w * 6.0 + 4.0 + 4.0;
                let relative_x = (pos.x - url_text_x).max(0.0);
                let mut col_px = 0.0_f32;
                let mut char_idx = 0;
                if let Some(PaneKind::Browser(bp)) = ctx.pane(focused_id) {
                    for ch in bp.url_input.chars() {
                        let w =
                            unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1) as f32 * cell_w;
                        if relative_x < col_px + w * 0.5 {
                            break;
                        }
                        col_px += w;
                        char_idx += 1;
                    }
                }
                if let Some(PaneKind::Browser(bp)) = ctx.pane_mut(focused_id) {
                    let anchor = match bp.url_selection {
                        Some((a, _)) => a,
                        None => bp.url_input_cursor,
                    };
                    bp.url_selection = Some((anchor, char_idx));
                    bp.url_input_cursor = char_idx;
                    ctx.invalidate_chrome();
                    ctx.request_redraw();
                }
            }
        }
    }
}
