// Spec: docs/specs/live-preview.md
use crate::domain::editor::markdown::{LivePreviewMap, MdElementKind};
use crate::domain::editor::wrap::WrapMap;
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalPane};
use crate::state::FocusArea;
use crate::tide_platform::{WindowCommand, WindowProxy};
use crate::ActionPort;
use crate::App;
use crate::DockPort;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use unicode_width::UnicodeWidthChar;

fn lines(s: &str) -> Vec<String> {
    s.lines().map(String::from).collect()
}

static NEXT_TEST_FILE_ID: AtomicUsize = AtomicUsize::new(0);

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn temp_markdown_path(label: &str) -> PathBuf {
    let id = NEXT_TEST_FILE_ID.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "tide_live_preview_behavior_{}_{}_{}.md",
        std::process::id(),
        id,
        label
    ))
}

fn app_with_markdown_editor(contents: &str) -> (App, u64, PathBuf) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let path = temp_markdown_path("selection");
    std::fs::write(&path, contents).unwrap();
    let pane = EditorPane::open(id, &path).unwrap();
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id, path)
}

fn app_with_dock_markdown_editor(contents: &str) -> (App, u64, u64, PathBuf) {
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.stage_focused = Some(terminal_id);

    let editor_id = app.layout.alloc_id();
    let path = temp_markdown_path("dock_selection");
    std::fs::write(&path, contents).unwrap();
    let pane = EditorPane::open(editor_id, &path).unwrap();
    app.panes.insert(editor_id, PaneKind::Editor(pane));
    app.add_pane_to_dock(editor_id, None);
    app.assoc.associated_terminal.insert(editor_id, terminal_id);

    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex".into(),
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: None,
        },
    );

    (app, editor_id, terminal_id, path)
}

fn pane_content_rect(
    pane_rect: crate::tide_core::Rect,
    cell_height: f32,
) -> crate::tide_core::Rect {
    let base = crate::pane::pane_content_rect(pane_rect, crate::theme::TAB_BAR_HEIGHT);
    let padding = crate::theme::editor_live_preview_vertical_padding(cell_height);
    crate::tide_core::Rect::new(
        base.x,
        base.y + padding,
        base.width,
        (base.height - 2.0 * padding).max(1.0),
    )
}

fn test_window_proxy() -> crate::tide_platform::WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    crate::tide_platform::WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

fn test_window_proxy_with_receiver() -> (WindowProxy, std::sync::mpsc::Receiver<WindowCommand>) {
    let (tx, rx) = std::sync::mpsc::channel();
    (WindowProxy::new(tx, std::sync::Arc::new(|| {})), rx)
}

// --- UC-0: OpenMarkdownInLivePreview ---

#[test]
fn markdown_file_opens_in_authoring_mode_with_live_preview_enabled() {
    // UC-0 BR-1/BR-2: Markdown Panes open with LivePreviewMode enabled while staying out of preview-only mode
    let (app, id, _path) = app_with_markdown_editor("# Title\n\nBody");
    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert!(pane.live_preview);
    assert!(!pane.preview_mode);
}

// --- UC-4: LivePreviewMapConstruction ---

#[test]
fn live_preview_map_builds_from_buffer_lines() {
    // UC-4 BR-1: LivePreviewMap builds from buffer lines and contains elements
    let input = lines("# Heading\n\nSome **bold** text.");
    let map = LivePreviewMap::build(&input);
    assert!(
        !map.elements.is_empty(),
        "map should contain elements from markdown"
    );
    // Should find at least a Heading and a Bold element
    assert!(map
        .elements
        .iter()
        .any(|e| matches!(e.kind, MdElementKind::Heading(1))));
    assert!(map.elements.iter().any(|e| e.kind == MdElementKind::Bold));
}

#[test]
fn live_preview_map_exposes_cached_line_byte_starts() {
    // markdown-preview-performance-polish UC-1 BR-1/BR-3: LivePreviewMap exposes cached line byte starts for render-time lookup.
    let input = lines("alpha\n**bold**\nlast");
    let map = LivePreviewMap::build(&input);

    assert_eq!(map.line_byte_start(0), 0);
    assert_eq!(map.line_byte_start(1), "alpha\n".len());
    assert_eq!(map.line_byte_start(2), "alpha\n**bold**\n".len());
    assert_eq!(
        map.line_byte_start(99),
        "alpha\n**bold**\nlast".len(),
        "out-of-range line starts should clamp to the source end"
    );
}

