// Spec: docs/specs/input-routing.md — UC-4: DispatchGlobalAction
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::tide_input::GlobalAction;
use crate::ActionPort;
use crate::App;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_editor() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(id, PaneKind::Editor(EditorPane::new_empty(id)));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

#[test]
fn split_vertical_creates_new_pane_in_split_layout_and_focuses_it() {
    // UC-4 BR-28: SplitVertical creates new Pane in SplitLayout
    let (mut app, first_id) = app_with_editor();
    app.handle_global_action(GlobalAction::SplitVertical);
    assert_ne!(app.focus.focused, Some(first_id));
    assert_eq!(app.layout.pane_ids().len(), 2);
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn split_horizontal_creates_new_pane_in_split_layout_and_focuses_it() {
    // UC-4 BR-28: SplitHorizontal creates new Pane in SplitLayout
    let (mut app, first_id) = app_with_editor();
    app.handle_global_action(GlobalAction::SplitHorizontal);
    assert_ne!(app.focus.focused, Some(first_id));
    assert_eq!(app.layout.pane_ids().len(), 2);
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn find_opens_search_bar_on_focused_pane() {
    // UC-4 BR-31: Find opens search bar on focused Pane
    let (mut app, id) = app_with_editor();
    app.handle_global_action(GlobalAction::Find);
    assert_eq!(app.focus.search_focus, Some(id));
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.search.is_some());
    }
}

#[test]
fn find_again_reuses_existing_search_bar() {
    // UC-4 BR-32: Find again reuses existing search bar
    let (mut app, id) = app_with_editor();
    app.handle_global_action(GlobalAction::Find);
    assert_eq!(app.focus.search_focus, Some(id));
    app.handle_global_action(GlobalAction::Find);
    assert_eq!(app.focus.search_focus, Some(id));
}

#[test]
fn new_file_global_action_creates_editor_pane_in_tab_group() {
    // UC-4 BR-30: NewFile creates Editor Pane in TabGroup
    let (mut app, first_id) = app_with_editor();
    app.handle_global_action(GlobalAction::NewFile);
    assert_ne!(app.focus.focused, Some(first_id));
    let new_id = app.focus.focused.unwrap();
    assert!(matches!(app.panes.get(&new_id), Some(PaneKind::Editor(_))));
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
}

#[test]
fn new_tab_global_action_creates_terminal_pane_in_stage() {
    // UC-4 BR-29: NewTab in Stage creates Terminal (added to TabGroup)
    let (mut app, _) = app_with_editor();
    app.handle_global_action(GlobalAction::NewTab);
    let new_id = app.focus.focused.unwrap();
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Terminal(_))
    ));
    assert_eq!(app.layout.all_pane_ids().len(), app.panes.len());
}

#[test]
fn toggle_file_tree_from_stage_sets_focus_area_to_file_tree() {
    // UC-4 BR-33: ToggleFileTree shows and sets FocusArea
    let (mut app, _) = app_with_editor();
    assert!(!app.ft.visible);
    app.handle_global_action(GlobalAction::ToggleFileTree);
    assert!(app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::FileTree);
}

#[test]
fn toggle_file_tree_again_hides_and_restores_focus_area_to_stage() {
    // UC-4 BR-33: ToggleFileTree hides and restores FocusArea
    let (mut app, _) = app_with_editor();
    app.handle_global_action(GlobalAction::ToggleFileTree);
    assert!(app.ft.visible);
    app.handle_global_action(GlobalAction::ToggleFileTree);
    assert!(!app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn toggle_fullscreen_sets_pending_flag() {
    // UC-4 BR-34: ToggleFullscreen sets pending flag
    let (mut app, _) = app_with_editor();
    assert!(!app.window.pending_fullscreen_toggle);
    app.handle_global_action(GlobalAction::ToggleFullscreen);
    assert!(app.window.pending_fullscreen_toggle);
}

#[test]
fn file_finder_opens_via_global_action() {
    // UC-4 BR-35: FileFinder opens file finder modal
    let (mut app, _) = app_with_editor();
    app.handle_global_action(GlobalAction::FileFinder);
}
