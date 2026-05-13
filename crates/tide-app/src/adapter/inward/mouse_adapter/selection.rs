//! Mouse text selection — start and drag.

use crate::tide_core::{Rect, Vec2};

use crate::pane::{PaneKind, Selection};
use crate::theme::*;
use crate::AppCorePort;
use crate::FocusNavPort;
use crate::InputStatePort;
use crate::PaneAccessPort;

fn clamp_pos_to_rect(pos: Vec2, rect: Rect) -> Vec2 {
    let max_x = (rect.x + rect.width - 0.001).max(rect.x);
    let max_y = (rect.y + rect.height - 0.001).max(rect.y);
    Vec2::new(pos.x.max(rect.x).min(max_x), pos.y.max(rect.y).min(max_y))
}

/// Begin text selection on mouse-down. Clears any existing selection in all
/// panes, then anchors a new one in the clicked pane. Returns `true` if a
/// selection was started.
pub(super) fn start_text_selection(
    ctx: &mut (impl AppCorePort + InputStatePort + PaneAccessPort),
) -> bool {
    let mods = ctx.modifiers();
    let cell_size = ctx.cell_size();
    if mods.ctrl || mods.meta {
        return false;
    }

    let pos = ctx.last_cursor_pos();
    let rects: Vec<_> = ctx.visual_pane_rects().to_vec();
    let hit = rects.iter().find(|(id, r)| {
        let content = match ctx.pane(*id) {
            Some(PaneKind::Editor(pane)) => pane.content_rect(*r, TAB_BAR_HEIGHT, cell_size),
            Some(PaneKind::Terminal(_))
            | Some(PaneKind::Diff(_))
            | Some(PaneKind::Browser(_))
            | Some(PaneKind::Launcher(_))
            | None => crate::pane::pane_content_rect(*r, TAB_BAR_HEIGHT),
        };
        content.contains(pos)
    });
    let pid = match hit {
        Some((id, _)) => *id,
        None => return false,
    };

    let shift_held = mods.shift;

    // Compute click position in cell coordinates for each pane type
    let term_cell = crate::adapter::inward::click_adapter::hit_test::pixel_to_cell(ctx, pos, pid);
    let cell_size_cached = cell_size;
    let editor_cell = {
        let cs = cell_size_cached;
        if let Some((_, rect)) = rects.iter().find(|(id, _)| *id == pid) {
            match ctx.pane(pid) {
                Some(PaneKind::Editor(pane)) => {
                    pane.selection_hit_cell(*rect, TAB_BAR_HEIGHT, cs, pos, false)
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
            let cy = rect.y + TAB_BAR_HEIGHT;
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
        let mut selection_started = false;
        match ctx.pane_mut(pid) {
            Some(PaneKind::Terminal(pane)) => {
                if let (Some(ref mut sel), Some(cell)) = (&mut pane.selection, term_cell) {
                    let visible_start = pane
                        .backend
                        .history_size()
                        .saturating_sub(pane.backend.display_offset());
                    sel.end = (cell.0 + visible_start, cell.1);
                    selection_started = true;
                }
            }
            Some(PaneKind::Editor(pane)) => {
                if let Some((rr, rc)) = editor_cell {
                    if let Some(end) = pane.selection_position_for_cell(rr, rc) {
                        if let Some(ref mut sel) = pane.selection {
                            sel.end = end;
                            selection_started = true;
                        }
                    }
                }
            }
            Some(PaneKind::Diff(dp)) => {
                if let (Some(ref mut sel), Some((vr, vc))) = (&mut dp.selection, diff_cell) {
                    sel.end = (vr, vc);
                    selection_started = true;
                }
            }
            _ => {}
        }
        if selection_started {
            ctx.interaction_mut().text_selection_drag_source = Some(pid);
            return true;
        }
        // No existing selection to extend — fall through to create a new one
    }

    // Clear all existing selections
    ctx.clear_all_selections();

    let mut selection_started = false;
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
                selection_started = true;
            }
        }
        Some(PaneKind::Browser(_)) => {}
        Some(PaneKind::Editor(pane)) => {
            if let Some((rr, rc)) = editor_cell {
                if let Some(pos) = pane.selection_position_for_cell(rr, rc) {
                    pane.selection = Some(Selection {
                        anchor: pos,
                        end: pos,
                    });
                    selection_started = true;
                }
            }
        }
        Some(PaneKind::Diff(dp)) => {
            if let Some((vr, vc)) = diff_cell {
                dp.selection = Some(Selection {
                    anchor: (vr, vc),
                    end: (vr, vc),
                });
                selection_started = true;
            }
        }
        Some(PaneKind::Launcher(_)) => {}
        None => {}
    }
    if selection_started {
        ctx.interaction_mut().text_selection_drag_source = Some(pid);
    }
    selection_started
}