#[test]
fn live_preview_map_counts_elements_by_line() {
    // markdown-preview-performance-polish UC-1 BR-2: LivePreviewMap keeps a per-line element index for line-scoped lookup.
    let input = lines("plain\n**bold**\n`code` and [link](https://example.com)");
    let map = LivePreviewMap::build(&input);

    assert_eq!(map.element_count_on_line(0), 0);
    assert_eq!(map.element_count_on_line(1), 1);
    assert_eq!(map.element_count_on_line(2), 2);
    assert_eq!(map.element_count_on_line(99), 0);
}

#[test]
fn element_ranges_sorted_non_overlapping() {
    // UC-4 BR-2: Element ranges are non-overlapping and sorted by start offset
    let input = lines("**bold** and *italic* and `code` here\n# Heading\n> quote");
    let map = LivePreviewMap::build(&input);

    // Check sorted by full_range.start
    for window in map.elements.windows(2) {
        assert!(
            window[0].full_range.start <= window[1].full_range.start,
            "elements not sorted: {:?} comes before {:?}",
            window[0].full_range,
            window[1].full_range
        );
    }

    // Check non-overlapping: for inline elements on the same level, ranges should not overlap.
    // Note: block elements (e.g. heading) can contain inline elements, so we only check
    // elements of the same nesting depth aren't overlapping with each other.
    // At minimum, verify the sort order holds.
    let inline_elements: Vec<_> = map.elements.iter().filter(|e| e.kind.is_inline()).collect();
    for window in inline_elements.windows(2) {
        assert!(
            window[0].full_range.end <= window[1].full_range.start,
            "inline elements overlap: {:?} and {:?}",
            window[0].full_range,
            window[1].full_range
        );
    }
}

#[test]
fn nested_formatting_produces_separate_entries() {
    // UC-4 BR-3: Nested formatting produces separate entries for outer and inner elements
    let input = lines("***bold italic***");
    let map = LivePreviewMap::build(&input);

    let has_bold = map.elements.iter().any(|e| e.kind == MdElementKind::Bold);
    let has_italic = map.elements.iter().any(|e| e.kind == MdElementKind::Italic);
    assert!(has_bold, "should have Bold entry for nested ***...***");
    assert!(has_italic, "should have Italic entry for nested ***...***");
}

#[test]
fn escaped_chars_not_treated_as_syntax() {
    // UC-4 BR-4: Escaped markdown chars are not treated as syntax markers
    let input = lines("\\*not bold\\*");
    let map = LivePreviewMap::build(&input);

    let has_bold = map.elements.iter().any(|e| e.kind == MdElementKind::Bold);
    let has_italic = map.elements.iter().any(|e| e.kind == MdElementKind::Italic);
    assert!(!has_bold, "escaped \\* should not produce Bold element");
    assert!(!has_italic, "escaped \\* should not produce Italic element");
}

// --- UC-2: InlineSyntaxHiding ---

#[test]
fn inline_syntax_hidden_on_non_cursor_lines() {
    // UC-2 BR-1: Inline syntax hiding operates at line level
    let input = lines("**bold** text");
    let map = LivePreviewMap::build(&input);

    // When cursor is on a different line, syntax ranges should be returned
    let hidden = map.hidden_syntax_ranges(0, 1);
    assert!(
        !hidden.is_empty(),
        "should return hidden syntax ranges when cursor is on a different line"
    );

    // When cursor is on the same line, no syntax should be hidden
    let not_hidden = map.hidden_syntax_ranges(0, 0);
    assert!(
        not_hidden.is_empty(),
        "should not hide syntax on cursor line"
    );
}

