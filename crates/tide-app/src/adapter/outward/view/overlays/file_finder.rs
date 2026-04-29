use crate::tide_core::{Color, Rect, Renderer, TextStyle, Vec2};

use crate::state::drag_types::HoverTarget;
use crate::theme::*;
use crate::ui::file_icon;
use crate::App;
use crate::AppCorePort;

use super::{draw_cursor_beam, draw_popup_rounded_bg, draw_popup_scrim, text_style, visual_width};

fn with_alpha(color: Color, alpha: f32) -> Color {
    Color::new(color.r, color.g, color.b, alpha)
}

/// Render file finder UI on top layer (visible regardless of tab state).
pub(super) fn render_file_finder(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    let finder = match app.modal.file_finder {
        Some(ref f) => f,
        None => return,
    };

    // Dim overlay (scrim)
    draw_popup_scrim(renderer, app.logical_size(), p.popup_scrim);

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let logical = app.logical_size();
    let geo = finder.geometry(cell_height, logical.width, logical.height);

    let line_height = geo.line_height;
    let popup_w = geo.popup_w;
    let popup_x = geo.popup_x;
    let popup_y = geo.popup_y;
    let popup_h = geo.popup_h;
    let input_h = geo.input_h;
    let max_visible = geo.max_visible;
    let indent_width = cell_size.width * 1.5;

    let popup_rect = Rect::new(popup_x, popup_y, popup_w, popup_h);

    // Shadow
    let shadow_color = Color::new(0.0, 0.0, 0.0, 0.25);
    renderer.draw_top_shadow(popup_rect, shadow_color, 8.0, 40.0, 0.0);

    // Background + border (rounded)
    draw_popup_rounded_bg(
        renderer,
        popup_rect,
        p.popup_bg,
        p.popup_border,
        POPUP_CORNER_RADIUS,
    );

    let ts = text_style(p.tab_text_focused);
    let muted_style = text_style(p.tab_text);
    let item_pad = 12.0_f32;

    // Search input — with search icon
    let input_y = popup_y + 2.0;
    let input_clip = Rect::new(
        popup_x + item_pad,
        input_y,
        popup_w - 2.0 * item_pad,
        input_h,
    );
    let text_y = input_y + (input_h - cell_height) / 2.0;
    let icon_x = popup_x + item_pad;
    let icon_style = text_style(p.tab_text);

    // Search icon
    renderer.draw_top_text(
        "\u{f002} ",
        Vec2::new(icon_x, text_y),
        icon_style,
        input_clip,
    );

    let text_x = icon_x + 2.0 * cell_size.width;
    let text_clip = Rect::new(
        text_x,
        input_y,
        popup_w - item_pad - 2.0 * cell_size.width,
        input_h,
    );

    if finder.input.is_empty() {
        renderer.draw_top_text(
            finder.placeholder_text(),
            Vec2::new(text_x, text_y),
            muted_style,
            text_clip,
        );
    } else {
        renderer.draw_top_text(&finder.input.text, Vec2::new(text_x, text_y), ts, text_clip);
    }

    // Match count
    let count_text = format!("{}/{}", finder.filtered.len(), finder.total_candidates());
    let count_w = count_text.len() as f32 * cell_size.width;
    let count_x = popup_x + popup_w - count_w - item_pad;
    renderer.draw_top_text(
        &count_text,
        Vec2::new(count_x, text_y),
        muted_style,
        input_clip,
    );

    let mode_text = finder.mode_label();
    let mode_w = mode_text.len() as f32 * cell_size.width;
    let mode_pad_x = 7.0_f32;
    let mode_h = cell_height + 4.0;
    let mode_x = count_x - mode_w - item_pad - mode_pad_x * 2.0;
    let mode_rect = Rect::new(
        mode_x,
        text_y + (cell_height - mode_h) / 2.0,
        mode_w + mode_pad_x * 2.0,
        mode_h,
    );
    renderer.draw_top_rounded_rect(mode_rect, with_alpha(p.badge_bg, 0.55), 4.0);
    renderer.draw_top_text(
        mode_text,
        Vec2::new(mode_x + mode_pad_x, text_y),
        text_style(p.badge_text),
        input_clip,
    );

    // Cursor beam
    let cx =
        text_x + visual_width(&finder.input.text[..finder.input.cursor]) as f32 * cell_size.width;
    draw_cursor_beam(renderer, cx, text_y, cell_height, p.cursor_accent);

    // Separator line below input
    let sep_y = input_y + input_h;
    let sep_rect = Rect::new(
        popup_x + POPUP_SEPARATOR_INSET,
        sep_y,
        popup_w - 2.0 * POPUP_SEPARATOR_INSET,
        POPUP_SEPARATOR,
    );
    renderer.draw_top_rect(sep_rect, p.popup_border);

    // File list
    let list_top = geo.list_top;
    let list_clip = Rect::new(
        popup_x + item_pad,
        list_top,
        popup_w - 2.0 * item_pad,
        max_visible as f32 * line_height,
    );

    for vi in 0..max_visible {
        let fi = finder.scroll_offset + vi;
        if fi >= finder.filtered.len() {
            break;
        }
        let y = list_top + vi as f32 * line_height;
        let is_selected = fi == finder.selected;
        let is_hovered = matches!(
            app.interaction.hover_target,
            Some(HoverTarget::FileFinderItem(idx)) if idx == fi
        );

        // Selected item highlight
        if is_selected || is_hovered {
            let color = if is_selected {
                p.file_tree_focus_fill
            } else {
                with_alpha(p.badge_bg, 0.18)
            };
            let sel_rect = Rect::new(
                popup_x + POPUP_SELECTED_INSET,
                y + 2.0,
                popup_w - 2.0 * POPUP_SELECTED_INSET,
                line_height - 4.0,
            );
            renderer.draw_top_rounded_rect(sel_rect, color, FILE_TREE_ROW_RADIUS);
        }

        // Result icon
        let text_offset_y = (line_height - cell_height) / 2.0;
        let (icon_str, icon_style) = match finder.mode {
            crate::state::FileFinderMode::Files => {
                let entry_idx = finder.filtered[fi];
                let rel_path = &finder.entries[entry_idx];
                let file_name = rel_path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let icon = file_icon(&file_name, false, false);
                (
                    std::iter::once(icon).collect::<String>(),
                    text_style(p.tree_icon),
                )
            }
            crate::state::FileFinderMode::Symbols
            | crate::state::FileFinderMode::WorkspaceSymbols => {
                ("\u{f121}".to_string(), text_style(p.badge_text))
            }
            crate::state::FileFinderMode::WorkspaceSearch => {
                ("\u{f002}".to_string(), text_style(p.badge_text))
            }
        };
        let icon_x = popup_x + item_pad + 4.0;
        renderer.draw_top_text(
            &icon_str,
            Vec2::new(icon_x, y + text_offset_y),
            icon_style,
            list_clip,
        );

        // Result row text
        let path_x = icon_x + indent_width + 4.0;
        let (primary, secondary) = finder.row_parts(fi).unwrap_or_default();
        let path_color = if is_selected {
            p.tab_text_focused
        } else {
            p.tree_text
        };
        let path_style = TextStyle {
            foreground: path_color,
            background: None,
            bold: is_selected,
            dim: false,
            italic: false,
            underline: false,
        };
        let meta_style = TextStyle {
            foreground: if is_selected {
                p.badge_text
            } else {
                p.badge_text_dimmed
            },
            background: None,
            bold: false,
            dim: false,
            italic: false,
            underline: false,
        };
        let secondary_w = visual_width(&secondary) as f32 * cell_size.width;
        let secondary_x = popup_x + popup_w - item_pad - secondary_w;
        let primary_clip_w = if secondary.is_empty() {
            popup_x + popup_w - item_pad - path_x
        } else {
            (secondary_x - path_x - 12.0).max(0.0)
        };
        renderer.draw_top_text(
            &primary,
            Vec2::new(path_x, y + text_offset_y),
            path_style,
            Rect::new(path_x, list_top, primary_clip_w, list_clip.height),
        );
        if !secondary.is_empty() && secondary_w < list_clip.width {
            renderer.draw_top_text(
                &secondary,
                Vec2::new(secondary_x, y + text_offset_y),
                meta_style,
                list_clip,
            );
        }
    }

    if finder.filtered.len() > max_visible {
        let track_h = max_visible as f32 * line_height;
        let track_x = popup_x + popup_w - 5.0;
        let track = Rect::new(track_x, list_top, 2.0, track_h);
        renderer.draw_top_rounded_rect(track, p.scrollbar_track, 1.0);

        let max_offset = finder.filtered.len().saturating_sub(max_visible);
        if max_offset > 0 {
            let thumb_h = (track_h * (max_visible as f32 / finder.filtered.len() as f32)).max(18.0);
            let progress = finder.scroll_offset as f32 / max_offset as f32;
            let thumb_y = list_top + (track_h - thumb_h) * progress;
            let thumb = Rect::new(track_x - 1.0, thumb_y, 4.0, thumb_h);
            renderer.draw_top_rounded_rect(thumb, p.scrollbar_thumb, 2.0);
        }
    }
}
