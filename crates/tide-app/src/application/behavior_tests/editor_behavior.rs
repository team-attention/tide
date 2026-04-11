// Spec: docs/specs/editor.md
use crate::application::ports::outward::clipboard_port::ClipboardPort;
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::ActionPort;
use crate::App;
use crate::ClipboardSearchPort;
use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_TEST_FILE_ID: AtomicUsize = AtomicUsize::new(0);

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

fn temp_markdown_path(label: &str) -> PathBuf {
    let id = NEXT_TEST_FILE_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "tide_editor_behavior_{}_{}_{}.md",
        std::process::id(),
        id,
        label
    ))
}

fn app_with_markdown_editor(contents: &str) -> (App, u64, PathBuf) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let path = temp_markdown_path("authoring");
    std::fs::write(&path, contents).unwrap();
    let pane = EditorPane::open(id, &path).unwrap();
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id, path)
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
    // UC-1 BR-4: Text input is blocked in preview mode
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
fn paste_action_is_blocked_in_preview_mode_even_with_selection() {
    // UC-1 BR-4: Preview mode blocks paste-driven buffer mutation even when a preview selection is active.
    let (mut app, id, _path) = app_with_markdown_editor("hello world\n");
    app.ports.clipboard = Box::new(RecordingClipboard {
        text: Rc::new(RefCell::new("replacement".to_string())),
    });
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.preview_mode = true;
        pane.selection = Some(crate::pane::Selection {
            anchor: (0, 0),
            end: (0, 5),
        });
    }

    app.handle_paste();

    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert_eq!(pane.editor.buffer.line(0), Some("hello world"));
        let selection = pane
            .selection
            .as_ref()
            .expect("preview selection should remain");
        assert_eq!(selection.anchor, (0, 0));
        assert_eq!(selection.end, (0, 5));
        assert!(!pane.editor.is_modified());
    } else {
        panic!("expected editor pane");
    }
}

#[test]
fn search_bar_receives_text_in_preview_mode() {
    // UC-1 BR-5: Search bar receives text even while preview mode is active
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
    // UC-1 BR-5: IME commit also reaches the search bar while preview mode is active
    let (mut app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.preview_mode = true;
        pane.search = Some(crate::state::search::SearchState::new());
    }
    app.focus.search_focus = Some(id);
    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app, "검색어");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert_eq!(pane.search.as_ref().unwrap().input.text, "검색어");
    }
}

#[test]
fn ime_commit_routes_text_to_focused_editor() {
    // UC-1 BR-3: IME commit routes text to focused Editor while authoring
    let (mut app, id) = app_with_editor();
    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app, "한글 입력");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.editor.is_modified());
    }
}

#[test]
fn ime_commit_to_file_finder_does_not_reach_editor() {
    // UC-1 BR-6: IME commit to FileFinder does not reach Editor
    let (mut app, id) = app_with_editor();
    app.modal.file_finder = Some(crate::state::FileFinderState::new(
        std::path::PathBuf::from("/tmp"),
        vec![],
    ));
    crate::adapter::inward::ime_adapter::handle_ime_commit(&mut app, "검색어");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.editor.is_modified());
    }
}

#[test]
fn preview_scroll_j_moves_viewport_down() {
    // UC-4 BR-18: j scrolls preview down one line
    let mut v_scroll = 0;
    let mut h_scroll = 0;
    let scrolled =
        crate::pane::editor::apply_preview_scroll('j', &mut v_scroll, &mut h_scroll, 100, 0, 30);
    assert!(scrolled);
    assert_eq!(v_scroll, 1);
}

// --- UC-2: EditorDefaults ---

#[test]
fn new_editor_has_no_file_path() {
    // UC-2 BR-7: New Editor has no file_path
    let (app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.editor.file_path().is_none());
    }
}

#[test]
fn new_editor_is_not_in_preview_mode() {
    // UC-2 BR-8: New Editor is not in preview mode
    let (app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.preview_mode);
    }
}

#[test]
fn markdown_file_opens_in_authoring_mode_with_live_preview_enabled() {
    // UC-2 BR-9: Opening a Markdown file starts in authoring mode with preview disabled and LivePreviewMode enabled
    let (app, id, _path) = app_with_markdown_editor("# Title\n\nBody");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(
            !pane.preview_mode,
            "markdown panes should open in authoring mode"
        );
        assert!(
            pane.live_preview,
            "markdown panes should default to LivePreviewMode"
        );
    } else {
        panic!("expected editor pane");
    }
}

#[test]
fn text_input_routes_to_focused_editor_in_authoring_mode() {
    // UC-1 BR-3: Text input routes to the focused editor while authoring
    let (mut app, id, _path) = app_with_markdown_editor("# Title\n");
    app.send_text_to_target("hello");
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(
            pane.editor.is_modified(),
            "focused markdown editor should accept text immediately after opening"
        );
    } else {
        panic!("expected editor pane");
    }
}

#[test]
fn escape_exits_preview_mode() {
    // UC-3 BR-17: Escape exits preview mode and returns the Pane to authoring mode
    let (mut app, id) = app_with_editor();
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.preview_mode = true;
    }
    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::KeyPress {
            key: crate::tide_core::Key::Escape,
            modifiers: crate::tide_core::Modifiers::default(),
        }),
    );
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(!pane.preview_mode);
    } else {
        panic!("expected editor pane");
    }
}

#[test]
fn click_in_authoring_mode_moves_cursor_using_current_layout() {
    // UC-3 BR-14: Authoring-mode clicks reposition the cursor through the current layout
    let (mut app, id, _path) = app_with_markdown_editor("alpha\nbravo\ncharlie\n");
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    app.visual_pane_rects = vec![(id, pane_rect)];

    let cell = app.window.cached_cell_size;
    let x = pane_rect.x
        + crate::theme::PANE_PADDING
        + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width
        + 2.0 * cell.width
        + 1.0;
    let y = pane_rect.y
        + crate::theme::TAB_BAR_HEIGHT
        + crate::theme::editor_live_preview_vertical_padding(cell.height)
        + 1.0 * cell.height
        + 1.0;

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::MouseClick {
            position: crate::tide_core::Vec2::new(x, y),
            button: crate::tide_core::MouseButton::Left,
        }),
    );

    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        let pos = pane.editor.cursor_position();
        assert_eq!(
            pos.line, 1,
            "click should move the cursor to the second line"
        );
        assert_eq!(
            pos.col, 2,
            "click should move the cursor to the clicked column"
        );
    } else {
        panic!("expected editor pane");
    }
}