#[test]
fn live_preview_map_exposes_cached_hidden_syntax_ranges_by_line() {
    // markdown-preview-performance-polish UC-1 BR-18: LivePreviewMap exposes cached hidden inline syntax ranges per line.
    let input = lines("`code` and **bold** plus [link](url)\nplain");
    let map = LivePreviewMap::build(&input);

    let cached = map.hidden_syntax_ranges_for_line(0, 1);
    let owned = map.hidden_syntax_ranges(0, 1);
    assert_eq!(cached, owned.as_slice());
    assert!(
        !cached.is_empty(),
        "inline syntax ranges should be cached for non-cursor lines"
    );
    assert!(
        cached.windows(2).all(|pair| pair[0].start <= pair[1].start),
        "cached hidden syntax ranges should be sorted"
    );
    assert!(map.hidden_syntax_ranges_for_line(0, 0).is_empty());
    assert!(map.hidden_syntax_ranges_for_line(99, 1).is_empty());
}

#[test]
fn live_preview_map_line_style_cursor_matches_element_style_for_monotonic_offsets() {
    // markdown-preview-performance-polish UC-1 BR-20: Line-scoped style ranges match element_style for monotonic byte offsets.
    let input = lines("# Heading\n\nText with `code`, **bold**, and [link](url).\n\n| A | B |\n|---|---|\n| `x` | y |");
    let map = LivePreviewMap::build(&input);

    for line in 0..input.len() {
        let line_start = map.line_byte_start(line);
        let line_end = input
            .get(line + 1)
            .map(|_| map.line_byte_start(line + 1).saturating_sub(1))
            .unwrap_or(line_start + input[line].len());
        let mut style_idx = 0usize;
        for byte_offset in line_start..line_end {
            assert_eq!(
                map.element_style_for_line(line, byte_offset, &mut style_idx),
                map.element_style(byte_offset),
                "line {line} byte {byte_offset} should match element_style"
            );
        }
    }
}

#[test]
#[ignore = "profiling harness; run explicitly with --ignored"]
fn profile_live_preview_terminal_pane_inset_hidden_ranges() {
    profile_live_preview_hidden_ranges_file("docs/specs/terminal-pane-inset.md");
}

#[test]
#[ignore = "profiling harness; run explicitly with --ignored"]
fn profile_live_preview_terminal_context_hidden_ranges() {
    profile_live_preview_hidden_ranges_file("docs/specs/terminal-context.md");
}

