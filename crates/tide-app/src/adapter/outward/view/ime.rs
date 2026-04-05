use unicode_width::UnicodeWidthChar;

use crate::tide_core::{Rect, Renderer, TerminalBackend, TextStyle, Vec2};

use crate::state::drag_types::{DropDestination, PaneDragState};
use crate::pane::PaneKind;
use crate::theme::*;
use crate::App;
use crate::DockPort;


/// Render IME preedit overlay (Korean composition in progress) for terminal panes,
/// drag-drop preview overlays, and handle drag preview.
pub(crate) fn render_ime_and_drop_preview(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    visual_pane_rects: &[(u64, Rect)],
    focused: Option<u64>,
) {
    // Render IME preedit overlay for terminal and editor panes.
    // Skip when a text-intercepting popup is active (file finder, git switcher, etc.)
    // — the popup draws its own input field with the preedit text.
    let popup_active = app.modal.file_finder.is_some()
        || app.modal.git_switcher.is_some()
        || app.modal.save_as_input.is_some()
        || app.modal.file_tree_rename.is_some();
    let search_bar_focused = app.focus.search_focus.is_some();
    if !app.ime.preedit.is_empty() && !popup_active && !search_bar_focused {
        let effective_id = focused;
        if let Some(target_id) = effective_id {
            // Try editor pane first (both tree editors and panel editors)
            let is_editor = matches!(app.panes.get(&target_id), Some(PaneKind::Editor(_)));
            if is_editor {
                render_editor_ime_preedit(app, renderer, p, visual_pane_rects, target_id);
            } else if let Some((_, rect)) = visual_pane_rects.iter().find(|(id, _)| *id == target_id) {
                if let Some(PaneKind::Terminal(pane)) = app.panes.get(&target_id) {
                    let cursor = pane.backend.cursor();
                    let cell_size = renderer.cell_size();
                    let inner_w = rect.width - 2.0 * PANE_PADDING;
                    let max_cols = (inner_w / cell_size.width).floor() as usize;
                    let actual_w = max_cols as f32 * cell_size.width;
                    let center_x = (inner_w - actual_w) / 2.0;
                    let ime_top = TAB_BAR_HEIGHT;
                    let inner_offset = Vec2::new(
                        rect.x + PANE_PADDING + center_x,
                        rect.y + ime_top,
                    );
                    let cx = inner_offset.x + cursor.col as f32 * cell_size.width;
                    let cy = inner_offset.y + cursor.row as f32 * cell_size.height;

                    // Draw preedit background
                    let preedit_chars: Vec<char> = app.ime.preedit.chars().collect();
                    let pw = preedit_chars.iter()
                        .map(|c| UnicodeWidthChar::width(*c).unwrap_or(1))
                        .sum::<usize>()
                        .max(1) as f32 * cell_size.width;
                    renderer.draw_rect(
                        Rect::new(cx, cy, pw, cell_size.height),
                        p.ime_preedit_bg,
                    );

                    // Draw each preedit character
                    let preedit_style = TextStyle {
                        foreground: p.ime_preedit_fg,
                        background: None,
                        bold: false,
                        dim: false,
                        italic: false,
                        underline: true,
                    };
                    let mut col_offset = 0usize;
                    for &ch in preedit_chars.iter() {
                        renderer.draw_cell(
                            ch,
                            cursor.row as usize,
                            cursor.col as usize + col_offset,
                            preedit_style,
                            cell_size,
                            inner_offset,
                        );
                        col_offset += UnicodeWidthChar::width(ch).unwrap_or(1);
                    }
                }
            }
        }
    }

    // Draw drop preview overlay when dragging a pane
    if let PaneDragState::Dragging {
        source_pane,
        drop_target: ref maybe_dest,
        cached_preview_rect,
        cursor_pos,
        source_label,
        ..
    } = &app.interaction.pane_drag {
        // Compute fade-in alpha from drop_preview_start (150ms ease-in quadratic)
        let alpha_factor = app.interaction.drop_preview_start
            .map(|start| {
                let t = (start.elapsed().as_secs_f32() * 1000.0 / 150.0).min(1.0);
                t * t // quadratic ease-in
            })
            .unwrap_or(1.0);

        // Dim overlay on the source pane being dragged
        if let Some(&(_, source_rect)) = visual_pane_rects.iter().find(|(id, _)| *id == *source_pane) {
            renderer.draw_rect(source_rect, p.drag_source_dim.with_alpha_factor(alpha_factor));
        }

        if let Some(ref dest) = maybe_dest {
            match dest {
                DropDestination::TreeRoot(zone) | DropDestination::TreePane(_, zone)
                | DropDestination::DockRoot(zone) => {
                    let is_swap = *zone == crate::tide_core::DropZone::Center;

                    if is_swap {
                        // Swap preview: border-only outline around target's visual rect
                        if let DropDestination::TreePane(target_id, _) = dest {
                            if let Some(&(_, target_rect)) = visual_pane_rects.iter().find(|(id, _)| *id == *target_id) {
                                App::draw_swap_preview(renderer, target_rect, p, alpha_factor);
                            }
                        }
                    } else {
                        // Use cached preview rect (computed on mouse move, not every frame)
                        if let Some(preview_rect) = cached_preview_rect {
                            // Dock drops use dock_area_rect offset, stage drops use pane_area_rect
                            let is_dock_drop = match dest {
                                DropDestination::DockRoot(_) => true,
                                DropDestination::TreePane(tid, _) => app.is_pane_in_dock(*tid),
                                _ => false,
                            };
                            let area = if is_dock_drop {
                                app.dock_area_rect
                            } else {
                                app.pane_area_rect
                            };
                            if let Some(area_rect) = area {
                                let screen_rect = Rect::new(
                                    preview_rect.x + area_rect.x,
                                    preview_rect.y + area_rect.y,
                                    preview_rect.width,
                                    preview_rect.height,
                                );
                                App::draw_insert_preview(renderer, screen_rect, p, alpha_factor);
                            }
                        }
                    }
                }
                DropDestination::Workspace(idx) => {
                    // Highlight the target workspace sidebar item
                    if let Some(item_rect) = crate::adapter::inward::drag_drop_adapter::workspace_sidebar_item_rect(app, *idx) {
                        App::draw_insert_preview(renderer, item_rect, p, alpha_factor);
                    }
                }
                DropDestination::PinnedGroup => {
                    // Highlight the pinned group area
                    if let Some(dock_rect) = app.dock_area_rect {
                        let pinned_w = (dock_rect.width * app.dock.pinned_dock_ratio).max(60.0).min(dock_rect.width - 60.0);
                        let pinned_rect = Rect::new(dock_rect.x, dock_rect.y, pinned_w, dock_rect.height);
                        App::draw_insert_preview(renderer, pinned_rect, p, alpha_factor);
                    }
                }
            }
        }

        // Floating tab label that follows the cursor during drag
        if !source_label.is_empty() {
            let cell_size = renderer.cell_size();
            let label_offset_x = 10.0;
            let label_offset_y = 10.0;
            let h_padding = 8.0;
            let v_padding = 4.0;

            let text_w = source_label.chars()
                .map(|c| UnicodeWidthChar::width(c).unwrap_or(1))
                .sum::<usize>() as f32 * cell_size.width;
            let text_h = cell_size.height;
            let bg_w = text_w + h_padding * 2.0;
            let bg_h = text_h + v_padding * 2.0;

            let bg_x = cursor_pos.x + label_offset_x;
            let bg_y = cursor_pos.y + label_offset_y;

            // Use theme colors for the floating label
            let bg_color = p.tab_bar_bg.with_alpha_factor(alpha_factor);
            renderer.draw_top_rect(Rect::new(bg_x, bg_y, bg_w, bg_h), bg_color);

            // White label text with fade-in
            let text_pos = Vec2::new(bg_x + h_padding, bg_y + v_padding);
            let label_style = TextStyle {
                foreground: p.tab_text.with_alpha_factor(alpha_factor),
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            };
            let clip = Rect::new(bg_x, bg_y, bg_w, bg_h);
            renderer.draw_top_text(&source_label, text_pos, label_style, clip);
        }
    }

}

