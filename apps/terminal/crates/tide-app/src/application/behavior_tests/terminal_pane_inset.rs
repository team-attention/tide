// Spec: docs/specs/terminal-pane-inset.md

use std::time::Duration;

use crate::adapter::outward::clock_adapter::FixedClock;
use crate::pane::{terminal_grid_origin, PaneKind, TerminalPane};
use crate::state::{FocusArea, SURFACE_VISIBILITY_ANIMATION_DURATION};
use crate::theme::{terminal_content_top, terminal_top_padding, PANE_PADDING, TAB_BAR_HEIGHT};
use crate::tide_core::{Rect, Vec2};
use crate::tide_platform::{WindowCommand, WindowProxy};
use crate::{ActionPort, App, AppCorePort, DockPort, LayoutPort};

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_terminal(cols: u16, rows: u16) -> (App, u64) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, cols, rows, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(terminal_id);
    app.router.set_focused(terminal_id);
    (app, terminal_id)
}

fn app_with_terminal_context_pane(cols: u16, rows: u16) -> (App, u64) {
    let (mut app, terminal_id) = app_with_terminal(cols, rows);
    let context_id = app.layout.alloc_id();
    app.panes.insert(
        context_id,
        PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(context_id)),
    );
    app.add_pane_to_dock(context_id, Some(terminal_id));
    (app, terminal_id)
}

fn terminal_size(app: &App, terminal_id: u64) -> (u16, u16) {
    let Some(PaneKind::Terminal(terminal)) = app.panes.get(&terminal_id) else {
        panic!("expected terminal pane");
    };
    (
        terminal.backend.current_cols(),
        terminal.backend.current_rows(),
    )
}

fn test_window_proxy() -> (WindowProxy, std::sync::mpsc::Receiver<WindowCommand>) {
    let (tx, rx) = std::sync::mpsc::channel();
    (WindowProxy::new(tx, std::sync::Arc::new(|| {})), rx)
}

fn terminal_first_row_click(rect: Rect, cell_size: crate::tide_core::Size, col: usize) -> Vec2 {
    let inner_x = rect.x + PANE_PADDING;
    let inner_y = rect.y + terminal_content_top(cell_size.height);

    Vec2::new(
        inner_x + (col as f32 + 0.5) * cell_size.width,
        inner_y + 0.5 * cell_size.height,
    )
}

// --- UC-1: LayoutTerminalPaneContent ---

#[test]
fn terminal_content_top_offset_is_half_a_cell() {
    // UC-1 BR-1: Terminal Pane content starts half a cell below the tab bar
    assert_eq!(terminal_top_padding(16.0), 8.0);
    assert_eq!(terminal_content_top(16.0), TAB_BAR_HEIGHT + 8.0);
}

#[test]
fn terminal_ime_cursor_area_uses_the_terminal_top_inset() {
    // UC-1 BR-4: Terminal IME cursor geometry uses the same inset-adjusted origin as terminal rendering
    let (mut app, terminal_id) = app_with_terminal(40, 6);
    let cell_size = app.window.cached_cell_size;
    let pane_rect = Rect::new(
        24.0,
        12.0,
        40.0 * cell_size.width + 2.0 * PANE_PADDING,
        terminal_content_top(cell_size.height) + 6.0 * cell_size.height + PANE_PADDING,
    );
    app.pane_rects = vec![(terminal_id, pane_rect)];
    app.visual_pane_rects = vec![(terminal_id, pane_rect)];
    app.ime.cursor_dirty = true;

    let (window, rx) = test_window_proxy();
    app.poll_background_events(&window);

    let mut cursor_area = None;
    while let Ok(command) = rx.try_recv() {
        if let WindowCommand::SetImeCursorArea {
            pane_id,
            x,
            y,
            w,
            h,
        } = command
        {
            cursor_area = Some((pane_id, x, y, w, h));
        }
    }

    let (pane_id, x, y, w, h) = cursor_area.expect("terminal IME cursor area command");
    assert_eq!(pane_id, terminal_id);
    assert_eq!(x, (pane_rect.x + PANE_PADDING) as f64);
    assert_eq!(
        y,
        (pane_rect.y + terminal_content_top(cell_size.height)) as f64
    );
    assert_eq!(w, cell_size.width as f64);
    assert_eq!(h, cell_size.height as f64);
}

