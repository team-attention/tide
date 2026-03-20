use tide_core::{Rect, Renderer, TextStyle, Vec2};

use crate::theme::*;
use crate::App;
use crate::AppCorePort;

use super::{draw_popup_rounded_bg, text_style};

/// Render context menu popup (right-click on file tree).
pub(super) fn render_context_menu(
    app: &App,
    renderer: &mut tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    let menu = match app.modal.context_menu {
        Some(ref m) => m,
        None => return,
    };

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let logical = app.logical_size();
    let rect = menu.geometry(cell_height, logical.width, logical.height);
    let line_height = cell_height + POPUP_LINE_EXTRA;

    // Background + border (rounded)
    draw_popup_rounded_bg(renderer, rect, p.popup_bg, p.popup_border, POPUP_CORNER_RADIUS);

    // Items
    let actions = menu.items();
    for (i, action) in actions.iter().enumerate() {
        let y = rect.y + 4.0 + i as f32 * line_height;

        // Selected highlight
        if i == menu.selected {
            let sel_rect = Rect::new(
                rect.x + POPUP_SELECTED_INSET,
                y,
                rect.width - 2.0 * POPUP_SELECTED_INSET,
                line_height,
            );
            renderer.draw_top_rect(sel_rect, p.popup_selected);
        }

        let item_x = rect.x + POPUP_TEXT_INSET;
        let item_y = y + (line_height - cell_height) / 2.0;
        let item_clip = Rect::new(rect.x, y, rect.width, line_height);

        // Icon
        let icon_style = text_style(p.tree_icon);
        renderer.draw_top_text(action.icon(), Vec2::new(item_x, item_y), icon_style, item_clip);

        // Label
        let label_x = item_x + 2.5 * cell_size.width;
        let label_color = if i == menu.selected { p.tab_text_focused } else { p.tree_text };
        let label_style = TextStyle {
            foreground: label_color,
            background: None,
            bold: i == menu.selected,
            dim: false,
            italic: false,
            underline: false,
        };
        renderer.draw_top_text(action.label(), Vec2::new(label_x, item_y), label_style, item_clip);
    }
}
