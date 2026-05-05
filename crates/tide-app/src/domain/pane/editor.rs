// Editor pane: wraps EditorState with rendering helpers (mirrors TerminalPane).

#[path = "editor_completion.rs"]
pub(crate) mod completion;
#[path = "editor_rendering.rs"]
mod rendering;
#[cfg(test)]
pub(crate) use rendering::{
    live_preview_code_fence_line, live_preview_editing_indicator_rect,
    live_preview_syntax_marker_style, live_preview_table_cell_text,
    live_preview_table_line_is_first, live_preview_table_line_is_header,
    live_preview_table_line_is_last, live_preview_table_separator_line,
};

use std::collections::HashMap;
use std::io;
use std::path::Path;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use crate::tide_core::{PaneId, Rect, Size};
use crate::tide_editor::input::EditorAction;
use crate::tide_editor::wrap::{VisualRowInfo, WrapMap};
use crate::tide_editor::{EditorPosition, EditorState};

use crate::tide_editor::markdown::{
    render_markdown_preview, LivePreviewMap, MarkdownTheme, MdElementKind, PreviewLine,
};

use crate::pane::Selection;
use crate::theme::{editor_live_preview_vertical_padding, SCROLLBAR_WIDTH};

/// Width of the gutter (line numbers) in cells.
pub(crate) const GUTTER_WIDTH_CELLS: usize = 6;
pub(crate) const SPLIT_PREVIEW_GAP_CELLS: usize = 2;
pub(crate) const SPLIT_PREVIEW_MIN_CONTENT_CELLS: usize = 20;
pub(crate) const MARKDOWN_PREVIEW_READABLE_WIDTH_CELLS: usize = 96;

struct MarkdownListContinuation {
    marker_start: usize,
    marker_end: usize,
    next_marker: String,
    empty: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SoftWrapDisplayRowInfo {
    pub info: VisualRowInfo,
    pub sub_row: usize,
}

#[derive(Clone, Copy)]
struct LivePreviewTableDisplaySpan {
    source_char: usize,
    start_col: usize,
    width: usize,
}

impl MarkdownListContinuation {
    fn parse(line: &str) -> Option<Self> {
        let marker_start = line
            .char_indices()
            .find(|(_, ch)| *ch != ' ' && *ch != '\t')
            .map(|(idx, _)| idx)
            .unwrap_or(line.len());
        let indent = &line[..marker_start];
        let rest = &line[marker_start..];

        if let Some(parsed) = Self::parse_unordered(indent, marker_start, rest) {
            return Some(parsed);
        }
        Self::parse_ordered(indent, marker_start, rest)
    }

    fn parse_unordered(indent: &str, marker_start: usize, rest: &str) -> Option<Self> {
        let marker = ['-', '*', '+']
            .into_iter()
            .find(|marker| rest.starts_with(&format!("{marker} ")))?;
        let bullet_prefix = format!("{marker} ");

        if let Some(task_marker) = Self::task_marker(rest, &bullet_prefix) {
            let marker_end = marker_start + task_marker.len();
            return Some(Self {
                marker_start,
                marker_end,
                next_marker: format!("{indent}{marker} [ ] "),
                empty: rest[task_marker.len()..].trim().is_empty(),
            });
        }

        let marker_end = marker_start + bullet_prefix.len();
        Some(Self {
            marker_start,
            marker_end,
            next_marker: format!("{indent}{bullet_prefix}"),
            empty: rest[bullet_prefix.len()..].trim().is_empty(),
        })
    }

    fn task_marker<'a>(rest: &'a str, bullet_prefix: &str) -> Option<&'a str> {
        ["[ ] ", "[x] ", "[X] "]
            .into_iter()
            .map(|state| format!("{bullet_prefix}{state}"))
            .find(|candidate| rest.starts_with(candidate))
            .map(|candidate| {
                let len = candidate.len();
                &rest[..len]
            })
    }

    fn parse_ordered(indent: &str, marker_start: usize, rest: &str) -> Option<Self> {
        let digit_end = rest
            .char_indices()
            .take_while(|(_, ch)| ch.is_ascii_digit())
            .last()
            .map(|(idx, ch)| idx + ch.len_utf8())?;
        if digit_end == 0 {
            return None;
        }

        let delimiter = rest[digit_end..].chars().next()?;
        if delimiter != '.' && delimiter != ')' {
            return None;
        }
        let delimiter_end = digit_end + delimiter.len_utf8();
        if !rest[delimiter_end..].starts_with(' ') {
            return None;
        }

        let marker_end = marker_start + delimiter_end + 1;
        let number = rest[..digit_end].parse::<usize>().ok()?;
        Some(Self {
            marker_start,
            marker_end,
            next_marker: format!("{indent}{}{delimiter} ", number + 1),
            empty: rest[delimiter_end + 1..].trim().is_empty(),
        })
    }
}

/// Pure preview scroll computation. Only used by tests now.
#[cfg(test)]
pub(crate) fn apply_preview_scroll(
    ch: char,
    v_scroll: &mut usize,
    h_scroll: &mut usize,
    max_v: usize,
    max_h: usize,
    visible_rows: usize,
) -> bool {
    match ch {
        'j' => {
            if *v_scroll < max_v {
                *v_scroll += 1;
                return true;
            }
        }
        'k' => {
            if *v_scroll > 0 {
                *v_scroll -= 1;
                return true;
            }
        }
        'd' => {
            let half = visible_rows / 2;
            let new = (*v_scroll + half).min(max_v);
            if new != *v_scroll {
                *v_scroll = new;
                return true;
            }
        }
        'u' => {
            let half = visible_rows / 2;
            let new = v_scroll.saturating_sub(half);
            if new != *v_scroll {
                *v_scroll = new;
                return true;
            }
        }
        'g' => {
            if *v_scroll != 0 {
                *v_scroll = 0;
                return true;
            }
        }
        'G' => {
            if *v_scroll != max_v {
                *v_scroll = max_v;
                return true;
            }
        }
        'h' => {
            if *h_scroll > 0 {
                *h_scroll = h_scroll.saturating_sub(2);
                return true;
            }
        }
        'l' => {
            if *h_scroll < max_h {
                *h_scroll += 2;
                return true;
            }
        }
        _ => {}
    }
    false
}

pub struct EditorPane {
    #[allow(dead_code)]
    pub id: PaneId,
    pub editor: EditorState,
    pub search: Option<crate::state::search::SearchState>,
    pub selection: Option<Selection>,
    pub disk_changed: bool,
    pub file_deleted: bool,
    pub diff_mode: bool,
    pub disk_content: Option<Vec<String>>,
    pub preview_mode: bool,
    pub split_preview: bool,
    preview_cache: Option<(u64, usize, bool, Vec<PreviewLine>)>,
    pub preview_scroll: usize,
    pub preview_h_scroll: usize,
    soft_wrap_visual_scroll: usize,
    live_preview_fixed_width_h_scroll: HashMap<usize, usize>,
    /// Last wrap_width passed to `ensure_preview_cache`, used to detect
    /// when the width has stabilised after a resize so we can defer the
    /// expensive markdown re-parse during continuous resize.
    preview_last_width: Option<usize>,
    /// Pending scroll ratio to apply after the preview cache is built (edit→preview).
    preview_scroll_pending_ratio: Option<f64>,
    /// Cached `is_modified()` for detecting transitions (drives tab ● indicator).
    pub last_is_modified: bool,
    /// Generation counter at the time of the last `is_modified()` check.
    /// Avoids expensive Vec<String> comparison every frame.
    pub last_checked_gen: u64,
    /// Whether soft wrap is enabled for this pane (prose files: md, txt).
    pub soft_wrap: bool,
    /// Cached wrap map for soft-wrapped rendering.
    wrap_map: Option<WrapMap>,
    /// Inline completion popup state. NOT part of ModalStack.
    pub completion: Option<completion::CompletionState>,
    /// Whether live preview mode is active (inline markdown rendering in editor).
    /// Mutually exclusive with full `preview_mode`.
    pub live_preview: bool,
    /// Cached live preview map (source-range → markdown-element mapping).
    pub live_preview_map: Option<LivePreviewMap>,
    /// Generation counter for `live_preview_map` cache invalidation.
    live_preview_generation: u64,
}

impl EditorPane {
    pub fn new_empty(id: PaneId) -> Self {
        let editor = EditorState::new_empty();
        Self {
            id,
            editor,
            search: None,
            selection: None,
            disk_changed: false,
            file_deleted: false,
            diff_mode: false,
            disk_content: None,
            preview_mode: false,
            split_preview: false,
            preview_cache: None,
            preview_scroll: 0,
            preview_h_scroll: 0,
            soft_wrap_visual_scroll: 0,
            live_preview_fixed_width_h_scroll: HashMap::new(),
            preview_last_width: None,
            preview_scroll_pending_ratio: None,
            last_is_modified: false,
            last_checked_gen: 0,
            soft_wrap: false,
            wrap_map: None,
            completion: None,
            live_preview: false,
            live_preview_map: None,
            live_preview_generation: 0,
        }
    }