fn profile_live_preview_hidden_ranges_file(path: &str) {
    let source = std::fs::read_to_string(path).expect("read markdown profile fixture");
    let lines: Vec<String> = source.lines().map(str::to_string).collect();
    let duration = std::env::var("TIDE_PROFILE_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(15);
    let wrap_cols = std::env::var("TIDE_PROFILE_WRAP_COLS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(39);
    let visible_rows = std::env::var("TIDE_PROFILE_VISIBLE_ROWS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(38);
    let live_map = LivePreviewMap::build(&lines);
    let wrap_map = WrapMap::build(&lines, wrap_cols, 0);
    let total_rows = (0..lines.len())
        .map(|line| wrap_map.visual_rows_for(line))
        .sum::<usize>()
        .max(1);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(duration);
    let mut iterations = 0usize;
    let mut hidden_hits = 0usize;
    let mut styled_hits = 0usize;
    let mut scroll = 0usize;

    while std::time::Instant::now() < deadline {
        for row in scroll..scroll + visible_rows {
            let visual_row = row % total_rows;
            let Some(info) = wrap_map.visual_row_to_line_info(visual_row, &lines) else {
                continue;
            };
            let Some(line_text) = lines.get(info.logical_line) else {
                continue;
            };
            let hidden_ranges =
                live_map.hidden_syntax_ranges_for_line(info.logical_line, usize::MAX);
            let row_text = line_text.get(info.byte_offset..).unwrap_or("");
            let mut hidden_range_idx = 0usize;
            let mut element_style_idx = 0usize;
            let mut byte_offset = live_map.line_byte_start(info.logical_line) + info.byte_offset;
            let mut char_idx = info.char_offset;

            for ch in row_text.chars() {
                if char_idx >= info.char_end {
                    break;
                }
                while hidden_range_idx < hidden_ranges.len()
                    && hidden_ranges[hidden_range_idx].end <= byte_offset
                {
                    hidden_range_idx += 1;
                }
                let is_hidden = hidden_ranges
                    .get(hidden_range_idx)
                    .is_some_and(|range| range.contains(&byte_offset));
                if is_hidden {
                    hidden_hits += 1;
                } else if live_map
                    .element_style_for_line(info.logical_line, byte_offset, &mut element_style_idx)
                    .is_some()
                {
                    styled_hits += UnicodeWidthChar::width(ch).unwrap_or(1);
                }
                byte_offset += ch.len_utf8();
                char_idx += 1;
            }
        }
        iterations += 1;
        scroll = (scroll + 1) % total_rows;
        std::hint::black_box((hidden_hits, styled_hits, scroll));
    }

    eprintln!(
        "profiled live preview {path}: iterations={iterations}, total_rows={total_rows}, hidden_hits={hidden_hits}, styled_hits={styled_hits}, wrap_cols={wrap_cols}, visible_rows={visible_rows}"
    );
}

#[test]
fn all_inline_syntax_types_detected() {
    // UC-2 BR-2: All inline syntax types detected: bold, italic, code, link, image, strikethrough
    let input = lines("**bold** *italic* `code` [link](url) ![img](src) ~~strike~~");
    let map = LivePreviewMap::build(&input);

    let kinds: Vec<MdElementKind> = map.elements.iter().map(|e| e.kind).collect();
    assert!(kinds.contains(&MdElementKind::Bold), "missing Bold");
    assert!(kinds.contains(&MdElementKind::Italic), "missing Italic");
    assert!(
        kinds.contains(&MdElementKind::InlineCode),
        "missing InlineCode"
    );
    assert!(kinds.contains(&MdElementKind::Link), "missing Link");
    assert!(kinds.contains(&MdElementKind::Image), "missing Image");
    assert!(
        kinds.contains(&MdElementKind::Strikethrough),
        "missing Strikethrough"
    );
}

// --- UC-3: BlockElementStyling ---

#[test]
fn block_syntax_never_hidden() {
    // UC-3 BR-1: Block syntax markers are never hidden regardless of cursor position
    let input = lines("# Heading\n\n```\ncode\n```");
    let map = LivePreviewMap::build(&input);

    // Block elements on line 0 (heading) — hidden_syntax_ranges should return empty
    // because hidden_syntax_ranges only returns inline element syntax
    let hidden_heading = map.hidden_syntax_ranges(0, 5);
    assert!(
        hidden_heading.is_empty(),
        "block element syntax should never be hidden; got {:?}",
        hidden_heading
    );

    // Code block lines — also should not be hidden
    let hidden_code = map.hidden_syntax_ranges(2, 5);
    assert!(
        hidden_code.is_empty(),
        "code block syntax should never be hidden; got {:?}",
        hidden_code
    );
}

#[test]
fn heading_markers_visible_and_styled() {
    // UC-3 BR-4: Heading # markers always visible, heading text styled
    let input = lines("# Heading");
    let map = LivePreviewMap::build(&input);

    let heading = map
        .elements
        .iter()
        .find(|e| matches!(e.kind, MdElementKind::Heading(_)));
    assert!(heading.is_some(), "should find a Heading element");

    let heading = heading.unwrap();
    assert!(
        !heading.kind.is_inline(),
        "Heading should be a block element (is_inline() == false)"
    );
    // Heading level should be 1
    assert!(
        matches!(heading.kind, MdElementKind::Heading(1)),
        "should be H1"
    );
}

// --- UC-5: CursorColumnMapping ---

#[test]
fn mouse_selection_on_hidden_syntax_line_maps_visual_column_to_buffer_column() {
    // UC-5 BR-4: Mouse selection start reverse-maps visual columns into buffer columns on non-cursor lines
    let (mut app, id, _path) = app_with_markdown_editor("cursor line\n**bold** tail\n");
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    let cell = app.window.cached_cell_size;
    let content_rect = pane_content_rect(pane_rect, cell.height);
    app.visual_pane_rects = vec![(id, pane_rect)];

    {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.handle_action(
            crate::tide_editor::input::EditorAction::SetCursor { line: 0, col: 0 },
            20,
        );
        pane.prepare_inline_caches(content_rect, cell, false);
    }

    let click_x =
        content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width + 1.0;
    let click_y = content_rect.y + 1.0 * cell.height + 1.0;
    app.window.last_cursor_pos = crate::tide_core::Vec2::new(click_x, click_y);

    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );

    let selection = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane.selection.as_ref().cloned(),
        _ => None,
    }
    .expect("selection should start on the clicked line");

    assert_eq!(selection.anchor, (1, 2));
    assert_eq!(selection.end, (1, 2));
}

#[test]
fn live_preview_selected_text_omits_hidden_syntax_markers() {
    // UC-7 BR-1: Visible-text copy in LivePreviewMode omits hidden inline syntax markers.
    let (mut app, id, _path) =
        app_with_markdown_editor("cursor line\n[OpenAI](https://openai.com)\n");
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    let cell = app.window.cached_cell_size;
    let content_rect = pane_content_rect(pane_rect, cell.height);
    app.visual_pane_rects = vec![(id, pane_rect)];

    {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.handle_action(
            crate::tide_editor::input::EditorAction::SetCursor { line: 0, col: 0 },
            20,
        );
        pane.prepare_inline_caches(content_rect, cell, false);
    }

    let gutter_x = content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width;
    let start = crate::tide_core::Vec2::new(gutter_x + 1.0, content_rect.y + cell.height + 1.0);
    let end = crate::tide_core::Vec2::new(
        gutter_x + 6.0 * cell.width + 1.0,
        content_rect.y + cell.height + 1.0,
    );
    app.window.last_cursor_pos = start;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
        &mut app,
        end,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::handle_mouse_up(
        &mut app,
        crate::tide_core::MouseButton::Left,
    );

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    let selection = pane.selection.as_ref().expect("selection should exist");
    assert_eq!(pane.selected_text(selection), "OpenAI");
}

#[test]
fn live_preview_context_artifact_capture_uses_visible_selected_text() {
    // UC-7 BR-2: Add-comment capture in LivePreviewMode uses the same visible selected text that copy uses.
    let (mut app, id, terminal_id, _path) =
        app_with_dock_markdown_editor("cursor line\n[OpenAI](https://openai.com)\n");
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    let cell = app.window.cached_cell_size;
    let content_rect = pane_content_rect(pane_rect, cell.height);
    app.visual_pane_rects = vec![(id, pane_rect)];

    {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.handle_action(
            crate::tide_editor::input::EditorAction::SetCursor { line: 0, col: 0 },
            20,
        );
        pane.prepare_inline_caches(content_rect, cell, false);
    }

    let gutter_x = content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width;
    let start = crate::tide_core::Vec2::new(gutter_x + 1.0, content_rect.y + cell.height + 1.0);
    let end = crate::tide_core::Vec2::new(
        gutter_x + 6.0 * cell.width + 1.0,
        content_rect.y + cell.height + 1.0,
    );
    app.window.last_cursor_pos = start;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
        &mut app,
        end,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::handle_mouse_up(
        &mut app,
        crate::tide_core::MouseButton::Left,
    );

    assert!(
        app.can_open_context_comment_composer(id),
        "dock live preview selection should be eligible for context comment capture"
    );
    app.open_context_comment_composer(id);

    let composer = app
        .modal
        .context_comment_composer
        .as_ref()
        .expect("context comment composer should open for a dock markdown pane");
    assert_eq!(composer.source_pane_id, id);
    assert_eq!(composer.associated_terminal_id, terminal_id);
    assert_eq!(composer.content, "OpenAI");
}

#[test]
fn live_preview_link_click_opens_rendered_link_target() {
    // UC-7 BR-3: Link activation in LivePreviewMode opens the rendered Markdown link target.
    let (mut app, id, _path) =
        app_with_markdown_editor("cursor line\n[OpenAI](https://openai.com)\n");
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    let cell = app.window.cached_cell_size;
    let content_rect = pane_content_rect(pane_rect, cell.height);
    app.visual_pane_rects = vec![(id, pane_rect)];

    {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.handle_action(
            crate::tide_editor::input::EditorAction::SetCursor { line: 0, col: 0 },
            20,
        );
        pane.prepare_inline_caches(content_rect, cell, false);
    }

    app.window.modifiers = crate::tide_core::Modifiers {
        meta: true,
        ..crate::tide_core::Modifiers::default()
    };

    let click_x =
        content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width + 1.0;
    let click_y = content_rect.y + 1.0 * cell.height + 1.0;

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::MouseClick {
            position: crate::tide_core::Vec2::new(click_x, click_y),
            button: crate::tide_core::MouseButton::Left,
        }),
    );

    assert!(
        app.panes.values().any(
            |pane| matches!(pane, PaneKind::Browser(browser) if browser.url == "https://openai.com")
        ),
        "cmd-click on a live preview markdown link should open the rendered link target"
    );
}

