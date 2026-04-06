use unicode_width::UnicodeWidthChar;

use crate::tide_core::{Color, Rect, Renderer, Size, Vec2};

use crate::theme::*;
use crate::App;
use crate::AppCorePort;

use super::{
    bold_style, draw_cursor_beam, draw_popup_rounded_bg, draw_popup_scrim, text_style, visual_width,
};

const COMMENT_INPUT_MIN_ROWS: usize = 3;
const COMMENT_INPUT_MAX_ROWS: usize = 4;
const COMMENT_INPUT_SIDE_PADDING: f32 = 10.0;

#[derive(Clone, Copy, PartialEq, Eq)]
enum CommentSegmentKind {
    Body,
    Preedit,
}

struct CommentSegment {
    text: String,
    kind: CommentSegmentKind,
}

struct CommentVisualRow {
    segments: Vec<CommentSegment>,
    width_cells: usize,
}

impl CommentVisualRow {
    fn new() -> Self {
        Self {
            segments: Vec::new(),
            width_cells: 0,
        }
    }

    fn push_char(&mut self, ch: char, kind: CommentSegmentKind, width: usize) {
        if let Some(segment) = self.segments.last_mut() {
            if segment.kind == kind {
                segment.text.push(ch);
                self.width_cells += width;
                return;
            }
        }
        self.segments.push(CommentSegment {
            text: ch.to_string(),
            kind,
        });
        self.width_cells += width;
    }
}

struct CommentInputLayout {
    input_rect: Rect,
    text_clip: Rect,
    text_x: f32,
    text_y: f32,
    line_h: f32,
    visible_rows: usize,
    first_visible_row: usize,
    cursor_row: usize,
    cursor_col_cells: usize,
    rows: Vec<CommentVisualRow>,
}

fn push_comment_text(
    rows: &mut Vec<CommentVisualRow>,
    text: &str,
    kind: CommentSegmentKind,
    max_cols: usize,
) {
    for ch in text.chars() {
        if ch == '\n' {
            rows.push(CommentVisualRow::new());
            continue;
        }
        let width = UnicodeWidthChar::width(ch).unwrap_or(1);
        if rows
            .last()
            .is_some_and(|row| row.width_cells > 0 && row.width_cells + width > max_cols)
        {
            rows.push(CommentVisualRow::new());
        }
        rows.last_mut()
            .expect("rows always has at least one row")
            .push_char(ch, kind, width);
    }
}

pub(crate) fn composer_popup_rect(logical: Size) -> Rect {
    let popup_w = if logical.width > 560.0 {
        (logical.width - 48.0).min(760.0).max(520.0)
    } else {
        (logical.width - 24.0).max(320.0)
    };
    let popup_h = if logical.height > 420.0 {
        (logical.height - 48.0).min(520.0).max(320.0)
    } else {
        (logical.height - 24.0).max(260.0)
    };
    let popup_x = (logical.width - popup_w) / 2.0;
    let popup_y = (logical.height - popup_h) / 2.0;
    Rect::new(popup_x, popup_y, popup_w, popup_h)
}

fn composer_input_visible_rows(logical: Size) -> usize {
    if logical.height > 360.0 {
        COMMENT_INPUT_MAX_ROWS
    } else {
        COMMENT_INPUT_MIN_ROWS
    }
}

pub(crate) fn composer_input_rect(logical: Size, cell_size: Size) -> (Rect, f32) {
    let popup_rect = composer_popup_rect(logical);
    let line_h = cell_size.height + 6.0;
    let visible_rows = composer_input_visible_rows(logical);
    let pad_x = 18.0;
    let mut y = popup_rect.y + 16.0;
    y += line_h + 4.0;
    y += line_h;
    y += line_h + 8.0;
    y += line_h;
    y += 5.0 * line_h + 12.0;
    y += line_h;

    let content_x = popup_rect.x + pad_x;
    let content_w = popup_rect.width - pad_x * 2.0;
    let input_h = visible_rows as f32 * line_h + 4.0;
    (Rect::new(content_x, y, content_w, input_h), line_h)
}

