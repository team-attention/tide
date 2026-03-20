// Spec: docs/specs/input-routing.md — UC-3: ManageFocus
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::App;
use crate::WorkspaceNavPort;
use crate::ActionPort;
use crate::tide_core::LayoutEngine;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_editor() -> (App, u64) {
    let mut app = test_app();
    let (layout, pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let pane = crate::pane::editor::EditorPane::new_empty(pane_id);
    app.panes.insert(pane_id, PaneKind::Editor(pane));
    app.focus.focused = Some(pane_id);
    app.focus.focus_area = FocusArea::Stage;
    (app, pane_id)
}

#[test]
fn new_app_starts_with_no_focused_pane() {
    // UC-3 BR-19: New App starts with no focused Pane
    let app = test_app();
    assert_eq!(app.focus.focused, None);
}

#[test]
fn new_app_starts_in_pane_area_focus() {
    // UC-3 BR-20: New App starts in Stage focus
    let app = test_app();
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn focus_terminal_sets_focus_area_to_pane_area() {
    // UC-3 BR-21: focus_terminal sets FocusArea to Stage
    let (mut app, id) = app_with_editor();
    app.focus.focus_area = FocusArea::FileTree;
    app.focus_terminal(id);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn focus_terminal_updates_chrome_generation_when_changing_pane() {
    // UC-3 BR-22: Changing focused Pane increments chrome_generation
    let mut app = test_app();
    let (layout, id1) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(id1, PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id1)));
    let id2 = app.layout.split(id1, crate::tide_core::SplitDirection::Vertical);
    app.panes.insert(id2, PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id2)));
    app.focus.focused = Some(id1);

    let gen_before = app.cache.chrome_generation;
    app.focus_terminal(id2);
    assert!(app.cache.chrome_generation > gen_before);
}

#[test]
fn focus_terminal_same_pane_does_not_change_chrome() {
    // UC-3 BR-23: Focusing same Pane does not change chrome_generation
    let (mut app, id) = app_with_editor();
    let gen_before = app.cache.chrome_generation;
    app.focus_terminal(id);
    assert_eq!(app.cache.chrome_generation, gen_before);
}

#[test]
fn toggling_file_tree_focus_cycles_through_three_states() {
    // UC-3 BR-24: File tree toggle cycles: hidden → shown+focused → hidden
    let (mut app, _) = app_with_editor();
    assert!(!app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);

    app.handle_focus_area(FocusArea::FileTree);
    assert!(app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::FileTree);

    app.handle_focus_area(FocusArea::FileTree);
    assert!(!app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn switching_to_pane_area_from_file_tree_preserves_focused_pane() {
    // UC-3 BR-25: Switching to Stage from FileTree preserves focused Pane
    let (mut app, id) = app_with_editor();
    app.ft.visible = true;
    app.focus.focus_area = FocusArea::FileTree;

    app.handle_focus_area(FocusArea::Stage);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.focused, Some(id));
}

#[test]
fn toggling_zoom_on_focused_pane_fills_entire_area() {
    // UC-3 BR-26: ToggleZoom sets zoomed_pane
    let mut app = test_app();
    let (layout, id1) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(id1, PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id1)));
    let id2 = app.layout.split(id1, crate::tide_core::SplitDirection::Vertical);
    app.panes.insert(id2, PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id2)));
    app.focus.focused = Some(id1);

    assert!(app.focus.zoomed_pane.is_none());
    app.handle_global_action(crate::tide_input::GlobalAction::ToggleZoom);
    assert_eq!(app.focus.zoomed_pane, Some(id1));
}

#[test]
fn toggling_zoom_again_restores_split_layout() {
    // UC-3 BR-26: ToggleZoom clears zoomed_pane
    let mut app = test_app();
    let (layout, id1) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes.insert(id1, PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id1)));
    app.focus.focused = Some(id1);

    app.handle_global_action(crate::tide_input::GlobalAction::ToggleZoom);
    assert_eq!(app.focus.zoomed_pane, Some(id1));
    app.handle_global_action(crate::tide_input::GlobalAction::ToggleZoom);
    assert!(app.focus.zoomed_pane.is_none());
}

#[test]
fn zoom_has_no_effect_when_focus_area_is_file_tree() {
    // UC-3 BR-27: Zoom has no effect when FocusArea is FileTree
    let (mut app, _) = app_with_editor();
    app.ft.visible = true;
    app.focus.focus_area = FocusArea::FileTree;

    app.handle_global_action(crate::tide_input::GlobalAction::ToggleZoom);
    assert!(app.focus.zoomed_pane.is_none());
}