    pub fn open(id: PaneId, path: &Path) -> io::Result<Self> {
        let editor = EditorState::open(path)?;
        let soft_wrap = Self::is_prose_extension(path);
        let live_preview = Self::is_markdown_extension(path);
        let live_preview_map = live_preview.then(|| LivePreviewMap::build(&editor.buffer.lines));
        let live_preview_generation = if live_preview {
            editor.content_generation()
        } else {
            0
        };
        Ok(Self {
            id,
            editor,
            search: None,
            selection: None,
            disk_changed: false,
            file_deleted: false,
            diff_mode: false,
            disk_content: None,
            preview_mode: false,
            split_preview: false,
            preview_cache: None,
            preview_scroll: 0,
            preview_h_scroll: 0,
            soft_wrap_visual_scroll: 0,
            live_preview_fixed_width_h_scroll: HashMap::new(),
            preview_last_width: None,
            preview_scroll_pending_ratio: None,
            last_is_modified: false,
            last_checked_gen: 0,
            soft_wrap,
            wrap_map: None,
            completion: None,
            live_preview,
            live_preview_map,
            live_preview_generation,
        })
    }

    /// Whether this pane needs a notification bar (disk changed, diff mode, or file deleted).
    pub fn needs_notification_bar(&self) -> bool {
        self.disk_changed || self.diff_mode
    }

    /// Handle an editor action (visible_cols defaults to 80 for scroll clamping).
    pub fn handle_action(&mut self, action: EditorAction, visible_rows: usize) {
        if self.effective_soft_wrap() {
            if matches!(
                action,
                EditorAction::ScrollLeft(_) | EditorAction::ScrollRight(_)
            ) {
                self.handle_soft_wrap_horizontal_scroll_action(&action, 80);
                return;
            }
            if self.wrap_map.is_none() {
                self.ensure_wrap_map(80);
            }
            if matches!(
                action,
                EditorAction::ScrollUp(_) | EditorAction::ScrollDown(_)
            ) {
                self.handle_soft_wrap_scroll_action(&action, visible_rows);
                return;
            }
            self.handle_editor_action(action);
            self.ensure_soft_wrap_cursor_visible(visible_rows);
            self.clamp_scroll(visible_rows);
            return;
        }
        let is_scroll = matches!(
            action,
            EditorAction::ScrollUp(_)
                | EditorAction::ScrollDown(_)
                | EditorAction::ScrollLeft(_)
                | EditorAction::ScrollRight(_)
        );
        self.handle_editor_action(action);
        if !is_scroll {
            self.editor.ensure_cursor_visible(visible_rows);
        }
        self.clamp_scroll(visible_rows);
        if !self.effective_soft_wrap() {
            self.clamp_h_scroll(80);
        }
    }

    /// Handle an editor action with both vertical and horizontal visibility.
    pub fn handle_action_with_size(
        &mut self,
        action: EditorAction,
        visible_rows: usize,
        visible_cols: usize,
    ) {
        if self.effective_soft_wrap() {
            if matches!(
                action,
                EditorAction::ScrollLeft(_) | EditorAction::ScrollRight(_)
            ) {
                self.handle_soft_wrap_horizontal_scroll_action(&action, visible_cols);
                return;
            }
            self.ensure_wrap_map(visible_cols.max(1));
            if matches!(
                action,
                EditorAction::ScrollUp(_) | EditorAction::ScrollDown(_)
            ) {
                self.handle_soft_wrap_scroll_action(&action, visible_rows);
                return;
            }
            self.handle_editor_action(action);
            self.ensure_soft_wrap_cursor_visible(visible_rows);
            self.clamp_scroll(visible_rows);
            return;
        }
        let is_scroll = matches!(
            action,
            EditorAction::ScrollUp(_)
                | EditorAction::ScrollDown(_)
                | EditorAction::ScrollLeft(_)
                | EditorAction::ScrollRight(_)
        );
        self.handle_editor_action(action);
        if !is_scroll {
            self.editor.ensure_cursor_visible(visible_rows);
            if !self.effective_soft_wrap() {
                self.editor.ensure_cursor_visible_h(visible_cols);
            }
        }
        self.clamp_scroll(visible_rows);
        if !self.effective_soft_wrap() {
            self.clamp_h_scroll(visible_cols);
        }
    }

    fn handle_editor_action(&mut self, action: EditorAction) {
        if matches!(&action, EditorAction::Enter) && self.handle_markdown_enter() {
            return;
        }
        self.editor.handle_action(action);
    }

    fn handle_markdown_enter(&mut self) -> bool {
        if !self.is_markdown() || self.preview_mode || self.diff_mode {
            return false;
        }

        let pos = self.editor.cursor_position();
        let Some(line) = self.editor.buffer.line(pos.line) else {
            return false;
        };
        if pos.col < line.len() {
            return false;
        }

        let Some(continuation) = MarkdownListContinuation::parse(line) else {
            return false;
        };

        if continuation.empty {
            let new_pos = self.editor.buffer.delete_range(
                EditorPosition {
                    line: pos.line,
                    col: continuation.marker_start,
                },
                EditorPosition {
                    line: pos.line,
                    col: continuation.marker_end,
                },
            );
            self.editor.cursor.set_position(new_pos);
            return true;
        }

        let new_pos = self.editor.buffer.insert_newline(pos);
        let end_pos = self
            .editor
            .buffer
            .insert_text(new_pos, &continuation.next_marker);
        self.editor.cursor.set_position(end_pos);
        true
    }

    /// Prevent vertical over-scrolling: last line should stick to bottom.
    fn clamp_scroll(&mut self, visible_rows: usize) {
        if self.effective_soft_wrap() {
            self.clamp_soft_wrap_scroll(visible_rows);
            return;
        }
        let max_scroll = self.editor.buffer.line_count().saturating_sub(visible_rows);
        if self.editor.scroll_offset() > max_scroll {
            self.editor.set_scroll_offset(max_scroll);
        }
    }

    fn handle_soft_wrap_scroll_action(
        &mut self,
        action: &EditorAction,
        visible_rows: usize,
    ) -> bool {
        let previous = self.soft_wrap_visual_scroll;
        match action {
            EditorAction::ScrollUp(delta) => {
                self.soft_wrap_visual_scroll =
                    self.soft_wrap_visual_scroll.saturating_sub(*delta as usize);
            }
            EditorAction::ScrollDown(delta) => {
                let max_scroll = self.soft_wrap_max_scroll(visible_rows);
                self.soft_wrap_visual_scroll =
                    (self.soft_wrap_visual_scroll + *delta as usize).min(max_scroll);
            }
            _ => return false,
        }
        self.sync_soft_wrap_scroll_line();
        self.soft_wrap_visual_scroll != previous
    }

    fn handle_soft_wrap_horizontal_scroll_action(
        &mut self,
        action: &EditorAction,
        visible_cols: usize,
    ) -> bool {
        let line = self.editor.cursor_position().line;
        let Some(block_start) = self.live_preview_fixed_width_block_start(line) else {
            self.editor.set_h_scroll_offset(0);
            return false;
        };
        let max_scroll =
            self.live_preview_fixed_width_block_max_h_scroll(block_start, visible_cols);
        let previous = self
            .live_preview_fixed_width_h_scroll
            .get(&block_start)
            .copied()
            .unwrap_or(0);
        let next = match action {
            EditorAction::ScrollLeft(delta) => previous.saturating_sub(*delta as usize),
            EditorAction::ScrollRight(delta) => (previous + *delta as usize).min(max_scroll),
            _ => return false,
        }
        .min(max_scroll);
        if next == 0 {
            self.live_preview_fixed_width_h_scroll.remove(&block_start);
        } else {
            self.live_preview_fixed_width_h_scroll
                .insert(block_start, next);
        }
        max_scroll > 0
    }

    pub(crate) fn handle_live_preview_fixed_width_horizontal_scroll_at_visual_row(
        &mut self,
        visual_row: usize,
        delta_x: f32,
        visible_cols: usize,
    ) -> bool {
        let Some(row) = self.soft_wrap_display_row_info(visual_row) else {
            return false;
        };
        let Some(block_start) = self.live_preview_fixed_width_block_start(row.info.logical_line)
        else {
            return false;
        };
        let max_scroll =
            self.live_preview_fixed_width_block_max_h_scroll(block_start, visible_cols);
        if max_scroll == 0 {
            self.live_preview_fixed_width_h_scroll.remove(&block_start);
            return false;
        }
        let previous = self
            .live_preview_fixed_width_h_scroll
            .get(&block_start)
            .copied()
            .unwrap_or(0);
        let delta = (delta_x.abs() * 3.0).ceil() as usize;
        let next = if delta_x > 0.0 {
            previous.saturating_sub(delta)
        } else {
            (previous + delta).min(max_scroll)
        };
        if next == 0 {
            self.live_preview_fixed_width_h_scroll.remove(&block_start);
        } else {
            self.live_preview_fixed_width_h_scroll
                .insert(block_start, next);
        }
        true
    }

