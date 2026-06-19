use crate::state::{FIRST_RUN_GUIDE_DISMISS_LABEL, FIRST_RUN_GUIDE_ROWS, FIRST_RUN_GUIDE_TITLE};
use crate::theme::*;
use crate::tide_core::{Rect, Renderer, Vec2};
use crate::App;
use crate::AppCorePort;

use super::{bold_style, draw_popup_rounded_bg, text_style, visual_width};

const GUIDE_RADIUS: f32 = 7.0;
const GUIDE_PAD_X: f32 = 12.0;
const GUIDE_PAD_TOP: f32 = 12.0;
const GUIDE_ROW_GAP: f32 = 5.0;

pub(super) fn render_first_run_guide(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    if app.settings.onboarding.first_run_guide_dismissed || app.modal.is_any_open() {
        return;
    }

    let cell_size = renderer.cell_size();
    let geometry =
        crate::state::first_run_guide_geometry(app.logical_size(), cell_size, app.window.top_inset);
    let panel = geometry.panel_rect;
    let clip = Rect::new(
        panel.x + GUIDE_PAD_X,
        panel.y + GUIDE_PAD_TOP,
        panel.width - GUIDE_PAD_X * 2.0,
        panel.height - GUIDE_PAD_TOP * 2.0,
    );

    renderer.draw_top_shadow(
        panel,
        crate::tide_core::Color::new(0.0, 0.0, 0.0, 0.22),
        6.0,
        30.0,
        0.0,
    );
    draw_popup_rounded_bg(renderer, panel, p.popup_bg, p.popup_border, GUIDE_RADIUS);

    let title_y = panel.y + GUIDE_PAD_TOP;
    renderer.draw_top_text(
        FIRST_RUN_GUIDE_TITLE,
        Vec2::new(panel.x + GUIDE_PAD_X, title_y),
        bold_style(p.tab_text_focused),
        clip,
    );

    let row_start_y = title_y + cell_size.height + 12.0;
    let line_h = cell_size.height + GUIDE_ROW_GAP;
    for (idx, row) in FIRST_RUN_GUIDE_ROWS.iter().enumerate() {
        let y = row_start_y + idx as f32 * line_h;
        render_guide_row(
            renderer,
            row,
            Vec2::new(panel.x + GUIDE_PAD_X, y),
            clip,
            p,
            cell_size.width,
        );
    }

    draw_popup_rounded_bg(
        renderer,
        geometry.dismiss_rect,
        p.popup_selected,
        p.popup_border,
        5.0,
    );
    let label_w = visual_width(FIRST_RUN_GUIDE_DISMISS_LABEL) as f32 * cell_size.width;
    let label_x = geometry.dismiss_rect.x + (geometry.dismiss_rect.width - label_w) / 2.0;
    let label_y = geometry.dismiss_rect.y + (geometry.dismiss_rect.height - cell_size.height) / 2.0;
    renderer.draw_top_text(
        FIRST_RUN_GUIDE_DISMISS_LABEL,
        Vec2::new(label_x, label_y),
        bold_style(p.tab_text_focused),
        geometry.dismiss_rect,
    );
}

fn render_guide_row(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    row: &str,
    pos: Vec2,
    clip: Rect,
    p: &ThemePalette,
    cell_width: f32,
) {
    let Some((label, detail)) = row.split_once(" = ") else {
        renderer.draw_top_text(row, pos, text_style(p.tab_text_active), clip);
        return;
    };

    renderer.draw_top_text(label, pos, bold_style(p.tab_text_focused), clip);

    let label_w = visual_width(label) as f32 * cell_width;
    let separator = " = ";
    renderer.draw_top_text(
        separator,
        Vec2::new(pos.x + label_w, pos.y),
        text_style(p.tab_text),
        clip,
    );

    let detail_x = pos.x + label_w + visual_width(separator) as f32 * cell_width;
    renderer.draw_top_text(
        detail,
        Vec2::new(detail_x, pos.y),
        text_style(p.tab_text_active),
        clip,
    );
}