#[test]
fn terminal_grid_origin_stays_left_anchored_when_width_changes() {
    // UC-1 BR-9: Terminal Pane grid origin stays left-anchored inside the padded content rect when the rect width changes.
    let narrow = Rect::new(32.0, 48.0, 501.0, 320.0);
    let wide = Rect::new(32.0, 48.0, 537.0, 320.0);

    assert_eq!(terminal_grid_origin(narrow).x, narrow.x);
    assert_eq!(terminal_grid_origin(wide).x, narrow.x);
    assert_eq!(terminal_grid_origin(wide).y, narrow.y);
}

// --- UC-2: MapTerminalCoordinates ---

#[test]
fn terminal_click_mapping_respects_the_terminal_top_inset() {
    // UC-2 BR-2, BR-3: Pointer positions inside the top inset do not map to row 0, while first-row positions still do
    let url = "https://example.com";
    let (mut app, terminal_id) = app_with_terminal(40, 6);
    let cell_size = app.window.cached_cell_size;
    let pane_rect = Rect::new(
        24.0,
        12.0,
        40.0 * cell_size.width + 2.0 * PANE_PADDING,
        terminal_content_top(cell_size.height) + 6.0 * cell_size.height + PANE_PADDING,
    );
    app.pane_rects = vec![(terminal_id, pane_rect)];
    app.visual_pane_rects = vec![(terminal_id, pane_rect)];

    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&terminal_id) {
        pane.backend.load_mock_screen_for_test(url);
    }

    let padding_click = Vec2::new(
        pane_rect.x + PANE_PADDING + 2.0 * cell_size.width,
        pane_rect.y + TAB_BAR_HEIGHT + terminal_top_padding(cell_size.height) / 2.0,
    );
    assert_eq!(
        crate::TextExtractPort::extract_url_at(&app, terminal_id, padding_click),
        None
    );

    let first_row_click = terminal_first_row_click(pane_rect, cell_size, 2);
    assert_eq!(
        crate::TextExtractPort::extract_url_at(&app, terminal_id, first_row_click),
        Some(url.to_string())
    );
}

#[test]
fn terminal_click_mapping_uses_left_anchored_grid_origin() {
    // UC-2 BR-10: Terminal pointer mapping uses the same left-anchored grid origin as terminal rendering.
    let url = "https://example.com";
    let (mut app, terminal_id) = app_with_terminal(40, 6);
    let cell_size = app.window.cached_cell_size;
    let pane_rect = Rect::new(
        24.0,
        12.0,
        40.0 * cell_size.width + 2.0 * PANE_PADDING + cell_size.width - 2.0,
        terminal_content_top(cell_size.height) + 6.0 * cell_size.height + PANE_PADDING,
    );
    app.pane_rects = vec![(terminal_id, pane_rect)];
    app.visual_pane_rects = vec![(terminal_id, pane_rect)];

    if let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&terminal_id) {
        pane.backend.load_mock_screen_for_test(url);
    }

    let left_anchored_click = Vec2::new(
        pane_rect.x + PANE_PADDING + 2.5 * cell_size.width,
        pane_rect.y + terminal_content_top(cell_size.height) + 0.5 * cell_size.height,
    );

    assert_eq!(
        crate::TextExtractPort::extract_url_at(&app, terminal_id, left_anchored_click),
        Some(url.to_string())
    );
}

// --- UC-3: StabilizeTerminalResize ---

#[test]
fn terminal_backend_resize_waits_for_deferred_window_resize_to_settle() {
    // UC-3 BR-5/BR-7: deferred window resize coalesces Terminal backend resize until the final layout.
    let (mut app, terminal_id) = app_with_terminal(80, 24);
    app.compute_layout();
    let initial_size = terminal_size(&app, terminal_id);

    app.window.window_size = (1280, 640);
    app.set_resize_deferred(50);
    app.compute_layout();
    assert_eq!(terminal_size(&app, terminal_id), initial_size);

    app.timing.resize_deferred_at = None;
    app.compute_layout();
    let settled_size = terminal_size(&app, terminal_id);

    assert!(settled_size.0 > initial_size.0);
    assert_eq!(settled_size.1, initial_size.1);
}

