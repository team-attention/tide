mod completions;
mod config_page;
mod context_comment;
mod context_menu;
mod file_finder;
pub(crate) mod git_switcher;
mod save_dialog;
mod search_bar;

use unicode_width::UnicodeWidthChar;

use crate::tide_core::{Rect, Renderer, TextStyle, Vec2};

use crate::pane::PaneKind;
use crate::theme::*;
use crate::App;

/// Sum of display widths for characters in `s`, treating wide (CJK) chars as 2 columns.
pub(super) fn visual_width(s: &str) -> usize {
    s.chars()
        .map(|c| UnicodeWidthChar::width(c).unwrap_or(1))
        .sum()
}

pub(crate) fn search_bar_text_advance_cells(text: &str) -> usize {
    visual_width(text)
}

pub(crate) fn search_bar_cursor_advance_cells(query: &str, cursor: usize, preedit: &str) -> usize {
    let cursor = cursor.min(query.len());
    let cursor = if query.is_char_boundary(cursor) {
        cursor
    } else {
        query
            .char_indices()
            .map(|(idx, _)| idx)
            .take_while(|idx| *idx < cursor)
            .last()
            .unwrap_or(0)
    };
    search_bar_text_advance_cells(&query[..cursor]) + search_bar_text_advance_cells(preedit)
}

#[cfg(test)]
pub(crate) use context_comment::{composer_input_rect, composer_popup_rect};
pub(crate) use context_comment::context_comment_composer_cursor_area;

// ── Shared helper functions ──

/// Draw a rounded popup background with border using SDF.
/// Renders outer rounded rect (border color) then inner rounded rect (fill color).
pub(super) fn draw_popup_rounded_bg(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    rect: Rect,
    fill: crate::tide_core::Color,
    border: crate::tide_core::Color,
    radius: f32,
) {
    let bw = POPUP_BORDER_WIDTH;
    // Outer rounded rect (border)
    renderer.draw_top_rounded_rect(rect, border, radius);
    // Inner rounded rect (fill, inset by border width)
    let inner = Rect::new(
        rect.x + bw,
        rect.y + bw,
        rect.width - 2.0 * bw,
        rect.height - 2.0 * bw,
    );
    renderer.draw_top_rounded_rect(inner, fill, (radius - bw).max(0.0));
}

/// Draw a 1px (or `POPUP_BORDER_WIDTH`) border around `rect`.
pub(super) fn draw_popup_border(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    rect: Rect,
    color: crate::tide_core::Color,
) {
    let bw = POPUP_BORDER_WIDTH;
    renderer.draw_top_rect(Rect::new(rect.x, rect.y, rect.width, bw), color);
    renderer.draw_top_rect(
        Rect::new(rect.x, rect.y + rect.height - bw, rect.width, bw),
        color,
    );
    renderer.draw_top_rect(Rect::new(rect.x, rect.y, bw, rect.height), color);
    renderer.draw_top_rect(
        Rect::new(rect.x + rect.width - bw, rect.y, bw, rect.height),
        color,
    );
}

/// Draw a cursor beam (vertical line) at the given position.
pub(super) fn draw_cursor_beam(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    x: f32,
    y: f32,
    height: f32,
    color: crate::tide_core::Color,
) {
    renderer.draw_top_rect(Rect::new(x, y, CURSOR_BEAM_WIDTH, height), color);
}

/// Create a plain (non-bold) TextStyle with the given foreground color.
pub(super) fn text_style(color: crate::tide_core::Color) -> TextStyle {
    TextStyle {
        foreground: color,
        background: None,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
    }
}

/// Create a bold TextStyle with the given foreground color.
pub(super) fn bold_style(color: crate::tide_core::Color) -> TextStyle {
    TextStyle {
        foreground: color,
        background: None,
        bold: true,
        dim: false,
        italic: false,
        underline: false,
    }
}

/// Draw a full-screen dim overlay (scrim) behind floating popups.
pub(super) fn draw_popup_scrim(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    logical_size: crate::tide_core::Size,
    color: crate::tide_core::Color,
) {
    renderer.draw_top_rect(
        Rect::new(0.0, 0.0, logical_size.width, logical_size.height),
        color,
    );
}