fn comment_input_layout(
    logical: Size,
    cell_size: Size,
    comment: &str,
    cursor: usize,
    preedit: &str,
) -> CommentInputLayout {
    let (input_rect, line_h) = composer_input_rect(logical, cell_size);
    let visible_rows = composer_input_visible_rows(logical);
    let text_x = input_rect.x + COMMENT_INPUT_SIDE_PADDING;
    let text_y = input_rect.y + ((line_h + 4.0) - cell_size.height) / 2.0;
    let text_clip = Rect::new(
        text_x,
        input_rect.y,
        input_rect.width - COMMENT_INPUT_SIDE_PADDING * 2.0,
        input_rect.height,
    );
    let max_cols = ((text_clip.width / cell_size.width).floor() as usize).max(1);

    let cursor = cursor.min(comment.len());
    let cursor = if comment.is_char_boundary(cursor) {
        cursor
    } else {
        comment
            .char_indices()
            .map(|(idx, _)| idx)
            .take_while(|idx| *idx < cursor)
            .last()
            .unwrap_or(0)
    };
    let before = &comment[..cursor];
    let after = &comment[cursor..];

    let mut rows = vec![CommentVisualRow::new()];
    push_comment_text(&mut rows, before, CommentSegmentKind::Body, max_cols);
    push_comment_text(&mut rows, preedit, CommentSegmentKind::Preedit, max_cols);
    let cursor_row = rows.len().saturating_sub(1);
    let cursor_col_cells = rows.last().map(|row| row.width_cells).unwrap_or(0);
    push_comment_text(&mut rows, after, CommentSegmentKind::Body, max_cols);

    let first_visible_row = cursor_row.saturating_sub(visible_rows.saturating_sub(1));

    CommentInputLayout {
        input_rect,
        text_clip,
        text_x,
        text_y,
        line_h,
        visible_rows,
        first_visible_row,
        cursor_row,
        cursor_col_cells,
        rows,
    }
}

pub(crate) fn context_comment_composer_cursor_area(
    logical: Size,
    cell_size: Size,
    comment: &str,
    cursor: usize,
    preedit: &str,
) -> Rect {
    let layout = comment_input_layout(logical, cell_size, comment, cursor, preedit);
    let visible_row = layout.cursor_row.saturating_sub(layout.first_visible_row);
    let cursor_x = layout.text_x + layout.cursor_col_cells as f32 * cell_size.width;
    let cursor_y = layout.text_y + visible_row as f32 * layout.line_h;
    Rect::new(cursor_x, cursor_y, cell_size.width, cell_size.height)
}