    pub(crate) fn live_preview_fixed_width_h_scroll_for_line(&self, line: usize) -> usize {
        self.live_preview_fixed_width_block_start(line)
            .and_then(|block_start| {
                self.live_preview_fixed_width_h_scroll
                    .get(&block_start)
                    .copied()
            })
            .unwrap_or(0)
    }

    pub(crate) fn clamp_live_preview_fixed_width_h_scrolls(&mut self, visible_cols: usize) {
        let keys: Vec<usize> = self
            .live_preview_fixed_width_h_scroll
            .keys()
            .copied()
            .collect();
        for block_start in keys {
            let max_scroll =
                self.live_preview_fixed_width_block_max_h_scroll(block_start, visible_cols);
            let next = self
                .live_preview_fixed_width_h_scroll
                .get(&block_start)
                .copied()
                .unwrap_or(0)
                .min(max_scroll);
            if next == 0 {
                self.live_preview_fixed_width_h_scroll.remove(&block_start);
            } else {
                self.live_preview_fixed_width_h_scroll
                    .insert(block_start, next);
            }
        }
    }

    fn live_preview_fixed_width_block_start(&self, line: usize) -> Option<usize> {
        let line_text = self.editor.buffer.line(line)?;
        let kind = self.live_preview_fixed_width_line_kind(line, line_text)?;
        let mut start = line;
        while start > 0 {
            let Some(prev_text) = self.editor.buffer.line(start - 1) else {
                break;
            };
            if self.live_preview_fixed_width_line_kind(start - 1, prev_text) != Some(kind) {
                break;
            }
            start -= 1;
        }
        Some(start)
    }

    fn live_preview_fixed_width_block_range(&self, block_start: usize) -> Option<(usize, usize)> {
        let line_text = self.editor.buffer.line(block_start)?;
        let kind = self.live_preview_fixed_width_line_kind(block_start, line_text)?;
        let mut end = block_start + 1;
        while end < self.editor.buffer.line_count() {
            let Some(next_text) = self.editor.buffer.line(end) else {
                break;
            };
            if self.live_preview_fixed_width_line_kind(end, next_text) != Some(kind) {
                break;
            }
            end += 1;
        }
        Some((block_start, end))
    }

    fn live_preview_fixed_width_block_max_h_scroll(
        &self,
        block_start: usize,
        visible_cols: usize,
    ) -> usize {
        let Some((start, end)) = self.live_preview_fixed_width_block_range(block_start) else {
            return 0;
        };
        let max_width = (start..end)
            .filter_map(|line| {
                let line_text = self.editor.buffer.line(line)?;
                let kind = self.live_preview_fixed_width_line_kind(line, line_text)?;
                let padding = match kind {
                    MdElementKind::CodeBlock => 4,
                    MdElementKind::Table => 2,
                    _ => 0,
                };
                Some(line_text.width() + padding)
            })
            .max()
            .unwrap_or(0);
        max_width.saturating_sub(visible_cols.max(1))
    }

    fn handle_legacy_soft_wrap_horizontal_scroll_action(
        &mut self,
        action: &EditorAction,
        visible_cols: usize,
    ) -> bool {
        let Some(max_scroll) = self.live_preview_fixed_width_max_h_scroll(visible_cols) else {
            self.editor.set_h_scroll_offset(0);
            return false;
        };
        let previous = self.editor.h_scroll_offset();
        match action {
            EditorAction::ScrollLeft(delta) => {
                let next = previous.saturating_sub(*delta as usize);
                self.editor.set_h_scroll_offset(next.min(max_scroll));
            }
            EditorAction::ScrollRight(delta) => {
                let next = (previous + *delta as usize).min(max_scroll);
                self.editor.set_h_scroll_offset(next);
            }
            _ => return false,
        }
        self.editor.h_scroll_offset() != previous
    }

    fn soft_wrap_max_scroll(&self, visible_rows: usize) -> usize {
        self.soft_wrap_display_total_visual_rows()
            .unwrap_or_else(|| self.editor.buffer.line_count())
            .saturating_sub(visible_rows)
    }

    fn clamp_soft_wrap_scroll(&mut self, visible_rows: usize) {
        let max_scroll = self.soft_wrap_max_scroll(visible_rows);
        self.soft_wrap_visual_scroll = self.soft_wrap_visual_scroll.min(max_scroll);
        self.sync_soft_wrap_scroll_line();
    }

    fn ensure_soft_wrap_cursor_visible(&mut self, visible_rows: usize) {
        if visible_rows == 0 {
            return;
        }
        let cursor_pos = self.editor.cursor_position();
        let cursor_visual_row =
            self.soft_wrap_display_row_for_position(cursor_pos.line, cursor_pos.col);
        if cursor_visual_row < self.soft_wrap_visual_scroll {
            self.soft_wrap_visual_scroll = cursor_visual_row;
        } else if cursor_visual_row >= self.soft_wrap_visual_scroll + visible_rows {
            self.soft_wrap_visual_scroll = cursor_visual_row - visible_rows + 1;
        }
        self.sync_soft_wrap_scroll_line();
    }

    fn sync_soft_wrap_scroll_line(&mut self) {
        let target_line = self
            .soft_wrap_display_row_info(self.soft_wrap_visual_scroll)
            .map(|row| row.info.logical_line)
            .unwrap_or_else(|| {
                self.soft_wrap_visual_scroll
                    .min(self.editor.buffer.line_count().saturating_sub(1))
            });
        self.editor.set_scroll_offset(target_line);
    }

    /// Prevent horizontal over-scrolling: end of longest line stays at right edge.
    /// h_scroll_offset is character-indexed, visible_cols is in display cells.
    fn clamp_h_scroll(&mut self, visible_cols: usize) {
        use unicode_width::UnicodeWidthChar;
        // For each line, find the max character offset such that remaining chars fit in visible_cols.
        let max_scroll = self
            .editor
            .buffer
            .lines
            .iter()
            .map(|l| {
                let display_width: usize = l.chars().map(|c| c.width().unwrap_or(1)).sum();
                if display_width <= visible_cols {
                    return 0;
                }
                // Walk from the end to find how many chars fit in visible_cols
                let total_chars = l.chars().count();
                let mut width_from_end = 0;
                let mut chars_from_end = 0;
                for ch in l.chars().rev() {
                    let w = ch.width().unwrap_or(1);
                    if width_from_end + w > visible_cols {
                        break;
                    }
                    width_from_end += w;
                    chars_from_end += 1;
                }
                total_chars - chars_from_end
            })
            .max()
            .unwrap_or(0);
        if self.editor.h_scroll_offset() > max_scroll {
            self.editor.set_h_scroll_offset(max_scroll);
        }
    }

    /// Get the file name for display in the tab bar.
    pub fn title(&self) -> String {
        self.editor.file_display_name()
    }

    /// Extract selected text from the editor buffer or preview lines.
    /// In preview mode, selection coordinates refer to preview lines (display-cell indexed),
    /// so we read from the cached preview instead of the raw buffer.
    pub fn selected_text(&self, sel: &Selection) -> String {
        if self.preview_mode {
            return self.preview_selected_text(sel);
        }
        if self.live_preview {
            return self.live_preview_selected_text(sel);
        }
        self.selected_buffer_text(sel)
    }

    fn live_preview_selected_text(&self, sel: &Selection) -> String {
        let Some(live_preview_map) = self.live_preview_map.as_ref() else {
            return self.selected_buffer_text(sel);
        };

        let (start, end) = if sel.anchor < sel.end {
            (sel.anchor, sel.end)
        } else {
            (sel.end, sel.anchor)
        };
        let cursor_line = self.editor.cursor_position().line;
        let mut result = String::new();
        let line_count = self.editor.buffer.line_count();
        let mut line_byte_start = 0usize;

        for row in 0..line_count {
            let Some(line) = self.editor.buffer.line(row) else {
                break;
            };

            if row < start.0 {
                line_byte_start += line.len() + 1;
                continue;
            }
            if row > end.0 {
                break;
            }

            let char_count = line.chars().count();
            let col_start = if row == start.0 {
                start.1.min(char_count)
            } else {
                0
            };
            let col_end = if row == end.0 {
                end.1.min(char_count)
            } else {
                char_count
            };

            if col_start <= col_end {
                let hidden = live_preview_map.hidden_syntax_ranges(row, cursor_line);
                let mut char_col = 0usize;
                let mut byte_offset = line_byte_start;
                for ch in line.chars() {
                    let next_byte_offset = byte_offset + ch.len_utf8();
                    let selected = char_col >= col_start && char_col < col_end;
                    let is_hidden = hidden.iter().any(|range| range.contains(&byte_offset));
                    if selected && !is_hidden {
                        result.push(ch);
                    }
                    char_col += 1;
                    byte_offset = next_byte_offset;
                }
            }

            if row != end.0 {
                result.push('\n');
            }
            line_byte_start += line.len() + 1;
        }

        result
    }

