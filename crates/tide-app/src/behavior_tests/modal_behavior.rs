// Spec: docs/specs/modal.md
use crate::pane::PaneKind;
use crate::state::*;
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
    app.panes.insert(id, PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id)));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

// --- UC-3: ModalLifecycle ---

#[test]
fn new_app_modal_stack_is_empty() {
    // UC-3 BR-14: New App has no modals open
    let app = test_app();
    assert!(!app.modal.is_any_open());
}

#[test]
fn modal_stack_close_all_dismisses_all_modals() {
    // UC-3 BR-15: close_all dismisses every modal
    let mut app = test_app();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/"), vec![]));
    app.modal.git_switcher = Some(GitSwitcherState::new(
        1, GitSwitcherMode::Branches, vec![], vec![],
        Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    assert!(app.modal.is_any_open());
    app.modal.close_all();
    assert!(!app.modal.is_any_open());
}

// --- UC-1: ModalInterception ---

#[test]
fn config_page_blocks_all_text_input() {
    // UC-1 BR-1: Config page blocks all text input
    let (mut app, _id) = app_with_editor();
    app.modal.config_page = Some(ConfigPageState::new(vec![], String::new(), String::new()));
    assert_eq!(
        app.text_input_target(),
        crate::event_handler::text_routing::TextInputTarget::Consumed,
    );
}

#[test]
fn context_menu_blocks_text_input() {
    // UC-1 BR-2: Context menu blocks text input
    let (mut app, _id) = app_with_editor();
    app.modal.context_menu = Some(ContextMenuState {
        entry_index: 0,
        path: PathBuf::from("/tmp"),
        is_dir: false,
        shell_idle: true,
        position: crate::tide_core::Vec2::new(0.0, 0.0),
        selected: 0,
    });
    assert_eq!(
        app.text_input_target(),
        crate::event_handler::text_routing::TextInputTarget::Consumed,
    );
}

#[test]
fn save_confirm_blocks_text_input() {
    // UC-1 BR-3: Save confirm blocks text input
    let (mut app, id) = app_with_editor();
    app.modal.save_confirm = Some(crate::SaveConfirmState { pane_id: id });
    assert_eq!(
        app.text_input_target(),
        crate::event_handler::text_routing::TextInputTarget::Consumed,
    );
}

#[test]
fn file_finder_captures_text_instead_of_pane() {
    // UC-1 BR-4: File finder captures text instead of Pane
    let (mut app, _id) = app_with_editor();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    assert_eq!(
        app.text_input_target(),
        crate::event_handler::text_routing::TextInputTarget::FileFinder,
    );
}

#[test]
fn git_switcher_captures_text_instead_of_pane() {
    // UC-1 BR-5: Git switcher captures text instead of Pane
    let (mut app, id) = app_with_editor();
    app.modal.git_switcher = Some(GitSwitcherState::new(
        id, GitSwitcherMode::Branches, vec![], vec![],
        Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    assert_eq!(
        app.text_input_target(),
        crate::event_handler::text_routing::TextInputTarget::GitSwitcher,
    );
}

#[test]
fn modal_stack_has_higher_input_priority_than_search_bar() {
    // UC-1 BR-6: ModalStack has higher input priority than search bar
    let (mut app, id) = app_with_editor();
    app.focus.search_focus = Some(id);
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    assert_eq!(
        app.text_input_target(),
        crate::event_handler::text_routing::TextInputTarget::FileFinder,
    );
}

#[test]
fn config_page_has_highest_priority_in_modal_stack() {
    // UC-1 BR-7: Config page has highest priority over all other modals
    let (mut app, id) = app_with_editor();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    app.modal.git_switcher = Some(GitSwitcherState::new(
        id, GitSwitcherMode::Branches, vec![], vec![],
        Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    app.modal.config_page = Some(ConfigPageState::new(vec![], String::new(), String::new()));
    assert_eq!(
        app.text_input_target(),
        crate::event_handler::text_routing::TextInputTarget::Consumed,
    );
}

// --- UC-2: DismissModal ---

#[test]
fn escape_closes_file_finder_modal() {
    // UC-2 BR-8: ESC closes file finder
    let (mut app, _id) = app_with_editor();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    app.handle_key_down(crate::tide_core::Key::Escape, crate::tide_core::Modifiers::default(), None);
    assert!(app.modal.file_finder.is_none());
}

#[test]
fn escape_closes_git_switcher() {
    // UC-2 BR-9: ESC closes git switcher
    let (mut app, id) = app_with_editor();
    app.modal.git_switcher = Some(GitSwitcherState::new(
        id, GitSwitcherMode::Branches, vec![], vec![],
        Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    app.handle_key_down(crate::tide_core::Key::Escape, crate::tide_core::Modifiers::default(), None);
    assert!(app.modal.git_switcher.is_none());
}

#[test]
fn escape_closes_save_as_input() {
    // UC-2 BR-10: ESC closes save_as_input
    let (mut app, id) = app_with_editor();
    app.modal.save_as_input = Some(SaveAsInput::new(id, PathBuf::from("/tmp"), Rect::new(0.0, 0.0, 100.0, 30.0)));
    app.handle_key_down(crate::tide_core::Key::Escape, crate::tide_core::Modifiers::default(), None);
    assert!(app.modal.save_as_input.is_none());
}

#[test]
fn escape_closes_context_menu() {
    // UC-2 BR-11: ESC closes context menu
    let (mut app, _id) = app_with_editor();
    app.modal.context_menu = Some(ContextMenuState {
        entry_index: 0,
        path: PathBuf::from("/tmp"),
        is_dir: false,
        shell_idle: true,
        position: crate::tide_core::Vec2::new(0.0, 0.0),
        selected: 0,
    });
    app.handle_key_down(crate::tide_core::Key::Escape, crate::tide_core::Modifiers::default(), None);
    assert!(app.modal.context_menu.is_none());
}

#[test]
fn escape_cancels_save_confirm() {
    // UC-2 BR-12: ESC cancels save confirm
    let (mut app, id) = app_with_editor();
    app.modal.save_confirm = Some(crate::SaveConfirmState { pane_id: id });
    app.handle_key_down(crate::tide_core::Key::Escape, crate::tide_core::Modifiers::default(), None);
    assert!(app.modal.save_confirm.is_none());
}

#[test]
fn escape_closes_file_tree_rename() {
    // UC-2 BR-13: ESC closes file tree rename
    let (mut app, _id) = app_with_editor();
    app.modal.file_tree_rename = Some(FileTreeRenameState {
        entry_index: 0,
        original_path: PathBuf::from("/tmp/file.txt"),
        input: InputLine::with_text("file.txt".to_string()),
    });
    app.handle_key_down(crate::tide_core::Key::Escape, crate::tide_core::Modifiers::default(), None);
    assert!(app.modal.file_tree_rename.is_none());
}