// --- UC-8: LivePreviewContentInset ---

#[test]
fn live_preview_content_rect_uses_vertical_padding() {
    // UC-8 BR-1, BR-2: LivePreviewMode content reserves a half-cell inset above and below the authoring region.
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    let base = crate::pane::pane_content_rect(pane_rect, crate::theme::TAB_BAR_HEIGHT);
    let content_rect = pane_content_rect(pane_rect, 16.0);

    assert_eq!(
        crate::theme::editor_live_preview_vertical_padding(16.0),
        8.0
    );
    assert_eq!(content_rect.y, base.y + 8.0);
    assert_eq!(content_rect.height, base.height - 16.0);
}

#[test]
fn live_preview_click_mapping_respects_vertical_padding() {
    // UC-8 BR-3, BR-4: Pointer positions inside the live-preview top inset do not map to the first row, while the first visible row still does.
    let (mut app, id, _path) = app_with_markdown_editor("alpha\nbeta\n");
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    let cell = app.window.cached_cell_size;
    let content_rect = pane_content_rect(pane_rect, cell.height);
    app.visual_pane_rects = vec![(id, pane_rect)];

    {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.prepare_inline_caches(content_rect, cell, false);
    }

    let padding_click = crate::tide_core::Vec2::new(
        content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width + 2.0,
        pane_rect.y
            + crate::theme::TAB_BAR_HEIGHT
            + 0.5 * crate::theme::editor_live_preview_vertical_padding(cell.height),
    );
    app.window.last_cursor_pos = padding_click;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );

    let no_selection = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane.selection.clone(),
        _ => None,
    };
    assert!(no_selection.is_none());

    let first_row_click = crate::tide_core::Vec2::new(
        content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width + 2.0,
        content_rect.y + 0.5 * cell.height,
    );
    app.window.last_cursor_pos = first_row_click;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );

    let selection = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane.selection.clone(),
        _ => None,
    }
    .expect("selection should start on the first visible row");
    assert_eq!(selection.anchor.0, 0);
}

