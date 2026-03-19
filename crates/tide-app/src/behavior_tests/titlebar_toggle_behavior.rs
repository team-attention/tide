// Spec: docs/specs/titlebar-buttons.md
use crate::pane::{PaneKind, TerminalPane};
use crate::pane::editor::EditorPane;
use crate::state::FocusArea;
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_real_terminal() -> (App, u64) {
    let mut app = test_app();
    let (layout, tid) = tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let tp = TerminalPane::with_cwd(tid, 80, 24, None, true).unwrap();
    app.panes.insert(tid, PaneKind::Terminal(tp));
    app.focus.focused = Some(tid);
    app.focus.stage_focused = Some(tid);
    app.focus.focus_area = FocusArea::Stage;
    (app, tid)
}

// --- UC-1: ToggleFileTreeVisibility ---

#[test]
// UC-1 BR-1: Opening FileTree does not move focus
fn toggle_file_tree_visibility_opens_without_moving_focus() {
    let (mut app, tid) = app_with_real_terminal();
    app.ft.visible = false;
    app.focus.focus_area = FocusArea::Stage;

    app.toggle_file_tree_visibility();

    assert!(app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::Stage, "focus should stay on Stage");
    assert_eq!(app.focus.focused, Some(tid));
}

#[test]
// UC-1 BR-2: Closing FileTree when focused falls back to Stage
fn toggle_file_tree_visibility_closes_with_fallback_when_focused() {
    let (mut app, _tid) = app_with_real_terminal();
    app.ft.visible = true;
    app.focus.focus_area = FocusArea::FileTree;

    app.toggle_file_tree_visibility();

    assert!(!app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::Stage, "focus should fall back to Stage");
}

#[test]
// UC-1 BR-3: Closing FileTree when unfocused does not change focus
fn toggle_file_tree_visibility_closes_without_fallback_when_unfocused() {
    let (mut app, tid) = app_with_real_terminal();
    app.ft.visible = true;
    app.focus.focus_area = FocusArea::Stage;

    app.toggle_file_tree_visibility();

    assert!(!app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::Stage, "focus should remain on Stage");
    assert_eq!(app.focus.focused, Some(tid));
}

// --- UC-2: ToggleDockVisibility ---

#[test]
// UC-2 BR-1: Opening Dock does not move focus
fn toggle_dock_visibility_opens_without_moving_focus() {
    let (mut app, tid) = app_with_real_terminal();
    app.dock.dock_open = false;
    app.focus.focus_area = FocusArea::Stage;

    app.toggle_dock_visibility();

    assert!(app.dock.dock_open);
    assert_eq!(app.focus.focus_area, FocusArea::Stage, "focus should stay on Stage");
    assert_eq!(app.focus.focused, Some(tid));
}

#[test]
// UC-2 BR-2: Closing Dock when focused falls back to Stage
fn toggle_dock_visibility_closes_with_fallback_when_focused() {
    let (mut app, tid) = app_with_real_terminal();
    // Set up dock with a pane
    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);
    app.dock.dock_open = true;
    app.focus.focus_area = FocusArea::Dock;
    app.focus.focused = Some(e1);

    app.toggle_dock_visibility();

    assert!(!app.dock.dock_open);
    assert_eq!(app.focus.focus_area, FocusArea::Stage, "focus should fall back to Stage");
    assert_eq!(app.focus.focused, Some(tid), "focus should return to owner terminal");
}

#[test]
// UC-2 BR-3: Closing Dock when unfocused does not change focus
fn toggle_dock_visibility_closes_without_fallback_when_unfocused() {
    let (mut app, tid) = app_with_real_terminal();
    // Set up dock with a pane
    let e1 = app.layout.alloc_id();
    app.panes.insert(e1, PaneKind::Editor(EditorPane::new_empty(e1)));
    app.add_pane_to_dock(e1);
    app.dock.dock_open = true;
    app.focus.focus_area = FocusArea::Stage;
    app.focus.focused = Some(tid);

    app.toggle_dock_visibility();

    assert!(!app.dock.dock_open);
    assert_eq!(app.focus.focus_area, FocusArea::Stage, "focus should remain on Stage");
    assert_eq!(app.focus.focused, Some(tid));
}
