// Spec: docs/specs/input-routing.md — UC-2: RouteTextInput
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::*;
use crate::adapter::inward::text_routing_adapter::TextInputTarget;
use crate::App;
use std::path::PathBuf;
use crate::tide_core::Rect;

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
    app.panes.insert(id, PaneKind::Editor(EditorPane::new_empty(id)));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

#[test]
fn text_goes_to_editor_when_nothing_else_is_open() {
    // UC-2 BR-10: Text goes to Editor when nothing else is open
    let (app, id) = app_with_editor();
    assert_eq!(app.text_input_target(), TextInputTarget::Pane(id));
}

#[test]
fn text_goes_to_file_finder_when_open() {
    // UC-2 BR-11: Text goes to FileFinder when open
    let (mut app, _) = app_with_editor();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/"), vec![]));
    assert_eq!(app.text_input_target(), TextInputTarget::FileFinder);
}

#[test]
fn text_goes_to_search_bar_when_focused() {
    // UC-2 BR-12: Text goes to SearchBar when focused
    let (mut app, id) = app_with_editor();
    app.focus.search_focus = Some(id);
    assert_eq!(app.text_input_target(), TextInputTarget::SearchBar(id));
}

#[test]
fn text_is_consumed_when_no_pane_is_focused() {
    // UC-2 BR-13: Text is consumed when no Pane is focused
    let app = test_app();
    assert_eq!(app.text_input_target(), TextInputTarget::Consumed);
}

#[test]
fn text_is_consumed_when_file_tree_has_focus() {
    // UC-2 BR-14: Text is consumed when FocusArea is FileTree
    let (mut app, _) = app_with_editor();
    app.focus.focus_area = FocusArea::FileTree;
    assert_eq!(app.text_input_target(), TextInputTarget::Consumed);
}

#[test]
fn text_goes_to_save_as_input_when_open() {
    // UC-2 BR-15: Text goes to SaveAsInput when open
    let (mut app, id) = app_with_editor();
    app.modal.save_as_input = Some(SaveAsInput::new(
        id, PathBuf::from("/tmp"), Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    assert_eq!(app.text_input_target(), TextInputTarget::SaveAsInput);
}

#[test]
fn text_goes_to_file_tree_rename_when_active() {
    // UC-2 BR-16: Text goes to FileTreeRename when active
    let (mut app, _) = app_with_editor();
    app.modal.file_tree_rename = Some(FileTreeRenameState {
        entry_index: 0,
        original_path: PathBuf::from("/tmp/file.txt"),
        input: InputLine::with_text("file.txt".to_string()),
    });
    assert_eq!(app.text_input_target(), TextInputTarget::FileTreeRename);
}

#[test]
fn config_page_worktree_editing_receives_text() {
    // UC-2 BR-17: ConfigPage worktree editing receives text
    let mut app = test_app();
    let mut cp = ConfigPageState::new(vec![], String::new(), String::new());
    cp.worktree_editing = true;
    app.modal.config_page = Some(cp);
    assert_eq!(app.text_input_target(), TextInputTarget::ConfigPageWorktree);
}

#[test]
fn config_page_copy_files_editing_receives_text() {
    // UC-2 BR-18: ConfigPage copy_files editing receives text
    let mut app = test_app();
    let mut cp = ConfigPageState::new(vec![], String::new(), String::new());
    cp.copy_files_editing = true;
    app.modal.config_page = Some(cp);
    assert_eq!(app.text_input_target(), TextInputTarget::ConfigPageCopyFiles);
}
