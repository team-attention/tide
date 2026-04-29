// Spec: docs/specs/input-routing.md — UC-2: RouteTextInput
use crate::adapter::inward::text_routing_adapter::{self, TextInputTarget};
use crate::application::ports::outward::clipboard_port::ClipboardPort;
use crate::pane::browser::BrowserPane;
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::*;
use crate::tide_core::Rect;
use crate::App;
use crate::ClipboardSearchPort;
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

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

fn app_with_browser() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(id, PaneKind::Browser(BrowserPane::new(id)));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

#[derive(Clone)]
struct RecordingClipboard {
    text: Rc<RefCell<String>>,
}

impl ClipboardPort for RecordingClipboard {
    fn get_text(&self) -> Result<String, String> {
        Ok(self.text.borrow().clone())
    }

    fn set_text(&self, _text: &str) -> Result<(), String> {
        Ok(())
    }
}

struct FailingClipboard;

impl ClipboardPort for FailingClipboard {
    fn get_text(&self) -> Result<String, String> {
        Err("clipboard read failed".to_string())
    }

    fn set_text(&self, _text: &str) -> Result<(), String> {
        Ok(())
    }
}

#[test]
fn text_goes_to_editor_when_nothing_else_is_open() {
    // UC-2 BR-10: Text goes to Editor when nothing else is open
    let (app, id) = app_with_editor();
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::Pane(id)
    );
}

#[test]
fn text_goes_to_file_finder_when_open() {
    // UC-2 BR-11: Text goes to FileFinder when open
    let (mut app, _) = app_with_editor();
    app.modal.file_finder = Some(FileFinderState::new(PathBuf::from("/"), vec![]));
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::FileFinder
    );
}

#[test]
fn text_goes_to_search_bar_when_focused() {
    // UC-2 BR-12: Text goes to SearchBar when focused
    let (mut app, id) = app_with_editor();
    app.focus.search_focus = Some(id);
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::SearchBar(id)
    );
}

#[test]
fn text_is_consumed_when_no_pane_is_focused() {
    // UC-2 BR-13: Text is consumed when no Pane is focused
    let app = test_app();
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::Consumed
    );
}

#[test]
fn text_is_consumed_when_file_tree_has_focus() {
    // UC-2 BR-14: Text is consumed when FocusArea is FileTree
    let (mut app, _) = app_with_editor();
    app.focus.focus_area = FocusArea::FileTree;
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::Consumed
    );
}

#[test]
fn text_goes_to_save_as_input_when_open() {
    // UC-2 BR-15: Text goes to SaveAsInput when open
    let (mut app, id) = app_with_editor();
    app.modal.save_as_input = Some(SaveAsInput::new(
        id,
        PathBuf::from("/tmp"),
        Rect::new(0.0, 0.0, 100.0, 30.0),
    ));
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::SaveAsInput
    );
}

#[test]
fn text_goes_to_context_comment_composer_when_open() {
    // UC-2 BR-16: Text goes to the context comment composer when open
    let (mut app, _id) = app_with_editor();
    app.modal.context_comment_composer = Some(ContextCommentComposerState::new(
        1,
        1,
        "editor".to_string(),
        None,
        "selection".to_string(),
    ));
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::ContextCommentComposer
    );
}

#[test]
fn pasted_newlines_are_preserved_in_context_comment_composer() {
    // Spec: docs/specs/agent-coworking-context.md
    // UC-3 BR-23: Pasted newline content is preserved in the Context Comment Composer while plain Enter remains the submit gesture.
    let (mut app, _id) = app_with_editor();
    app.modal.context_comment_composer = Some(ContextCommentComposerState::new(
        1,
        1,
        "editor".to_string(),
        None,
        "selection".to_string(),
    ));

    app.send_text_to_target("alpha\nbeta");

    let composer = app
        .modal
        .context_comment_composer
        .as_ref()
        .expect("composer should stay open after pasted multiline text");
    assert_eq!(composer.comment.text, "alpha\nbeta");
}

