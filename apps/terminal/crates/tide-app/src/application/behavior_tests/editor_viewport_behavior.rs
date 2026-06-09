// Spec: docs/specs/editor-pane-revamp.md

use std::path::PathBuf;

use crate::adapter::outward::view::editor_selection_rects;
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, Selection};
use crate::state::FocusArea;
use crate::tide_core::{MouseButton, Rect, Size, Vec2};
use crate::tide_editor::EditorPosition;
use crate::tide_platform::WindowProxy;
use crate::App;

fn test_window_proxy() -> WindowProxy {
    let (tx, _rx) = std::sync::mpsc::channel();
    WindowProxy::new(tx, std::sync::Arc::new(|| {}))
}

fn char_col_to_byte(line: &str, char_col: usize) -> usize {
    line.char_indices()
        .nth(char_col)
        .map(|(idx, _)| idx)
        .unwrap_or(line.len())
}

// --- UC-1: KeepDocumentChromeAndCursorLocked ---

#[test]
fn caret_rect_with_korean_spaces_and_dots_matches_glyph_columns() {
    // The caret must sit on the glyph it points at when a line mixes wide
    // Korean (width 2), spaces, and dots (width 1) — the user-reported
    // "시각적으로 가리키는 곳이 이상" case, on the non-wrapped authoring path.
    let mut pane = EditorPane::new_empty(1);
    pane.soft_wrap = false;
    pane.editor.buffer.lines = vec!["한 글.x".to_string()]; // 한(2) ' '(1) 글(2) '.'(1) x(1)
    let cell = Size::new(8.0, 16.0);
    let inner = Rect::new(0.0, 0.0, 400.0, 200.0);
    let gutter = 6.0 * cell.width; // GUTTER_WIDTH_CELLS = 6

    // After "한 " (byte 4): display width 2 + 1 = 3 cells.
    pane.editor
        .cursor
        .set_position(EditorPosition { line: 0, col: 4 });
    let caret = pane.authoring_cursor_rect(inner, cell, 0).expect("caret");
    assert_eq!(caret.x, gutter + 3.0 * cell.width);

    // After "한 글" (byte 7), before the dot: display width 2 + 1 + 2 = 5 cells.
    pane.editor
        .cursor
        .set_position(EditorPosition { line: 0, col: 7 });
    let caret = pane.authoring_cursor_rect(inner, cell, 0).expect("caret");
    assert_eq!(caret.x, gutter + 5.0 * cell.width);

    // After "한 글." (byte 8): display width 5 + 1 = 6 cells.
    pane.editor
        .cursor
        .set_position(EditorPosition { line: 0, col: 8 });
    let caret = pane.authoring_cursor_rect(inner, cell, 0).expect("caret");
    assert_eq!(caret.x, gutter + 6.0 * cell.width);
}

#[test]
fn selection_rects_share_authoring_viewport_geometry() {
    // UC-1 BR-2: Selection rects must use the same authoring rect, gutter width, and scroll origin as cursor geometry.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = vec!["first".to_string(), "abcdef".to_string()];
    pane.editor
        .cursor
        .set_position(EditorPosition { line: 1, col: 2 });

    let inner = Rect::new(10.0, 20.0, 240.0, 160.0);
    let cell_size = Size::new(8.0, 16.0);
    let selection = Selection {
        anchor: (1, 2),
        end: (1, 4),
    };

    let cursor_rect = pane
        .authoring_cursor_rect(inner, cell_size, 0)
        .expect("cursor should be visible");
    let selection_rects = editor_selection_rects(&pane, inner, cell_size, &selection);

    assert_eq!(selection_rects.len(), 1);
    assert_eq!(selection_rects[0].x.to_bits(), cursor_rect.x.to_bits());
    assert_eq!(selection_rects[0].y.to_bits(), cursor_rect.y.to_bits());
}

#[test]
fn split_preview_selection_rects_share_authoring_viewport_geometry() {
    // UC-1 BR-2: Selection rects in split preview must stay inside the authoring rect.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.file_path = Some(PathBuf::from("note.md"));
    pane.split_preview = true;
    pane.editor.buffer.lines = vec!["abcdefghijklmnopqrstuvwxyz0123456789".to_string()];

    let inner = Rect::new(10.0, 20.0, 480.0, 160.0);
    let cell_size = Size::new(8.0, 16.0);
    let (authoring_rect, _) = pane
        .split_preview_rects(inner, cell_size)
        .expect("split preview should expose an authoring rect");
    let selection = Selection {
        anchor: (0, 0),
        end: (0, 36),
    };

    let selection_rects = editor_selection_rects(&pane, inner, cell_size, &selection);

    assert_eq!(selection_rects.len(), 1);
    assert!(
        selection_rects[0].x + selection_rects[0].width <= authoring_rect.x + authoring_rect.width,
        "selection rect should not spill into the split preview region"
    );
}

