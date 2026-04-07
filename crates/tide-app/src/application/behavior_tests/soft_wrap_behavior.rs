// Spec: docs/specs/soft-wrap.md
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::ActionPort;
use crate::App;

fn editor_with_extension(ext: &str) -> EditorPane {
    let path = std::env::temp_dir().join(format!("tide_test_soft_wrap.{}", ext));
    std::fs::write(&path, "hello world").unwrap();
    EditorPane::open(1, &path).unwrap()
}

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_markdown_editor(contents: &str) -> (App, u64, std::path::PathBuf) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let path = std::env::temp_dir().join(format!(
        "tide_soft_wrap_behavior_{}_{}.md",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::write(&path, contents).unwrap();
    let pane = EditorPane::open(id, &path).unwrap();
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id, path)
}

fn pane_content_rect(pane_rect: crate::tide_core::Rect) -> crate::tide_core::Rect {
    crate::pane::pane_content_rect(pane_rect, crate::theme::TAB_BAR_HEIGHT)
}

// --- UC-1: Open Prose File ---

#[test]
fn soft_wrap_enabled_for_markdown_files() {
    // UC-1 BR-1: .md files get soft_wrap = true
    let pane = editor_with_extension("md");
    assert!(
        pane.soft_wrap,
        "markdown files should have soft wrap enabled"
    );
}

#[test]
fn soft_wrap_enabled_for_txt_files() {
    // UC-1 BR-1: .txt files get soft_wrap = true
    let pane = editor_with_extension("txt");
    assert!(pane.soft_wrap, "text files should have soft wrap enabled");
}

#[test]
fn soft_wrap_disabled_for_source_code() {
    // UC-1 BR-2: non-prose files get soft_wrap = false
    for ext in &["rs", "js", "py", "go", "toml", "json"] {
        let pane = editor_with_extension(ext);
        assert!(!pane.soft_wrap, ".{} should not have soft wrap", ext);
    }
}

#[test]
fn soft_wrap_disabled_in_diff_mode() {
    // UC-1 BR-4: diff mode → no wrap regardless of file type
    let mut pane = editor_with_extension("md");
    pane.diff_mode = true;
    // soft_wrap flag is still true but rendering should skip wrap in diff mode.
    // The effective_soft_wrap() helper should return false.
    assert!(!pane.effective_soft_wrap());
}

#[test]
fn markdown_authoring_opens_with_soft_wrap_active() {
    // UC-1 BR-3: Markdown files open in authoring mode so Soft Wrap is active immediately
    let pane = editor_with_extension("md");
    assert!(
        pane.effective_soft_wrap(),
        "markdown authoring should start with effective soft wrap enabled"
    );
}

// --- UC-2: Render Wrapped Lines ---

#[test]
fn horizontal_scroll_disabled_with_soft_wrap() {
    // UC-2 BR-8: h_scroll should stay 0 when soft wrap is active
    use crate::tide_editor::input::EditorAction;
    let mut pane = editor_with_extension("txt");
    // Insert a very long line
    let long_text = "a".repeat(200);
    pane.editor.insert_text(&long_text);
    // Try to scroll right
    pane.handle_action(EditorAction::ScrollRight(10.0), 20);
    assert_eq!(
        pane.editor.h_scroll_offset(),
        0,
        "h_scroll should be 0 with soft wrap"
    );
}

// --- UC-2: WrapMap visual row counting ---

#[test]
fn wrap_map_counts_visual_rows_correctly() {
    // UC-2 BR-6/BR-7: WrapMap correctly maps logical lines to visual rows
    use crate::tide_editor::wrap::WrapMap;
    let lines: Vec<String> = vec![
        "short".to_string(),
        "a".repeat(100), // wraps to 3 rows at width 40
        "end".to_string(),
    ];
    let map = WrapMap::build(&lines, 40, 0);
    assert_eq!(map.total_visual_rows(), 5); // 1 + 3 + 1
    assert_eq!(map.visual_rows_for(0), 1);
    assert_eq!(map.visual_rows_for(1), 3);
    assert_eq!(map.visual_rows_for(2), 1);
}

#[test]
fn wide_characters_wrap_correctly() {
    // UC-2 BR-9: CJK characters (width 2) respected in wrapping
    use crate::tide_editor::wrap::WrapMap;
    // 25 CJK chars = 50 display cols → 2 rows at width 40
    let cjk: String = std::iter::repeat('가').take(25).collect();
    let lines = vec![cjk];
    let map = WrapMap::build(&lines, 40, 0);
    assert_eq!(map.total_visual_rows(), 2);
}

// --- UC-5: Selection Highlight in Wrapped Text ---

