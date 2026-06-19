use crate::tide_core::{Rect, Size, Vec2};

pub(crate) const FIRST_RUN_GUIDE_TITLE: &str = "Tide is terminal-first";
pub(crate) const FIRST_RUN_GUIDE_ROWS: [&str; 4] = [
    "Workspace = task",
    "Stage = live terminals",
    "Dock = focused terminal context",
    "Artifacts = reviewed agent handoff",
];
pub(crate) const FIRST_RUN_GUIDE_DISMISS_LABEL: &str = "Got it";

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct FirstRunGuideGeometry {
    pub panel_rect: Rect,
    pub dismiss_rect: Rect,
}

pub(crate) fn first_run_guide_geometry(
    logical: Size,
    cell_size: Size,
    top_inset: f32,
) -> FirstRunGuideGeometry {
    let margin = 16.0_f32;
    let panel_w = (logical.width - 2.0 * margin).clamp(320.0, 520.0);
    let line_h = cell_size.height + 5.0;
    let panel_h = (cell_size.height + 18.0) + line_h * FIRST_RUN_GUIDE_ROWS.len() as f32 + 34.0;
    let panel_x = margin.min((logical.width - panel_w).max(0.0));
    let panel_y = (top_inset + 12.0).min((logical.height - panel_h - margin).max(margin));
    let panel_rect = Rect::new(panel_x, panel_y, panel_w, panel_h);

    let button_pad_h = 10.0;
    let button_w =
        FIRST_RUN_GUIDE_DISMISS_LABEL.len() as f32 * cell_size.width + button_pad_h * 2.0;
    let button_h = cell_size.height + 8.0;
    let dismiss_rect = Rect::new(
        panel_rect.x + panel_rect.width - button_w - 12.0,
        panel_rect.y + panel_rect.height - button_h - 10.0,
        button_w,
        button_h,
    );

    FirstRunGuideGeometry {
        panel_rect,
        dismiss_rect,
    }
}

pub(crate) fn first_run_guide_dismiss_hit(
    logical: Size,
    cell_size: Size,
    top_inset: f32,
    pos: Vec2,
) -> bool {
    first_run_guide_geometry(logical, cell_size, top_inset)
        .dismiss_rect
        .contains(pos)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_run_guide_geometry_keeps_dismiss_button_inside_panel() {
        let logical = Size::new(960.0, 640.0);
        let cell = Size::new(8.0, 16.0);
        let geometry = first_run_guide_geometry(logical, cell, 40.0);

        assert!(geometry
            .panel_rect
            .contains(Vec2::new(geometry.dismiss_rect.x, geometry.dismiss_rect.y)));
        assert!(geometry.panel_rect.contains(Vec2::new(
            geometry.dismiss_rect.x + geometry.dismiss_rect.width - 1.0,
            geometry.dismiss_rect.y + geometry.dismiss_rect.height - 1.0
        )));
        assert!(geometry.panel_rect.y >= 40.0);
        assert!(geometry.panel_rect.width <= 520.0);
    }
}
