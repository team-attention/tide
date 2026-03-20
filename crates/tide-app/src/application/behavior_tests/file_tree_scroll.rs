// Spec: docs/specs/file-tree.md — UC-1: ScrollClamp
use crate::App;

fn test_app_with_file_tree() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app.ft.visible = true;
    app
}

#[test]
fn scroll_clamped_after_window_resize_shrinks_viewport() {
    // UC-1 BR-1: Scroll is clamped after window resize shrinks viewport
    let mut app = test_app_with_file_tree();
    app.ft.scroll = 500.0;
    app.ft.scroll_target = 500.0;
    app.update();
    let max = app.file_tree_max_scroll();
    assert!(app.ft.scroll <= max);
    assert!(app.ft.scroll_target <= max);
}

#[test]
fn scroll_target_clamped_independently() {
    // UC-1 BR-2: scroll_target is clamped independently of scroll
    let mut app = test_app_with_file_tree();
    app.ft.scroll = 100.0;
    app.ft.scroll_target = 300.0;
    app.update();
    let max = app.file_tree_max_scroll();
    assert!(app.ft.scroll <= max);
    assert!(app.ft.scroll_target <= max);
}

#[test]
fn hidden_file_tree_scroll_not_clamped() {
    // UC-1 BR-3: Hidden file tree scroll is not clamped
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app.ft.visible = false;
    app.ft.scroll = 999.0;
    app.ft.scroll_target = 999.0;
    app.update();
    assert_eq!(app.ft.scroll, 999.0);
    assert_eq!(app.ft.scroll_target, 999.0);
}
