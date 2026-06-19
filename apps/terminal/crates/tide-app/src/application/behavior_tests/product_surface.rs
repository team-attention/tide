// Spec: docs/specs/product-surface.md

use crate::state::{first_run_guide_dismiss_hit, first_run_guide_geometry, FIRST_RUN_GUIDE_ROWS};
use crate::tide_core::{Size, Vec2};
use crate::tide_platform::WindowCommand;
use crate::App;
use crate::AppCorePort;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app.settings.onboarding.first_run_guide_dismissed = false;
    app
}

#[test]
fn first_run_guide_copy_fits_compact_panel() {
    let app = test_app();
    let geometry = first_run_guide_geometry(
        app.logical_size(),
        app.window.cached_cell_size,
        app.window.top_inset,
    );
    let longest_row_cells = FIRST_RUN_GUIDE_ROWS
        .iter()
        .map(|row| row.chars().count())
        .max()
        .unwrap_or_default();

    assert!(geometry.panel_rect.width <= 520.0);
    assert!(
        longest_row_cells as f32 * app.window.cached_cell_size.width + 24.0
            <= geometry.panel_rect.width
    );
    assert!(FIRST_RUN_GUIDE_ROWS.iter().all(|row| row.len() <= 36));
}

#[test]
fn first_run_guide_body_click_does_not_dismiss() {
    let mut app = test_app();
    let geometry = first_run_guide_geometry(
        app.logical_size(),
        app.window.cached_cell_size,
        app.window.top_inset,
    );
    let body_pos = Vec2::new(geometry.panel_rect.x + 16.0, geometry.panel_rect.y + 16.0);

    assert!(!first_run_guide_dismiss_hit(
        app.logical_size(),
        app.window.cached_cell_size,
        app.window.top_inset,
        body_pos
    ));
    assert!(!AppCorePort::dismiss_first_run_guide_at(&mut app, body_pos));
    assert!(!app.settings.onboarding.first_run_guide_dismissed);
}

#[test]
fn first_run_guide_dismiss_click_persists_and_broadcasts() {
    let mut app = test_app();
    app.cache.needs_redraw = false;
    app.pending_platform_commands.clear();

    let geometry = first_run_guide_geometry(
        app.logical_size(),
        app.window.cached_cell_size,
        app.window.top_inset,
    );
    let dismiss_center = Vec2::new(
        geometry.dismiss_rect.x + geometry.dismiss_rect.width / 2.0,
        geometry.dismiss_rect.y + geometry.dismiss_rect.height / 2.0,
    );

    assert!(AppCorePort::dismiss_first_run_guide_at(
        &mut app,
        dismiss_center
    ));
    assert!(app.settings.onboarding.first_run_guide_dismissed);
    assert!(app.cache.needs_redraw);
    assert!(matches!(
        app.pending_platform_commands.last(),
        Some(WindowCommand::BroadcastSettingsChanged)
    ));
    assert!(!AppCorePort::dismiss_first_run_guide_at(
        &mut app,
        dismiss_center
    ));
}