#[test]
fn plain_selection_rects_use_display_cell_width_for_wide_text() {
    // UC-1 BR-2: Plain selection rects must use display-cell widths for wide characters.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = vec!["한a글".to_string()];
    pane.editor.cursor.set_position(EditorPosition {
        line: 0,
        col: "한".len(),
    });

    let inner = Rect::new(10.0, 20.0, 240.0, 160.0);
    let cell_size = Size::new(8.0, 16.0);
    let selection = Selection {
        anchor: (0, 1),
        end: (0, 3),
    };

    let cursor_rect = pane
        .authoring_cursor_rect(inner, cell_size, 0)
        .expect("cursor after first wide character should be visible");
    let selection_rects = editor_selection_rects(&pane, inner, cell_size, &selection);

    assert_eq!(selection_rects.len(), 1);
    assert_eq!(selection_rects[0].x.to_bits(), cursor_rect.x.to_bits());
    assert_eq!(
        selection_rects[0].width.to_bits(),
        (3.0_f32 * cell_size.width).to_bits()
    );
}

#[test]
fn wrapped_selection_rects_share_authoring_viewport_geometry() {
    // UC-1 BR-2: Wrapped selection rects must use the same WrapMap visual row as cursor geometry.
    let mut pane = EditorPane::new_empty(1);
    pane.soft_wrap = true;
    pane.editor.buffer.lines = vec!["abcdefghijkl".to_string()];
    pane.ensure_wrap_map(6);
    pane.editor
        .cursor
        .set_position(EditorPosition { line: 0, col: 7 });

    let inner = Rect::new(10.0, 20.0, 96.0, 160.0);
    let cell_size = Size::new(8.0, 16.0);
    let selection = Selection {
        anchor: (0, 7),
        end: (0, 9),
    };

    let cursor_rect = pane
        .authoring_cursor_rect(inner, cell_size, 0)
        .expect("wrapped cursor should be visible");
    let selection_rects = editor_selection_rects(&pane, inner, cell_size, &selection);

    assert_eq!(selection_rects.len(), 1);
    assert_eq!(selection_rects[0].x.to_bits(), cursor_rect.x.to_bits());
    assert_eq!(selection_rects[0].y.to_bits(), cursor_rect.y.to_bits());
}

#[test]
fn wrapped_hit_testing_uses_display_cell_width_for_wide_text() {
    // UC-1 BR-2: Wrapped hit-testing must convert display cells through wide-character widths before setting cursor state.
    let mut pane = EditorPane::new_empty(1);
    pane.soft_wrap = true;
    pane.editor.buffer.lines = vec!["한글abc한글".to_string()];
    pane.ensure_wrap_map(6);

    let inner = Rect::new(10.0, 20.0, 144.0, 160.0);
    let cell_size = Size::new(8.0, 16.0);
    let gutter_width = crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;
    let expected_x = inner.x + gutter_width + 3.0 * cell_size.width;

    let (line, char_col) = pane
        .soft_wrap_display_position_for_visual_cell(1, 3)
        .expect("wrapped hit target should resolve to a buffer position");
    assert_eq!((line, char_col), (0, 6));

    let byte_col = pane
        .editor
        .buffer
        .line(line)
        .and_then(|text| text.char_indices().nth(char_col).map(|(idx, _)| idx))
        .unwrap_or_else(|| pane.editor.buffer.line(line).map_or(0, |text| text.len()));
    pane.editor.cursor.set_position(EditorPosition {
        line,
        col: byte_col,
    });

    let cursor_rect = pane
        .authoring_cursor_rect(inner, cell_size, 0)
        .expect("wrapped cursor should be visible");

    assert_eq!(cursor_rect.x.to_bits(), expected_x.to_bits());
}

