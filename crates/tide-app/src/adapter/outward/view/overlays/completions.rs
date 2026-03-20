use tide_core::{Color, Rect, Renderer, TextStyle, Vec2};

use crate::pane::PaneKind;
use crate::theme::*;
use crate::App;
use crate::AppCorePort;

use super::{visual_width, draw_popup_rounded_bg};

/// Render completion popups for editor panes that have active completions.
pub(super) fn render_completion_popups(
    app: &App,
    renderer: &mut tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    visual_pane_rects: &[(u64, Rect)],
) {
    use crate::pane::editor::completion::COMPLETION_VISIBLE_COUNT;

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let line_height = cell_height + 4.0; // compact line height for completion items
    let popup_padding = 4.0_f32;
    let kind_col_width = 3.0 * cell_size.width; // "fn ", "var", etc.
    let min_label_width = 15.0 * cell_size.width;
    let logical = app.logical_size();

    for &(pane_id, ref pane_rect) in visual_pane_rects {
        let pane = match app.panes.get(&pane_id) {
            Some(PaneKind::Editor(ep)) => ep,
            _ => continue,
        };
        let cs = match pane.completion {
            Some(ref cs) => cs,
            None => continue,
        };

        let visible: Vec<_> = cs.visible_items().collect();
        if visible.is_empty() {
            continue;
        }

        // Compute cursor position in screen coordinates
        let cursor_pos = pane.editor.cursor_position();
        let scroll = pane.editor.scroll_offset();
        let h_scroll = pane.editor.h_scroll_offset();
        if cursor_pos.line < scroll {
            continue;
        }
        let visual_row = cursor_pos.line - scroll;
        let cursor_char_col = if let Some(line_text) = pane.editor.buffer.line(cursor_pos.line) {
            let byte_col = cursor_pos.col.min(line_text.len());
            line_text[..byte_col].chars().count()
        } else {
            0
        };
        let visual_col = if cursor_char_col >= h_scroll { cursor_char_col - h_scroll } else { 0 };

        let content_top = crate::theme::TAB_BAR_HEIGHT;
        let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        let cursor_x = pane_rect.x + PANE_PADDING + gutter_width + visual_col as f32 * cell_size.width;
        let cursor_y = pane_rect.y + content_top + (visual_row as f32 + 1.0) * cell_size.height;

        // Compute popup dimensions
        let visible_count = visible.len().min(COMPLETION_VISIBLE_COUNT);
        let max_label_len = visible.iter()
            .map(|(_, item)| visual_width(&item.label))
            .max()
            .unwrap_or(10);
        let max_detail_len = visible.iter()
            .filter_map(|(_, item)| item.detail.as_ref().map(|d| visual_width(d).min(30)))
            .max()
            .unwrap_or(0);
        let detail_col_width = if max_detail_len > 0 {
            (max_detail_len as f32 + 2.0) * cell_size.width
        } else {
            0.0
        };
        let popup_w = (kind_col_width + (max_label_len as f32 + 2.0) * cell_size.width + detail_col_width)
            .max(min_label_width + kind_col_width)
            .min(pane_rect.width * 0.8);
        let popup_h = visible_count as f32 * line_height + 2.0 * popup_padding;

        // Position: below cursor, shift left if overflows right edge
        let mut popup_x = cursor_x;
        let mut popup_y = cursor_y + 2.0; // small gap below cursor line

        // Clamp to screen bounds
        if popup_x + popup_w > logical.width {
            popup_x = (logical.width - popup_w - 4.0).max(0.0);
        }
        if popup_y + popup_h > logical.height {
            // Show above the cursor line instead
            popup_y = pane_rect.y + content_top + visual_row as f32 * cell_size.height - popup_h - 2.0;
        }

        let popup_rect = Rect::new(popup_x, popup_y, popup_w, popup_h);

        // Shadow
        let shadow_color = Color::new(0.0, 0.0, 0.0, 0.3);
        renderer.draw_top_shadow(popup_rect, shadow_color, 4.0, 16.0, 0.0);

        // Background + border
        draw_popup_rounded_bg(renderer, popup_rect, p.popup_bg, p.popup_border, 6.0);

        let list_clip = Rect::new(popup_x, popup_y, popup_w, popup_h);

        // Draw items
        for (vi, (_orig_idx, item)) in visible.iter().enumerate() {
            let y = popup_y + popup_padding + vi as f32 * line_height;
            let is_selected = vi + cs.scroll_offset == cs.selected_index;

            // Selected highlight
            if is_selected {
                let sel_rect = Rect::new(
                    popup_x + 2.0,
                    y,
                    popup_w - 4.0,
                    line_height,
                );
                renderer.draw_top_rounded_rect(sel_rect, p.popup_selected, 4.0);
            }

            let item_y = y + (line_height - cell_height) / 2.0;

            // Kind abbreviation (e.g., "fn", "var", "mod")
            let kind_abbr = item.kind.abbr();
            let kind_color = match item.kind {
                crate::pane::editor::completion::CompletionKind::Function
                | crate::pane::editor::completion::CompletionKind::Method => {
                    Color::new(0.608, 0.529, 0.847, 1.0) // purple
                }
                crate::pane::editor::completion::CompletionKind::Variable
                | crate::pane::editor::completion::CompletionKind::Field
                | crate::pane::editor::completion::CompletionKind::Property => {
                    Color::new(0.506, 0.718, 0.886, 1.0) // blue
                }
                crate::pane::editor::completion::CompletionKind::Type
                | crate::pane::editor::completion::CompletionKind::Module => {
                    Color::new(0.886, 0.741, 0.420, 1.0) // yellow/orange
                }
                crate::pane::editor::completion::CompletionKind::Keyword => {
                    Color::new(0.820, 0.506, 0.506, 1.0) // red
                }
                _ => p.tab_text, // gray for others
            };
            let kind_style = TextStyle {
                foreground: kind_color,
                background: None,
                bold: false,
                dim: false,
                italic: true,
                underline: false,
            };
            renderer.draw_top_text(
                kind_abbr,
                Vec2::new(popup_x + 6.0, item_y),
                kind_style,
                list_clip,
            );

            // Label
            let label_x = popup_x + 6.0 + kind_col_width;
            let label_color = if is_selected { p.tab_text_focused } else { p.tree_text };
            let label_style = TextStyle {
                foreground: label_color,
                background: None,
                bold: is_selected,
                dim: false,
                italic: false,
                underline: false,
            };
            let label_avail = popup_w - kind_col_width - 12.0 - detail_col_width;
            let label_clip = Rect::new(label_x, y, label_avail, line_height);
            renderer.draw_top_text(&item.label, Vec2::new(label_x, item_y), label_style, label_clip);

            // Detail text (right-aligned, dimmed)
            if let Some(ref detail) = item.detail {
                let detail_str: String = detail.chars().take(30).collect();
                let detail_w = visual_width(&detail_str) as f32 * cell_size.width;
                let detail_x = popup_x + popup_w - detail_w - 8.0;
                let detail_style = TextStyle {
                    foreground: p.tab_text,
                    background: None,
                    bold: false,
                    dim: true,
                    italic: false,
                    underline: false,
                };
                let detail_clip = Rect::new(
                    popup_x + popup_w - detail_col_width - 4.0,
                    y,
                    detail_col_width,
                    line_height,
                );
                renderer.draw_top_text(&detail_str, Vec2::new(detail_x, item_y), detail_style, detail_clip);
            }
        }
    }
}
