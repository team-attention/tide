use crate::tide_core::{Rect, Renderer, Vec2};

use crate::theme::*;
use crate::App;
use crate::AppCorePort;

use super::{bold_style, draw_cursor_beam, draw_popup_rounded_bg, draw_popup_scrim, text_style};

/// Render the save-as popup (filename entry for untitled files).
pub(super) fn render_save_as(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    visual_pane_rects: &[(u64, Rect)],
) {
    let save_as = match app.modal.save_as_input {
        Some(ref s) => s,
        None => return,
    };
    // Find the pane rect for the save-as target
    let pane_rect = match visual_pane_rects
        .iter()
        .find(|(id, _)| *id == save_as.pane_id)
    {
        Some(&(_, r)) => r,
        None => return,
    };

    // Dim overlay (scrim)
    draw_popup_scrim(renderer, app.logical_size(), p.popup_scrim);

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let field_h = cell_height + POPUP_INPUT_PADDING;
    let hint_h = cell_height + 8.0;
    let padding = POPUP_TEXT_INSET;

    // Popup dimensions — anchored below the pane tab bar
    let popup_w = SAVE_AS_POPUP_W.min(pane_rect.width - 2.0 * PANE_PADDING);
    let popup_h = field_h * 2.0 + POPUP_SEPARATOR + hint_h + 2.0 * padding;
    let popup_x = save_as.anchor_rect.x.clamp(
        pane_rect.x + PANE_PADDING,
        pane_rect.x + pane_rect.width - popup_w - PANE_PADDING,
    );
    let popup_y = save_as.anchor_rect.y + save_as.anchor_rect.height + 4.0;
    let popup_rect = Rect::new(popup_x, popup_y, popup_w, popup_h);

    // Background + border (rounded)
    draw_popup_rounded_bg(
        renderer,
        popup_rect,
        p.popup_bg,
        p.popup_border,
        POPUP_CORNER_RADIUS,
    );

    let ts = text_style(p.tab_text_focused);
    let label_style = bold_style(p.tab_text);
    let muted_style = text_style(p.tab_text);

    let label_w = 5.0 * cell_size.width + 8.0;
    let content_x = popup_x + padding + label_w;
    let content_w = popup_w - 2.0 * padding - label_w;

    let is_dir_active = save_as.active_field == crate::SaveAsField::Directory;

    // Directory field
    let dir_y = popup_y + padding;
    let dir_rect = Rect::new(popup_x + padding, dir_y, popup_w - 2.0 * padding, field_h);
    if is_dir_active {
        renderer.draw_top_rect(dir_rect, p.popup_selected);
    }
    let dir_text_y = dir_y + (field_h - cell_height) / 2.0;
    renderer.draw_top_text(
        "Dir",
        Vec2::new(popup_x + padding + 4.0, dir_text_y),
        label_style,
        dir_rect,
    );
    let dir_clip = Rect::new(content_x, dir_y, content_w, field_h);
    let dir_beam = super::draw_input_with_preedit(
        renderer,
        &save_as.directory.text,
        save_as.directory.cursor,
        if is_dir_active {
            app.ime.preedit.as_str()
        } else {
            ""
        },
        Vec2::new(content_x, dir_text_y),
        cell_size,
        dir_clip,
        ts,
        p.ime_preedit_bg,
        p.ime_preedit_fg,
    );
    if is_dir_active {
        draw_cursor_beam(renderer, dir_beam, dir_text_y, cell_height, p.cursor_accent);
    }

    // Separator
    let sep_y = dir_y + field_h;
    renderer.draw_top_rect(
        Rect::new(
            popup_x + POPUP_SEPARATOR_INSET,
            sep_y,
            popup_w - 2.0 * POPUP_SEPARATOR_INSET,
            POPUP_SEPARATOR,
        ),
        p.popup_border,
    );

    // Filename field
    let name_y = sep_y + POPUP_SEPARATOR;
    let name_rect = Rect::new(popup_x + padding, name_y, popup_w - 2.0 * padding, field_h);
    if !is_dir_active {
        renderer.draw_top_rect(name_rect, p.popup_selected);
    }
    let name_text_y = name_y + (field_h - cell_height) / 2.0;
    renderer.draw_top_text(
        "Name",
        Vec2::new(popup_x + padding + 4.0, name_text_y),
        label_style,
        name_rect,
    );
    let name_clip = Rect::new(content_x, name_y, content_w, field_h);
    let name_beam = super::draw_input_with_preedit(
        renderer,
        &save_as.filename.text,
        save_as.filename.cursor,
        if is_dir_active {
            ""
        } else {
            app.ime.preedit.as_str()
        },
        Vec2::new(content_x, name_text_y),
        cell_size,
        name_clip,
        ts,
        p.ime_preedit_bg,
        p.ime_preedit_fg,
    );
    if !is_dir_active {
        draw_cursor_beam(
            renderer,
            name_beam,
            name_text_y,
            cell_height,
            p.cursor_accent,
        );
    }

    // Hint bar
    let hint_y = name_y + field_h;
    let hint_text_y = hint_y + (hint_h - cell_height) / 2.0;
    let hint = "Enter save   Tab switch   Esc cancel";
    let hint_w_px = hint.len() as f32 * cell_size.width;
    let hint_x = popup_x + (popup_w - hint_w_px) / 2.0;
    let hint_clip = Rect::new(popup_x + padding, hint_y, popup_w - 2.0 * padding, hint_h);
    renderer.draw_top_text(hint, Vec2::new(hint_x, hint_text_y), muted_style, hint_clip);
}
