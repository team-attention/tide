// Spec: docs/specs/terminal-pane-inset.md

use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::theme::{terminal_content_top, terminal_top_padding, PANE_PADDING, TAB_BAR_HEIGHT};
use crate::tide_core::{Rect, Vec2};
use crate::tide_platform::{WindowCommand, WindowProxy};
use crate::App;

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

fn test_window_proxy() -> (WindowProxy, std::sync::mpsc::Receiver<WindowCommand>) {
    let (tx, rx) = std::sync::mpsc::channel();
    (WindowProxy::new(tx, std::sync::Arc::new(|| {})), rx)
}

fn terminal_first_row_click(rect: Rect, cell_size: crate::tide_core::Size, col: usize) -> Vec2 {
    let inner_x = rect.x + PANE_PADDING;
    let inner_y = rect.y + terminal_content_top(cell_size.height);
    let max_cols = ((rect.width - 2.0 * PANE_PADDING) / cell_size.width).floor() as usize;
    let actual_width = max_cols as f32 * cell_size.width;
    let extra_x = ((rect.width - 2.0 * PANE_PADDING) - actual_width) / 2.0;

    Vec2::new(
        inner_x + extra_x + (col as f32 + 0.5) * cell_size.width,
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
