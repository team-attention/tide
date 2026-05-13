// Spec: docs/specs/live-preview.md
use crate::adapter::inward::scroll_adapter::handle_scroll;
use crate::adapter::outward::view::editor_selection_rects;
use crate::domain::editor::markdown::{LivePreviewMap, MdElementKind};
use crate::domain::editor::wrap::WrapMap;
use crate::pane::editor::{
    live_preview_code_fence_line, live_preview_editing_indicator_rect,
    live_preview_syntax_marker_style, live_preview_table_cell_text,
    live_preview_table_line_is_first, live_preview_table_line_is_header,
    live_preview_table_line_is_last, live_preview_table_separator_line, EditorPane,
};
use crate::pane::{PaneKind, Selection, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::{Rect, Size};
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

fn live_preview_scroll_axis_fixture() -> (App, u64, PathBuf, usize) {
    let long_cell = format!(
        "domain/pane owns LivePreviewMode and Soft Wrap {}",
        "x".repeat(140)
    );
    let trailing_rows = (0..80)
        .map(|idx| format!("after {}", idx))
        .collect::<Vec<_>>()
        .join("\n");
    let contents = format!(
        "# Tests\n\n| Context | Responsibility |\n| --- | --- |\n| domain/pane | {long_cell} |\n\n{trailing_rows}\n"
    );
    let (mut app, id, path) = app_with_markdown_editor(&contents);
    let pane_rect = Rect::new(0.0, 0.0, 280.0, 160.0);
    let cell = Size::new(8.0, 16.0);
    app.window.cached_cell_size = cell;
    app.pane_rects = vec![(id, pane_rect)];
    app.visual_pane_rects = vec![(id, pane_rect)];

    let content_rect = pane_content_rect(pane_rect, cell.height);
    let table_line = 4;
    let table_visual_row = {
        let pane = match app.panes.get_mut(&id) {
            Some(PaneKind::Editor(pane)) => pane,
            _ => panic!("expected editor pane"),
        };
        pane.prepare_inline_caches(content_rect, cell, false);
        let (_, visible_cols) = pane.viewport_size_for_content_rect(content_rect, cell);
        assert!(
            pane.live_preview_fixed_width_max_h_scroll(visible_cols)
                .unwrap()
                > 0,
            "fixture table must be horizontally scrollable"
        );
        pane.handle_action(
            crate::tide_editor::input::EditorAction::SetCursor {
                line: table_line,
                col: 16,
            },
            12,
        );
        pane.soft_wrap_visual_row_of_line(table_line).unwrap()
    };

    let cursor_x =
        content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width + 24.0;
    let cursor_y = content_rect.y + table_visual_row as f32 * cell.height + 1.0;
    app.window.last_cursor_pos = crate::tide_core::Vec2::new(cursor_x, cursor_y);

    (app, id, path, table_line)
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

fn marker_text_for_ranges(line: &str, ranges: &[std::ops::Range<usize>]) -> String {
    ranges
        .iter()
        .filter_map(|range| line.get(range.clone()))
        .collect::<Vec<_>>()
        .join("")
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
fn live_preview_map_keeps_cursor_line_syntax_ranges_for_dim_marker_styling() {
    // UC-2 BR-5/BR-7: Cursor-line content keeps Markdown styling while revealed syntax markers can use a dim structural style.
    let input = lines("# Heading with **bold** and `code`");
    let map = LivePreviewMap::build(&input);

    assert!(
        map.hidden_syntax_ranges_for_line(0, 0).is_empty(),
        "cursor line should still reveal syntax"
    );
    let syntax_ranges = map.syntax_ranges_for_line(0);
    let marker_text = marker_text_for_ranges(&input[0], syntax_ranges);
    assert!(marker_text.contains('#'));
    assert!(marker_text.contains("**"));
    assert!(marker_text.contains('`'));

    let marker_style = live_preview_syntax_marker_style(false);
    assert!(marker_style.dim);
    assert!(marker_style.background.is_none());
    assert!(marker_style.foreground.a < 1.0);
}

#[test]
fn live_preview_editing_indicator_is_a_narrow_rail() {
    // UC-2 BR-6: Cursor-line editing state uses a narrow rail instead of a full-row background tint.
    let rect = crate::tide_core::Rect::new(10.0, 20.0, 420.0, 320.0);
    let cell = crate::tide_core::Size::new(8.0, 16.0);
    let rail = live_preview_editing_indicator_rect(rect, cell, 3);

    assert_eq!(rail.width, 2.0);
    assert!(rail.height < cell.height);
    assert_eq!(rail.y, rect.y + 3.0 * cell.height + 2.0);
    assert!(rail.x < rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width);
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
fn non_cursor_code_block_lines_render_as_preview_surface_until_edited() {
    // UC-3 BR-5: Non-cursor code block fences are treated as preview chrome instead of body text.
    assert!(live_preview_code_fence_line("```rust"));
    assert!(live_preview_code_fence_line("   ~~~"));
    assert!(!live_preview_code_fence_line("let value = 1;"));
}

#[test]
fn live_preview_code_block_blank_lines_keep_code_block_kind() {
    // UC-3 BR-13: Empty source rows inside a fenced code block remain code-block rows.
    let input = lines("```text\nfirst line\n\nsecond line\n```");
    let map = LivePreviewMap::build(&input);

    assert_eq!(map.block_kind_for_line(1), Some(MdElementKind::CodeBlock));
    assert_eq!(map.block_kind_for_line(2), Some(MdElementKind::CodeBlock));
    assert_eq!(map.block_kind_for_line(3), Some(MdElementKind::CodeBlock));
}

#[test]
fn non_cursor_table_lines_render_as_preview_table_until_edited() {
    // UC-3 BR-6: Non-cursor table separator rows become table structure instead of Markdown text.
    let rows = lines("| Name | Value |\n| --- | ---: |\n| Tide | 42 |");

    assert!(live_preview_table_line_is_header(&rows, 0));
    assert!(live_preview_table_separator_line(&rows[1]));
    assert!(!live_preview_table_separator_line(&rows[0]));
    assert!(!live_preview_table_line_is_header(&rows, 2));
}

#[test]
fn live_preview_table_cells_render_without_source_markers() {
    // UC-3 BR-11: Table cell text renders without simple Markdown source markers.
    assert_eq!(live_preview_table_cell_text("**Domain**"), "Domain");
    assert_eq!(live_preview_table_cell_text("`domain/`"), "domain/");
    assert_eq!(
        live_preview_table_cell_text("Application -> `application/services/`"),
        "Application -> application/services/"
    );
}

#[test]
fn live_preview_table_surface_edges_follow_source_table_bounds() {
    // UC-3 BR-11: Table surface edges follow the source table bounds instead of every row looking like a detached band.
    let rows = lines(
        "Before\n\n| Layer | Path | Responsibility |\n|-------|------|---------------|\n| **Domain** | `domain/` | Pure business logic |\n| **Application** | `application/ports/` | Port traits |\n\nAfter",
    );

    assert!(live_preview_table_line_is_first(&rows, 2));
    assert!(!live_preview_table_line_is_last(&rows, 2));
    assert!(!live_preview_table_line_is_first(&rows, 3));
    assert!(!live_preview_table_line_is_last(&rows, 3));
    assert!(!live_preview_table_line_is_first(&rows, 4));
    assert!(!live_preview_table_line_is_last(&rows, 4));
    assert!(live_preview_table_line_is_last(&rows, 5));
}

#[test]
fn live_preview_block_cursor_raw_mode_only_for_structure_markers() {
    // UC-3 BR-12: Complete Markdown tables stay rendered when focused; incomplete table syntax stays raw.
    let mut complete = EditorPane::new_empty(1);
    complete.editor.buffer.lines =
        lines("| Layer | Path |\n|-------|------|\n| Domain | `domain/` |");
    assert!(complete.live_preview_source_table_complete_at_line(0));
    assert!(complete.live_preview_source_table_complete_at_line(1));
    assert!(complete.live_preview_source_table_complete_at_line(2));

    let mut incomplete = EditorPane::new_empty(2);
    incomplete.editor.buffer.lines = lines("| Layer | Path |\n|-------|------|\n| Domain |");
    assert!(!incomplete.live_preview_source_table_complete_at_line(0));
    assert!(!incomplete.live_preview_source_table_complete_at_line(1));
    assert!(!incomplete.live_preview_source_table_complete_at_line(2));
}

#[test]
fn live_preview_source_table_keeps_escaped_pipe_inside_cell() {
    // markdown-preview-performance-polish UC-7 BR-22: Escaped pipes inside cells do not split Markdown table columns.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = lines(
        "| Turn | user text |\n| --- | --- |\n| 26 | 코드블럭 왼쪽에 \\| 랑 위에 짧은 선도 이상해 |",
    );

    assert!(pane.live_preview_source_table_complete_at_line(0));
    assert!(pane.live_preview_source_table_complete_at_line(1));
    assert!(pane.live_preview_source_table_complete_at_line(2));
    assert_eq!(
        live_preview_table_cell_text("코드블럭 왼쪽에 \\| 랑 위에 짧은 선도 이상해"),
        "코드블럭 왼쪽에 | 랑 위에 짧은 선도 이상해"
    );
}

#[test]
fn live_preview_table_cache_reuses_large_table_geometry() {
    // markdown-preview-performance-polish UC-7 BR-23: Table-heavy LivePreviewMode reuses prepared source-table geometry.
    let mut contents = String::from("| Turn | user text |\n| --- | --- |\n");
    for idx in 0..160 {
        let text = if idx == 80 {
            format!("scroll \\| edge {}", "x".repeat(96))
        } else {
            format!("ordinary row {}", idx)
        };
        contents.push_str(&format!("| {idx} | {text} |\n"));
    }

    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = lines(&contents);
    pane.live_preview = true;
    pane.soft_wrap = true;
    pane.ensure_live_preview_map();

    let cell = Size::new(8.0, 16.0);
    let rect = Rect::new(0.0, 0.0, 320.0, 240.0);
    pane.prepare_inline_caches(rect, cell, false);

    let escaped_row = 82;
    assert!(pane.live_preview_source_table_line(escaped_row));
    assert_eq!(pane.soft_wrap_display_rows_for_line(escaped_row), 1);
    assert!(pane.live_preview_table_cache_contains_line(escaped_row));
    let widths = pane
        .live_preview_table_cached_widths_for_line(escaped_row)
        .expect("prepared table widths");
    assert!(
        widths.get(1).copied().unwrap_or(0) > 96,
        "cached user text column should preserve the long escaped-pipe cell width"
    );
}

#[test]
fn live_preview_fixed_width_hit_testing_uses_display_rows() {
    // UC-6 BR-8: Hit-testing fixed-width blocks uses rendered display rows, not raw WrapMap sub-rows.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = lines("```text\nabcdefghijklmnop\n```\nafter");
    pane.live_preview = true;
    pane.soft_wrap = true;
    pane.ensure_live_preview_map();
    pane.ensure_wrap_map(6);

    assert!(
        pane.wrap_map().unwrap().visual_rows_for(1) > 1,
        "fixture must raw-wrap the code block content"
    );
    assert_eq!(pane.soft_wrap_display_rows_for_line(1), 1);

    let code_row = pane.soft_wrap_visual_row_of_line(1).unwrap();
    assert_eq!(
        pane.soft_wrap_display_position_for_visual_cell(code_row, 3),
        Some((1, 0))
    );
    assert_eq!(
        pane.soft_wrap_display_position_for_visual_cell(code_row + 1, 0)
            .map(|(line, _)| line),
        Some(2),
        "the row after a rendered code line should map to the next logical line, not a raw wrapped sub-row"
    );
}

#[test]
fn live_preview_fixed_width_selection_rects_are_clipped_to_viewport() {
    // UC-6 BR-9: Fixed-width LivePreviewMode selection highlights do not draw outside the Editor Pane viewport.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = lines("```text\nabcdefghijklmnop\n```\nafter");
    pane.live_preview = true;
    pane.soft_wrap = true;
    pane.ensure_live_preview_map();
    pane.ensure_wrap_map(6);
    pane.selection = Some(Selection {
        anchor: (1, 0),
        end: (1, 16),
    });

    let cell_size = Size::new(8.0, 16.0);
    let inner = Rect::new(
        10.0,
        20.0,
        crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width + 10.0 * cell_size.width,
        4.0 * cell_size.height,
    );
    let rects = editor_selection_rects(&pane, inner, cell_size, pane.selection.as_ref().unwrap());
    assert_eq!(rects.len(), 1);
    let right = rects[0].x + rects[0].width;
    assert!(
        right <= inner.x + inner.width,
        "selection rect must be clipped to viewport: right={right}, viewport_right={}",
        inner.x + inner.width
    );
    assert_eq!(
        rects[0].width,
        7.0 * cell_size.width,
        "code block selection starts after preview padding and fills the remaining visible columns"
    );
}

#[test]
fn live_preview_selection_rects_after_fixed_width_rows_use_display_rows() {
    // UC-6 BR-9: Selection highlights after fixed-width rows use LivePreviewMode display rows, not raw wrapped rows.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = lines("```text\nabcdefghijklmnop\n```\nafter");
    pane.live_preview = true;
    pane.soft_wrap = true;
    pane.ensure_live_preview_map();
    pane.ensure_wrap_map(6);
    pane.selection = Some(Selection {
        anchor: (3, 0),
        end: (3, 5),
    });

    let raw_row = pane.wrap_map().unwrap().visual_row_of_line(3);
    let display_row = pane.soft_wrap_visual_row_of_line(3).unwrap();
    assert!(
        raw_row > display_row,
        "fixture must put the target line after raw-wrapped fixed-width rows"
    );

    let cell_size = Size::new(8.0, 16.0);
    let inner = Rect::new(10.0, 20.0, 240.0, 8.0 * cell_size.height);
    let rects = editor_selection_rects(&pane, inner, cell_size, pane.selection.as_ref().unwrap());

    assert_eq!(rects.len(), 1);
    assert_eq!(
        rects[0].y.to_bits(),
        (inner.y + display_row as f32 * cell_size.height).to_bits()
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
fn live_preview_table_selection_rects_skip_table_syntax_markers() {
    // UC-6 BR-10: Table row selection uses table-specific visual↔source mapping.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = lines("| Domain | Adapter |\n| --- | --- |\n| Domain | adapter |\n");
    pane.live_preview = true;
    pane.soft_wrap = true;
    pane.ensure_live_preview_map();
    pane.ensure_wrap_map(80);

    let line = 2;
    let line_text = pane.editor.buffer.line(line).unwrap();
    let to_byte = |text: &str, char_idx: usize| -> usize {
        text.char_indices()
            .nth(char_idx)
            .map(|(idx, _)| idx)
            .unwrap_or(text.len())
    };

    assert_eq!(
        pane.live_preview_table_source_char_for_visual_col(line, line_text, 0),
        2,
        "left table gutter should map to first visible cell"
    );
    assert_eq!(
        pane.live_preview_table_source_char_for_visual_col(line, line_text, 8),
        11,
        "gap after first cell should map to second visible cell start"
    );

    assert_eq!(
        pane.live_preview_table_visual_col_for_source_char(line, line_text, 2),
        2,
        "first visible source char should align to its own display column"
    );
    assert_eq!(
        pane.live_preview_table_visual_col_for_source_char(line, line_text, 8),
        8,
        "between visible cells should stay at first cell boundary"
    );
    assert_eq!(
        pane.live_preview_table_visual_col_for_source_char(line, line_text, 11),
        12,
        "second cell start should align to table gap boundary"
    );

    let anchor = pane.live_preview_table_source_char_for_visual_col(line, line_text, 2);
    let end = pane.live_preview_table_source_char_for_visual_col(line, line_text, 24);
    assert!(anchor < end);
    pane.selection = Some(Selection {
        anchor: (line, anchor),
        end: (line, end),
    });

    let cell_size = Size::new(8.0, 16.0);
    let inner = Rect::new(0.0, 0.0, 28.0 * cell_size.width, 4.0 * cell_size.height);
    let rects = editor_selection_rects(&pane, inner, cell_size, pane.selection.as_ref().unwrap());
    assert_eq!(rects.len(), 1);

    let expected_start_col =
        pane.soft_wrap_display_col_for_position(line, to_byte(line_text, anchor));
    let expected_end_col = pane.soft_wrap_display_col_for_position(line, to_byte(line_text, end));
    let expected_width =
        (expected_end_col.saturating_sub(expected_start_col)) as f32 * cell_size.width;
    assert_eq!(rects[0].width, expected_width);
    assert!(
        rects[0].width > 0.0,
        "table selection should remain visible with table-specific mapping"
    );
}

#[test]
fn live_preview_table_selection_expands_to_cell_width() {
    // UC-6 BR-10: Table selections reflect computed column widths even when text is shorter than the cell.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = lines("| Domain | Adapter |\n| --- | --- |\n| D | x |\n");
    pane.live_preview = true;
    pane.soft_wrap = true;
    pane.ensure_live_preview_map();
    pane.ensure_wrap_map(80);

    let line = 2;
    let line_text = pane.editor.buffer.line(line).unwrap();
    let to_byte = |text: &str, char_idx: usize| -> usize {
        text.char_indices()
            .nth(char_idx)
            .map(|(idx, _)| idx)
            .unwrap_or(text.len())
    };

    let x_pos = line_text
        .char_indices()
        .position(|(_, ch)| ch == 'x')
        .unwrap();
    let x_after = to_byte(line_text, x_pos + 1);

    assert_eq!(
        pane.soft_wrap_display_col_for_position(line, x_after),
        13,
        "single-char cell should keep row geometry"
    );
    assert_eq!(
        pane.soft_wrap_display_col_for_position(
            line,
            to_byte(line_text, line_text.chars().count())
        ),
        19,
        "selection at row end should include configured cell width"
    );

    let trailing = pane.live_preview_table_source_char_for_visual_col(line, line_text, 19);
    assert!(
        trailing > x_pos,
        "padded zone should map to post-text source index"
    );

    pane.selection = Some(Selection {
        anchor: (line, 2),
        end: (line, line_text.chars().count()),
    });

    let cell_size = Size::new(8.0, 16.0);
    let inner = Rect::new(0.0, 0.0, 28.0 * cell_size.width, 4.0 * cell_size.height);
    let rects = editor_selection_rects(&pane, inner, cell_size, pane.selection.as_ref().unwrap());
    assert_eq!(rects.len(), 1);
    assert_eq!(rects[0].width, (19 - 2) as f32 * cell_size.width);
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
fn live_preview_selection_rects_use_visible_markdown_columns() {
    // UC-7 BR-4: Selection highlights in LivePreviewMode use visible Markdown columns instead of hidden syntax marker columns.
    let (mut app, id, _path) = app_with_markdown_editor("cursor line\n**OpenAI** tail\n");
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    let cell = app.window.cached_cell_size;
    let content_rect = pane_content_rect(pane_rect, cell.height);

    let pane = match app.panes.get_mut(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    pane.handle_action(
        crate::tide_editor::input::EditorAction::SetCursor { line: 0, col: 0 },
        20,
    );
    pane.prepare_inline_caches(content_rect, cell, false);
    pane.selection = Some(Selection {
        anchor: (1, 2),
        end: (1, 8),
    });

    let rects = editor_selection_rects(pane, content_rect, cell, pane.selection.as_ref().unwrap());
    assert_eq!(rects.len(), 1);

    let expected_x = content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell.width;
    assert_eq!(rects[0].x, expected_x);
    assert_eq!(rects[0].width, 6.0 * cell.width);
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

#[test]
fn live_preview_soft_wrap_display_rows_do_not_enter_code_block_subrows() {
    // UC-3 BR-9, UC-6 BR-4: LivePreviewMode Soft Wrap counts code block lines as one display row, so scrolling cannot land inside raw wrapped sub-rows.
    let long_code = format!("application services renderer adapter {}", "x".repeat(80));
    let contents = format!("# Context Map\n\n```text\n{long_code}\n```\n\nAfter\n");
    let (mut app, id, path) = app_with_markdown_editor(&contents);
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 320.0, 220.0);
    let cell = crate::tide_core::Size::new(8.0, 16.0);
    let content_rect = pane_content_rect(pane_rect, cell.height);

    let pane = match app.panes.get_mut(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    pane.prepare_inline_caches(content_rect, cell, false);

    let raw_rows = pane.wrap_map().unwrap().visual_rows_for(3);
    assert!(
        raw_rows > 1,
        "fixture must wrap the raw code block line before LivePreviewMode display mapping"
    );
    assert_eq!(pane.soft_wrap_display_rows_for_line(3), 1);

    let code_display_row = pane.soft_wrap_visual_row_of_line(3).unwrap();
    let next_row = pane
        .soft_wrap_display_row_info(code_display_row + 1)
        .expect("expected row after code block content");
    assert_eq!(next_row.info.logical_line, 4);

    let _ = std::fs::remove_file(path);
}

#[test]
fn live_preview_soft_wrap_display_rows_do_not_enter_table_subrows() {
    // UC-6 BR-4: LivePreviewMode Soft Wrap counts Markdown table rows as one display row even when their raw source exceeds the Pane width.
    let long_cell = format!(
        "domain/pane owns LivePreviewMode and Soft Wrap {}",
        "x".repeat(90)
    );
    let contents = format!(
        "# Tests\n\n| Context | Responsibility |\n| --- | --- |\n| domain/pane | {long_cell} |\n\nAfter\n"
    );
    let (mut app, id, path) = app_with_markdown_editor(&contents);
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 320.0, 220.0);
    let cell = crate::tide_core::Size::new(8.0, 16.0);
    let content_rect = pane_content_rect(pane_rect, cell.height);

    let pane = match app.panes.get_mut(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    pane.prepare_inline_caches(content_rect, cell, false);

    let raw_rows = pane.wrap_map().unwrap().visual_rows_for(4);
    assert!(
        raw_rows > 1,
        "fixture must wrap the raw table row before LivePreviewMode display mapping"
    );
    assert_eq!(pane.soft_wrap_display_rows_for_line(4), 1);

    let table_display_row = pane.soft_wrap_visual_row_of_line(4).unwrap();
    let next_row = pane
        .soft_wrap_display_row_info(table_display_row + 1)
        .expect("expected row after table row");
    assert_eq!(next_row.info.logical_line, 5);

    let _ = std::fs::remove_file(path);
}

#[test]
fn live_preview_soft_wrap_code_blocks_allow_horizontal_scroll() {
    // UC-6 BR-5: Fixed-width code block content in LivePreviewMode can be viewed with horizontal scroll even while Soft Wrap is active.
    let long_code = format!("application services renderer adapter {}", "x".repeat(120));
    let contents = format!("# Context Map\n\n```text\n{long_code}\n```\n");
    let (mut app, id, path) = app_with_markdown_editor(&contents);
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 280.0, 220.0);
    let cell = crate::tide_core::Size::new(8.0, 16.0);
    let content_rect = pane_content_rect(pane_rect, cell.height);

    let pane = match app.panes.get_mut(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    pane.prepare_inline_caches(content_rect, cell, false);
    let (_, visible_cols) = pane.viewport_size_for_content_rect(content_rect, cell);
    assert!(
        pane.live_preview_fixed_width_max_h_scroll(visible_cols)
            .unwrap()
            > 0
    );

    let visual_row = pane.soft_wrap_visual_row_of_line(3).unwrap();
    pane.handle_live_preview_fixed_width_horizontal_scroll_at_visual_row(
        visual_row,
        -4.0,
        visible_cols,
    );

    assert!(
        pane.live_preview_fixed_width_h_scroll_for_line(3) > 0,
        "horizontal scroll should move across long code block content"
    );

    let _ = std::fs::remove_file(path);
}

#[test]
fn live_preview_soft_wrap_tables_allow_horizontal_scroll() {
    // UC-6 BR-5: Fixed-width table content in LivePreviewMode can be viewed with horizontal scroll even while Soft Wrap is active.
    let long_cell = format!(
        "domain/pane owns LivePreviewMode and Soft Wrap {}",
        "x".repeat(120)
    );
    let contents = format!(
        "# Tests\n\n| Context | Responsibility |\n| --- | --- |\n| domain/pane | {long_cell} |\n"
    );
    let (mut app, id, path) = app_with_markdown_editor(&contents);
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 280.0, 220.0);
    let cell = crate::tide_core::Size::new(8.0, 16.0);
    let content_rect = pane_content_rect(pane_rect, cell.height);

    let pane = match app.panes.get_mut(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    pane.prepare_inline_caches(content_rect, cell, false);
    let (_, visible_cols) = pane.viewport_size_for_content_rect(content_rect, cell);
    assert!(
        pane.live_preview_fixed_width_max_h_scroll(visible_cols)
            .unwrap()
            > 0
    );

    let visual_row = pane.soft_wrap_visual_row_of_line(4).unwrap();
    pane.handle_live_preview_fixed_width_horizontal_scroll_at_visual_row(
        visual_row,
        -4.0,
        visible_cols,
    );

    assert!(
        pane.live_preview_fixed_width_h_scroll_for_line(4) > 0,
        "horizontal scroll should move across long table content"
    );

    let _ = std::fs::remove_file(path);
}

#[test]
fn vertical_scroll_over_fixed_width_live_preview_block_scrolls_pane_not_block() {
    // UC-6 BR-11: Vertical-dominant scroll over a fixed-width LivePreviewMode block routes to Markdown Pane vertical scrolling and does not mutate block horizontal scroll.
    let (mut app, id, path, table_line) = live_preview_scroll_axis_fixture();

    handle_scroll(&mut app, -0.15, -3.0);

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert!(
        pane.soft_wrap_visual_scroll() > 0,
        "vertical-dominant scroll should move the Markdown Pane viewport"
    );
    assert_eq!(
        pane.live_preview_fixed_width_h_scroll_for_line(table_line),
        0,
        "vertical-dominant scroll should not move the fixed-width block horizontally"
    );

    let _ = std::fs::remove_file(path);
}

#[test]
fn horizontal_scroll_over_fixed_width_live_preview_block_scrolls_block_not_pane() {
    // UC-6 BR-12: Horizontal-dominant scroll over a fixed-width LivePreviewMode block mutates only that block's horizontal scroll and does not route Markdown Pane vertical scrolling.
    let (mut app, id, path, table_line) = live_preview_scroll_axis_fixture();

    handle_scroll(&mut app, -3.0, -0.15);

    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert!(
        pane.live_preview_fixed_width_h_scroll_for_line(table_line) > 0,
        "horizontal-dominant scroll should move the fixed-width block horizontally"
    );
    assert_eq!(
        pane.soft_wrap_visual_scroll(),
        0,
        "horizontal-dominant scroll should not move the Markdown Pane viewport"
    );

    let _ = std::fs::remove_file(path);
}

#[test]
fn live_preview_fixed_width_blocks_keep_independent_horizontal_scroll() {
    // UC-6 BR-5: Horizontal scroll is scoped to the fixed-width block under the gesture, not shared by every code block and table in the Markdown Pane.
    let first = format!("first block {}", "a".repeat(100));
    let second = format!("second block {}", "b".repeat(100));
    let contents = format!("```text\n{first}\n```\n\n```text\n{second}\n```\n");
    let (mut app, id, path) = app_with_markdown_editor(&contents);
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 280.0, 220.0);
    let cell = crate::tide_core::Size::new(8.0, 16.0);
    let content_rect = pane_content_rect(pane_rect, cell.height);

    let pane = match app.panes.get_mut(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    pane.prepare_inline_caches(content_rect, cell, false);
    let (_, visible_cols) = pane.viewport_size_for_content_rect(content_rect, cell);
    let second_block_row = pane.soft_wrap_visual_row_of_line(5).unwrap();

    pane.handle_live_preview_fixed_width_horizontal_scroll_at_visual_row(
        second_block_row,
        -4.0,
        visible_cols,
    );

    assert_eq!(pane.live_preview_fixed_width_h_scroll_for_line(1), 0);
    assert!(
        pane.live_preview_fixed_width_h_scroll_for_line(5) > 0,
        "horizontal scroll should only move the second fixed-width block"
    );

    let _ = std::fs::remove_file(path);
}

#[test]
fn live_preview_code_block_blank_lines_share_horizontal_scroll() {
    // UC-6 BR-13: A fenced code block with empty source rows owns one horizontal scroll state across every row.
    let first = format!("first line {}", "a".repeat(90));
    let second = format!("second line {}", "b".repeat(120));
    let contents = format!("```text\n{first}\n\n{second}\n```\n");
    let (mut app, id, path) = app_with_markdown_editor(&contents);
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 280.0, 220.0);
    let cell = crate::tide_core::Size::new(8.0, 16.0);
    let content_rect = pane_content_rect(pane_rect, cell.height);

    let pane = match app.panes.get_mut(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    pane.prepare_inline_caches(content_rect, cell, false);
    let (_, visible_cols) = pane.viewport_size_for_content_rect(content_rect, cell);
    let second_line_row = pane.soft_wrap_visual_row_of_line(3).unwrap();

    pane.handle_live_preview_fixed_width_horizontal_scroll_at_visual_row(
        second_line_row,
        -4.0,
        visible_cols,
    );

    let first_scroll = pane.live_preview_fixed_width_h_scroll_for_line(1);
    let blank_scroll = pane.live_preview_fixed_width_h_scroll_for_line(2);
    let second_scroll = pane.live_preview_fixed_width_h_scroll_for_line(3);

    assert!(second_scroll > 0);
    assert_eq!(first_scroll, second_scroll);
    assert_eq!(blank_scroll, second_scroll);

    let _ = std::fs::remove_file(path);
}

#[test]
fn live_preview_context_map_table_rows_use_fixed_width_display_rows() {
    // UC-6 BR-4: Source-valid Markdown table rows stay one fixed-width display row even when pulldown_cmark styling is unavailable for a row.
    let contents = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/context-map.md"),
    )
    .unwrap();
    let (mut app, id, path) = app_with_markdown_editor(&contents);
    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 280.0, 220.0);
    let cell = crate::tide_core::Size::new(8.0, 16.0);
    let content_rect = pane_content_rect(pane_rect, cell.height);

    let pane = match app.panes.get_mut(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    pane.prepare_inline_caches(content_rect, cell, false);

    for line in 54..=60 {
        assert!(
            pane.live_preview_source_table_line(line),
            "context-map table line {} should be treated as a table row",
            line + 1
        );
        assert_eq!(
            pane.soft_wrap_display_rows_for_line(line),
            1,
            "context-map table line {} should not enter raw wrapped sub-rows",
            line + 1
        );
    }

    let _ = std::fs::remove_file(path);
}
