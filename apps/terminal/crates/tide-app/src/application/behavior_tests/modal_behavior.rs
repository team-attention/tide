// Spec: docs/specs/modal.md
use crate::pane::PaneKind;
use crate::state::*;
use crate::tide_core::Rect;
use crate::App;
use crate::AppCorePort;
use std::path::PathBuf;

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
    app.panes.insert(
        id,
        PaneKind::Editor(crate::pane::editor::EditorPane::new_empty(id)),
    );
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
        1,
        vec![],
        Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    app.modal.context_comment_composer = Some(ContextCommentComposerState::new(
        1,
        1,
        "editor".to_string(),
        None,
        "selection".to_string(),
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
        crate::adapter::inward::text_routing_adapter::text_input_target(&app),
        crate::adapter::inward::text_routing_adapter::TextInputTarget::Consumed,
    );
}

#[test]
fn context_menu_blocks_text_input() {
    // UC-1 BR-2: Context menu blocks text input
    let (mut app, _id) = app_with_editor();
    app.modal.context_menu = Some(ContextMenuState {
        target: crate::ContextMenuTarget::FileTreeEntry {
            entry_index: 0,
            path: PathBuf::from("/tmp"),
            is_dir: false,
            is_app_bundle: false,
            shell_idle: true,
        },
        position: crate::tide_core::Vec2::new(0.0, 0.0),
        selected: 0,
    });
    assert_eq!(
        crate::adapter::inward::text_routing_adapter::text_input_target(&app),
        crate::adapter::inward::text_routing_adapter::TextInputTarget::Consumed,
    );
}

#[test]
fn save_confirm_blocks_text_input() {
    // UC-1 BR-3: Save confirm blocks text input
    let (mut app, id) = app_with_editor();
    app.modal.save_confirm = Some(crate::SaveConfirmState { pane_id: id });
    assert_eq!(
        crate::adapter::inward::text_routing_adapter::text_input_target(&app),
        crate::adapter::inward::text_routing_adapter::TextInputTarget::Consumed,
    );
}

#[test]
fn file_finder_captures_text_instead_of_pane() {
    // UC-1 BR-4: File finder captures text instead of Pane
    let (mut app, _id) = app_with_editor();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    assert_eq!(
        crate::adapter::inward::text_routing_adapter::text_input_target(&app),
        crate::adapter::inward::text_routing_adapter::TextInputTarget::FileFinder,
    );
}