#[test]
fn paste_action_routes_multiline_clipboard_text_to_context_comment_composer() {
    // Spec: docs/specs/agent-coworking-context.md
    // UC-3 BR-23: Clipboard paste routes multiline text into the Context Comment Composer instead of the focused Pane.
    let (mut app, _id) = app_with_editor();
    app.modal.context_comment_composer = Some(ContextCommentComposerState::new(
        1,
        1,
        "editor".to_string(),
        None,
        "selection".to_string(),
    ));
    app.ports.clipboard = Box::new(RecordingClipboard {
        text: Rc::new(RefCell::new("alpha\nbeta".to_string())),
    });

    app.handle_paste();

    let composer = app
        .modal
        .context_comment_composer
        .as_ref()
        .expect("composer should stay open after paste");
    assert_eq!(composer.comment.text, "alpha\nbeta");
}

#[test]
fn paste_action_consumes_clipboard_failure_without_mutating_editor() {
    // UC-2 BR-18a: Clipboard paste failure is consumed without mutating the focused Pane
    let (mut app, id) = app_with_editor();
    app.ports.clipboard = Box::new(FailingClipboard);

    app.handle_paste();

    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert_eq!(pane.editor.buffer.line(0), Some(""));
        assert!(!pane.editor.is_modified());
    } else {
        panic!("expected editor Pane");
    }
}

#[test]
fn text_goes_to_file_tree_rename_when_active() {
    // UC-2 BR-17: Text goes to FileTreeRename when active
    let (mut app, _) = app_with_editor();
    app.modal.file_tree_rename = Some(FileTreeRenameState {
        entry_index: 0,
        original_path: PathBuf::from("/tmp/file.txt"),
        input: InputLine::with_text("file.txt".to_string()),
    });
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::FileTreeRename
    );
}

#[test]
fn config_page_worktree_editing_receives_text() {
    // UC-2 BR-18: ConfigPage worktree editing receives text
    let mut app = test_app();
    let mut cp = ConfigPageState::new(vec![], String::new(), String::new());
    cp.worktree_editing = true;
    app.modal.config_page = Some(cp);
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::ConfigPageWorktree
    );
}

#[test]
fn config_page_copy_files_editing_receives_text() {
    // UC-2 BR-19: ConfigPage copy_files editing receives text
    let mut app = test_app();
    let mut cp = ConfigPageState::new(vec![], String::new(), String::new());
    cp.copy_files_editing = true;
    app.modal.config_page = Some(cp);
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::ConfigPageCopyFiles
    );
}

#[test]
fn typing_in_empty_browser_pane_routes_text_to_url_bar() {
    // Spec: docs/specs/browser-pane-ux.md
    // UC-1 BR-2: Typing or pasting in an empty Browser Pane routes text to the Browser URL bar
    let (app, id) = app_with_browser();
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::BrowserUrlBar(id)
    );
}

#[test]
fn typing_in_loading_browser_pane_routes_text_to_url_bar() {
    // Spec: docs/specs/browser-pane-ux.md
    // UC-1 BR-3: Typing or pasting in a loading Browser Pane routes text to the Browser URL bar
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.loading = true;
        bp.url_input_focused = true;
    }
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::BrowserUrlBar(id)
    );
}

#[test]
fn search_active_browser_pane_routes_text_to_search_bar() {
    // Spec: docs/specs/browser-pane-ux.md
    // UC-2 BR-6: Search-active Browser Pane always routes text input to the search bar before the URL bar or Browser Pane content
    let (mut app, id) = app_with_browser();
    app.focus.search_focus = Some(id);
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::SearchBar(id)
    );
}

#[test]
fn typing_in_navigated_browser_pane_without_url_focus_is_consumed_by_content() {
    // Spec: docs/specs/browser-pane-ux.md
    // UC-2 BR-8: A navigated Browser Pane defaults typing to Browser Pane content when the URL bar and search bar are both inactive
    let (mut app, id) = app_with_browser();
    if let Some(PaneKind::Browser(bp)) = app.panes.get_mut(&id) {
        bp.url = "https://example.com".to_string();
        bp.url_input = bp.url.clone();
        bp.url_input_cursor = bp.url_input.chars().count();
        bp.url_input_focused = false;
    }
    assert_eq!(
        text_routing_adapter::text_input_target(&app),
        TextInputTarget::Consumed
    );
}