/// Render the explicit context comment composer overlay.
pub(super) fn render_context_comment_composer(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    let composer = match app.modal.context_comment_composer {
        Some(ref c) => c,
        None => return,
    };

    draw_popup_scrim(renderer, app.logical_size(), p.popup_scrim);

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let logical = app.logical_size();
    let popup_rect = composer_popup_rect(logical);
    let popup_x = popup_rect.x;
    let popup_y = popup_rect.y;
    let popup_w = popup_rect.width;

    renderer.draw_top_shadow(popup_rect, Color::new(0.0, 0.0, 0.0, 0.28), 10.0, 44.0, 0.0);
    draw_popup_rounded_bg(
        renderer,
        popup_rect,
        p.popup_bg,
        p.popup_border,
        POPUP_CORNER_RADIUS,
    );

    let title_style = bold_style(p.tab_text_focused);
    let body_style = text_style(p.tree_text);
    let muted_style = text_style(p.tab_text);
    let accent_style = bold_style(p.badge_git_branch);

    let pad_x = 18.0;
    let mut y = popup_y + 16.0;
    let line_h = cell_height + 6.0;
    let content_x = popup_x + pad_x;
    let content_w = popup_w - pad_x * 2.0;

    let title = format!("Add comment for {}", composer.pane_kind);
    renderer.draw_top_text(
        &title,
        Vec2::new(content_x, y),
        title_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
    y += line_h + 4.0;

    let source_line = format!(
        "Source Pane {}  •  paired terminal {}",
        composer.source_pane_id, composer.associated_terminal_id
    );
    renderer.draw_top_text(
        &source_line,
        Vec2::new(content_x, y),
        muted_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
    y += line_h;

    let pin_label = if composer.pinned {
        "Pinned: on"
    } else {
        "Pinned: off"
    };
    renderer.draw_top_text(
        &format!("{}  •  Tab toggles pin", pin_label),
        Vec2::new(content_x, y),
        accent_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
    y += line_h + 8.0;

    let section_title = "Selection";
    renderer.draw_top_text(
        section_title,
        Vec2::new(content_x, y),
        title_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
    y += line_h;

    let selection_rect = Rect::new(content_x, y, content_w, 5.0 * line_h);
    renderer.draw_top_rect(
        selection_rect,
        Color::new(p.popup_border.r, p.popup_border.g, p.popup_border.b, 0.12),
    );

    let preview_lines = if composer.content.trim().is_empty() {
        vec!["(no captured selection text)".to_string()]
    } else {
        let mut lines: Vec<String> = composer
            .content
            .lines()
            .take(4)
            .map(|line| line.to_string())
            .collect();
        if composer.content.lines().count() > 4 {
            lines.push("…".to_string());
        }
        lines
    };
    for (idx, line) in preview_lines.iter().enumerate() {
        let ly = y + 4.0 + idx as f32 * line_h;
        renderer.draw_top_text(
            line,
            Vec2::new(content_x + 8.0, ly),
            body_style,
            Rect::new(content_x + 8.0, ly, content_w - 16.0, cell_height + 2.0),
        );
    }
    y += 5.0 * line_h + 12.0;

    renderer.draw_top_text(
        "Comment",
        Vec2::new(content_x, y),
        title_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
    let layout = comment_input_layout(logical, cell_size, &composer.comment.text, composer.comment.cursor, &app.ime.preedit);
    let input_rect = layout.input_rect;
    renderer.draw_top_rect(
        input_rect,
        Color::new(p.popup_border.r, p.popup_border.g, p.popup_border.b, 0.10),
    );

    if composer.comment.is_empty() && app.ime.preedit.is_empty() {
        renderer.draw_top_text(
            "Type a comment...",
            Vec2::new(layout.text_x, layout.text_y),
            muted_style,
            layout.text_clip,
        );
    } else {
        for (visible_idx, row) in layout
            .rows
            .iter()
            .skip(layout.first_visible_row)
            .take(layout.visible_rows)
            .enumerate()
        {
            let row_y = layout.text_y + visible_idx as f32 * layout.line_h;
            let mut row_x = layout.text_x;
            for segment in &row.segments {
                let segment_width = visual_width(&segment.text) as f32 * cell_size.width;
                match segment.kind {
                    CommentSegmentKind::Body => {
                        renderer.draw_top_text(
                            &segment.text,
                            Vec2::new(row_x, row_y),
                            body_style,
                            layout.text_clip,
                        );
                    }
                    CommentSegmentKind::Preedit => {
                        renderer.draw_top_rect(
                            Rect::new(row_x, row_y, segment_width, cell_height),
                            p.ime_preedit_bg,
                        );
                        renderer.draw_top_text(
                            &segment.text,
                            Vec2::new(row_x, row_y),
                            text_style(p.ime_preedit_fg),
                            layout.text_clip,
                        );
                        renderer.draw_top_rect(
                            Rect::new(row_x, row_y + cell_height - 1.0, segment_width, 1.0),
                            p.ime_preedit_fg,
                        );
                    }
                }
                row_x += segment_width;
            }
        }
    }

    if !composer.comment.is_empty() || !app.ime.preedit.is_empty() {
        let cursor_rect = context_comment_composer_cursor_area(
            logical,
            cell_size,
            &composer.comment.text,
            composer.comment.cursor,
            &app.ime.preedit,
        );
        draw_cursor_beam(
            renderer,
            cursor_rect.x,
            cursor_rect.y,
            cell_height,
            p.cursor_accent,
        );
    }

    y = input_rect.y + input_rect.height + 14.0;

    let footer = "Esc closes  •  Tab toggles pin  •  Shift+Enter newline  •  Enter submits";
    renderer.draw_top_text(
        footer,
        Vec2::new(content_x, y),
        muted_style,
        Rect::new(content_x, y, content_w, cell_height + 2.0),
    );
}
