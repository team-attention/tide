use crate::tide_core::{Rect, Renderer, Vec2};

use crate::pane::PaneKind;
use crate::state::search::SearchField;
use crate::theme::*;
use crate::App;

use super::super::raster_icons::FLATICON_CLOSE;
use super::{
    draw_cursor_beam, draw_popup_border, search_bar_cursor_advance_cells,
    search_bar_text_advance_cells, text_style,
};

pub(crate) fn search_bar_close_icon_text_glyph() -> Option<&'static str> {
    None
}

pub(crate) fn search_close_raster_icon_asset() -> &'static crate::tide_renderer::RasterIconAsset {
    &FLATICON_CLOSE
}

fn render_search_close_icon(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    rect: Rect,
    color: crate::tide_core::Color,
) {
    if search_bar_close_icon_text_glyph().is_some() {
        return;
    }

    let icon_size = 12.0_f32;
    let icon_rect = Rect::new(
        (rect.x + (rect.width - icon_size) / 2.0).round(),
        (rect.y + (rect.height - icon_size) / 2.0).round(),
        icon_size,
        icon_size,
    );
    renderer.draw_top_raster_icon(search_close_raster_icon_asset(), icon_rect, color);
}

struct SearchBarRenderState {
    rect: Rect,
    query: String,
    replacement: String,
    display: String,
    query_cursor: usize,
    replacement_cursor: usize,
    is_focused: bool,
    replace_visible: bool,
    active_field: SearchField,
}

#[allow(clippy::too_many_arguments)]
fn render_search_input_text(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    text: &str,
    cursor_pos: usize,
    placeholder: &str,
    is_focused: bool,
    text_x: f32,
    text_y: f32,
    text_clip: Rect,
) {
    let cell_size = renderer.cell_size();
    let ts = text_style(p.search_bar_text);
    let muted_style = text_style(p.tab_text);
    let has_preedit = is_focused && !app.ime.preedit.is_empty();
    let before_w = if is_focused {
        search_bar_cursor_advance_cells(text, cursor_pos, "") as f32 * cell_size.width
    } else {
        0.0
    };
    let preedit_w = if has_preedit {
        search_bar_text_advance_cells(&app.ime.preedit) as f32 * cell_size.width
    } else {
        0.0
    };

    if text.is_empty() && !has_preedit {
        renderer.draw_top_text(
            placeholder,
            Vec2::new(text_x, text_y),
            muted_style,
            text_clip,
        );
    } else if has_preedit {
        let before = &text[..cursor_pos];
        let after = &text[cursor_pos..];

        if !before.is_empty() {
            renderer.draw_top_text(before, Vec2::new(text_x, text_y), ts, text_clip);
        }
        let preedit_x = text_x + before_w;
        let preedit_style = text_style(p.ime_preedit_fg);
        renderer.draw_top_rect(
            Rect::new(preedit_x, text_y, preedit_w, cell_size.height),
            p.ime_preedit_bg,
        );
        renderer.draw_top_text(
            &app.ime.preedit,
            Vec2::new(preedit_x, text_y),
            preedit_style,
            text_clip,
        );
        renderer.draw_top_rect(
            Rect::new(preedit_x, text_y + cell_size.height - 1.0, preedit_w, 1.0),
            p.ime_preedit_fg,
        );
        if !after.is_empty() {
            renderer.draw_top_text(
                after,
                Vec2::new(preedit_x + preedit_w, text_y),
                ts,
                text_clip,
            );
        }
    } else {
        renderer.draw_top_text(text, Vec2::new(text_x, text_y), ts, text_clip);
    }

    if is_focused {
        let cx = text_x
            + search_bar_cursor_advance_cells(text, cursor_pos, &app.ime.preedit) as f32
                * cell_size.width;
        draw_cursor_beam(renderer, cx, text_y, cell_size.height, p.cursor_accent);
    }
}