#[test]
fn wrapped_selection_highlight_tracks_visual_rows() {
    // UC-5 BR-15, BR-16: Wrapped selection highlight uses WrapMap visual rows and current wrapped scroll origin.
    use crate::adapter::outward::view::editor_selection_rects;
    use crate::pane::editor::GUTTER_WIDTH_CELLS;
    use crate::pane::Selection;
    use crate::theme::SCROLLBAR_WIDTH;
    use crate::tide_core::{Rect, Size};

    let path = std::env::temp_dir().join(format!(
        "tide_soft_wrap_selection_{}_{}.md",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::write(&path, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").unwrap();

    let mut pane = EditorPane::open(1, &path).unwrap();
    let cell_size = Size::new(8.0, 16.0);
    let inner = Rect::new(
        0.0,
        0.0,
        GUTTER_WIDTH_CELLS as f32 * cell_size.width + SCROLLBAR_WIDTH + 40.0 * cell_size.width,
        4.0 * cell_size.height,
    );
    pane.prepare_inline_caches(inner, cell_size, true);
    pane.selection = Some(Selection {
        anchor: (0, 45),
        end: (0, 48),
    });

    let rects = editor_selection_rects(&pane, inner, cell_size, pane.selection.as_ref().unwrap());
    assert_eq!(rects.len(), 1);
    assert_eq!(
        rects[0].x,
        GUTTER_WIDTH_CELLS as f32 * cell_size.width + 5.0 * cell_size.width
    );
    assert_eq!(rects[0].y, cell_size.height);
    assert_eq!(rects[0].width, 3.0 * cell_size.width);
    assert_eq!(rects[0].height, cell_size.height);

    let _ = std::fs::remove_file(path);
}

// --- UC-6: Resize Viewport ---

#[test]
fn wrap_map_rebuilt_on_width_change() {
    // UC-6 BR-17: WrapMap must change when width changes
    use crate::tide_editor::wrap::WrapMap;
    let lines = vec!["a".repeat(100)];
    let map40 = WrapMap::build(&lines, 40, 0);
    let map50 = WrapMap::build(&lines, 50, 0);
    assert_eq!(map40.total_visual_rows(), 3); // ceil(100/40)
    assert_eq!(map50.total_visual_rows(), 2); // ceil(100/50)
}

// --- UC-8: Scroll Wrapped Authoring ---

#[test]
fn scrolling_wrapped_markdown_advances_by_visual_row() {
    // UC-8 BR-20: Soft-wrap authoring scroll advances in visual rows, not only whole logical lines
    use crate::tide_editor::input::EditorAction;

    let mut pane = editor_with_extension("md");
    pane.editor.insert_text(&"a".repeat(120));
    pane.ensure_wrap_map(20);

    pane.handle_action_with_size(EditorAction::ScrollDown(1.0), 3, 20);

    assert_eq!(pane.soft_wrap_visual_scroll(), 1);
    assert_eq!(
        pane.editor.scroll_offset(),
        0,
        "a wrapped single logical line should still scroll within the same logical line"
    );
}

#[test]
fn scrolling_wrapped_markdown_reaches_the_last_visual_row() {
    // UC-8 BR-21: Soft-wrap scroll clamping uses total visual rows so the wrapped tail remains reachable
    use crate::tide_editor::input::EditorAction;

    let mut pane = editor_with_extension("md");
    pane.editor.insert_text(&"a".repeat(120));
    pane.ensure_wrap_map(20);

    for _ in 0..10 {
        pane.handle_action_with_size(EditorAction::ScrollDown(1.0), 3, 20);
    }

    let expected = pane
        .soft_wrap_total_visual_rows()
        .unwrap()
        .saturating_sub(3);
    assert_eq!(pane.soft_wrap_visual_scroll(), expected);
}

#[test]
fn mouse_wheel_soft_wrap_preserves_render_wrap_width() {
    // UC-8 BR-22: Mouse-wheel soft-wrap scroll reuses the same authoring-region wrap width as render-time cache preparation
    let (mut app, id, path) = app_with_markdown_editor(&"a".repeat(1000));
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    let content_rect = pane_content_rect(pane_rect);
    let cell_size = app.window.cached_cell_size;
    app.visual_pane_rects = vec![(id, pane_rect)];

    let expected_wrap_width = {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.prepare_inline_caches(content_rect, cell_size, false);
        pane.wrap_cols_for_rect(content_rect, cell_size)
    };

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(
        pane.wrap_map().map(|map| map.wrap_width()),
        Some(expected_wrap_width)
    );

    let pos = crate::tide_core::Vec2::new(
        pane_rect.x + 40.0,
        pane_rect.y + crate::theme::TAB_BAR_HEIGHT + 40.0,
    );
    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::MouseScroll {
            delta: -1.0,
            position: pos,
        }),
    );

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(
        pane.wrap_map().map(|map| map.wrap_width()),
        Some(expected_wrap_width),
        "soft-wrap scroll should not rebuild WrapMap with a different width than render-time preparation"
    );
    assert!(
        pane.soft_wrap_visual_scroll() > 0,
        "soft-wrap scroll should still move the viewport when the document exceeds the visible rows"
    );

    let _ = std::fs::remove_file(path);
}
