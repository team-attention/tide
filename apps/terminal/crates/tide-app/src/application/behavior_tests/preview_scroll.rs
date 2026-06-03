// Spec: docs/specs/editor.md
use crate::pane::editor::{self, EditorPane};
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::theme::{PANE_PADDING, TAB_BAR_HEIGHT};
use crate::tide_core::{Color, TextStyle};
use crate::tide_editor::highlight::{StyledSpan, StyledSpanCursor};
use crate::tide_editor::markdown::{render_markdown_preview, MarkdownTheme};
use crate::ActionPort;
use crate::App;
use unicode_width::UnicodeWidthStr;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn test_window_proxy() -> crate::tide_platform::WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    crate::tide_platform::WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

fn preview_content_rect(pane_rect: crate::tide_core::Rect) -> crate::tide_core::Rect {
    crate::pane::pane_content_rect(pane_rect, TAB_BAR_HEIGHT)
}

fn app_with_preview_editor(line_count: usize) -> (App, u64, crate::tide_core::Rect) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;

    let mut pane = EditorPane::new_empty(id);
    pane.preview_mode = true;
    pane.editor.buffer.lines = (0..line_count).map(|idx| format!("line {}", idx)).collect();
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;

    let pane_rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);
    app.visual_pane_rects = vec![(id, pane_rect)];

    let content_rect = preview_content_rect(pane_rect);
    let cell = app.window.cached_cell_size;
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.prepare_inline_caches(content_rect, cell, false);
    }

    (app, id, pane_rect)
}

fn preview_visible_rows(app: &App, pane_rect: crate::tide_core::Rect) -> usize {
    ((pane_rect.height - TAB_BAR_HEIGHT - PANE_PADDING) / app.window.cached_cell_size.height)
        .floor() as usize
}

fn preview_max_scroll(app: &App, pane_id: u64, pane_rect: crate::tide_core::Rect) -> usize {
    let visible_rows = preview_visible_rows(app, pane_rect);
    match app.panes.get(&pane_id) {
        Some(PaneKind::Editor(pane)) => pane.preview_line_count().saturating_sub(visible_rows),
        _ => 0,
    }
}

// --- markdown-preview-performance-polish UC-3: ReadFullMarkdownPreview ---

#[test]
fn wide_markdown_preview_uses_centered_readable_width() {
    // UC-3 BR-7/BR-8: wide Markdown preview caps wrapping at the readable width and centers the content.
    let pane = EditorPane::new_empty(1);
    let cell = crate::tide_core::Size::new(8.0, 16.0);
    let rect = crate::tide_core::Rect::new(0.0, 0.0, 1600.0, 640.0);

    assert_eq!(
        pane.preview_wrap_width_for_rect(rect, cell),
        editor::MARKDOWN_PREVIEW_READABLE_WIDTH_CELLS
    );
    assert!(
        pane.preview_content_inset_for_rect(rect, cell, 0.0) > 0.0,
        "wide preview content should be centered with a positive inset"
    );
}

#[test]
fn narrow_markdown_preview_uses_available_width() {
    // UC-3 BR-9: narrow Markdown preview keeps using the available width instead of clipping to the readable width.
    let pane = EditorPane::new_empty(1);
    let cell = crate::tide_core::Size::new(8.0, 16.0);
    let rect = crate::tide_core::Rect::new(0.0, 0.0, 420.0, 320.0);

    assert!(
        pane.preview_wrap_width_for_rect(rect, cell)
            < editor::MARKDOWN_PREVIEW_READABLE_WIDTH_CELLS
    );
    assert_eq!(pane.preview_content_inset_for_rect(rect, cell, 0.0), 0.0);
}

#[test]
fn table_heavy_markdown_preview_uses_compact_table_rows() {
    // markdown-preview-performance-polish UC-4 BR-10: table preview should not emit a separator before every body row.
    let mut lines = vec!["| A | B | C |".to_string(), "|---|---|---|".to_string()];
    for row in 0..100 {
        lines.push(format!("| a{} | b{} | c{} |", row, row, row));
    }

    let preview = render_markdown_preview(&lines, &MarkdownTheme::dark(), 96);

    assert!(
        preview.len() <= 106,
        "100 body rows should render near one preview line per row, not with body-row separators; got {} lines",
        preview.len()
    );
}

