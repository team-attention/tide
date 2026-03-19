use tide_core::{Color, Rect, Renderer, TextStyle, Vec2};

use crate::theme::*;
use crate::ui::file_icon;
use crate::App;

use super::{visual_width, draw_popup_rounded_bg, draw_popup_scrim, draw_cursor_beam, text_style};

/// Render file finder UI on top layer (visible regardless of tab state).
pub(super) fn render_file_finder(
    app: &App,
    renderer: &mut tide_renderer::WgpuRenderer,
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
    draw_popup_rounded_bg(renderer, popup_rect, p.popup_bg, p.popup_border, POPUP_CORNER_RADIUS);

    let ts = text_style(p.tab_text_focused);
    let muted_style = text_style(p.tab_text);
    let item_pad = 12.0_f32;

    // Search input — with search icon
    let input_y = popup_y + 2.0;
    let input_clip = Rect::new(popup_x + item_pad, input_y, popup_w - 2.0 * item_pad, input_h);
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
    let text_clip = Rect::new(text_x, input_y, popup_w - item_pad - 2.0 * cell_size.width, input_h);

    if finder.input.is_empty() {
        renderer.draw_top_text(
            "Search files...",
            Vec2::new(text_x, text_y),
            muted_style,
            text_clip,
        );
    } else {
        renderer.draw_top_text(
            &finder.input.text,
            Vec2::new(text_x, text_y),
            ts,
            text_clip,
        );
    }

    // Match count
    let count_text = format!("{}/{}", finder.filtered.len(), finder.entries.len());
    let count_w = count_text.len() as f32 * cell_size.width;
    let count_x = popup_x + popup_w - count_w - item_pad;
    renderer.draw_top_text(
        &count_text,
        Vec2::new(count_x, text_y),
        muted_style,
        input_clip,
    );

    // Cursor beam
    let cx = text_x + visual_width(&finder.input.text[..finder.input.cursor]) as f32 * cell_size.width;
    draw_cursor_beam(renderer, cx, text_y, cell_height, p.cursor_accent);

    // Separator line below input
    let sep_y = input_y + input_h;
    let sep_rect = Rect::new(popup_x + POPUP_SEPARATOR_INSET, sep_y, popup_w - 2.0 * POPUP_SEPARATOR_INSET, POPUP_SEPARATOR);
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
        let entry_idx = finder.filtered[fi];
        let rel_path = &finder.entries[entry_idx];
        let y = list_top + vi as f32 * line_height;

        // Selected item highlight
        if fi == finder.selected {
            let sel_rect = Rect::new(
                popup_x + 2.0,
                y,
                popup_w - 4.0,
                line_height,
            );
            renderer.draw_top_rect(sel_rect, p.popup_selected);
        }

        // File icon
        let text_offset_y = (line_height - cell_height) / 2.0;
        let file_name = rel_path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let icon = file_icon(&file_name, false, false);
        let icon_style = text_style(p.tree_icon);
        let icon_x = popup_x + item_pad + 4.0;
        let icon_str: String = std::iter::once(icon).collect();
        renderer.draw_top_text(
            &icon_str,
            Vec2::new(icon_x, y + text_offset_y),
            icon_style,
            list_clip,
        );

        // File path
        let path_x = icon_x + indent_width + 4.0;
        let display_path = rel_path.to_string_lossy();
        let path_color = if fi == finder.selected {
            p.tab_text_focused
        } else {
            p.tree_text
        };
        let path_style = TextStyle {
            foreground: path_color,
            background: None,
            bold: fi == finder.selected,
            dim: false,
            italic: false,
            underline: false,
        };
        renderer.draw_top_text(
            &display_path,
            Vec2::new(path_x, y + text_offset_y),
            path_style,
            list_clip,
        );
    }
}