fn apply_selection_drag_for_pane(
    ctx: &mut (impl AppCorePort + PaneAccessPort),
    pid: crate::tide_core::PaneId,
    rect: Rect,
    pos: Vec2,
    clamp_to_source: bool,
) -> bool {
    let cell_size = ctx.cell_size();
    let term_cell = if matches!(ctx.pane(pid), Some(PaneKind::Terminal(_))) {
        let target_pos = if clamp_to_source {
            let inner =
                crate::pane::pane_content_rect(rect, terminal_content_top(cell_size.height));
            clamp_pos_to_rect(pos, inner)
        } else {
            pos
        };
        crate::adapter::inward::click_adapter::hit_test::pixel_to_cell(ctx, target_pos, pid)
    } else {
        None
    };
    let editor_cell = match ctx.pane(pid) {
        Some(PaneKind::Editor(pane)) => {
            pane.selection_hit_cell(rect, TAB_BAR_HEIGHT, cell_size, pos, clamp_to_source)
        }
        _ => None,
    };
    let diff_cell = if matches!(ctx.pane(pid), Some(PaneKind::Diff(_))) {
        let target_pos = if clamp_to_source {
            clamp_pos_to_rect(pos, crate::pane::pane_content_rect(rect, TAB_BAR_HEIGHT))
        } else {
            pos
        };
        let cx = rect.x + PANE_PADDING;
        let cy = rect.y + TAB_BAR_HEIGHT;
        let rc = ((target_pos.x - cx) / cell_size.width).floor() as isize;
        let rr = ((target_pos.y - cy) / cell_size.height).floor() as isize;
        if rr >= 0 && rc >= 0 {
            Some((rr as usize, rc as usize))
        } else {
            None
        }
    } else {
        None
    };

    match ctx.pane_mut(pid) {
        Some(PaneKind::Terminal(pane)) => {
            if let (Some(ref mut sel), Some(c)) = (&mut pane.selection, term_cell) {
                let visible_start = pane
                    .backend
                    .history_size()
                    .saturating_sub(pane.backend.display_offset());
                sel.end = (c.0 + visible_start, c.1);
                return true;
            }
        }
        Some(PaneKind::Browser(_)) => {}
        Some(PaneKind::Editor(pane)) => {
            let Some((rel_row, rel_col)) = editor_cell else {
                return false;
            };
            let end = pane.selection_position_for_cell(rel_row, rel_col);
            if let (Some(ref mut sel), Some(end)) = (&mut pane.selection, end) {
                sel.end = end;
                return true;
            }
        }
        Some(PaneKind::Diff(dp)) => {
            if let (Some(ref mut sel), Some((vr, vc))) = (&mut dp.selection, diff_cell) {
                sel.end = (dp.scroll as usize + vr, vc);
                return true;
            }
        }
        Some(PaneKind::Launcher(_)) => {}
        None => {}
    }
    false
}

/// Extend text selection while dragging (mouse move with left button held).
pub(super) fn handle_selection_drag(
    ctx: &mut (impl AppCorePort + InputStatePort + PaneAccessPort),
    pos: Vec2,
) {
    let cell_size = ctx.cell_size();
    let pane_rects: Vec<_> = ctx.visual_pane_rects().to_vec();
    if let Some(source_pid) = ctx.interaction().text_selection_drag_source {
        if let Some((_, rect)) = pane_rects.iter().find(|(pid, _)| *pid == source_pid) {
            if apply_selection_drag_for_pane(ctx, source_pid, *rect, pos, true) {
                ctx.request_redraw();
                return;
            }
        }
    }

    for (pid, rect) in pane_rects {
        let content = match ctx.pane(pid) {
            Some(PaneKind::Editor(pane)) => pane.content_rect(rect, TAB_BAR_HEIGHT, cell_size),
            Some(PaneKind::Terminal(_))
            | Some(PaneKind::Diff(_))
            | Some(PaneKind::Browser(_))
            | Some(PaneKind::Launcher(_))
            | None => crate::pane::pane_content_rect(rect, TAB_BAR_HEIGHT),
        };
        if !content.contains(pos) {
            continue;
        }
        apply_selection_drag_for_pane(ctx, pid, rect, pos, false);
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