#[test]
fn long_markdown_paragraph_coalesces_plain_text_spans() {
    // markdown-preview-performance-polish UC-5 BR-12: same-style prose should not keep one span per word.
    let paragraph = (0..120)
        .map(|idx| format!("word{}", idx))
        .collect::<Vec<_>>()
        .join(" ");
    let preview = render_markdown_preview(&[paragraph], &MarkdownTheme::dark(), 40);
    let content_lines: Vec<_> = preview
        .iter()
        .filter(|line| line.spans.iter().any(|span| !span.text.trim().is_empty()))
        .collect();

    assert!(
        content_lines.len() > 10,
        "test paragraph should wrap into many preview lines"
    );
    for line in content_lines {
        assert!(
            line.spans.len() <= 2,
            "plain text line should contain only indent plus one body span, got {} spans",
            line.spans.len()
        );
    }
}

#[test]
fn overwide_inline_code_wraps_within_preview_width() {
    // markdown-preview-performance-polish UC-5 BR-13: a single long inline code span should not create an overwide preview line.
    let long_code = "a".repeat(120);
    let source = format!("prefix `{}` suffix", long_code);
    let preview = render_markdown_preview(&[source], &MarkdownTheme::dark(), 40);

    assert!(
        preview.len() > 3,
        "long inline code should wrap into multiple preview lines"
    );
    for line in preview
        .iter()
        .filter(|line| line.spans.iter().any(|span| !span.text.trim().is_empty()))
    {
        let width: usize = line.spans.iter().map(|span| span.text.width()).sum();
        assert!(
            width <= 40,
            "preview line should stay within wrap width, got width {}",
            width
        );
    }
}

#[test]
fn styled_span_cursor_matches_prefix_scan_for_monotonic_access() {
    // markdown-preview-performance-polish UC-6 BR-14: StyledSpanCursor preserves fallback style lookup semantics for monotonic access.
    let default_style = TextStyle {
        foreground: Color::new(0.8, 0.8, 0.8, 1.0),
        background: None,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
    };
    let bold_style = TextStyle {
        bold: true,
        ..default_style
    };
    let italic_style = TextStyle {
        italic: true,
        ..default_style
    };
    let spans = vec![
        StyledSpan {
            text: "alpha ".repeat(20),
            style: default_style,
        },
        StyledSpan {
            text: "beta ".repeat(20),
            style: bold_style,
        },
        StyledSpan {
            text: "gamma ".repeat(20),
            style: italic_style,
        },
    ];
    let mut cursor = StyledSpanCursor::new(&spans, default_style);
    let total_chars: usize = spans.iter().map(|span| span.text.chars().count()).sum();

    for target_char in 0..total_chars {
        let expected = prefix_scan_style_at(&spans, target_char, default_style);
        assert_eq!(cursor.style_at(target_char), expected);
    }
}

fn prefix_scan_style_at(
    spans: &[StyledSpan],
    target_char: usize,
    fallback: TextStyle,
) -> TextStyle {
    let mut char_idx = 0usize;
    for span in spans {
        for _ in span.text.chars() {
            if char_idx == target_char {
                return span.style;
            }
            char_idx += 1;
        }
    }
    fallback
}

#[test]
#[ignore = "profiling harness; run explicitly with --ignored"]
fn profile_markdown_preview_terminal_pane_inset() {
    profile_markdown_preview_file("docs/specs/terminal-pane-inset.md");
}

#[test]
#[ignore = "profiling harness; run explicitly with --ignored"]
fn profile_markdown_preview_terminal_context() {
    profile_markdown_preview_file("docs/specs/terminal-context.md");
}