#[test]
fn git_switcher_captures_text_instead_of_pane() {
    // UC-1 BR-5: Git switcher captures text instead of Pane
    let (mut app, id) = app_with_editor();
    app.modal.git_switcher = Some(GitSwitcherState::new(
        id,
        vec![],
        Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    assert_eq!(
        crate::adapter::inward::text_routing_adapter::text_input_target(&app),
        crate::adapter::inward::text_routing_adapter::TextInputTarget::GitSwitcher,
    );
}

#[test]
fn modal_stack_has_higher_input_priority_than_search_bar() {
    // UC-1 BR-6: ModalStack has higher input priority than search bar
    let (mut app, id) = app_with_editor();
    app.focus.search_focus = Some(id);
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    assert_eq!(
        crate::adapter::inward::text_routing_adapter::text_input_target(&app),
        crate::adapter::inward::text_routing_adapter::TextInputTarget::FileFinder,
    );
}

#[test]
fn config_page_has_highest_priority_in_modal_stack() {
    // UC-1 BR-7: Config page has highest priority over all other modals
    let (mut app, id) = app_with_editor();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    app.modal.git_switcher = Some(GitSwitcherState::new(
        id,
        vec![],
        Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    app.modal.config_page = Some(ConfigPageState::new(vec![], String::new(), String::new()));
    assert_eq!(
        crate::adapter::inward::text_routing_adapter::text_input_target(&app),
        crate::adapter::inward::text_routing_adapter::TextInputTarget::Consumed,
    );
}

// --- UC-2: DismissModal ---

#[test]
fn escape_closes_file_finder_modal() {
    // UC-2 BR-8: ESC closes file finder
    let (mut app, _id) = app_with_editor();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        crate::tide_core::Key::Escape,
        crate::tide_core::Modifiers::default(),
        None,
    );
    assert!(app.modal.file_finder.is_none());
}

#[test]
fn escape_closes_git_switcher() {
    // UC-2 BR-9: ESC closes git switcher
    let (mut app, id) = app_with_editor();
    app.modal.git_switcher = Some(GitSwitcherState::new(
        id,
        vec![],
        Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        crate::tide_core::Key::Escape,
        crate::tide_core::Modifiers::default(),
        None,
    );
    assert!(app.modal.git_switcher.is_none());
}

#[test]
fn escape_closes_save_as_input() {
    // UC-2 BR-10: ESC closes save_as_input
    let (mut app, id) = app_with_editor();
    app.modal.save_as_input = Some(SaveAsInput::new(
        id,
        PathBuf::from("/tmp"),
        Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        crate::tide_core::Key::Escape,
        crate::tide_core::Modifiers::default(),
        None,
    );
    assert!(app.modal.save_as_input.is_none());
}

#[test]
fn escape_closes_context_menu() {
    // UC-2 BR-11: ESC closes context menu
    let (mut app, _id) = app_with_editor();
    app.modal.context_menu = Some(ContextMenuState {
        target: crate::ContextMenuTarget::FileTreeEntry {
            entry_index: 0,
            path: PathBuf::from("/tmp"),
            is_dir: false,
            is_app_bundle: false,
            shell_idle: true,
        },
        position: crate::tide_core::Vec2::new(0.0, 0.0),
        selected: 0,
    });
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        crate::tide_core::Key::Escape,
        crate::tide_core::Modifiers::default(),
        None,
    );
    assert!(app.modal.context_menu.is_none());
}

#[test]
fn escape_closes_context_comment_composer() {
    // UC-2 BR-12: ESC closes the context comment composer
    let (mut app, _id) = app_with_editor();
    app.modal.context_comment_composer = Some(ContextCommentComposerState::new(
        1,
        1,
        "editor".to_string(),
        None,
        "selection".to_string(),
    ));
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        crate::tide_core::Key::Escape,
        crate::tide_core::Modifiers::default(),
        None,
    );
    assert!(app.modal.context_comment_composer.is_none());
}

#[test]
fn tab_toggles_context_comment_pinned() {
    // UC-2 BR-13: Tab toggles the composer pin state
    let (mut app, _id) = app_with_editor();
    app.modal.context_comment_composer = Some(ContextCommentComposerState::new(
        1,
        1,
        "editor".to_string(),
        None,
        "selection".to_string(),
    ));
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        crate::tide_core::Key::Tab,
        crate::tide_core::Modifiers::default(),
        None,
    );
    assert!(app.modal.context_comment_composer.as_ref().unwrap().pinned);
}

#[test]
fn shift_enter_in_context_comment_composer_inserts_newline() {
    // Spec: docs/specs/agent-coworking-context.md
    // UC-3 BR-23: The Context Comment Composer accepts multiline comment text from Shift+Enter while keeping plain Enter as submit.
    let (mut app, _id) = app_with_editor();
    let mut composer =
        ContextCommentComposerState::new(1, 1, "editor".to_string(), None, "selection".to_string());
    composer.comment = InputLine::with_text("alpha".to_string());
    app.modal.context_comment_composer = Some(composer);

    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        crate::tide_core::Key::Enter,
        crate::tide_core::Modifiers {
            shift: true,
            ..crate::tide_core::Modifiers::default()
        },
        None,
    );

    let composer = app
        .modal
        .context_comment_composer
        .as_ref()
        .expect("composer should stay open after Shift+Enter");
    assert_eq!(composer.comment.text, "alpha\n");
}

#[test]
fn context_comment_composer_keeps_caret_visible_when_comment_wraps() {
    // Spec: docs/specs/agent-coworking-context.md
    // UC-3 BR-24: The Context Comment Composer keeps the active caret visible inside the input viewport as multiline text grows.
    let (app, _id) = app_with_editor();
    let logical = app.logical_size();
    let cell_size = app.cell_size();
    let comment = "Wrapped composer text ".repeat(24);
    let cursor_rect = crate::adapter::outward::view::overlays::context_comment_composer_cursor_area(
        logical,
        cell_size,
        &comment,
        comment.chars().count(),
        "",
    );

    let (input_rect, _line_h) =
        crate::adapter::outward::view::overlays::composer_input_rect(logical, cell_size);

    assert!(
        cursor_rect.x >= input_rect.x
            && cursor_rect.x <= input_rect.x + input_rect.width - cell_size.width,
        "wrapped composer caret should stay inside the visible input width"
    );
    assert!(
        cursor_rect.y >= input_rect.y
            && cursor_rect.y <= input_rect.y + input_rect.height - cell_size.height,
        "wrapped composer caret should stay inside the visible input height"
    );
}

#[test]
fn escape_cancels_save_confirm() {
    // UC-2 BR-12: ESC cancels save confirm
    let (mut app, id) = app_with_editor();
    app.modal.save_confirm = Some(crate::SaveConfirmState { pane_id: id });
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        crate::tide_core::Key::Escape,
        crate::tide_core::Modifiers::default(),
        None,
    );
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
    crate::adapter::inward::keyboard_adapter::handle_key_down(
        &mut app,
        crate::tide_core::Key::Escape,
        crate::tide_core::Modifiers::default(),
        None,
    );
    assert!(app.modal.file_tree_rename.is_none());
}
