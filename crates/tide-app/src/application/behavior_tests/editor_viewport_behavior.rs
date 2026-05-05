// Spec: docs/specs/editor-pane-revamp.md

use crate::adapter::outward::view::editor_selection_rects;
use crate::pane::editor::EditorPane;
use crate::pane::Selection;
use crate::tide_core::{Rect, Size};
use crate::tide_editor::EditorPosition;

// --- UC-1: KeepDocumentChromeAndCursorLocked ---

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
