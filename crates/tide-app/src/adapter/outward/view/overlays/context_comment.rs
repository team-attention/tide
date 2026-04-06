use crate::tide_core::{Color, Rect, Renderer, Vec2};

use crate::theme::*;
use crate::App;
use crate::AppCorePort;

use super::{
    bold_style, draw_cursor_beam, draw_popup_rounded_bg, draw_popup_scrim, text_style, visual_width,
};

/// Render the explicit context comment composer overlay.
pub(super) fn render_context_comment_composer(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    let composer = match app.modal.context_comment_composer {
        Some(ref c) => c,
        None => return,
    };

    draw_popup_scrim(renderer, app.logical_size(), p.popup_scrim);

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let logical = app.logical_size();

    let popup_w = if logical.width > 560.0 {
        (logical.width - 48.0).min(760.0).max(520.0)
    } else {
        (logical.width - 24.0).max(320.0)
    };
    let popup_h = if logical.height > 420.0 {
        (logical.height - 48.0).min(520.0).max(320.0)
    } else {
        (logical.height - 24.0).max(260.0)
    };
    let popup_x = (logical.width - popup_w) / 2.0;
    let popup_y = (logical.height - popup_h) / 2.0;
    let popup_rect = Rect::new(popup_x, popup_y, popup_w, popup_h);

    renderer.draw_top_shadow(popup_rect, Color::new(0.0, 0.0, 0.0, 0.28), 10.0, 44.0, 0.0);
    draw_popup_rounded_bg(
        renderer,
        popup_rect,
        p.popup_bg,
        p.popup_border,
        POPUP_CORNER_RADIUS,
    );

    let title_style = bold_style(p.tab_text_focused);
    let body_style = text_style(p.tree_text);
    let muted_style = text_style(p.tab_text);
    let accent_style = bold_style(p.badge_git_branch);

    let pad_x = 18.0;
    let mut y = popup_y + 16.0;
    let line_h = cell_height + 6.0;
    let content_x = popup_x + pad_x;
    let content_w = popup_w - pad_x * 2.0;

    let title = format!("Add comment for {}", composer.pane_kind);
    renderer.draw_top_text(
        &title,
        Vec2::new(content_x, y),
        title_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
    y += line_h + 4.0;

    let source_line = format!(
        "Source Pane {}  •  paired terminal {}",
        composer.source_pane_id, composer.associated_terminal_id
    );
    renderer.draw_top_text(
        &source_line,
        Vec2::new(content_x, y),
        muted_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
    y += line_h;

    let pin_label = if composer.pinned {
        "Pinned: on"
    } else {
        "Pinned: off"
    };
    renderer.draw_top_text(
        &format!("{}  •  Tab toggles pin", pin_label),
        Vec2::new(content_x, y),
        accent_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
    y += line_h + 8.0;

    let section_title = "Selection";
    renderer.draw_top_text(
        section_title,
        Vec2::new(content_x, y),
        title_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
    y += line_h;

    let selection_rect = Rect::new(content_x, y, content_w, 5.0 * line_h);
    renderer.draw_top_rect(
        selection_rect,
        Color::new(p.popup_border.r, p.popup_border.g, p.popup_border.b, 0.12),
    );

    let preview_lines = if composer.content.trim().is_empty() {
        vec!["(no captured selection text)".to_string()]
    } else {
        let mut lines: Vec<String> = composer
            .content
            .lines()
            .take(4)
            .map(|line| line.to_string())
            .collect();
        if composer.content.lines().count() > 4 {
            lines.push("…".to_string());
        }
        lines
    };
    for (idx, line) in preview_lines.iter().enumerate() {
        let ly = y + 4.0 + idx as f32 * line_h;
        renderer.draw_top_text(
            line,
            Vec2::new(content_x + 8.0, ly),
            body_style,
            Rect::new(content_x + 8.0, ly, content_w - 16.0, cell_height + 2.0),
        );
    }
    y += 5.0 * line_h + 12.0;

    renderer.draw_top_text(
        "Comment",
        Vec2::new(content_x, y),
        title_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
    y += line_h;

    let input_h = line_h + 4.0;
    let input_rect = Rect::new(content_x, y, content_w, input_h);
    renderer.draw_top_rect(
        input_rect,
        Color::new(p.popup_border.r, p.popup_border.g, p.popup_border.b, 0.10),
    );

    let input_text_y = y + (input_h - cell_height) / 2.0;
    let text_x = content_x + 10.0;
    let text_clip = Rect::new(text_x, y, content_w - 20.0, input_h);
    let has_preedit = !app.ime.preedit.is_empty();
    let before_w =
        visual_width(&composer.comment.text[..composer.comment.cursor]) as f32 * cell_size.width;
    let preedit_w = if has_preedit {
        visual_width(&app.ime.preedit) as f32 * cell_size.width
    } else {
        0.0
    };

    if composer.comment.is_empty() && !has_preedit {
        renderer.draw_top_text(
            "Type a comment...",
            Vec2::new(text_x, input_text_y),
            muted_style,
            text_clip,
        );
    } else if has_preedit {
        let before = &composer.comment.text[..composer.comment.cursor];
        let after = &composer.comment.text[composer.comment.cursor..];
        if !before.is_empty() {
            renderer.draw_top_text(
                before,
                Vec2::new(text_x, input_text_y),
                body_style,
                text_clip,
            );
        }
        let preedit_x = text_x + before_w;
        renderer.draw_top_rect(
            Rect::new(preedit_x, input_text_y, preedit_w, cell_height),
            p.ime_preedit_bg,
        );
        renderer.draw_top_text(
            &app.ime.preedit,
            Vec2::new(preedit_x, input_text_y),
            text_style(p.ime_preedit_fg),
            text_clip,
        );
        renderer.draw_top_rect(
            Rect::new(preedit_x, input_text_y + cell_height - 1.0, preedit_w, 1.0),
            p.ime_preedit_fg,
        );
        if !after.is_empty() {
            renderer.draw_top_text(
                after,
                Vec2::new(preedit_x + preedit_w, input_text_y),
                body_style,
                text_clip,
            );
        }
    } else {
        renderer.draw_top_text(
            &composer.comment.text,
            Vec2::new(text_x, input_text_y),
            body_style,
            text_clip,
        );
    }

    if !composer.comment.is_empty() || composer.comment.cursor == 0 {
        let cursor_x = text_x + before_w + preedit_w;
        draw_cursor_beam(
            renderer,
            cursor_x,
            input_text_y,
            cell_height,
            p.cursor_accent,
        );
    }

    y += input_h + 14.0;

    let footer = "Esc closes  •  Tab toggles pin  •  Enter submits";
    renderer.draw_top_text(
        footer,
        Vec2::new(content_x, y),
        muted_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
}
