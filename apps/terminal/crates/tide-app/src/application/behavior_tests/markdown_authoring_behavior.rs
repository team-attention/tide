// Spec: docs/specs/editor-pane-revamp.md
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::tide_core::{InputEvent, Key, Modifiers};
use crate::tide_editor::EditorPosition;
use crate::tide_input::Action;
use crate::ActionPort;
use crate::App;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

static NEXT_TEST_FILE_ID: AtomicUsize = AtomicUsize::new(0);

fn temp_markdown_path(label: &str) -> PathBuf {
    let id = NEXT_TEST_FILE_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "tide_markdown_authoring_{}_{}_{}.md",
        std::process::id(),
        id,
        label
    ))
}

fn app_with_markdown_editor(contents: &str) -> (App, u64, PathBuf) {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let path = temp_markdown_path("list");
    std::fs::write(&path, contents).unwrap();
    // Markdown now opens in Reading mode; authoring tests exercise Source mode.
    let mut pane = EditorPane::open(id, &path).unwrap();
    pane.preview_mode = false;
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id, path)
}

fn press_enter(app: &mut App, id: u64) {
    ActionPort::handle_action(
        app,
        Action::RouteToPane(id),
        Some(InputEvent::KeyPress {
            key: Key::Enter,
            modifiers: Modifiers::default(),
        }),
    );
}

fn set_cursor(app: &mut App, id: u64, line: usize, col: usize) {
    let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) else {
        panic!("expected editor pane");
    };
    pane.editor
        .cursor
        .set_position(EditorPosition { line, col });
}

fn editor_pane(app: &App, id: u64) -> &EditorPane {
    match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    }
}

// --- UC-3: MakeMarkdownAuthoringFeelNative ---

#[test]
fn markdown_enter_continues_list_marker() {
    // UC-3 BR-11: Enter on a non-empty Markdown list item continues the list marker.
    let (mut app, id, _path) = app_with_markdown_editor("- item");
    set_cursor(&mut app, id, 0, "- item".len());

    press_enter(&mut app, id);

    let pane = editor_pane(&app, id);
    assert_eq!(pane.editor.buffer.lines, vec!["- item", "- "]);
    assert_eq!(
        pane.editor.cursor_position(),
        EditorPosition { line: 1, col: 2 }
    );
}

#[test]
fn markdown_enter_increments_ordered_list_marker() {
    // UC-3 BR-11: Enter on an ordered Markdown list item continues with the next marker.
    let (mut app, id, _path) = app_with_markdown_editor("1. item");
    set_cursor(&mut app, id, 0, "1. item".len());

    press_enter(&mut app, id);

    let pane = editor_pane(&app, id);
    assert_eq!(pane.editor.buffer.lines, vec!["1. item", "2. "]);
    assert_eq!(
        pane.editor.cursor_position(),
        EditorPosition { line: 1, col: 3 }
    );
}

#[test]
fn markdown_enter_continues_task_list_unchecked() {
    // UC-3 BR-11: Enter on a Markdown task item continues with an unchecked task marker.
    let (mut app, id, _path) = app_with_markdown_editor("- [x] done");
    set_cursor(&mut app, id, 0, "- [x] done".len());

    press_enter(&mut app, id);

    let pane = editor_pane(&app, id);
    assert_eq!(pane.editor.buffer.lines, vec!["- [x] done", "- [ ] "]);
    assert_eq!(
        pane.editor.cursor_position(),
        EditorPosition { line: 1, col: 6 }
    );
}

#[test]
fn markdown_enter_on_empty_list_item_exits_list() {
    // UC-3 BR-11: Enter on an empty Markdown list item removes the marker instead of nesting more markers.
    let (mut app, id, _path) = app_with_markdown_editor("- ");
    set_cursor(&mut app, id, 0, "- ".len());

    press_enter(&mut app, id);

    let pane = editor_pane(&app, id);
    assert_eq!(pane.editor.buffer.lines, vec![""]);
    assert_eq!(
        pane.editor.cursor_position(),
        EditorPosition { line: 0, col: 0 }
    );
}