#[test]
fn live_preview_ime_cursor_area_uses_the_live_preview_inset() {
    // UC-8 BR-5: Editor IME geometry in LivePreviewMode uses the same inset-adjusted origin as rendering.
    let (mut app, id, _path) = app_with_markdown_editor("alpha\n");
    let cell = app.window.cached_cell_size;
    let pane_rect = crate::tide_core::Rect::new(24.0, 12.0, 420.0, 320.0);
    let content_rect = pane_content_rect(pane_rect, cell.height);
    app.pane_rects = vec![(id, pane_rect)];
    app.visual_pane_rects = vec![(id, pane_rect)];
    app.ime.cursor_dirty = true;

    {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.prepare_inline_caches(content_rect, cell, false);
    }

    let (window, rx) = test_window_proxy_with_receiver();
    app.poll_background_events(&window);

    let mut cursor_area = None;
    while let Ok(command) = rx.try_recv() {
        if let WindowCommand::SetImeCursorArea {
            pane_id,
            x,
            y,
            w,
            h,
        } = command
        {
            cursor_area = Some((pane_id, x, y, w, h));
        }
    }

    let (pane_id, x, y, w, h) = cursor_area.expect("editor IME cursor area command");
    assert_eq!(pane_id, id);
    assert_eq!(
        x,
        (content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width) as f64
    );
    assert_eq!(y, content_rect.y as f64);
    assert_eq!(w, cell.width as f64);
    assert_eq!(h, cell.height as f64);
}