#[test]
fn terminal_backend_resize_throttles_live_updates_during_side_surface_animation() {
    // UC-3 BR-6/BR-7/BR-13: side-surface animation throttles live Terminal backend resize instead of resizing on every intermediate frame.
    let (mut app, terminal_id) = app_with_terminal_context_pane(80, 24);
    app.dock.dock_open = false;
    app.dock.visibility_animation = None;
    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(terminal_id);
    app.router.set_focused(terminal_id);
    app.compute_layout();
    let initial_size = terminal_size(&app, terminal_id);

    app.handle_global_action(crate::tide_input::GlobalAction::ToggleDock);

    assert!(app.surface_visibility_animation_active());
    assert_eq!(terminal_size(&app, terminal_id), initial_size);

    app.ports.clock = Box::new(FixedClock {
        instant: app.ports.clock.now() + Duration::from_millis(121),
    });
    app.compute_layout();
    let mid_animation_size = terminal_size(&app, terminal_id);

    assert!(mid_animation_size.0 < initial_size.0);
    assert_eq!(mid_animation_size.1, initial_size.1);

    let settled_at =
        app.ports.clock.now() + SURFACE_VISIBILITY_ANIMATION_DURATION + Duration::from_millis(1);
    app.ports.clock = Box::new(FixedClock {
        instant: settled_at,
    });
    app.compute_layout();
    let settled_size = terminal_size(&app, terminal_id);

    assert!(!app.surface_visibility_animation_active());
    assert!(settled_size.0 < initial_size.0);
    assert_eq!(settled_size.1, initial_size.1);
}

#[test]
fn terminal_backend_resize_throttles_live_updates_during_border_drag() {
    // UC-3 BR-13: border dragging may deliver throttled live PTY resizes while motion is active, but never on every frame.
    let (mut app, terminal_id) = app_with_terminal(80, 24);
    app.ft.visible = true;
    app.ft.width = 240.0;
    app.compute_layout();
    let initial_size = terminal_size(&app, terminal_id);

    app.ft.border_dragging = true;
    app.ft.width = 320.0;
    app.compute_layout();
    let first_drag_size = terminal_size(&app, terminal_id);

    app.ft.width = 360.0;
    app.ports.clock = Box::new(FixedClock {
        instant: app.ports.clock.now() + Duration::from_millis(40),
    });
    app.compute_layout();
    let throttled_size = terminal_size(&app, terminal_id);

    app.ports.clock = Box::new(FixedClock {
        instant: app.ports.clock.now() + Duration::from_millis(90),
    });
    app.compute_layout();
    let updated_size = terminal_size(&app, terminal_id);

    assert!(first_drag_size.0 < initial_size.0);
    assert_eq!(throttled_size, first_drag_size);
    assert!(updated_size.0 < first_drag_size.0);
}

#[test]
fn terminal_backend_resize_skips_pathologically_narrow_widths() {
    // UC-3 BR-12: A layout-driven Terminal Pane width shrink below the minimum readable backend width clamps the PTY to the minimum readable backend column count.
    let (mut app, terminal_id) = app_with_terminal(80, 24);
    let cell_size = app.window.cached_cell_size;
    let Some(PaneKind::Terminal(pane)) = app.panes.get_mut(&terminal_id) else {
        panic!("expected terminal pane");
    };

    pane.resize_to_rect(
        Rect::new(0.0, 0.0, 3.0 * cell_size.width, 10.0 * cell_size.height),
        cell_size,
    );
    assert_eq!(pane.backend.current_cols(), 4);

    pane.resize_to_rect(
        Rect::new(0.0, 0.0, 12.0 * cell_size.width, 10.0 * cell_size.height),
        cell_size,
    );
    assert_eq!(pane.backend.current_cols(), 12);
}
