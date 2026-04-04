// Spec: docs/specs/soft-wrap.md
use crate::pane::editor::EditorPane;

fn editor_with_extension(ext: &str) -> EditorPane {
    let path = std::env::temp_dir().join(format!("tide_test_soft_wrap.{}", ext));
    std::fs::write(&path, "hello world").unwrap();
    EditorPane::open(1, &path).unwrap()
}

// --- UC-1: Open Prose File ---

#[test]
fn soft_wrap_enabled_for_markdown_files() {
    // UC-1 BR-1: .md files get soft_wrap = true
    let pane = editor_with_extension("md");
    assert!(pane.soft_wrap, "markdown files should have soft wrap enabled");
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
    assert_eq!(pane.editor.h_scroll_offset(), 0, "h_scroll should be 0 with soft wrap");
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

// --- UC-5: Resize Viewport ---

#[test]
fn wrap_map_rebuilt_on_width_change() {
    // UC-5 BR-15: WrapMap must change when width changes
    use crate::tide_editor::wrap::WrapMap;
    let lines = vec!["a".repeat(100)];
    let map40 = WrapMap::build(&lines, 40, 0);
    let map50 = WrapMap::build(&lines, 50, 0);
    assert_eq!(map40.total_visual_rows(), 3); // ceil(100/40)
    assert_eq!(map50.total_visual_rows(), 2); // ceil(100/50)
}
