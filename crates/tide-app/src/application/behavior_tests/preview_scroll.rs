// Spec: docs/specs/editor.md
use crate::pane::editor::{self, EditorPane};
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::theme::{PANE_PADDING, TAB_BAR_HEIGHT};
use crate::ActionPort;
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn test_window_proxy() -> crate::tide_platform::WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    crate::tide_platform::WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

fn preview_content_rect(pane_rect: crate::tide_core::Rect) -> crate::tide_core::Rect {
    crate::pane::pane_content_rect(pane_rect, TAB_BAR_HEIGHT)
}

fn app_with_preview_editor(line_count: usize) -> (App, u64, crate::tide_core::Rect) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;

    let mut pane = EditorPane::new_empty(id);
    pane.preview_mode = true;
    pane.editor.buffer.lines = (0..line_count).map(|idx| format!("line {}", idx)).collect();
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;

    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    app.visual_pane_rects = vec![(id, pane_rect)];

    let content_rect = preview_content_rect(pane_rect);
    let cell = app.window.cached_cell_size;
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.prepare_inline_caches(content_rect, cell, false);
    }

    (app, id, pane_rect)
}

fn preview_visible_rows(app: &App, pane_rect: crate::tide_core::Rect) -> usize {
    ((pane_rect.height - TAB_BAR_HEIGHT - PANE_PADDING) / app.window.cached_cell_size.height)
        .floor() as usize
}

fn preview_max_scroll(app: &App, pane_id: u64, pane_rect: crate::tide_core::Rect) -> usize {
    let visible_rows = preview_visible_rows(app, pane_rect);
    match app.panes.get(&pane_id) {
        Some(PaneKind::Editor(pane)) => pane.preview_line_count().saturating_sub(visible_rows),
        _ => 0,
    }
}

// --- UC-4: PreviewScroll ---

#[test]
fn j_scrolls_down_one_line() {
    // UC-4 BR-18: j scrolls preview down one line
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('j', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 1);
}

#[test]
fn k_scrolls_up_one_line() {
    // UC-4 BR-19: k scrolls preview up one line
    let mut v = 5;
    let mut h = 0;
    editor::apply_preview_scroll('k', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 4);
}

#[test]
fn k_does_not_scroll_below_zero() {
    // UC-4 BR-20: k does not scroll below zero
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('k', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 0);
}

#[test]
fn d_scrolls_down_half_page() {
    // UC-4 BR-21: d scrolls down half page
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('d', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 15);
}

#[test]
fn u_scrolls_up_half_page() {
    // UC-4 BR-22: u scrolls up half page
    let mut v = 20;
    let mut h = 0;
    editor::apply_preview_scroll('u', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 5);
}

#[test]
fn g_scrolls_to_top() {
    // UC-4 BR-23: g scrolls to top
    let mut v = 50;
    let mut h = 0;
    editor::apply_preview_scroll('g', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 0);
}

#[test]
fn capital_g_scrolls_to_bottom() {
    // UC-4 BR-24: G scrolls to bottom
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('G', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 100);
}

#[test]
fn scroll_clamps_to_max() {
    // UC-4 BR-24: preview scroll clamps to the available range
    let mut v = 95;
    let mut h = 0;
    editor::apply_preview_scroll('j', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 96);
    let mut v2 = 100;
    editor::apply_preview_scroll('j', &mut v2, &mut h, 100, 100, 30);
    assert_eq!(v2, 100);
}

#[test]
fn mouse_wheel_preview_scroll_clamps_to_visible_range() {
    // UC-4 BR-27: Mouse-wheel preview scrolling clamps to the same visible range as keyboard preview navigation.
    let (mut app, id, pane_rect) = app_with_preview_editor(200);
    let pos = crate::tide_core::Vec2::new(pane_rect.x + 40.0, pane_rect.y + TAB_BAR_HEIGHT + 40.0);
    let max_scroll = preview_max_scroll(&app, id, pane_rect);

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::MouseScroll {
            delta: -1000.0,
            position: pos,
        }),
    );
    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(pane.preview_scroll, max_scroll);

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::MouseScroll {
            delta: 1000.0,
            position: pos,
        }),
    );
    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(pane.preview_scroll, 0);
}

#[test]
fn preview_scrollbar_drag_clamps_to_visible_range() {
    // UC-4 BR-28: Scrollbar drag in preview mode clamps to the same visible range as keyboard preview navigation.
    let (mut app, id, pane_rect) = app_with_preview_editor(200);
    let inner = preview_content_rect(pane_rect);
    let scrollbar_x = inner.x + inner.width - 1.0;
    let max_scroll = preview_max_scroll(&app, id, pane_rect);

    app.window.last_cursor_pos = crate::tide_core::Vec2::new(scrollbar_x, inner.y + 12.0);
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
        &mut app,
        crate::tide_core::Vec2::new(scrollbar_x, inner.y + inner.height + 200.0),
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::handle_mouse_up(
        &mut app,
        crate::tide_core::MouseButton::Left,
    );
    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(pane.preview_scroll, max_scroll);

    app.window.last_cursor_pos =
        crate::tide_core::Vec2::new(scrollbar_x, inner.y + inner.height - 12.0);
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
        &mut app,
        crate::tide_core::Vec2::new(scrollbar_x, inner.y - 200.0),
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::handle_mouse_up(
        &mut app,
        crate::tide_core::MouseButton::Left,
    );
    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(pane.preview_scroll, 0);
}
