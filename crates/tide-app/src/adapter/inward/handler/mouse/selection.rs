//! Mouse text selection — start and drag.

use tide_core::{Rect, Vec2};

use crate::pane::{PaneKind, Selection};
use crate::theme::*;
use crate::App;
use crate::AppCorePort;

impl App {
    /// Begin text selection on mouse-down. Clears any existing selection in all
    /// panes, then anchors a new one in the clicked pane. Returns `true` if a
    /// selection was started.
    pub(super) fn start_text_selection(&mut self) -> bool {
        let mods = self.window.modifiers;
        let content_top_offset = TAB_BAR_HEIGHT;
        if mods.ctrl || mods.meta {
            return false;
        }

        let hit = self.visual_pane_rects.iter().find(|(_, r)| {
            let content = Rect::new(
                r.x + PANE_PADDING,
                r.y + content_top_offset,
                r.width - 2.0 * PANE_PADDING,
                r.height - content_top_offset - PANE_PADDING,
            );
            content.contains(self.window.last_cursor_pos)
        });
        let pid = match hit {
            Some((id, _)) => *id,
            None => return false,
        };

        // Clear all existing selections
        for (_, pane) in self.panes.iter_mut() {
            match pane {
                PaneKind::Terminal(p) => p.selection = None,
                PaneKind::Editor(p) => p.selection = None,
                PaneKind::Diff(_) | PaneKind::Browser(_) | PaneKind::Launcher(_) => {}
            }
        }

        let term_cell = self.pixel_to_cell(self.window.last_cursor_pos, pid);
        let editor_cell = {
            let cs = Some(self.cell_size());
            if let (Some(cs), Some((_, rect))) =
                (cs, self.visual_pane_rects.iter().find(|(id, _)| *id == pid))
            {
                let gutter = 5.0 * cs.width;
                let cx = rect.x + PANE_PADDING + gutter;
                let cy = rect.y + content_top_offset;
                let rc = ((self.window.last_cursor_pos.x - cx) / cs.width).floor() as isize;
                let rr = ((self.window.last_cursor_pos.y - cy) / cs.height).floor() as isize;
                if rr >= 0 && rc >= 0 {
                    Some((rr as usize, rc as usize))
                } else {
                    None
                }
            } else {
                None
            }
        };
        let cell_size_cached = self.cell_size();
        match self.panes.get_mut(&pid) {
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
                    let cs = Some(cell_size_cached);
                    if let (Some(cs), Some((_, rect))) =
                        (cs, self.visual_pane_rects.iter().find(|(id, _)| *id == pid))
                    {
                        let cx = rect.x + PANE_PADDING;
                        let cy = rect.y + content_top_offset;
                        let rc =
                            ((self.window.last_cursor_pos.x - cx) / cs.width).floor() as isize;
                        let rr =
                            ((self.window.last_cursor_pos.y - cy) / cs.height).floor() as isize;
                        if rr >= 0 && rc >= 0 {
                            let line = pane.preview_scroll + rr as usize;
                            let col = pane.preview_h_scroll + rc as usize;
                            pane.selection = Some(Selection {
                                anchor: (line, col),
                                end: (line, col),
                            });
                        }
                    }
                } else if pane.effective_soft_wrap() {
                    if let Some((rr, rc)) = editor_cell {
                        if let Some(wrap_map) = pane.wrap_map() {
                            let scroll_vr =
                                wrap_map.visual_row_of_line(pane.editor.scroll_offset());
                            let abs_vr = scroll_vr + rr;
                            if let Some(info) = wrap_map
                                .visual_row_to_line_info(abs_vr, &pane.editor.buffer.lines)
                            {
                                let col = (info.char_offset + rc).min(info.char_end);
                                pane.selection = Some(Selection {
                                    anchor: (info.logical_line, col),
                                    end: (info.logical_line, col),
                                });
                            }
                        }
                    }
                } else if let Some((rr, rc)) = editor_cell {
                    let line = pane.editor.scroll_offset() + rr;
                    let col = pane.editor.h_scroll_offset() + rc;
                    pane.selection = Some(Selection {
                        anchor: (line, col),
                        end: (line, col),
                    });
                }
            }
            Some(PaneKind::Diff(_)) => {}
            Some(PaneKind::Launcher(_)) => {}
            None => {}
        }
        true
    }

    /// Extend text selection while dragging (mouse move with left button held).
    pub(super) fn handle_selection_drag(&mut self, pos: Vec2) {
        let cell_size = Some(self.cell_size());
        let drag_top_offset = TAB_BAR_HEIGHT;

        let pane_rects: Vec<_> = self
            .visual_pane_rects
            .iter()
            .map(|(id, r)| (*id, *r))
            .collect();
        for (pid, rect) in pane_rects {
            let content = Rect::new(
                rect.x + PANE_PADDING,
                rect.y + drag_top_offset,
                rect.width - 2.0 * PANE_PADDING,
                rect.height - drag_top_offset - PANE_PADDING,
            );
            if !content.contains(pos) {
                continue;
            }
            let cell = self.pixel_to_cell(pos, pid);
            let editor_cell = if let Some(cs) = cell_size {
                let gutter_width =
                    crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cs.width;
                let content_x = rect.x + PANE_PADDING + gutter_width;
                let content_y = rect.y + drag_top_offset;
                let rel_col = ((pos.x - content_x) / cs.width).floor() as isize;
                let rel_row = ((pos.y - content_y) / cs.height).floor() as isize;
                if rel_row >= 0 && rel_col >= 0 {
                    Some((rel_row as usize, rel_col as usize))
                } else {
                    None
                }
            } else {
                None
            };

            match self.panes.get_mut(&pid) {
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
                        if let (Some(ref mut sel), Some(cs)) = (&mut pane.selection, cell_size) {
                            let cx = rect.x + PANE_PADDING;
                            let cy = rect.y + drag_top_offset;
                            let rc = ((pos.x - cx) / cs.width).floor() as isize;
                            let rr = ((pos.y - cy) / cs.height).floor() as isize;
                            if rr >= 0 && rc >= 0 {
                                sel.end = (
                                    pane.preview_scroll + rr as usize,
                                    pane.preview_h_scroll + rc as usize,
                                );
                            }
                        }
                    } else if pane.effective_soft_wrap() {
                        if let Some((rel_row, rel_col)) = editor_cell {
                            let mapped = pane.wrap_map().and_then(|wrap_map| {
                                let scroll_vr =
                                    wrap_map.visual_row_of_line(pane.editor.scroll_offset());
                                let abs_vr = scroll_vr + rel_row;
                                wrap_map
                                    .visual_row_to_line_info(abs_vr, &pane.editor.buffer.lines)
                            });
                            if let (Some(ref mut sel), Some(info)) = (&mut pane.selection, mapped) {
                                sel.end = (
                                    info.logical_line,
                                    (info.char_offset + rel_col).min(info.char_end),
                                );
                            }
                        }
                    } else if let (Some(ref mut sel), Some((rel_row, rel_col))) =
                        (&mut pane.selection, editor_cell)
                    {
                        sel.end = (
                            pane.editor.scroll_offset() + rel_row,
                            pane.editor.h_scroll_offset() + rel_col,
                        );
                    }
                }
                Some(PaneKind::Diff(_)) => {}
                Some(PaneKind::Launcher(_)) => {}
                None => {}
            }
        }
        self.cache.needs_redraw = true;
    }

    /// Extend URL-bar selection while dragging.
    pub(super) fn handle_url_bar_drag(&mut self, pos: Vec2) {
        if let Some(focused_id) = self.focus.focused {
            let is_url_focused = matches!(
                self.panes.get(&focused_id),
                Some(PaneKind::Browser(bp)) if bp.url_input_focused
            );
            if is_url_focused {
                let cell_w = self.cell_size().width;
                if let Some((_, rect)) = self
                    .visual_pane_rects
                    .iter()
                    .find(|(id, _)| *id == focused_id)
                {
                    let nav_x = rect.x + PANE_PADDING;
                    let url_text_x = nav_x + 8.0 + cell_w * 6.0 + 4.0 + 4.0;
                    let relative_x = (pos.x - url_text_x).max(0.0);
                    let mut col_px = 0.0_f32;
                    let mut char_idx = 0;
                    if let Some(PaneKind::Browser(bp)) = self.panes.get(&focused_id) {
                        for ch in bp.url_input.chars() {
                            let w = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1) as f32
                                * cell_w;
                            if relative_x < col_px + w * 0.5 {
                                break;
                            }
                            col_px += w;
                            char_idx += 1;
                        }
                    }
                    if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused_id) {
                        let anchor = match bp.url_selection {
                            Some((a, _)) => a,
                            None => bp.url_input_cursor,
                        };
                        bp.url_selection = Some((anchor, char_idx));
                        bp.url_input_cursor = char_idx;
                        self.cache.invalidate_chrome();
                        self.cache.needs_redraw = true;
                    }
                }
            }
        }
    }
}