    fn selected_buffer_text(&self, sel: &Selection) -> String {
        let (start, end) = if sel.anchor < sel.end {
            (sel.anchor, sel.end)
        } else {
            (sel.end, sel.anchor)
        };

        let mut result = String::new();
        let line_count = self.editor.buffer.line_count();
        for row in start.0..=end.0 {
            if row >= line_count {
                break;
            }
            let line = match self.editor.buffer.line(row) {
                Some(l) => l,
                None => break,
            };
            let char_count = line.chars().count();
            let col_start = if row == start.0 {
                start.1.min(char_count)
            } else {
                0
            };
            let col_end = if row == end.0 {
                end.1.min(char_count)
            } else {
                char_count
            };
            if col_start <= col_end {
                let text: String = line
                    .chars()
                    .skip(col_start)
                    .take(col_end - col_start)
                    .collect();
                result.push_str(&text);
            }
            if row != end.0 {
                result.push('\n');
            }
        }
        result
    }

    /// Extract selected text from cached preview lines.
    /// Selection columns are in display-cell units (CJK chars count as 2).
    fn preview_selected_text(&self, sel: &Selection) -> String {
        use unicode_width::UnicodeWidthChar;

        let preview_lines = match &self.preview_cache {
            Some((_, _, _, lines)) => lines,
            None => return String::new(),
        };

        let (start, end) = if sel.anchor < sel.end {
            (sel.anchor, sel.end)
        } else {
            (sel.end, sel.anchor)
        };

        let mut result = String::new();
        for row in start.0..=end.0 {
            if row >= preview_lines.len() {
                break;
            }
            let line = &preview_lines[row];
            // Flatten all spans into characters (excluding newlines)
            let chars: Vec<char> = line
                .spans
                .iter()
                .flat_map(|s| s.text.chars())
                .filter(|c| *c != '\n')
                .collect();

            let col_start = if row == start.0 { start.1 } else { 0 };
            let col_end = if row == end.0 {
                end.1
            } else {
                chars.iter().map(|c| c.width().unwrap_or(1)).sum()
            };

            // Walk characters by display width to extract the right range
            let mut display_col = 0usize;
            for &ch in &chars {
                let w = ch.width().unwrap_or(1);
                if display_col + w > col_end {
                    break;
                }
                if display_col >= col_start {
                    result.push(ch);
                }
                display_col += w;
            }

            if row != end.0 {
                result.push('\n');
            }
        }
        result
    }

    /// Select all text in the buffer (or preview lines in preview mode).
    pub fn select_all(&mut self) {
        if self.preview_mode {
            if let Some((_, _, _, ref lines)) = self.preview_cache {
                use unicode_width::UnicodeWidthChar;
                let last_line = lines.len().saturating_sub(1);
                let last_col = lines.get(last_line).map_or(0, |line| {
                    line.spans
                        .iter()
                        .flat_map(|s| s.text.chars())
                        .filter(|c| *c != '\n')
                        .map(|c| c.width().unwrap_or(1))
                        .sum()
                });
                self.selection = Some(Selection {
                    anchor: (0, 0),
                    end: (last_line, last_col),
                });
            }
        } else {
            let last_line = self.editor.buffer.line_count().saturating_sub(1);
            let last_col = self
                .editor
                .buffer
                .line(last_line)
                .map_or(0, |l| l.chars().count());
            self.selection = Some(Selection {
                anchor: (0, 0),
                end: (last_line, last_col),
            });
        }
    }

    /// Convert a selection (char-indexed) to byte-offset positions for buffer operations.
    /// Returns (start, end) where start <= end in document order.
    pub fn selection_byte_range(
        &self,
        sel: &Selection,
    ) -> (
        crate::tide_editor::EditorPosition,
        crate::tide_editor::EditorPosition,
    ) {
        let (start, end) = if sel.anchor <= sel.end {
            (sel.anchor, sel.end)
        } else {
            (sel.end, sel.anchor)
        };
        let start_byte = self.char_col_to_byte(start.0, start.1);
        let end_byte = self.char_col_to_byte(end.0, end.1);
        (
            crate::tide_editor::EditorPosition {
                line: start.0,
                col: start_byte,
            },
            crate::tide_editor::EditorPosition {
                line: end.0,
                col: end_byte,
            },
        )
    }

    /// Convert a character column index to a byte offset for a given line.
    fn char_col_to_byte(&self, line: usize, char_col: usize) -> usize {
        if let Some(text) = self.editor.buffer.line(line) {
            text.char_indices()
                .nth(char_col)
                .map(|(i, _)| i)
                .unwrap_or(text.len())
        } else {
            0
        }
    }

    /// Delete the current selection, clear it, and set cursor to start.
    /// Returns true if a selection was deleted.
    pub fn delete_selection(&mut self) -> bool {
        if let Some(sel) = self.selection.take() {
            let (start, end) = self.selection_byte_range(&sel);
            let new_pos = self.editor.buffer.delete_range(start, end);
            self.editor.cursor.set_position(new_pos);
            true
        } else {
            false
        }
    }

    /// Get the generation counter for dirty checking.
    pub fn generation(&self) -> u64 {
        if self.preview_mode {
            let cache_width = self
                .preview_cache
                .as_ref()
                .map(|(_, w, _, _)| *w as u64)
                .unwrap_or(0);
            self.editor
                .generation()
                .wrapping_add(self.preview_scroll as u64)
                .wrapping_add(self.preview_h_scroll as u64)
                .wrapping_add(cache_width)
        } else {
            let mut gen = self
                .editor
                .generation()
                .wrapping_add(u64::from(self.split_preview_active()))
                .wrapping_add(self.soft_wrap_visual_scroll as u64);
            // Current-line chrome and LivePreviewMode syntax hiding both depend on
            // the cursor row, so row movement must refresh the cached grid layer.
            gen = gen.wrapping_add(self.editor.cursor_position().line as u64 * 100_003);
            for (block_start, h_scroll) in &self.live_preview_fixed_width_h_scroll {
                gen = gen
                    .wrapping_add(*block_start as u64)
                    .wrapping_add((*h_scroll as u64).wrapping_mul(1_000_003));
            }
            gen
        }
    }

    /// Check if this file is a markdown file.
    pub fn is_markdown(&self) -> bool {
        self.editor
            .file_path()
            .map(Self::is_markdown_extension)
            .unwrap_or(false)
    }

