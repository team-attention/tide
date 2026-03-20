use tide_core::{Rect, Renderer, Vec2};

use crate::pane::PaneKind;
use crate::theme::*;
use crate::App;
use crate::AppCorePort;

use super::{visual_width, draw_popup_border, draw_cursor_beam, text_style};

/// Render search bar UI for panes that have search visible.
pub(super) fn render_search_bars(
    app: &App,
    renderer: &mut tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    visual_pane_rects: &[(u64, Rect)],
) {
    let search_focus = app.focus.search_focus;
    let cell_size = renderer.cell_size();

    // Helper: render a search bar floating at top-right of a given rect
    let mut search_bars: Vec<(tide_core::PaneId, Rect, String, String, usize, bool)> = Vec::new();
    for &(id, rect) in visual_pane_rects {
        let (query, display, cursor_pos, visible) = match app.panes.get(&id) {
            Some(PaneKind::Terminal(pane)) => match &pane.search {
                Some(s) if s.visible => (s.input.text.clone(), s.current_display(), s.input.cursor, true),
                _ => continue,
            },
            Some(PaneKind::Editor(pane)) => match &pane.search {
                Some(s) if s.visible => (s.input.text.clone(), s.current_display(), s.input.cursor, true),
                _ => continue,
            },
            Some(PaneKind::Browser(bp)) => match &bp.search {
                Some(s) if s.visible => (s.input.text.clone(), String::new(), s.input.cursor, true),
                _ => continue,
            },
            _ => continue,
        };
        if visible {
            search_bars.push((id, rect, query, display, cursor_pos, search_focus == Some(id)));
        }
    }

    for (_id, rect, query, display, cursor_pos, is_focused) in &search_bars {
        let bar_w = SEARCH_BAR_WIDTH.min(rect.width - 16.0);
        if bar_w < 80.0 { continue; } // too narrow to render
        let bar_h = SEARCH_BAR_HEIGHT;
        let bar_x = rect.x + rect.width - bar_w - 8.0;
        let bar_y = rect.y + TAB_BAR_HEIGHT + 4.0;
        let bar_rect = Rect::new(bar_x, bar_y, bar_w, bar_h);

        // Background (top layer — fully opaque, covers text)
        renderer.draw_top_rect(bar_rect, p.search_bar_bg);

        // Border
        draw_popup_border(renderer, bar_rect, p.search_bar_border);

        let text_x = bar_x + 6.0;
        let text_y = bar_y + (bar_h - cell_size.height) / 2.0;
        let ts = text_style(p.search_bar_text);
        let muted_style = text_style(p.tab_text);
        let counter_style = text_style(p.search_bar_counter);

        // Layout: [query text] [counter] [close button]
        let close_area_w = SEARCH_BAR_CLOSE_SIZE;
        let close_x = bar_x + bar_w - close_area_w;
        let counter_w = display.len() as f32 * cell_size.width;
        let counter_x = close_x - counter_w - 4.0;
        let text_clip_w = (counter_x - text_x - 4.0).max(0.0);

        // Query text (top layer) or placeholder
        let text_clip = Rect::new(text_x, bar_y, text_clip_w, bar_h);
        if query.is_empty() {
            renderer.draw_top_text("Search...", Vec2::new(text_x, text_y), muted_style, text_clip);
        } else {
            renderer.draw_top_text(query, Vec2::new(text_x, text_y), ts, text_clip);
        }

        // Text cursor (beam) — only when focused
        if *is_focused {
            let cx = text_x + visual_width(&query[..*cursor_pos]) as f32 * cell_size.width;
            draw_cursor_beam(renderer, cx, text_y, cell_size.height, p.cursor_accent);
        }

        // Counter text
        let counter_clip = Rect::new(counter_x, bar_y, counter_w + 4.0, bar_h);
        renderer.draw_top_text(display, Vec2::new(counter_x, text_y), counter_style, counter_clip);

        // Close button
        let close_icon_x = close_x + (close_area_w - cell_size.width) / 2.0;
        let close_clip = Rect::new(close_x, bar_y, close_area_w, bar_h);
        renderer.draw_top_text("\u{f00d}", Vec2::new(close_icon_x, text_y), counter_style, close_clip);
    }
}