/// Render all overlay UI elements on the top layer: search bars, notification bars,
/// save-as inline edit, file finder, git switcher, and file switcher.
pub(crate) fn render_overlays(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    visual_pane_rects: &[(u64, Rect)],
) {
    search_bar::render_search_bars(app, renderer, p, visual_pane_rects);
    render_notification_bars(app, renderer, p, visual_pane_rects);
    save_dialog::render_save_as(app, renderer, p, visual_pane_rects);
    completions::render_completion_popups(app, renderer, p, visual_pane_rects);
    file_finder::render_file_finder(app, renderer, p);
    git_switcher::render_git_switcher(app, renderer, p);
    context_menu::render_context_menu(app, renderer, p);
    context_comment::render_context_comment_composer(app, renderer, p);
    config_page::render_config_page(app, renderer, p);
}

/// Render notification bars (conflict / save confirm) for all editor panes.
fn render_notification_bars(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    visual_pane_rects: &[(u64, Rect)],
) {
    let cell_size = renderer.cell_size();

    // Collect all panes that need notification bars
    let mut bar_panes: Vec<(crate::tide_core::PaneId, Rect)> = Vec::new();

    let content_top_off = TAB_BAR_HEIGHT;
    for &(id, rect) in visual_pane_rects {
        let content_top = rect.y + content_top_off;
        let bar_x = rect.x + PANE_PADDING;
        let bar_w = rect.width - 2.0 * PANE_PADDING;
        bar_panes.push((
            id,
            Rect::new(bar_x, content_top, bar_w, CONFLICT_BAR_HEIGHT),
        ));
    }

    for (pane_id, bar_rect) in bar_panes {
        // Check for branch cleanup bar
        if let Some(ref bc) = app.modal.branch_cleanup {
            if bc.pane_id == pane_id {
                renderer.draw_top_rect(bar_rect, p.conflict_bar_bg);
                let text_y = bar_rect.y + (CONFLICT_BAR_HEIGHT - cell_size.height) / 2.0;
                let ts = text_style(p.conflict_bar_text);
                let msg = format!("Delete worktree + branch '{}'?", bc.branch);
                renderer.draw_top_text(&msg, Vec2::new(bar_rect.x + 8.0, text_y), ts, bar_rect);

                let btn_style = bold_style(p.conflict_bar_btn_text);
                let btn_pad = 8.0;
                let btn_h = CONFLICT_BAR_HEIGHT - 6.0;
                let btn_y = bar_rect.y + 3.0;

                // Cancel button (rightmost)
                let cancel_text = "Cancel";
                let cancel_w = cancel_text.len() as f32 * cell_size.width + btn_pad * 2.0;
                let cancel_x = bar_rect.x + bar_rect.width - cancel_w - 4.0;
                let cancel_rect = Rect::new(cancel_x, btn_y, cancel_w, btn_h);
                renderer.draw_top_rect(cancel_rect, p.conflict_bar_btn);
                renderer.draw_top_text(
                    cancel_text,
                    Vec2::new(cancel_x + btn_pad, text_y),
                    btn_style,
                    cancel_rect,
                );

                // Keep button
                let keep_text = "Keep";
                let keep_w = keep_text.len() as f32 * cell_size.width + btn_pad * 2.0;
                let keep_x = cancel_x - keep_w - 4.0;
                let keep_rect = Rect::new(keep_x, btn_y, keep_w, btn_h);
                renderer.draw_top_rect(keep_rect, p.conflict_bar_btn);
                renderer.draw_top_text(
                    keep_text,
                    Vec2::new(keep_x + btn_pad, text_y),
                    btn_style,
                    keep_rect,
                );

                // Delete button (destructive, leftmost of buttons)
                let delete_text = "Delete";
                let delete_w = delete_text.len() as f32 * cell_size.width + btn_pad * 2.0;
                let delete_x = keep_x - delete_w - 4.0;
                let delete_rect = Rect::new(delete_x, btn_y, delete_w, btn_h);
                let delete_bg = crate::tide_core::Color::new(0.6, 0.2, 0.2, 1.0);
                renderer.draw_top_rect(delete_rect, delete_bg);
                renderer.draw_top_text(
                    delete_text,
                    Vec2::new(delete_x + btn_pad, text_y),
                    btn_style,
                    delete_rect,
                );

                continue;
            }
        }

        // Check for save confirm bar first
        if let Some(ref sc) = app.modal.save_confirm {
            if sc.pane_id == pane_id {
                // Render save confirm bar
                renderer.draw_top_rect(bar_rect, p.conflict_bar_bg);
                let text_y = bar_rect.y + (CONFLICT_BAR_HEIGHT - cell_size.height) / 2.0;
                let ts = text_style(p.conflict_bar_text);
                renderer.draw_top_text(
                    "Unsaved changes",
                    Vec2::new(bar_rect.x + 8.0, text_y),
                    ts,
                    bar_rect,
                );

                let btn_style = bold_style(p.conflict_bar_btn_text);
                let btn_pad = 8.0;
                let btn_h = CONFLICT_BAR_HEIGHT - 6.0;
                let btn_y = bar_rect.y + 3.0;

                // Cancel button (rightmost)
                let cancel_text = "Cancel";
                let cancel_w = cancel_text.len() as f32 * cell_size.width + btn_pad * 2.0;
                let cancel_x = bar_rect.x + bar_rect.width - cancel_w - 4.0;
                let cancel_rect = Rect::new(cancel_x, btn_y, cancel_w, btn_h);
                renderer.draw_top_rect(cancel_rect, p.conflict_bar_btn);
                renderer.draw_top_text(
                    cancel_text,
                    Vec2::new(cancel_x + btn_pad, text_y),
                    btn_style,
                    cancel_rect,
                );

                // Don't Save button
                let dont_save_text = "Don't Save";
                let dont_save_w = dont_save_text.len() as f32 * cell_size.width + btn_pad * 2.0;
                let dont_save_x = cancel_x - dont_save_w - 4.0;
                let dont_save_rect = Rect::new(dont_save_x, btn_y, dont_save_w, btn_h);
                renderer.draw_top_rect(dont_save_rect, p.conflict_bar_btn);
                renderer.draw_top_text(
                    dont_save_text,
                    Vec2::new(dont_save_x + btn_pad, text_y),
                    btn_style,
                    dont_save_rect,
                );

                // Save button
                let save_text = "Save";
                let save_w = save_text.len() as f32 * cell_size.width + btn_pad * 2.0;
                let save_x = dont_save_x - save_w - 4.0;
                let save_rect = Rect::new(save_x, btn_y, save_w, btn_h);
                renderer.draw_top_rect(save_rect, p.conflict_bar_btn);
                renderer.draw_top_text(
                    save_text,
                    Vec2::new(save_x + btn_pad, text_y),
                    btn_style,
                    save_rect,
                );

                continue; // Don't also show conflict bar
            }
        }

        // Notification bar (disk changed, diff mode, or file deleted)
        if let Some(PaneKind::Editor(pane)) = app.panes.get(&pane_id) {
            if pane.needs_notification_bar() {
                renderer.draw_top_rect(bar_rect, p.conflict_bar_bg);
                let text_y = bar_rect.y + (CONFLICT_BAR_HEIGHT - cell_size.height) / 2.0;
                let ts = text_style(p.conflict_bar_text);
                let msg = if pane.file_deleted {
                    "File deleted on disk"
                } else if pane.diff_mode {
                    "Comparing with disk"
                } else {
                    "File changed on disk"
                };
                renderer.draw_top_text(msg, Vec2::new(bar_rect.x + 8.0, text_y), ts, bar_rect);

                let btn_style = bold_style(p.conflict_bar_btn_text);
                let btn_pad = 8.0;
                let btn_h = CONFLICT_BAR_HEIGHT - 6.0;
                let btn_y = bar_rect.y + 3.0;

                // Overwrite button (rightmost)
                let overwrite_text = "Overwrite";
                let overwrite_w = overwrite_text.len() as f32 * cell_size.width + btn_pad * 2.0;
                let overwrite_x = bar_rect.x + bar_rect.width - overwrite_w - 4.0;
                let overwrite_rect = Rect::new(overwrite_x, btn_y, overwrite_w, btn_h);
                renderer.draw_top_rect(overwrite_rect, p.conflict_bar_btn);
                renderer.draw_top_text(
                    overwrite_text,
                    Vec2::new(overwrite_x + btn_pad, text_y),
                    btn_style,
                    overwrite_rect,
                );

                // Reload button (not for deleted files)
                if !pane.file_deleted {
                    let reload_text = "Reload";
                    let reload_w = reload_text.len() as f32 * cell_size.width + btn_pad * 2.0;
                    let reload_x = overwrite_x - reload_w - 4.0;
                    let reload_rect = Rect::new(reload_x, btn_y, reload_w, btn_h);
                    renderer.draw_top_rect(reload_rect, p.conflict_bar_btn);
                    renderer.draw_top_text(
                        reload_text,
                        Vec2::new(reload_x + btn_pad, text_y),
                        btn_style,
                        reload_rect,
                    );
                }
            }
        }
    }
}