    fn is_markdown_extension(path: &Path) -> bool {
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| matches!(ext, "md" | "markdown" | "mdown" | "mkd"))
            .unwrap_or(false)
    }

    /// Whether a file path has a prose extension (markdown or plain text).
    fn is_prose_extension(path: &Path) -> bool {
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| matches!(ext, "md" | "markdown" | "mdown" | "mkd" | "txt" | "text"))
            .unwrap_or(false)
    }

    /// Effective soft wrap: true only when soft_wrap is set AND not in diff/preview mode.
    pub fn effective_soft_wrap(&self) -> bool {
        self.soft_wrap && !self.diff_mode && !self.preview_mode
    }

    /// Whether split preview is visible inside the current Markdown pane.
    pub fn split_preview_active(&self) -> bool {
        self.split_preview && self.is_markdown() && !self.preview_mode
    }

    /// Layout rectangles for the authoring and preview regions inside one Pane.
    pub fn split_preview_rects(&self, rect: Rect, cell_size: Size) -> Option<(Rect, Rect)> {
        if !self.split_preview_active() {
            return None;
        }

        let gap = SPLIT_PREVIEW_GAP_CELLS as f32 * cell_size.width;
        let min_content = SPLIT_PREVIEW_MIN_CONTENT_CELLS as f32 * cell_size.width;
        if rect.width < min_content * 2.0 + gap {
            return None;
        }

        let editor_width = ((rect.width - gap) / 2.0).floor();
        let preview_width = (rect.width - editor_width - gap).max(0.0);
        if editor_width < min_content || preview_width < min_content {
            return None;
        }

        let editor_rect = Rect::new(rect.x, rect.y, editor_width, rect.height);
        let preview_rect = Rect::new(
            rect.x + editor_width + gap,
            rect.y,
            preview_width,
            rect.height,
        );
        Some((editor_rect, preview_rect))
    }

    /// Authoring rect for the current Pane mode.
    pub(crate) fn authoring_rect(&self, rect: Rect, cell_size: Size) -> Rect {
        self.split_preview_rects(rect, cell_size)
            .map(|(editor_rect, _)| editor_rect)
            .unwrap_or(rect)
    }

    /// Shared content rect for the Pane's current rendering mode.
    /// LivePreviewMode reserves symmetric vertical breathing room while keeping
    /// the same coordinate space for rendering and hit-testing.
    pub(crate) fn content_rect(
        &self,
        pane_rect: Rect,
        content_top_offset: f32,
        cell_size: Size,
    ) -> Rect {
        let rect = crate::pane::pane_content_rect(pane_rect, content_top_offset);
        if self.preview_mode || !self.live_preview {
            return rect;
        }

        let vertical_padding = editor_live_preview_vertical_padding(cell_size.height);
        if vertical_padding <= 0.0 {
            return rect;
        }

        Rect::new(
            rect.x,
            rect.y + vertical_padding,
            rect.width,
            (rect.height - 2.0 * vertical_padding).max(1.0),
        )
    }

    /// Preview rect for split preview, if visible.
    pub(crate) fn preview_rect(&self, rect: Rect, cell_size: Size) -> Option<Rect> {
        self.split_preview_rects(rect, cell_size)
            .map(|(_, preview_rect)| preview_rect)
    }

    /// Wrap columns for an authoring rect, excluding gutter and scrollbar.
    pub(crate) fn wrap_cols_for_rect(&self, rect: Rect, cell_size: Size) -> usize {
        let gutter_width = GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        let content_width = (rect.width - gutter_width - SCROLLBAR_WIDTH).max(0.0);
        (content_width / cell_size.width).floor() as usize
    }

    /// Visible rows and content columns for the current Pane mode.
    ///
    /// The returned columns must match the width used by `prepare_inline_caches()`
    /// so input-time `WrapMap` rebuilds stay in sync with render-time preparation.
    pub fn viewport_size_for_content_rect(&self, rect: Rect, cell_size: Size) -> (usize, usize) {
        let viewport_rect = if self.preview_mode {
            rect
        } else {
            self.authoring_rect(rect, cell_size)
        };
        let visible_rows = (viewport_rect.height / cell_size.height).floor() as usize;

        if self.preview_mode {
            let scrollbar_reserved = if self.needs_scrollbar(viewport_rect, cell_size.height) {
                SCROLLBAR_WIDTH
            } else {
                0.0
            };
            let visible_cols = ((viewport_rect.width - scrollbar_reserved).max(0.0)
                / cell_size.width)
                .floor() as usize;
            return (visible_rows.max(1), visible_cols.max(1));
        }

        if self.effective_soft_wrap() {
            return (
                visible_rows.max(1),
                self.wrap_cols_for_rect(viewport_rect, cell_size).max(1),
            );
        }

        let gutter_width = GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        let scrollbar_reserved = if self.needs_scrollbar(viewport_rect, cell_size.height) {
            SCROLLBAR_WIDTH
        } else {
            0.0
        };
        let visible_cols = ((viewport_rect.width - gutter_width - scrollbar_reserved).max(0.0)
            / cell_size.width)
            .floor() as usize;
        (visible_rows.max(1), visible_cols.max(1))
    }

    /// Preview wrapping width for a preview rect.
    pub(crate) fn preview_wrap_width_for_rect(&self, rect: Rect, cell_size: Size) -> usize {
        let available_cols =
            ((rect.width - SCROLLBAR_WIDTH).max(0.0) / cell_size.width).floor() as usize;
        available_cols
            .min(MARKDOWN_PREVIEW_READABLE_WIDTH_CELLS)
            .max(1)
    }

    /// Horizontal inset for centered full-preview content on wide Panes.
    pub(crate) fn preview_content_inset_for_rect(
        &self,
        rect: Rect,
        cell_size: Size,
        scrollbar_reserved: f32,
    ) -> f32 {
        let available_width = (rect.width - scrollbar_reserved).max(0.0);
        let readable_width =
            (MARKDOWN_PREVIEW_READABLE_WIDTH_CELLS as f32 * cell_size.width).min(available_width);
        if available_width <= readable_width {
            0.0
        } else {
            ((available_width - readable_width) / 2.0).floor()
        }
    }

    /// Prepare Pane-local wrap and preview caches for the current mode and rect.
    pub(crate) fn prepare_inline_caches(&mut self, rect: Rect, cell_size: Size, dark: bool) {
        if self.preview_mode {
            self.wrap_map = None;
            let wrap_width = self.preview_wrap_width_for_rect(rect, cell_size);
            if wrap_width > 0 {
                self.ensure_preview_cache(wrap_width, dark);
            }
            return;
        }

        // Keep live preview map in sync before mode-specific geometry uses it.
        if self.live_preview {
            self.ensure_live_preview_map();
        }

        let authoring_rect = self.authoring_rect(rect, cell_size);
        if self.effective_soft_wrap() {
            let wrap_cols = self.wrap_cols_for_rect(authoring_rect, cell_size);
            if wrap_cols > 0 {
                self.ensure_wrap_map(wrap_cols);
            }
            let visible_rows = (authoring_rect.height / cell_size.height).floor() as usize;
            self.clamp_soft_wrap_scroll(visible_rows);
            self.clamp_live_preview_fixed_width_h_scrolls(wrap_cols);
            self.editor.set_h_scroll_offset(0);
        } else {
            self.wrap_map = None;
        }

        if let Some(preview_rect) = self.preview_rect(rect, cell_size) {
            let wrap_width = self.preview_wrap_width_for_rect(preview_rect, cell_size);
            if wrap_width > 0 {
                self.ensure_preview_cache(wrap_width, dark);
            }
        }
    }

    /// Ensure the wrap map is up to date for the current content and width.
    /// Returns true if the map was rebuilt.
    pub fn ensure_wrap_map(&mut self, wrap_width: usize) -> bool {
        if !self.effective_soft_wrap() {
            self.wrap_map = None;
            return false;
        }
        let gen = self.editor.content_generation();
        if let Some(ref map) = self.wrap_map {
            if map.generation() == gen && map.wrap_width() == wrap_width {
                return false;
            }
        }
        self.wrap_map = Some(WrapMap::build(&self.editor.buffer.lines, wrap_width, gen));
        true
    }

    /// Get a reference to the current wrap map, if any.
    pub fn wrap_map(&self) -> Option<&WrapMap> {
        self.wrap_map.as_ref()
    }

    pub fn soft_wrap_visual_scroll(&self) -> usize {
        self.soft_wrap_visual_scroll
    }

    pub fn soft_wrap_total_visual_rows(&self) -> Option<usize> {
        self.soft_wrap_display_total_visual_rows()
    }

    pub fn soft_wrap_visual_row_of_line(&self, line: usize) -> Option<usize> {
        if self.live_preview_soft_wrap_uses_display_rows() {
            return self.soft_wrap_display_visual_row_of_line(line);
        }
        self.wrap_map
            .as_ref()
            .map(|map| map.visual_row_of_line(line))
    }

    pub(crate) fn soft_wrap_display_row_info(
        &self,
        visual_row: usize,
    ) -> Option<SoftWrapDisplayRowInfo> {
        let wrap_map = self.wrap_map.as_ref()?;
        if !self.live_preview_soft_wrap_uses_display_rows() {
            let info = wrap_map.visual_row_to_line_info(visual_row, &self.editor.buffer.lines)?;
            let sub_row = visual_row.saturating_sub(wrap_map.visual_row_of_line(info.logical_line));
            return Some(SoftWrapDisplayRowInfo { info, sub_row });
        }

        let mut display_row = 0usize;
        for (line, line_text) in self.editor.buffer.lines.iter().enumerate() {
            let line_rows = self.soft_wrap_display_rows_for_line(line);
            if visual_row < display_row + line_rows {
                let sub_row = visual_row - display_row;
                let info = if self
                    .live_preview_fixed_width_line_kind(line, line_text)
                    .is_some()
                {
                    VisualRowInfo {
                        logical_line: line,
                        byte_offset: 0,
                        char_offset: 0,
                        char_end: line_text.chars().count(),
                    }
                } else {
                    wrap_map.visual_row_info_for_line(line, sub_row)?
                };
                return Some(SoftWrapDisplayRowInfo { info, sub_row });
            }
            display_row += line_rows;
        }
        None
    }

    pub(crate) fn soft_wrap_display_rows_for_line(&self, line: usize) -> usize {
        let Some(wrap_map) = self.wrap_map.as_ref() else {
            return 1;
        };
        if self.live_preview_soft_wrap_uses_display_rows() {
            if let Some(line_text) = self.editor.buffer.line(line) {
                if self
                    .live_preview_fixed_width_line_kind(line, line_text)
                    .is_some()
                {
                    return 1;
                }
            }
        }
        wrap_map.visual_rows_for(line)
    }

    fn soft_wrap_display_total_visual_rows(&self) -> Option<usize> {
        let wrap_map = self.wrap_map.as_ref()?;
        if !self.live_preview_soft_wrap_uses_display_rows() {
            return Some(wrap_map.total_visual_rows());
        }
        Some(
            (0..self.editor.buffer.line_count())
                .map(|line| self.soft_wrap_display_rows_for_line(line))
                .sum(),
        )
    }

    fn soft_wrap_display_visual_row_of_line(&self, target_line: usize) -> Option<usize> {
        self.wrap_map.as_ref()?;
        if !self.live_preview_soft_wrap_uses_display_rows() {
            return self
                .wrap_map
                .as_ref()
                .map(|map| map.visual_row_of_line(target_line));
        }
        let clamped_line = target_line.min(self.editor.buffer.line_count());
        Some(
            (0..clamped_line)
                .map(|line| self.soft_wrap_display_rows_for_line(line))
                .sum(),
        )
    }

    pub(crate) fn soft_wrap_display_row_for_position(&self, line: usize, byte_col: usize) -> usize {
        let Some(wrap_map) = self.wrap_map.as_ref() else {
            return line;
        };
        if !self.live_preview_soft_wrap_uses_display_rows() {
            return wrap_map.buffer_pos_to_visual_row(line, byte_col, &self.editor.buffer.lines);
        }
        let base = self
            .soft_wrap_display_visual_row_of_line(line)
            .unwrap_or(line);
        let Some(line_text) = self.editor.buffer.line(line) else {
            return base;
        };
        if self
            .live_preview_fixed_width_line_kind(line, line_text)
            .is_some()
        {
            return base;
        }
        let raw_base = wrap_map.visual_row_of_line(line);
        let raw_row = wrap_map.buffer_pos_to_visual_row(line, byte_col, &self.editor.buffer.lines);
        base + raw_row.saturating_sub(raw_base)
    }

    pub(crate) fn soft_wrap_display_col_for_position(&self, line: usize, byte_col: usize) -> usize {
        let Some(wrap_map) = self.wrap_map.as_ref() else {
            return 0;
        };
        let Some(line_text) = self.editor.buffer.line(line) else {
            return 0;
        };
        let byte_col = byte_col.min(line_text.len());
        let source_char = line_text[..byte_col].chars().count();
        if self.live_preview_soft_wrap_uses_display_rows() {
            let Some(kind) = self.live_preview_fixed_width_line_kind(line, line_text) else {
                return wrap_map.buffer_pos_to_visual_col(
                    line,
                    byte_col,
                    &self.editor.buffer.lines,
                );
            };
            let source_display_col = Self::display_width_before_char(line_text, source_char);
            return match kind {
                MdElementKind::CodeBlock => source_display_col
                    .saturating_sub(self.live_preview_fixed_width_h_scroll_for_line(line)),
                MdElementKind::Table => {
                    self.live_preview_table_visual_col_for_source_char(line, line_text, source_char)
                }
                _ => source_display_col
                    .saturating_sub(self.live_preview_fixed_width_h_scroll_for_line(line)),
            };
        }
        wrap_map.buffer_pos_to_visual_col(line, byte_col, &self.editor.buffer.lines)
    }

    pub(crate) fn soft_wrap_display_position_for_visual_cell(
        &self,
        visual_row: usize,
        visual_col: usize,
    ) -> Option<(usize, usize)> {
        let row = self.soft_wrap_display_row_info(visual_row)?;
        let line = row.info.logical_line;
        let line_text = self.editor.buffer.line(line)?;
        let Some(kind) = self.live_preview_fixed_width_line_kind(line, line_text) else {
            return Some((
                line,
                (row.info.char_offset + visual_col).min(row.info.char_end),
            ));
        };

        let source_display_col = match kind {
            MdElementKind::CodeBlock => {
                self.live_preview_codeblock_source_char_for_visual_col(line, line_text, visual_col)
            }
            MdElementKind::Table => {
                self.live_preview_table_source_char_for_visual_col(line, line_text, visual_col)
            }
            _ => visual_col,
        };
        Some((line, source_display_col))
    }

    pub(crate) fn live_preview_codeblock_source_char_for_visual_col(
        &self,
        line: usize,
        line_text: &str,
        visual_col: usize,
    ) -> usize {
        let h_scroll = self.live_preview_fixed_width_h_scroll_for_line(line);
        let source_display_col = visual_col.saturating_add(h_scroll).saturating_sub(3);
        Self::char_index_for_display_width(line_text, source_display_col)
    }

    pub(crate) fn live_preview_table_source_char_for_visual_col(
        &self,
        line: usize,
        line_text: &str,
        visual_col: usize,
    ) -> usize {
        let h_scroll = self.live_preview_fixed_width_h_scroll_for_line(line);
        let target_col = visual_col.saturating_add(h_scroll);
        let Some(spans) = self.live_preview_table_display_spans_for_line(line, line_text) else {
            return 0;
        };
        if spans.is_empty() {
            return 0;
        }

        if target_col <= 2 {
            return spans[0].source_char;
        }

        for span in spans.iter() {
            if target_col < span.start_col {
                return span.source_char;
            }
            let span_end = span.start_col + span.width;
            if target_col < span_end {
                return span.source_char;
            }
        }

        let trailing = spans
            .last()
            .map(|last| last.source_char.saturating_add(1))
            .unwrap_or(0);
        if trailing < line_text.chars().count() {
            trailing
        } else {
            line_text.chars().count()
        }
    }

    pub(crate) fn live_preview_table_visual_col_for_source_char(
        &self,
        line: usize,
        line_text: &str,
        source_char: usize,
    ) -> usize {
        let h_scroll = self.live_preview_fixed_width_h_scroll_for_line(line);
        let Some(spans) = self.live_preview_table_display_spans_for_line(line, line_text) else {
            return 0;
        };
        if spans.is_empty() {
            return 0;
        }

        let source_limit = line_text.chars().count();
        let source_char = source_char.min(source_limit);

        if let Some(first) = spans.first() {
            if source_char <= first.source_char {
                return first.start_col.saturating_sub(h_scroll);
            }
        }

        for idx in 0..spans.len() {
            let current = &spans[idx];
            if source_char <= current.source_char {
                return current.start_col.saturating_sub(h_scroll);
            }
            if let Some(next) = spans.get(idx + 1) {
                if source_char < next.source_char {
                    return (current.start_col + current.width).saturating_sub(h_scroll);
                }
            }
        }

        let last = spans.last().expect("spans not empty");
        if source_char == last.source_char {
            last.start_col.saturating_sub(h_scroll)
        } else {
            (last.start_col + last.width).saturating_sub(h_scroll)
        }
    }

    fn live_preview_table_display_spans_for_line(
        &self,
        line: usize,
        line_text: &str,
    ) -> Option<Vec<LivePreviewTableDisplaySpan>> {
        let widths = rendering::live_preview_table_column_widths(&self.editor.buffer.lines, line);
        if widths.is_empty() {
            return None;
        }

        let mut row = line_text.trim();
        if row.is_empty() {
            return None;
        }
        let mut row_start_byte = line_text.find(row).unwrap_or(0);
        if row.starts_with('|') {
            row = &row[1..];
            row_start_byte = row_start_byte.saturating_add(1);
        }
        if row.ends_with('|') {
            row = &row[..row.len().saturating_sub(1)];
        }
        if row.is_empty() {
            return None;
        }

        let table_gap_cols = 4usize;
        let mut spans = Vec::new();
        let cells: Vec<&str> = row.split('|').collect();
        let mut col = 2usize;
        let mut byte_cursor = 0usize;

        for (idx, raw_cell) in cells.iter().enumerate() {
            if idx >= widths.len() {
                break;
            }
            let cell_width = widths[idx];
            let cell_start_byte = row_start_byte + byte_cursor;
            let source_start = line_text[..cell_start_byte].chars().count();
            let raw_cell_chars: Vec<char> = raw_cell.chars().collect();
            let mut trim_start = 0usize;
            while trim_start < raw_cell_chars.len() && raw_cell_chars[trim_start].is_whitespace() {
                trim_start += 1;
            }
            let mut trim_end = raw_cell_chars.len();
            while trim_end > trim_start && raw_cell_chars[trim_end - 1].is_whitespace() {
                trim_end = trim_end.saturating_sub(1);
            }

            let mut used = 0usize;
            let mut cell_idx = trim_start;
            let cell_start_col = col;
            while cell_idx < trim_end {
                if cell_idx + 1 < trim_end
                    && raw_cell_chars[cell_idx] == '*'
                    && raw_cell_chars[cell_idx + 1] == '*'
                {
                    cell_idx += 2;
                    continue;
                }
                if raw_cell_chars[cell_idx] == '`' {
                    cell_idx += 1;
                    continue;
                }
                let width = raw_cell_chars[cell_idx].width().unwrap_or(1);
                if used + width > cell_width {
                    break;
                }
                spans.push(LivePreviewTableDisplaySpan {
                    source_char: source_start + cell_idx,
                    start_col: col,
                    width,
                });
                col += width;
                used += width;
                cell_idx += 1;
            }

            if used < cell_width {
                let padding_source = source_start + trim_end;
                let padding_width = cell_width.saturating_sub(used);
                if padding_width > 0 {
                    spans.push(LivePreviewTableDisplaySpan {
                        source_char: padding_source,
                        start_col: col,
                        width: padding_width,
                    });
                }
            }

            col = cell_start_col + cell_width + table_gap_cols;
            byte_cursor += raw_cell.len();
            if idx + 1 < cells.len() {
                byte_cursor = byte_cursor.saturating_add(1);
            }
        }

        Some(spans)
    }

    fn char_index_for_display_width(line_text: &str, target_width: usize) -> usize {
        let mut width = 0usize;
        let mut char_idx = 0usize;
        for ch in line_text.chars() {
            let ch_width = ch.width().unwrap_or(1);
            if width + ch_width > target_width {
                break;
            }
            width += ch_width;
            char_idx += 1;
        }
        char_idx
    }

    fn display_width_before_char(line_text: &str, source_char: usize) -> usize {
        line_text
            .chars()
            .take(source_char)
            .map(|ch| ch.width().unwrap_or(1))
            .sum()
    }

    fn live_preview_soft_wrap_uses_display_rows(&self) -> bool {
        self.live_preview && self.effective_soft_wrap() && self.live_preview_map.is_some()
    }

    pub(crate) fn live_preview_fixed_width_line_kind(
        &self,
        line: usize,
        line_text: &str,
    ) -> Option<MdElementKind> {
        let live_map = self.live_preview_map.as_ref()?;
        let line_start = live_map.line_byte_start(line);
        let first_content_offset = line_text
            .char_indices()
            .find(|(_, ch)| !ch.is_whitespace())
            .map(|(idx, _)| idx)
            .unwrap_or(0);
        let mut element_style_idx = 0usize;
        match live_map.element_style_for_line(
            line,
            line_start + first_content_offset,
            &mut element_style_idx,
        ) {
            Some(MdElementKind::CodeBlock) => Some(MdElementKind::CodeBlock),
            Some(MdElementKind::Table) => Some(MdElementKind::Table),
            _ if self.live_preview_source_table_line(line) => Some(MdElementKind::Table),
            _ => None,
        }
    }

    pub(crate) fn live_preview_source_table_line(&self, line: usize) -> bool {
        self.live_preview_source_table_bounds(line)
            .is_some_and(|bounds| bounds.contains(&line))
    }

    fn live_preview_source_table_bounds(&self, line: usize) -> Option<std::ops::Range<usize>> {
        let line_text = self.editor.buffer.line(line)?;
        if !Self::live_preview_source_table_candidate_line(line_text) {
            return None;
        }

        let mut start = line;
        while start > 0 {
            let Some(prev_text) = self.editor.buffer.line(start - 1) else {
                break;
            };
            if !Self::live_preview_source_table_candidate_line(prev_text) {
                break;
            }
            start -= 1;
        }

        let mut end = line + 1;
        while end < self.editor.buffer.line_count() {
            let Some(next_text) = self.editor.buffer.line(end) else {
                break;
            };
            if !Self::live_preview_source_table_candidate_line(next_text) {
                break;
            }
            end += 1;
        }

        let separator = (start..end).find(|row| {
            self.editor
                .buffer
                .line(*row)
                .is_some_and(Self::live_preview_source_table_separator_line)
        })?;
        if separator == start || end.saturating_sub(start) < 2 {
            return None;
        }

        let separator_cols =
            Self::live_preview_source_table_cell_count(self.editor.buffer.line(separator)?);
        if separator_cols < 2 {
            return None;
        }
        let header_cols =
            Self::live_preview_source_table_cell_count(self.editor.buffer.line(separator - 1)?);
        if header_cols != separator_cols {
            return None;
        }

        for row in start..end {
            let row_text = self.editor.buffer.line(row)?;
            if Self::live_preview_source_table_separator_line(row_text) {
                if Self::live_preview_source_table_cell_count(row_text) != separator_cols {
                    return None;
                }
                continue;
            }
            if Self::live_preview_source_table_cell_count(row_text) != separator_cols {
                return None;
            }
        }

        Some(start..end)
    }

    fn live_preview_source_table_candidate_line(line: &str) -> bool {
        line.contains('|') && !line.trim().is_empty()
    }

    fn live_preview_source_table_cell_count(line: &str) -> usize {
        line.trim()
            .trim_matches('|')
            .split('|')
            .map(str::trim)
            .filter(|cell| !cell.is_empty())
            .count()
    }

    fn live_preview_source_table_separator_line(line: &str) -> bool {
        let trimmed = line.trim().trim_matches('|');
        let cells: Vec<&str> = trimmed.split('|').map(str::trim).collect();
        !cells.is_empty()
            && cells.iter().all(|cell| {
                let has_dash = cell.chars().any(|ch| ch == '-');
                has_dash
                    && cell
                        .chars()
                        .all(|ch| ch == '-' || ch == ':' || ch.is_whitespace())
            })
    }

    #[cfg(test)]
    pub(crate) fn live_preview_source_table_complete_at_line(&self, line: usize) -> bool {
        self.live_preview_source_table_bounds(line).is_some()
    }

    pub(crate) fn live_preview_fixed_width_max_h_scroll(
        &self,
        visible_cols: usize,
    ) -> Option<usize> {
        if !self.live_preview_soft_wrap_uses_display_rows() {
            return None;
        }
        let max_width: usize = self
            .editor
            .buffer
            .lines
            .iter()
            .enumerate()
            .filter_map(|(line, line_text)| {
                self.live_preview_fixed_width_line_kind(line, line_text)
                    .map(|kind| {
                        let padding = match kind {
                            MdElementKind::CodeBlock => 4,
                            MdElementKind::Table => 2,
                            _ => 0,
                        };
                        line_text.width() + padding
                    })
            })
            .max()
            .unwrap_or(0);
        Some(max_width.saturating_sub(visible_cols.max(1)))
    }

    pub fn set_soft_wrap_visual_scroll(&mut self, scroll: usize, visible_rows: usize) {
        self.soft_wrap_visual_scroll = scroll;
        self.clamp_soft_wrap_scroll(visible_rows);
    }

    pub fn center_soft_wrap_visual_row(&mut self, visual_row: usize, visible_rows: usize) {
        self.set_soft_wrap_visual_scroll(visual_row.saturating_sub(visible_rows / 2), visible_rows);
    }

    /// Toggle live preview mode. Mutually exclusive with full preview mode.
    pub fn toggle_live_preview(&mut self) {
        if self.live_preview {
            self.live_preview = false;
            self.live_preview_map = None;
        } else {
            // Exit full preview if active
            if self.preview_mode {
                self.preview_mode = false;
            }
            self.live_preview = true;
            self.ensure_live_preview_map();
        }
    }

    /// Ensure LivePreviewMap is up-to-date with current buffer.
    pub fn ensure_live_preview_map(&mut self) {
        let gen = self.editor.content_generation();
        if self.live_preview_map.is_none() || self.live_preview_generation != gen {
            self.live_preview_map = Some(LivePreviewMap::build(&self.editor.buffer.lines));
            self.live_preview_generation = gen;
        }
    }

    /// Toggle preview mode on/off, syncing scroll position proportionally.
    pub fn toggle_preview(&mut self) {
        // Exit live preview if active (mutually exclusive)
        if self.live_preview {
            self.live_preview = false;
            self.live_preview_map = None;
        }

        let raw_line_count = self.editor.buffer.line_count().max(1);

        if self.preview_mode {
            // Preview → Edit: map preview_scroll to editor scroll
            let preview_total = self.preview_line_count().max(1);
            let ratio = self.preview_scroll as f64 / preview_total as f64;
            if self.soft_wrap && !self.diff_mode {
                if let Some(total_visual_rows) = self.soft_wrap_total_visual_rows() {
                    let target = (ratio * total_visual_rows.max(1) as f64).round() as usize;
                    self.soft_wrap_visual_scroll = target.min(total_visual_rows.saturating_sub(1));
                    self.sync_soft_wrap_scroll_line();
                } else {
                    let target = (ratio * raw_line_count as f64).round() as usize;
                    self.editor
                        .set_scroll_offset(target.min(raw_line_count.saturating_sub(1)));
                    self.soft_wrap_visual_scroll = self.editor.scroll_offset();
                }
            } else {
                let target = (ratio * raw_line_count as f64).round() as usize;
                self.editor
                    .set_scroll_offset(target.min(raw_line_count.saturating_sub(1)));
            }
        } else {
            // Edit → Preview: save current scroll ratio to apply after cache is built
            let ratio = if self.effective_soft_wrap() {
                if let Some(total_visual_rows) = self.soft_wrap_total_visual_rows() {
                    self.soft_wrap_visual_scroll as f64 / total_visual_rows.max(1) as f64
                } else {
                    self.editor.scroll_offset() as f64 / raw_line_count as f64
                }
            } else {
                self.editor.scroll_offset() as f64 / raw_line_count as f64
            };
            // Store ratio temporarily; will be applied in ensure_preview_cache
            self.preview_scroll_pending_ratio = Some(ratio);
            self.split_preview = false;
        }

        self.preview_mode = !self.preview_mode;
        self.preview_h_scroll = 0;
        self.preview_cache = None;
        // Re-execute search in the new coordinate space
        if self.preview_mode {
            // Edit → Preview: cache not built yet; clear matches now,
            // ensure_preview_cache will re-execute after building.
            if let Some(ref mut s) = self.search {
                s.matches.clear();
                s.current = None;
            }
        } else {
            // Preview → Edit: buffer is always available, re-execute immediately
            if let Some(ref mut s) = self.search {
                crate::state::search::execute_search_editor(s, &self.editor.buffer.lines);
            }
        }
    }

    /// Toggle split preview inside the current Markdown pane.
    pub fn toggle_split_preview(&mut self) {
        if !self.is_markdown() {
            return;
        }
        if self.preview_mode {
            self.toggle_preview();
        }
        self.split_preview = !self.split_preview;
        self.preview_h_scroll = 0;
    }

    /// Ensure the preview cache is up to date.
    ///
    /// During continuous resize the wrap_width changes every frame.  Re-parsing
    /// the full markdown each time is expensive, so we defer when only the width
    /// changed.  The cache is rebuilt once the width stabilises (same value for
    /// two consecutive calls), which typically happens on the first frame after
    /// the resize stops — the deferred PTY-resize timer fires 50 ms later and
    /// triggers a redraw that picks this up.
    pub fn ensure_preview_cache(&mut self, wrap_width: usize, dark: bool) {
        // Use content_generation (not generation) so scroll changes don't
        // invalidate the expensive markdown parse cache.
        let gen = self.editor.content_generation();
        if let Some((cached_gen, cached_width, cached_dark, _)) = &self.preview_cache {
            if *cached_gen == gen && *cached_width == wrap_width && *cached_dark == dark {
                return;
            }
        }

        // Detect mid-resize: width_stable is true only when the requested
        // wrap_width equals the value from the previous call.
        let width_stable = self.preview_last_width == Some(wrap_width);
        self.preview_last_width = Some(wrap_width);

        if !width_stable {
            // Width just changed — likely mid-resize.  If only the width
            // differs (content and theme unchanged), skip the expensive
            // recomputation and keep showing the stale cache.
            if let Some((cached_gen, _, cached_dark, _)) = &self.preview_cache {
                if *cached_gen == gen && *cached_dark == dark {
                    return;
                }
            }
        }

        let theme = if dark {
            MarkdownTheme::dark()
        } else {
            MarkdownTheme::light()
        };
        let lines = render_markdown_preview(&self.editor.buffer.lines, &theme, wrap_width);
        let line_count = lines.len();
        self.preview_cache = Some((gen, wrap_width, dark, lines));

        // Apply pending scroll ratio from edit→preview toggle
        if let Some(ratio) = self.preview_scroll_pending_ratio.take() {
            self.preview_scroll = (ratio * line_count as f64).round() as usize;
            if line_count > 0 {
                self.preview_scroll = self.preview_scroll.min(line_count.saturating_sub(1));
            }
        }

        // Re-execute search against newly built preview lines
        self.execute_preview_search();
    }

    /// Get a reference to the cached preview lines.
    pub fn preview_lines(&self) -> &[PreviewLine] {
        match &self.preview_cache {
            Some((_, _, _, lines)) => lines,
            None => &[],
        }
    }

    pub(crate) fn preview_cache_width(&self) -> Option<usize> {
        self.preview_cache.as_ref().map(|(_, width, _, _)| *width)
    }

    /// Total number of preview lines (for scroll clamping).
    pub fn preview_line_count(&self) -> usize {
        match &self.preview_cache {
            Some((_, _, _, lines)) => lines.len(),
            None => 0,
        }
    }

    /// Execute search against preview lines (field-level borrow splitting).
    pub fn execute_preview_search(&mut self) {
        let preview_lines = match &self.preview_cache {
            Some((_, _, _, lines)) => lines.as_slice(),
            None => &[],
        };
        if let Some(ref mut s) = self.search {
            crate::state::search::execute_search_preview(s, preview_lines);
        }
    }

    /// Maximum display-width across code block lines only (for h-scroll clamping).
    /// Normal text is already wrapped, so only code blocks need horizontal scroll.
    pub fn preview_max_line_width(&self) -> usize {
        use unicode_width::UnicodeWidthChar;
        self.preview_lines()
            .iter()
            .filter(|line| line.bg_color.is_some())
            .map(|line| {
                line.spans
                    .iter()
                    .map(|s| {
                        s.text
                            .chars()
                            .filter(|c| *c != '\n')
                            .map(|c| c.width().unwrap_or(1))
                            .sum::<usize>()
                    })
                    .sum::<usize>()
            })
            .max()
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── apply_preview_scroll ──

    #[test]
    fn scroll_j_increments() {
        let (mut v, mut h) = (5, 0);
        assert!(apply_preview_scroll('j', &mut v, &mut h, 100, 0, 30));
        assert_eq!(v, 6);
    }

    #[test]
    fn scroll_j_at_max_no_change() {
        let (mut v, mut h) = (100, 0);
        assert!(!apply_preview_scroll('j', &mut v, &mut h, 100, 0, 30));
        assert_eq!(v, 100);
    }

    #[test]
    fn scroll_k_decrements() {
        let (mut v, mut h) = (5, 0);
        assert!(apply_preview_scroll('k', &mut v, &mut h, 100, 0, 30));
        assert_eq!(v, 4);
    }

    #[test]
    fn scroll_k_at_zero_no_change() {
        let (mut v, mut h) = (0, 0);
        assert!(!apply_preview_scroll('k', &mut v, &mut h, 100, 0, 30));
        assert_eq!(v, 0);
    }

    #[test]
    fn scroll_d_half_page_down() {
        let (mut v, mut h) = (0, 0);
        assert!(apply_preview_scroll('d', &mut v, &mut h, 100, 0, 30));
        assert_eq!(v, 15); // 30/2
    }

    #[test]
    fn scroll_d_clamps_to_max() {
        let (mut v, mut h) = (95, 0);
        assert!(apply_preview_scroll('d', &mut v, &mut h, 100, 0, 30));
        assert_eq!(v, 100);
    }

    #[test]
    fn scroll_u_half_page_up() {
        let (mut v, mut h) = (30, 0);
        assert!(apply_preview_scroll('u', &mut v, &mut h, 100, 0, 30));
        assert_eq!(v, 15);
    }

    #[test]
    fn scroll_u_clamps_to_zero() {
        let (mut v, mut h) = (5, 0);
        assert!(apply_preview_scroll('u', &mut v, &mut h, 100, 0, 30));
        assert_eq!(v, 0);
    }

    #[test]
    fn scroll_g_goes_to_top() {
        let (mut v, mut h) = (50, 0);
        assert!(apply_preview_scroll('g', &mut v, &mut h, 100, 0, 30));
        assert_eq!(v, 0);
    }

    #[test]
    fn scroll_g_at_zero_no_change() {
        let (mut v, mut h) = (0, 0);
        assert!(!apply_preview_scroll('g', &mut v, &mut h, 100, 0, 30));
    }

    #[test]
    fn scroll_big_g_goes_to_bottom() {
        let (mut v, mut h) = (0, 0);
        assert!(apply_preview_scroll('G', &mut v, &mut h, 100, 0, 30));
        assert_eq!(v, 100);
    }

    #[test]
    fn scroll_big_g_at_max_no_change() {
        let (mut v, mut h) = (100, 0);
        assert!(!apply_preview_scroll('G', &mut v, &mut h, 100, 0, 30));
    }

    #[test]
    fn scroll_h_decrements_h_scroll() {
        let (mut v, mut h) = (0, 10);
        assert!(apply_preview_scroll('h', &mut v, &mut h, 100, 50, 30));
        assert_eq!(h, 8);
    }

    #[test]
    fn scroll_h_at_zero_no_change() {
        let (mut v, mut h) = (0, 0);
        assert!(!apply_preview_scroll('h', &mut v, &mut h, 100, 50, 30));
    }

    #[test]
    fn scroll_l_increments_h_scroll() {
        let (mut v, mut h) = (0, 0);
        assert!(apply_preview_scroll('l', &mut v, &mut h, 100, 50, 30));
        assert_eq!(h, 2);
    }

    #[test]
    fn scroll_l_at_max_no_change() {
        let (mut v, mut h) = (0, 50);
        assert!(!apply_preview_scroll('l', &mut v, &mut h, 100, 50, 30));
    }

    #[test]
    fn unknown_key_no_change() {
        let (mut v, mut h) = (5, 5);
        assert!(!apply_preview_scroll('x', &mut v, &mut h, 100, 50, 30));
        assert_eq!((v, h), (5, 5));
    }
}