/// Render search bar UI for panes that have search visible.
pub(super) fn render_search_bars(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    visual_pane_rects: &[(u64, Rect)],
) {
    let search_focus = app.focus.search_focus;
    let cell_size = renderer.cell_size();

    // Helper: render a search bar floating at top-right of a given rect
    let mut search_bars: Vec<SearchBarRenderState> = Vec::new();
    for &(id, rect) in visual_pane_rects {
        let (
            query,
            replacement,
            display,
            query_cursor,
            replacement_cursor,
            replace_visible,
            active_field,
            visible,
        ) = match app.panes.get(&id) {
            Some(PaneKind::Terminal(pane)) => match &pane.search {
                Some(s) if s.visible => (
                    s.input.text.clone(),
                    String::new(),
                    s.current_display(),
                    s.input.cursor,
                    0,
                    false,
                    SearchField::Query,
                    true,
                ),
                _ => continue,
            },
            Some(PaneKind::Editor(pane)) => match &pane.search {
                Some(s) if s.visible => (
                    s.input.text.clone(),
                    s.replacement.text.clone(),
                    s.current_display(),
                    s.input.cursor,
                    s.replacement.cursor,
                    s.replace_visible,
                    s.active_field,
                    true,
                ),
                _ => continue,
            },
            Some(PaneKind::Browser(bp)) => match &bp.search {
                Some(s) if s.visible => (
                    s.input.text.clone(),
                    String::new(),
                    String::new(),
                    s.input.cursor,
                    0,
                    false,
                    SearchField::Query,
                    true,
                ),
                _ => continue,
            },
            _ => continue,
        };
        if visible {
            search_bars.push(SearchBarRenderState {
                rect,
                query,
                replacement,
                display,
                query_cursor,
                replacement_cursor,
                is_focused: search_focus == Some(id),
                replace_visible,
                active_field,
            });
        }
    }

    for search_bar in &search_bars {
        let rect = search_bar.rect;
        let bar_w = SEARCH_BAR_WIDTH.min(rect.width - 16.0);
        if bar_w < 80.0 {
            continue;
        } // too narrow to render
        let bar_h = if search_bar.replace_visible {
            SEARCH_BAR_HEIGHT * 2.0
        } else {
            SEARCH_BAR_HEIGHT
        };
        let bar_x = rect.x + rect.width - bar_w - 8.0;
        let bar_y = rect.y + TAB_BAR_HEIGHT + 4.0;
        let bar_rect = Rect::new(bar_x, bar_y, bar_w, bar_h);

        // Background (top layer — fully opaque, covers text)
        renderer.draw_top_rect(bar_rect, p.search_bar_bg);

        // Border
        draw_popup_border(renderer, bar_rect, p.search_bar_border);

        let text_x = bar_x + 6.0;
        let query_text_y = bar_y + (SEARCH_BAR_HEIGHT - cell_size.height) / 2.0;
        let counter_style = text_style(p.search_bar_counter);

        // Layout: [query text] [counter] [close button]
        let close_area_w = SEARCH_BAR_CLOSE_SIZE;
        let close_x = bar_x + bar_w - close_area_w;
        let counter_w = search_bar.display.len() as f32 * cell_size.width;
        let counter_x = close_x - counter_w - 4.0;
        let text_clip_w = (counter_x - text_x - 4.0).max(0.0);

        // Query text (top layer) or placeholder, with IME preedit inline.
        let text_clip = Rect::new(text_x, bar_y, text_clip_w, bar_h);
        render_search_input_text(
            app,
            renderer,
            p,
            &search_bar.query,
            search_bar.query_cursor,
            "Search...",
            search_bar.is_focused && search_bar.active_field == SearchField::Query,
            text_x,
            query_text_y,
            text_clip,
        );

        if search_bar.replace_visible {
            let divider_y = bar_y + SEARCH_BAR_HEIGHT;
            renderer.draw_top_rect(
                Rect::new(bar_x + 1.0, divider_y, bar_w - 2.0, 1.0),
                p.search_bar_border,
            );
            let replacement_text_y = divider_y + (SEARCH_BAR_HEIGHT - cell_size.height) / 2.0;
            let replacement_clip =
                Rect::new(text_x, divider_y, close_x - text_x - 4.0, SEARCH_BAR_HEIGHT);
            render_search_input_text(
                app,
                renderer,
                p,
                &search_bar.replacement,
                search_bar.replacement_cursor,
                "Replace...",
                search_bar.is_focused && search_bar.active_field == SearchField::Replacement,
                text_x,
                replacement_text_y,
                replacement_clip,
            );
        }

        // Counter text
        let counter_clip = Rect::new(counter_x, bar_y, counter_w + 4.0, SEARCH_BAR_HEIGHT);
        renderer.draw_top_text(
            &search_bar.display,
            Vec2::new(counter_x, query_text_y),
            counter_style,
            counter_clip,
        );

        // Close button
        let close_clip = Rect::new(close_x, bar_y, close_area_w, SEARCH_BAR_HEIGHT);
        render_search_close_icon(renderer, close_clip, counter_style.foreground);
    }
}