#[test]
fn dragging_editor_selection_moves_cursor_to_active_edge() {
    // UC-1 BR-2: During mouse selection, the overlay cursor must follow the active selection edge.
    let mut app = App::new();
    app.window.cached_cell_size = Size::new(8.0, 16.0);
    let (layout, pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.focus.focused = Some(pane_id);
    app.focus.focus_area = FocusArea::Stage;

    let mut pane = EditorPane::new_empty(pane_id);
    pane.editor.buffer.lines = vec!["처음에는 좋은 선택".to_string()];
    pane.editor.cursor.set_position(EditorPosition {
        line: 0,
        col: char_col_to_byte(&pane.editor.buffer.lines[0], 8),
    });
    app.panes.insert(pane_id, PaneKind::Editor(pane));

    let pane_rect = Rect::new(0.0, 0.0, 360.0, 180.0);
    let cell_size = app.window.cached_cell_size;
    app.visual_pane_rects = vec![(pane_id, pane_rect)];
    let content_rect = match app.panes.get(&pane_id) {
        Some(PaneKind::Editor(pane)) => {
            pane.content_rect(pane_rect, crate::theme::TAB_BAR_HEIGHT, cell_size)
        }
        _ => panic!("expected editor pane"),
    };
    let gutter_x =
        content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;

    let start = Vec2::new(gutter_x + 1.0, content_rect.y + 1.0);
    let after_good = Vec2::new(
        gutter_x + 11.0 * cell_size.width + 1.0,
        content_rect.y + 1.0,
    );
    app.window.last_cursor_pos = start;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        MouseButton::Left,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
        &mut app,
        after_good,
        &test_window_proxy(),
    );

    let pane = match app.panes.get(&pane_id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    let selection = pane.selection.as_ref().expect("selection should be active");
    assert_eq!(selection.anchor, (0, 0));
    assert_eq!(selection.end, (0, 6));
    let cursor_rect = pane
        .authoring_cursor_rect(content_rect, cell_size, 0)
        .expect("selection cursor should be visible");
    assert_eq!(
        cursor_rect.x.to_bits(),
        (gutter_x + 11.0 * cell_size.width).to_bits()
    );
}

#[test]
fn dragging_editor_selection_stays_bound_to_source_pane_outside_viewport() {
    // UC-1 BR-2: Selection drag stays bound to the source Editor Pane and clamps pointer positions outside the authoring viewport.
    let mut app = App::new();
    app.window.cached_cell_size = Size::new(8.0, 16.0);
    let (layout, pane_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.focus.focused = Some(pane_id);
    app.focus.focus_area = FocusArea::Stage;

    let mut pane = EditorPane::new_empty(pane_id);
    pane.editor.buffer.lines = vec!["abcdef".to_string()];
    app.panes.insert(pane_id, PaneKind::Editor(pane));

    let pane_rect = Rect::new(0.0, 0.0, 180.0, 120.0);
    let cell_size = app.window.cached_cell_size;
    app.visual_pane_rects = vec![(pane_id, pane_rect)];
    let content_rect = match app.panes.get(&pane_id) {
        Some(PaneKind::Editor(pane)) => {
            pane.content_rect(pane_rect, crate::theme::TAB_BAR_HEIGHT, cell_size)
        }
        _ => panic!("expected editor pane"),
    };
    let gutter_x =
        content_rect.x + crate::pane::editor::GUTTER_WIDTH_CELLS as f32 * cell_size.width;

    let start = Vec2::new(gutter_x + 1.0, content_rect.y + 1.0);
    let outside_right = Vec2::new(
        content_rect.x + content_rect.width + 24.0,
        content_rect.y + 1.0,
    );
    app.window.last_cursor_pos = start;
    crate::adapter::inward::mouse_adapter::handle_mouse_down(
        &mut app,
        MouseButton::Left,
        &test_window_proxy(),
    );
    crate::adapter::inward::mouse_adapter::drag::handle_cursor_moved_logical(
        &mut app,
        outside_right,
        &test_window_proxy(),
    );

    let pane = match app.panes.get(&pane_id) {
        Some(PaneKind::Editor(pane)) => pane,
        _ => panic!("expected editor pane"),
    };
    let selection = pane.selection.as_ref().expect("selection should be active");
    assert_eq!(selection.anchor, (0, 0));
    assert_eq!(selection.end, (0, 6));
}

#[test]
fn plain_selection_rect_clamps_to_line_content_width() {
    // UC-1 BR-2: Dragging past the end of a plain editor line must not paint selection to the viewport edge.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = vec!["abc".to_string()];

    let inner = Rect::new(10.0, 20.0, 240.0, 160.0);
    let cell_size = Size::new(8.0, 16.0);
    let selection = Selection {
        anchor: (0, 0),
        end: (0, 80),
    };

    let selection_rects = editor_selection_rects(&pane, inner, cell_size, &selection);

    assert_eq!(selection_rects.len(), 1);
    assert_eq!(
        selection_rects[0].width.to_bits(),
        (3.0_f32 * 8.0).to_bits()
    );
}

#[test]
fn multiline_plain_selection_rects_stop_at_each_line_content_width() {
    // UC-1 BR-2: Multi-line plain editor selection must stop each row highlight at that row's text content.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = vec!["abc".to_string(), "de".to_string(), "fghi".to_string()];

    let inner = Rect::new(10.0, 20.0, 320.0, 160.0);
    let cell_size = Size::new(8.0, 16.0);
    let selection = Selection {
        anchor: (0, 0),
        end: (2, 4),
    };

    let selection_rects = editor_selection_rects(&pane, inner, cell_size, &selection);

    assert_eq!(selection_rects.len(), 3);
    assert_eq!(
        selection_rects[0].width.to_bits(),
        (3.0_f32 * 8.0).to_bits()
    );
    assert_eq!(
        selection_rects[1].width.to_bits(),
        (2.0_f32 * 8.0).to_bits()
    );
    assert_eq!(
        selection_rects[2].width.to_bits(),
        (4.0_f32 * 8.0).to_bits()
    );
}

#[test]
fn ime_cursor_area_matches_editor_cursor_geometry() {
    // UC-1 BR-3: IME cursor areas must use the same authoring rect as the rendered editor cursor.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = vec!["alpha".to_string(), "abcdef".to_string()];
    pane.editor
        .cursor
        .set_position(EditorPosition { line: 1, col: 3 });

    let pane_rect = Rect::new(10.0, 20.0, 320.0, 220.0);
    let cell_size = Size::new(8.0, 16.0);
    let content_rect = pane.content_rect(pane_rect, crate::theme::TAB_BAR_HEIGHT, cell_size);
    let authoring_rect = pane.authoring_rect(content_rect, cell_size);
    let cursor_rect = pane
        .authoring_cursor_rect(authoring_rect, cell_size, 0)
        .expect("cursor should be visible");
    let ime_rect = crate::adapter::inward::event_loop_adapter::editor_ime_cursor_area(
        &pane, pane_rect, cell_size, "",
    )
    .expect("ime cursor area should be visible");

    assert_eq!(ime_rect.x.to_bits(), cursor_rect.x.to_bits());
    assert_eq!(ime_rect.y.to_bits(), cursor_rect.y.to_bits());
    assert_eq!(ime_rect.width.to_bits(), cell_size.width.to_bits());
    assert_eq!(ime_rect.height.to_bits(), cursor_rect.height.to_bits());
}

#[test]
fn wrapped_ime_cursor_area_matches_editor_cursor_geometry() {
    // UC-1 BR-3: IME cursor areas must use the same WrapMap visual row as the rendered editor cursor.
    let mut pane = EditorPane::new_empty(1);
    pane.soft_wrap = true;
    pane.editor.buffer.lines = vec!["abcdefghijkl".to_string()];
    pane.ensure_wrap_map(6);
    pane.editor
        .cursor
        .set_position(EditorPosition { line: 0, col: 7 });

    let pane_rect = Rect::new(10.0, 20.0, 144.0, 220.0);
    let cell_size = Size::new(8.0, 16.0);
    let content_rect = pane.content_rect(pane_rect, crate::theme::TAB_BAR_HEIGHT, cell_size);
    let authoring_rect = pane.authoring_rect(content_rect, cell_size);
    let cursor_rect = pane
        .authoring_cursor_rect(authoring_rect, cell_size, 0)
        .expect("wrapped cursor should be visible");
    let ime_rect = crate::adapter::inward::event_loop_adapter::editor_ime_cursor_area(
        &pane, pane_rect, cell_size, "",
    )
    .expect("wrapped ime cursor area should be visible");

    assert_eq!(ime_rect.x.to_bits(), cursor_rect.x.to_bits());
    assert_eq!(ime_rect.y.to_bits(), cursor_rect.y.to_bits());
    assert_eq!(ime_rect.width.to_bits(), cell_size.width.to_bits());
    assert_eq!(ime_rect.height.to_bits(), cursor_rect.height.to_bits());
}
