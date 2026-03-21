// Spec: docs/specs/editor.md
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
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
    let pane = EditorPane::new_empty(id);
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

// --- UC-1: EditText ---

#[test]
fn new_editor_starts_unmodified() {
    // UC-1 BR-1: New Editor starts unmodified
    let (app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.editor.is_modified());
    } else {
        panic!("expected editor pane");
    }
}

#[test]
fn typing_text_into_editor_marks_it_as_modified() {
    // UC-1 BR-2: Typing text marks Editor as modified
    let (mut app, id) = app_with_editor();
    app.send_text_to_target("hello world");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.editor.is_modified());
    } else {
        panic!("expected editor pane");
    }
}

#[test]
fn text_input_is_blocked_in_preview_mode() {
    // UC-1 BR-3: Text input is blocked in preview mode
    let (mut app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.preview_mode = true;
    }
    app.send_text_to_target("should not appear");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.editor.is_modified());
    }
}

#[test]
fn search_bar_receives_text_in_preview_mode() {
    // UC-1 BR-3a: Search bar overrides preview mode text blocking
    let (mut app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.preview_mode = true;
        pane.search = Some(crate::state::search::SearchState::new());
    }
    app.focus.search_focus = Some(id);
    app.send_text_to_target("hello");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert_eq!(pane.search.as_ref().unwrap().input.text, "hello");
    }
}

#[test]
fn ime_commit_reaches_search_bar_in_preview_mode() {
    // UC-1 BR-3b: IME commit routes to search bar even in preview mode
    let (mut app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.preview_mode = true;
        pane.search = Some(crate::state::search::SearchState::new());
    }
    app.focus.search_focus = Some(id);
    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app,"검색어");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert_eq!(pane.search.as_ref().unwrap().input.text, "검색어");
    }
}

#[test]
fn ime_commit_routes_text_to_focused_editor() {
    // UC-1 BR-4: IME commit routes text to focused Editor
    let (mut app, id) = app_with_editor();
    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app,"한글 입력");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.editor.is_modified());
    }
}

#[test]
fn ime_commit_to_file_finder_does_not_reach_editor() {
    // UC-1 BR-5: IME commit to FileFinder does not reach Editor
    let (mut app, id) = app_with_editor();
    app.modal.file_finder = Some(crate::state::FileFinderState::new(
        std::path::PathBuf::from("/tmp"), vec![],
    ));
    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app,"검색어");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.editor.is_modified());
    }
}

#[test]
fn preview_scroll_j_moves_viewport_down() {
    // UC-3: PreviewScroll (see also mod preview_scroll)
    let mut v_scroll = 0;
    let mut h_scroll = 0;
    let scrolled = crate::pane::editor::apply_preview_scroll(
        'j', &mut v_scroll, &mut h_scroll, 100, 0, 30,
    );
    assert!(scrolled);
    assert_eq!(v_scroll, 1);
}

// --- UC-2: EditorDefaults ---

#[test]
fn new_editor_has_no_file_path() {
    // UC-2 BR-6: New Editor has no file_path
    let (app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.editor.file_path().is_none());
    }
}

#[test]
fn new_editor_is_not_in_preview_mode() {
    // UC-2 BR-7: New Editor is not in preview mode
    let (app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.preview_mode);
    }
}