fn profile_markdown_preview_file(path: &str) {
    let source = std::fs::read_to_string(path).expect("read markdown profile fixture");
    let lines: Vec<String> = source.lines().map(str::to_string).collect();
    let duration = std::env::var("TIDE_TERMINAL_PROFILE_SECONDS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(20);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(duration);
    let theme = MarkdownTheme::dark();
    let mut iterations = 0usize;
    let mut total_preview_lines = 0usize;

    while std::time::Instant::now() < deadline {
        let preview = std::hint::black_box(render_markdown_preview(&lines, &theme, 96));
        total_preview_lines += preview.len();
        iterations += 1;
        std::hint::black_box(total_preview_lines);
    }

    eprintln!(
        "profiled {path}: iterations={iterations}, total_preview_lines={total_preview_lines}"
    );
}

// --- UC-4: PreviewScroll ---

#[test]
fn j_scrolls_down_one_line() {
    // UC-4 BR-18: j scrolls preview down one line
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('j', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 1);
}

#[test]
fn k_scrolls_up_one_line() {
    // UC-4 BR-19: k scrolls preview up one line
    let mut v = 5;
    let mut h = 0;
    editor::apply_preview_scroll('k', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 4);
}

#[test]
fn k_does_not_scroll_below_zero() {
    // UC-4 BR-20: k does not scroll below zero
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('k', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 0);
}

#[test]
fn d_scrolls_down_half_page() {
    // UC-4 BR-21: d scrolls down half page
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('d', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 15);
}

#[test]
fn u_scrolls_up_half_page() {
    // UC-4 BR-22: u scrolls up half page
    let mut v = 20;
    let mut h = 0;
    editor::apply_preview_scroll('u', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 5);
}

#[test]
fn g_scrolls_to_top() {
    // UC-4 BR-23: g scrolls to top
    let mut v = 50;
    let mut h = 0;
    editor::apply_preview_scroll('g', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 0);
}

#[test]
fn capital_g_scrolls_to_bottom() {
    // UC-4 BR-24: G scrolls to bottom
    let mut v = 0;
    let mut h = 0;
    editor::apply_preview_scroll('G', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 100);
}

#[test]
fn scroll_clamps_to_max() {
    // UC-4 BR-24: preview scroll clamps to the available range
    let mut v = 95;
    let mut h = 0;
    editor::apply_preview_scroll('j', &mut v, &mut h, 100, 100, 30);
    assert_eq!(v, 96);
    let mut v2 = 100;
    editor::apply_preview_scroll('j', &mut v2, &mut h, 100, 100, 30);
    assert_eq!(v2, 100);
}

#[test]
fn mouse_wheel_preview_scroll_clamps_to_visible_range() {
    // UC-4 BR-27: Mouse-wheel preview scrolling clamps to the same visible range as keyboard preview navigation.
    let (mut app, id, pane_rect) = app_with_preview_editor(200);
    let pos = crate::tide_core::Vec2::new(pane_rect.x + 40.0, pane_rect.y + TAB_BAR_HEIGHT + 40.0);
    let max_scroll = preview_max_scroll(&app, id, pane_rect);

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::MouseScroll {
            delta: -1000.0,
            position: pos,
        }),
    );
    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(pane.preview_scroll, max_scroll);

    ActionPort::handle_action(
        &mut app,
        crate::tide_input::Action::RouteToPane(id),
        Some(crate::tide_core::InputEvent::MouseScroll {
            delta: 1000.0,
            position: pos,
        }),
    );
    let pane = match app.panes.get(&id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    assert_eq!(pane.preview_scroll, 0);
}

#[test]
fn preview_scrollbar_drag_clamps_to_visible_range() {
    // UC-4 BR-28: Scrollbar drag in preview mode clamps to the same visible range as keyboard preview navigation.
    let (mut app, id, pane_rect) = app_with_preview_editor(200);
    let inner = preview_content_rect(pane_rect);
    let scrollbar_x = inner.x + inner.width - 1.0;
    let max_scroll = preview_max_scroll(&app, id, pane_rect);

    app.window.last_cursor_pos = crate::tide_core::Vec2::new(scrollbar_x, inner.y + 12.0);
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
        &mut app,
        crate::tide_core::Vec2::new(scrollbar_x, inner.y + inner.height + 200.0),
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
    assert_eq!(pane.preview_scroll, max_scroll);

    app.window.last_cursor_pos =
        crate::tide_core::Vec2::new(scrollbar_x, inner.y + inner.height - 12.0);
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        crate::tide_core::MouseButton::Left,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
        &mut app,
        crate::tide_core::Vec2::new(scrollbar_x, inner.y - 200.0),
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
    assert_eq!(pane.preview_scroll, 0);
}