/// Render IME preedit overlay for an editor pane (tree editor or panel editor).
fn render_editor_ime_preedit(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    visual_pane_rects: &[(u64, Rect)],
    target_id: u64,
) {
    let pane = match app.panes.get(&target_id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => return,
    };
    let cell_size = renderer.cell_size();
    let pos = pane.editor.cursor_position();
    let scroll = pane.editor.scroll_offset();
    let h_scroll = pane.editor.h_scroll_offset();
    let gutter_cells = crate::pane::editor::GUTTER_WIDTH_CELLS;

    // Determine the rect for this editor pane
    let (inner_x, inner_y) = if let Some((_, rect)) = visual_pane_rects.iter().find(|(id, _)| *id == target_id) {
        let top_offset = TAB_BAR_HEIGHT;
        (rect.x + PANE_PADDING, rect.y + top_offset)
    } else {
        return;
    };

    let gutter_width = gutter_cells as f32 * cell_size.width;

    // Compute visual row and column — soft wrap aware
    let (visual_row, visual_col_offset) = if pane.effective_soft_wrap() {
        if let Some(wrap_map) = pane.wrap_map() {
            let cursor_vr = wrap_map.buffer_pos_to_visual_row(
                pos.line, pos.col, &pane.editor.buffer.lines,
            );
            if cursor_vr < pane.soft_wrap_visual_scroll() {
                return;
            }
            let vr = cursor_vr - pane.soft_wrap_visual_scroll();
            let vc = wrap_map.buffer_pos_to_visual_col(
                pos.line, pos.col, &pane.editor.buffer.lines,
            );
            (vr, vc)
        } else {
            return;
        }
    } else {
        if pos.line < scroll {
            return;
        }
        let visual_row = pos.line - scroll;

        // Convert byte offset to char index
        let cursor_char_col = if let Some(line_text) = pane.editor.buffer.line(pos.line) {
            let byte_col = pos.col.min(line_text.len());
            line_text[..byte_col].chars().count()
        } else {
            0
        };
        if cursor_char_col < h_scroll {
            return;
        }
        let visual_col_offset = if let Some(line_text) = pane.editor.buffer.line(pos.line) {
            line_text.chars()
                .skip(h_scroll)
                .take(cursor_char_col - h_scroll)
                .map(|c| UnicodeWidthChar::width(c).unwrap_or(1))
                .sum::<usize>()
        } else {
            cursor_char_col - h_scroll
        };
        (visual_row, visual_col_offset)
    };

    let cx = inner_x + gutter_width + visual_col_offset as f32 * cell_size.width;
    let cy = inner_y + visual_row as f32 * cell_size.height;

    // Draw preedit background
    let preedit_chars: Vec<char> = app.ime.preedit.chars().collect();
    let pw = preedit_chars.iter()
        .map(|c| UnicodeWidthChar::width(*c).unwrap_or(1))
        .sum::<usize>()
        .max(1) as f32 * cell_size.width;
    renderer.draw_top_rect(
        Rect::new(cx, cy, pw, cell_size.height),
        p.ime_preedit_bg,
    );

    // Draw each preedit character in the top layer (above preedit bg)
    let mut col_offset = 0usize;
    for &ch in preedit_chars.iter() {
        let char_x = cx + col_offset as f32 * cell_size.width;
        renderer.draw_top_glyph(ch, Vec2::new(char_x, cy), p.ime_preedit_fg, false, false);
        col_offset += UnicodeWidthChar::width(ch).unwrap_or(1);
    }
}
