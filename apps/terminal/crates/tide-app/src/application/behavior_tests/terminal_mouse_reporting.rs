// Spec: docs/specs/terminal-mouse-reporting.md

use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::{LayoutEngine, Rect, SplitDirection, Vec2};
use crate::tide_platform::WindowProxy;
use crate::App;

fn test_window_proxy() -> WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

// --- UC-3: Any Motion ---

#[test]
fn terminal_any_motion_reporting_does_not_move_focus_between_panes() {
    // UC-3 BR-6: Buttonless pointer motion never changes the focused Pane.
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);

    let (layout, first_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let second_id = app.layout.split(first_id, SplitDirection::Vertical);

    let mut first = TerminalPane::with_cwd(first_id, 40, 20, None, true).unwrap();
    first.backend.stop_pty_for_test();
    let mut second = TerminalPane::with_cwd(second_id, 40, 20, None, true).unwrap();
    second.backend.stop_pty_for_test();
    second
        .backend
        .bench_write_to_term(b"\x1b[?1003h\x1b[?1006h");

    app.panes.insert(first_id, PaneKind::Terminal(first));
    app.panes.insert(second_id, PaneKind::Terminal(second));
    app.focus.focused = Some(first_id);
    app.focus.stage_focused = Some(first_id);
    app.focus.focus_area = FocusArea::Stage;
    app.router.set_focused(first_id);

    let first_rect = Rect::new(0.0, 0.0, 400.0, 400.0);
    let second_rect = Rect::new(400.0, 0.0, 400.0, 400.0);
    app.pane_rects = vec![(first_id, first_rect), (second_id, second_rect)];
    app.visual_pane_rects = app.pane_rects.clone();
    let chrome_generation = app.cache.chrome_generation;

    crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
        &mut app,
        Vec2::new(420.0, 80.0),
        &test_window_proxy(),
    );

    assert_eq!(app.focus.focused, Some(first_id));
    assert_eq!(app.focus.stage_focused, Some(first_id));
    assert_eq!(app.cache.chrome_generation, chrome_generation);
}
