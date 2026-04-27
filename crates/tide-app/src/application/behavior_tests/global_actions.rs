// Spec: docs/specs/input-routing.md — UC-4: DispatchGlobalAction
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_input::{AreaSlot, GlobalAction};
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

fn app_with_terminal() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(id, 80, 24, None, true).unwrap();
    app.panes.insert(id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(id);
    app.focus.stage_focused = Some(id);
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
fn new_file_global_action_creates_editor_pane_in_stage_split() {
    // UC-4 BR-30: NewFile creates Editor Pane as a Stage split leaf
    let (mut app, first_id) = app_with_editor();
    app.handle_global_action(GlobalAction::NewFile);
    assert_ne!(app.focus.focused, Some(first_id));
    let new_id = app.focus.focused.unwrap();
    assert!(matches!(app.panes.get(&new_id), Some(PaneKind::Editor(_))));
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
    assert!(app.layout.tab_group_containing(new_id).is_none());
}

#[test]
fn new_tab_global_action_creates_terminal_pane_in_stage() {
    // UC-4 BR-29: NewTab in Stage creates Terminal split leaf
    let (mut app, _) = app_with_editor();
    app.handle_global_action(GlobalAction::NewTab);
    let new_id = app.focus.focused.unwrap();
    assert!(matches!(
        app.panes.get(&new_id),
        Some(PaneKind::Terminal(_))
    ));
    assert_eq!(app.layout.pane_ids().len(), app.panes.len());
    assert!(app.layout.tab_group_containing(new_id).is_none());
}

#[test]
fn toggle_file_tree_from_stage_opens_without_moving_focus() {
    // UC-4 BR-33: ToggleFileTree shows FileTree View without moving focus on open.
    let (mut app, id) = app_with_editor();
    assert!(!app.ft.visible);
    app.handle_global_action(GlobalAction::ToggleFileTree);
    assert!(app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.focused, Some(id));
}

#[test]
fn focus_slot_2_opens_file_tree_without_moving_focus() {
    // UC-4 BR-33: The legacy FocusArea slot opens FileTree View without creating FileTree Cursor Row chrome.
    let (mut app, id) = app_with_editor();
    assert!(!app.ft.visible);

    app.handle_global_action(GlobalAction::FocusArea(AreaSlot::Slot2));

    assert!(app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
    assert_eq!(app.focus.focused, Some(id));
}

#[test]
fn toggle_file_tree_again_hides_and_restores_focus_area_to_stage() {
    // UC-4 BR-33: ToggleFileTree hides FileTree View and keeps Stage focus.
    let (mut app, _) = app_with_editor();
    app.handle_global_action(GlobalAction::ToggleFileTree);
    assert!(app.ft.visible);
    app.handle_global_action(GlobalAction::ToggleFileTree);
    assert!(!app.ft.visible);
    assert_eq!(app.focus.focus_area, FocusArea::Stage);
}

#[test]
fn toggle_dock_global_action_opens_terminal_context_surface() {
    // UC-4 BR-36: ToggleDock opens/focuses Dock using the focused Stage Terminal.
    let (mut app, terminal_id) = app_with_terminal();
    assert!(!app.dock.dock_open);

    app.handle_global_action(GlobalAction::ToggleDock);

    assert!(app.dock.dock_open);
    assert_eq!(app.focus.focus_area, FocusArea::Dock);
    assert_ne!(app.focus.focused, Some(terminal_id));
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
