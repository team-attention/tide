// Rendering methods for EditorPane: grid, cursor, and scrollbar.

use unicode_width::UnicodeWidthChar;

use crate::tide_core::{Color, Rect, Renderer, TextStyle, Vec2};
use crate::tide_editor::markdown::{MarkdownTheme, MdElementKind, PreviewLine};
use crate::tide_editor::wrap::WrapMap;
use crate::tide_renderer::WgpuRenderer;

use crate::state::search::SearchState;
use crate::theme::SCROLLBAR_WIDTH;

use crate::theme::ThemePalette;

use super::{EditorPane, GUTTER_WIDTH_CELLS, SPLIT_PREVIEW_GAP_CELLS};

impl EditorPane {
    /// Render the editor grid cells into the cached grid layer, with optional diff colors.
    pub fn render_grid_full(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        gutter_text: Color,
        gutter_active_text: Color,
        diff_added_bg: Option<Color>,
        diff_removed_bg: Option<Color>,
        diff_added_gutter: Option<Color>,
        diff_removed_gutter: Option<Color>,
        ime_preedit: &str,
        current_line_bg: Color,
        indent_guide: Color,
    ) {
        if self.preview_mode {
            self.render_preview_grid(rect, renderer);
            return;
        }
        if self.live_preview && self.live_preview_map.is_some() {
            // v1: soft wrap in live preview uses raw buffer widths for wrap
            // positions (the WrapMap is already built from raw line content).
            if self.effective_soft_wrap() {
                self.render_live_preview_soft_wrap_grid(
                    rect,
                    renderer,
                    gutter_text,
                    gutter_active_text,
                    ime_preedit,
                    current_line_bg,
                    indent_guide,
                );
            } else {
                self.render_live_preview_grid(
                    rect,
                    renderer,
                    gutter_text,
                    gutter_active_text,
                    ime_preedit,
                    current_line_bg,
                    indent_guide,
                );
            }
            return;
        }
        if let Some((editor_rect, preview_rect)) =
            self.split_preview_rects(rect, renderer.cell_size())
        {
            self.render_authoring_grid(
                editor_rect,
                renderer,
                gutter_text,
                gutter_active_text,
                diff_added_bg,
                diff_removed_bg,
                diff_added_gutter,
                diff_removed_gutter,
                ime_preedit,
                current_line_bg,
                indent_guide,
                self.wrap_map(),
            );
            self.render_split_preview_grid(preview_rect, renderer);
            let separator_x = preview_rect.x
                - (SPLIT_PREVIEW_GAP_CELLS as f32 * renderer.cell_size().width) / 2.0;
            renderer.draw_grid_rect(
                Rect::new(separator_x, rect.y, 1.0, rect.height),
                current_line_bg,
            );
            return;
        }
        self.render_authoring_grid(
            rect,
            renderer,
            gutter_text,
            gutter_active_text,
            diff_added_bg,
            diff_removed_bg,
            diff_added_gutter,
            diff_removed_gutter,
            ime_preedit,
            current_line_bg,
            indent_guide,
            None,
        );
    }

    fn render_authoring_grid(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        gutter_text: Color,
        gutter_active_text: Color,
        diff_added_bg: Option<Color>,
        diff_removed_bg: Option<Color>,
        diff_added_gutter: Option<Color>,
        diff_removed_gutter: Option<Color>,
        ime_preedit: &str,
        current_line_bg: Color,
        indent_guide: Color,
        wrap_map_override: Option<&WrapMap>,
    ) {
        if let Some(wrap_map) = wrap_map_override {
            self.render_soft_wrap_grid_with_map(
                rect,
                renderer,
                gutter_text,
                gutter_active_text,
                ime_preedit,
                current_line_bg,
                wrap_map,
            );
            return;
        }
        if self.effective_soft_wrap() {
            self.render_soft_wrap_grid(
                rect,
                renderer,
                gutter_text,
                gutter_active_text,
                ime_preedit,
                current_line_bg,
            );
            return;
        }
        if self.diff_mode {
            if let Some(ref disk_content) = self.disk_content {
                self.render_diff_grid(
                    rect,
                    renderer,
                    gutter_text,
                    disk_content,
                    diff_added_bg.unwrap_or(gutter_text),
                    diff_removed_bg.unwrap_or(gutter_text),
                    diff_added_gutter.unwrap_or(gutter_text),
                    diff_removed_gutter.unwrap_or(gutter_text),
                );
                return;
            }
        }

        let cell_size = renderer.cell_size();
        let gutter_width = GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        let content_x = rect.x + gutter_width;
        let scrollbar_reserved = if self.needs_scrollbar(rect, cell_size.height) {
            SCROLLBAR_WIDTH
        } else {
            0.0
        };
        let content_width = (rect.width - gutter_width - scrollbar_reserved).max(0.0);

        let visible_rows = (rect.height / cell_size.height).floor() as usize;
        let scroll = self.editor.scroll_offset();
        let h_scroll = self.editor.h_scroll_offset();

        // Get highlighted lines
        let highlighted = self.editor.visible_highlighted_lines(visible_rows);
        let cursor_pos = self.editor.cursor_position();
        let cursor_line = cursor_pos.line;

        // Calculate preedit width for inline text shift
        let preedit_width = if !ime_preedit.is_empty() {
            ime_preedit
                .chars()
                .map(|c| c.width().unwrap_or(1))
                .sum::<usize>()
        } else {
            0
        };
        // Cursor column in character index (for preedit shift comparison)
        let cursor_char_col = if preedit_width > 0 {
            if let Some(line_text) = self.editor.buffer.line(cursor_line) {
                let byte_col = cursor_pos.col.min(line_text.len());
                line_text[..byte_col].chars().count()
            } else {
                0
            }
        } else {
            0
        };

        for (vi, spans) in highlighted.iter().enumerate() {
            let abs_line = scroll + vi;
            let y = rect.y + vi as f32 * cell_size.height;

            if y + cell_size.height > rect.y + rect.height {
                break;
            }

            // Current line highlight: full-width bg rect spanning gutter + content
            if abs_line == cursor_line {
                let row_rect = Rect::new(rect.x, y, rect.width, cell_size.height);
                renderer.draw_grid_rect(row_rect, current_line_bg);
            }

            // Draw line number in gutter
            let line_num = format!("{:>4}  ", abs_line + 1);
            let gutter_color = if abs_line == cursor_line {
                gutter_active_text
            } else {
                gutter_text
            };
            let gutter_style = TextStyle {
                foreground: gutter_color,
                background: None,
                bold: abs_line == cursor_line,
                dim: false,
                italic: false,
                underline: false,
            };
            for (ci, ch) in line_num.chars().enumerate() {
                if ch != ' ' {
                    renderer.draw_grid_cell(
                        ch,
                        vi,
                        ci,
                        gutter_style,
                        cell_size,
                        Vec2::new(rect.x, rect.y),
                    );
                }
            }

            // Draw syntax-highlighted content with horizontal scroll
            let mut char_idx = 0usize; // character index in the line
            let mut display_col = 0usize; // visual column offset from h_scroll start
            let mut preedit_shifted = false;
            for span in spans {
                for ch in span.text.chars() {
                    if ch == '\n' {
                        continue;
                    }
                    let char_w = ch.width().unwrap_or(1);
                    // Skip characters before h_scroll (h_scroll is character-indexed)
                    if char_idx < h_scroll {
                        char_idx += 1;
                        continue;
                    }
                    // On the cursor line, shift text rightward when we reach the cursor
                    // to make room for the IME preedit characters
                    if !preedit_shifted
                        && preedit_width > 0
                        && abs_line == cursor_line
                        && char_idx >= cursor_char_col
                    {
                        display_col += preedit_width;
                        preedit_shifted = true;
                    }
                    let px = content_x + display_col as f32 * cell_size.width;
                    if px >= content_x + content_width {
                        break;
                    }
                    if ch != ' ' || span.style.background.is_some() {
                        renderer.draw_grid_cell(
                            ch,
                            vi,
                            GUTTER_WIDTH_CELLS + display_col,
                            span.style,
                            cell_size,
                            Vec2::new(rect.x, rect.y),
                        );
                    }
                    display_col += char_w;
                    char_idx += 1;
                }
            }

            // Indentation guides: draw vertical lines at each tab stop
            if h_scroll == 0 {
                let indent_level = if let Some(line_text) = self.editor.buffer.line(abs_line) {
                    let leading: usize = line_text
                        .chars()
                        .take_while(|c| *c == ' ' || *c == '\t')
                        .map(|c| if c == '\t' { 4 } else { 1 })
                        .sum();
                    // For blank lines, use indent of nearest non-blank line above
                    if line_text.trim().is_empty() {
                        let mut level = 0usize;
                        // Limit backward scan to avoid O(file_size) per blank line.
                        let scan_start = abs_line.saturating_sub(100);
                        for prev_line in (scan_start..abs_line).rev() {
                            if let Some(prev) = self.editor.buffer.line(prev_line) {
                                if !prev.trim().is_empty() {
                                    level = prev
                                        .chars()
                                        .take_while(|c| *c == ' ' || *c == '\t')
                                        .map(|c| if c == '\t' { 4 } else { 1 })
                                        .sum();
                                    break;
                                }
                            }
                        }
                        level
                    } else {
                        leading
                    }
                } else {
                    0
                };
                let tab_size = 4usize;
                let mut col = tab_size;
                while col < indent_level {
                    let guide_x = content_x + col as f32 * cell_size.width;
                    if guide_x < content_x + content_width {
                        renderer.draw_grid_rect(
                            Rect::new(guide_x, y, 1.0, cell_size.height),
                            indent_guide,
                        );
                    }
                    col += tab_size;
                }
            }
        }
    }

    /// Render the editor grid in live preview mode.
    ///
    /// The cursor line is rendered exactly like authoring mode (raw text, all syntax visible).
    /// Non-cursor lines hide inline syntax markers and apply markdown styling.
    fn render_live_preview_grid(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        gutter_text: Color,
        gutter_active_text: Color,
        ime_preedit: &str,
        current_line_bg: Color,
        indent_guide: Color,
    ) {
        let live_map = match &self.live_preview_map {
            Some(m) => m,
            None => return,
        };

        let cell_size = renderer.cell_size();
        let gutter_width = GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        let content_x = rect.x + gutter_width;
        let scrollbar_reserved = if self.needs_scrollbar(rect, cell_size.height) {
            SCROLLBAR_WIDTH
        } else {
            0.0
        };
        let content_width = (rect.width - gutter_width - scrollbar_reserved).max(0.0);

        let visible_rows = (rect.height / cell_size.height).floor() as usize;
        let scroll = self.editor.scroll_offset();
        let h_scroll = self.editor.h_scroll_offset();

        let highlighted = self.editor.visible_highlighted_lines(visible_rows);
        let cursor_pos = self.editor.cursor_position();
        let cursor_line = cursor_pos.line;

        // Preedit width for cursor line IME shift
        let preedit_width = if !ime_preedit.is_empty() {
            ime_preedit
                .chars()
                .map(|c| c.width().unwrap_or(1))
                .sum::<usize>()
        } else {
            0
        };
        let cursor_char_col = if preedit_width > 0 {
            if let Some(line_text) = self.editor.buffer.line(cursor_line) {
                let byte_col = cursor_pos.col.min(line_text.len());
                line_text[..byte_col].chars().count()
            } else {
                0
            }
        } else {
            0
        };

        // Precompute cumulative byte offsets for each line so we can convert
        // a (line, char_index) into a global byte offset for element_style lookups.
        // We only need lines in the visible range.
        // Build a theme for styling (use dark — matches typical editor bg)
        let theme = MarkdownTheme::dark();

        for (vi, spans) in highlighted.iter().enumerate() {
            let abs_line = scroll + vi;
            let y = rect.y + vi as f32 * cell_size.height;

            if y + cell_size.height > rect.y + rect.height {
                break;
            }

            // Current line highlight
            if abs_line == cursor_line {
                let row_rect = Rect::new(rect.x, y, rect.width, cell_size.height);
                renderer.draw_grid_rect(row_rect, current_line_bg);
            }

            // Gutter: line number
            let line_num = format!("{:>4}  ", abs_line + 1);
            let gutter_color = if abs_line == cursor_line {
                gutter_active_text
            } else {
                gutter_text
            };
            let gutter_style = TextStyle {
                foreground: gutter_color,
                background: None,
                bold: abs_line == cursor_line,
                dim: false,
                italic: false,
                underline: false,
            };
            for (ci, ch) in line_num.chars().enumerate() {
                if ch != ' ' {
                    renderer.draw_grid_cell(
                        ch,
                        vi,
                        ci,
                        gutter_style,
                        cell_size,
                        Vec2::new(rect.x, rect.y),
                    );
                }
            }

            if abs_line == cursor_line {
                // Cursor line: render exactly like authoring mode (raw text, all syntax)
                let mut char_idx = 0usize;
                let mut display_col = 0usize;
                let mut preedit_shifted = false;
                for span in spans {
                    for ch in span.text.chars() {
                        if ch == '\n' {
                            continue;
                        }
                        let char_w = ch.width().unwrap_or(1);
                        if char_idx < h_scroll {
                            char_idx += 1;
                            continue;
                        }
                        if !preedit_shifted && preedit_width > 0 && char_idx >= cursor_char_col {
                            display_col += preedit_width;
                            preedit_shifted = true;
                        }
                        let px = content_x + display_col as f32 * cell_size.width;
                        if px >= content_x + content_width {
                            break;
                        }
                        if ch != ' ' || span.style.background.is_some() {
                            renderer.draw_grid_cell(
                                ch,
                                vi,
                                GUTTER_WIDTH_CELLS + display_col,
                                span.style,
                                cell_size,
                                Vec2::new(rect.x, rect.y),
                            );
                        }
                        display_col += char_w;
                        char_idx += 1;
                    }
                }

                // Indent guides on cursor line
                if h_scroll == 0 {
                    if let Some(line_text) = self.editor.buffer.line(abs_line) {
                        let indent_level: usize = line_text
                            .chars()
                            .take_while(|c| *c == ' ' || *c == '\t')
                            .map(|c| if c == '\t' { 4 } else { 1 })
                            .sum();
                        let tab_size = 4usize;
                        let mut col = tab_size;
                        while col < indent_level {
                            let guide_x = content_x + col as f32 * cell_size.width;
                            if guide_x < content_x + content_width {
                                renderer.draw_grid_rect(
                                    Rect::new(guide_x, y, 1.0, cell_size.height),
                                    indent_guide,
                                );
                            }
                            col += tab_size;
                        }
                    }
                }
            } else {
                // Non-cursor line: hide inline syntax, apply markdown styling
                let line_text = match self.editor.buffer.line(abs_line) {
                    Some(t) => t,
                    None => continue,
                };

                // Get hidden byte ranges for this line
                let hidden_ranges = live_map.hidden_syntax_ranges(abs_line, cursor_line);

                // Compute the byte offset of this line in the overall buffer
                let line_byte_start: usize = (0..abs_line)
                    .filter_map(|i| self.editor.buffer.line(i))
                    .map(|l| l.len() + 1) // +1 for '\n'
                    .sum();

                let mut display_col = 0usize;
                let mut byte_offset = line_byte_start;
                let mut char_idx = 0usize;

                for ch in line_text.chars() {
                    if ch == '\n' {
                        byte_offset += ch.len_utf8();
                        continue;
                    }
                    let char_byte_len = ch.len_utf8();
                    let char_w = ch.width().unwrap_or(1);

                    // Check if this byte offset is in a hidden syntax range
                    let is_hidden = hidden_ranges.iter().any(|r| r.contains(&byte_offset));
                    if is_hidden {
                        byte_offset += char_byte_len;
                        char_idx += 1;
                        continue; // skip rendering
                    }

                    // Apply h_scroll based on display_col (not char_idx, since some chars are hidden)
                    // For non-cursor lines we still respect h_scroll
                    if char_idx < h_scroll && !is_hidden {
                        // We need to count non-hidden chars for h_scroll
                        // Actually, h_scroll is char-indexed, but with hidden chars
                        // the mapping is tricky. For simplicity, apply h_scroll
                        // to displayed chars only.
                    }

                    // Determine style based on markdown element
                    let md_style = live_map.element_style(byte_offset);
                    let style = self.resolve_md_style(md_style, &theme, spans, char_idx);

                    let px = content_x + display_col as f32 * cell_size.width;
                    if px >= content_x + content_width {
                        break;
                    }
                    if ch != ' ' || style.background.is_some() {
                        renderer.draw_grid_cell(
                            ch,
                            vi,
                            GUTTER_WIDTH_CELLS + display_col,
                            style,
                            cell_size,
                            Vec2::new(rect.x, rect.y),
                        );
                    }
                    display_col += char_w;
                    byte_offset += char_byte_len;
                    char_idx += 1;
                }

                // Indent guides on non-cursor lines
                if h_scroll == 0 {
                    let indent_level: usize = line_text
                        .chars()
                        .take_while(|c| *c == ' ' || *c == '\t')
                        .map(|c| if c == '\t' { 4 } else { 1 })
                        .sum();
                    if line_text.trim().is_empty() {
                        // For blank lines, check nearest non-blank above
                        let scan_start = abs_line.saturating_sub(100);
                        let mut level = 0usize;
                        for prev_line in (scan_start..abs_line).rev() {
                            if let Some(prev) = self.editor.buffer.line(prev_line) {
                                if !prev.trim().is_empty() {
                                    level = prev
                                        .chars()
                                        .take_while(|c| *c == ' ' || *c == '\t')
                                        .map(|c| if c == '\t' { 4 } else { 1 })
                                        .sum();
                                    break;
                                }
                            }
                        }
                        let tab_size = 4usize;
                        let mut col = tab_size;
                        while col < level {
                            let guide_x = content_x + col as f32 * cell_size.width;
                            if guide_x < content_x + content_width {
                                renderer.draw_grid_rect(
                                    Rect::new(guide_x, y, 1.0, cell_size.height),
                                    indent_guide,
                                );
                            }
                            col += tab_size;
                        }
                    } else {
                        let tab_size = 4usize;
                        let mut col = tab_size;
                        while col < indent_level {
                            let guide_x = content_x + col as f32 * cell_size.width;
                            if guide_x < content_x + content_width {
                                renderer.draw_grid_rect(
                                    Rect::new(guide_x, y, 1.0, cell_size.height),
                                    indent_guide,
                                );
                            }
                            col += tab_size;
                        }
                    }
                }
            }
        }
    }

    /// Render live preview grid with soft wrapping.
    ///
    /// v1: wrapping is based on raw buffer widths (WrapMap uses raw line content,
    /// not display widths with hidden syntax). This means wrapped positions may
    /// not perfectly match displayed character positions on non-cursor lines
    /// where syntax markers are hidden. A future version could compute a
    /// display-width-aware wrap map for live preview.
    fn render_live_preview_soft_wrap_grid(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        gutter_text: Color,
        gutter_active_text: Color,
        ime_preedit: &str,
        current_line_bg: Color,
        _indent_guide: Color,
    ) {
        let live_map = match &self.live_preview_map {
            Some(m) => m,
            None => return,
        };
        let wrap_map = match self.wrap_map() {
            Some(m) => m,
            None => return,
        };

        let cell_size = renderer.cell_size();
        let gutter_width = GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        let content_x = rect.x + gutter_width;
        let scrollbar_reserved = if self.needs_scrollbar_soft_wrap(rect, cell_size.height) {
            SCROLLBAR_WIDTH
        } else {
            0.0
        };
        let content_width = (rect.width - gutter_width - scrollbar_reserved).max(0.0);
        let wrap_cols = wrap_map.wrap_width();

        let visible_rows = (rect.height / cell_size.height).floor() as usize;
        let scroll = self.soft_wrap_visual_scroll();
        let logical_scroll = self.editor.scroll_offset();
        let cursor_pos = self.editor.cursor_position();
        let cursor_line = cursor_pos.line;

        // Preedit width for cursor line IME shift
        let preedit_width = if !ime_preedit.is_empty() {
            ime_preedit
                .chars()
                .map(|c| c.width().unwrap_or(1))
                .sum::<usize>()
        } else {
            0
        };
        let cursor_char_col = if preedit_width > 0 {
            if let Some(line_text) = self.editor.buffer.line(cursor_line) {
                let byte_col = cursor_pos.col.min(line_text.len());
                line_text[..byte_col].chars().count()
            } else {
                0
            }
        } else {
            0
        };

        let theme = MarkdownTheme::dark();

        // Fetch enough logical lines to fill visible_rows visual rows.
        let line_count = self.editor.buffer.line_count();
        let start_sub_row = scroll.saturating_sub(wrap_map.visual_row_of_line(logical_scroll));
        let mut fetch_lines = 0usize;
        let mut remaining_rows = visible_rows + start_sub_row;
        for line in logical_scroll..line_count {
            fetch_lines += 1;
            let line_rows = wrap_map.visual_rows_for(line);
            if line_rows >= remaining_rows {
                break;
            }
            remaining_rows -= line_rows;
        }
        let highlighted = self.editor.visible_highlighted_lines(fetch_lines);

        let mut vi = 0; // current visual row index on screen
        for (li_offset, spans) in highlighted.iter().enumerate() {
            let abs_line = logical_scroll + li_offset;
            if vi >= visible_rows {
                break;
            }

            let sub_rows = wrap_map.visual_rows_for(abs_line);
            let first_sub_row = if li_offset == 0 { start_sub_row } else { 0 };

            for sub_row in first_sub_row..sub_rows {
                if vi >= visible_rows {
                    break;
                }

                let y = rect.y + vi as f32 * cell_size.height;
                if y + cell_size.height > rect.y + rect.height {
                    break;
                }

                // Current line highlight
                if abs_line == cursor_line {
                    let row_rect = Rect::new(rect.x, y, rect.width, cell_size.height);
                    renderer.draw_grid_rect(row_rect, current_line_bg);
                }

                // Gutter: line number only on first sub-row
                if sub_row == 0 {
                    let line_num = format!("{:>4}  ", abs_line + 1);
                    let gutter_color = if abs_line == cursor_line {
                        gutter_active_text
                    } else {
                        gutter_text
                    };
                    let gutter_style = TextStyle {
                        foreground: gutter_color,
                        background: None,
                        bold: abs_line == cursor_line,
                        dim: false,
                        italic: false,
                        underline: false,
                    };
                    for (ci, ch) in line_num.chars().enumerate() {
                        if ch != ' ' {
                            renderer.draw_grid_cell(
                                ch,
                                vi,
                                ci,
                                gutter_style,
                                cell_size,
                                Vec2::new(rect.x, rect.y),
                            );
                        }
                    }
                }

                let sub_row_start_col = sub_row * wrap_cols;
                let sub_row_end_col = sub_row_start_col + wrap_cols;

                if abs_line == cursor_line {
                    // Cursor line: render raw text with syntax highlighting (no hidden syntax)
                    let mut display_col_abs = 0usize;
                    let mut display_col = 0usize;
                    let mut char_idx = 0usize;
                    let mut preedit_shifted = false;

                    for span in spans {
                        for ch in span.text.chars() {
                            if ch == '\n' {
                                continue;
                            }
                            let char_w = ch.width().unwrap_or(1);

                            if display_col_abs >= sub_row_end_col {
                                break;
                            }

                            if display_col_abs + char_w > sub_row_start_col {
                                if display_col_abs < sub_row_start_col {
                                    display_col_abs += char_w;
                                    char_idx += 1;
                                    continue;
                                }

                                if !preedit_shifted
                                    && preedit_width > 0
                                    && char_idx >= cursor_char_col
                                {
                                    display_col += preedit_width;
                                    preedit_shifted = true;
                                }

                                let px = content_x + display_col as f32 * cell_size.width;
                                if px < content_x + content_width {
                                    if ch != ' ' || span.style.background.is_some() {
                                        renderer.draw_grid_cell(
                                            ch,
                                            vi,
                                            GUTTER_WIDTH_CELLS + display_col,
                                            span.style,
                                            cell_size,
                                            Vec2::new(rect.x, rect.y),
                                        );
                                    }
                                }
                                display_col += char_w;
                            }

                            display_col_abs += char_w;
                            char_idx += 1;
                        }
                        if display_col_abs >= sub_row_end_col {
                            break;
                        }
                    }
                } else {
                    // Non-cursor line: hide syntax markers, apply markdown styling.
                    // v1: wrapping uses raw buffer column positions.
                    let line_text = match self.editor.buffer.line(abs_line) {
                        Some(t) => t,
                        None => {
                            vi += 1;
                            continue;
                        }
                    };

                    let hidden_ranges = live_map.hidden_syntax_ranges(abs_line, cursor_line);
                    let line_byte_start: usize = (0..abs_line)
                        .filter_map(|i| self.editor.buffer.line(i))
                        .map(|l| l.len() + 1)
                        .sum();

                    let mut display_col_abs = 0usize; // raw column in the logical line
                    let mut display_col = 0usize; // column within this sub-row
                    let mut byte_offset = line_byte_start;
                    let mut char_idx = 0usize;

                    for ch in line_text.chars() {
                        if ch == '\n' {
                            byte_offset += ch.len_utf8();
                            continue;
                        }
                        let char_byte_len = ch.len_utf8();
                        let char_w = ch.width().unwrap_or(1);

                        // Past the end of this sub-row (in raw columns)
                        if display_col_abs >= sub_row_end_col {
                            break;
                        }

                        // Before this sub-row starts (in raw columns)
                        if display_col_abs + char_w <= sub_row_start_col {
                            display_col_abs += char_w;
                            byte_offset += char_byte_len;
                            char_idx += 1;
                            continue;
                        }

                        // Wide char straddling sub-row boundary — skip
                        if display_col_abs < sub_row_start_col {
                            display_col_abs += char_w;
                            byte_offset += char_byte_len;
                            char_idx += 1;
                            continue;
                        }

                        // Hidden syntax characters are still counted for raw
                        // column position but not rendered.
                        let is_hidden = hidden_ranges.iter().any(|r| r.contains(&byte_offset));
                        if is_hidden {
                            display_col_abs += char_w;
                            byte_offset += char_byte_len;
                            char_idx += 1;
                            continue;
                        }

                        let md_style = live_map.element_style(byte_offset);
                        let style = self.resolve_md_style(md_style, &theme, spans, char_idx);

                        let px = content_x + display_col as f32 * cell_size.width;
                        if px >= content_x + content_width {
                            break;
                        }
                        if ch != ' ' || style.background.is_some() {
                            renderer.draw_grid_cell(
                                ch,
                                vi,
                                GUTTER_WIDTH_CELLS + display_col,
                                style,
                                cell_size,
                                Vec2::new(rect.x, rect.y),
                            );
                        }
                        display_col += char_w;
                        display_col_abs += char_w;
                        byte_offset += char_byte_len;
                        char_idx += 1;
                    }
                }

                vi += 1;
            }
        }
    }

    /// Resolve a markdown element kind (or None) into a TextStyle.
    /// Falls back to syntax highlighting style when no markdown element applies.
    fn resolve_md_style(
        &self,
        md_style: Option<MdElementKind>,
        theme: &MarkdownTheme,
        spans: &[crate::tide_editor::highlight::StyledSpan],
        char_idx: usize,
    ) -> TextStyle {
        match md_style {
            Some(MdElementKind::Bold) => TextStyle {
                foreground: theme.bold,
                background: None,
                bold: true,
                dim: false,
                italic: false,
                underline: false,
            },
            Some(MdElementKind::Italic) => TextStyle {
                foreground: theme.italic,
                background: None,
                bold: false,
                dim: false,
                italic: true,
                underline: false,
            },
            Some(MdElementKind::InlineCode) => TextStyle {
                foreground: theme.code_fg,
                background: Some(theme.code_bg),
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            Some(MdElementKind::Link) | Some(MdElementKind::Image) => TextStyle {
                foreground: theme.link,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: true,
            },
            Some(MdElementKind::Strikethrough) => TextStyle {
                foreground: theme.body,
                background: None,
                bold: false,
                dim: true,
                italic: false,
                underline: false,
            },
            Some(MdElementKind::Heading(lvl)) => {
                let color = match lvl {
                    1 => theme.h1,
                    2 => theme.h2,
                    3 => theme.h3,
                    _ => theme.h4,
                };
                TextStyle {
                    foreground: color,
                    background: None,
                    bold: true,
                    dim: false,
                    italic: false,
                    underline: false,
                }
            }
            Some(MdElementKind::CodeBlock) => TextStyle {
                foreground: theme.code_fg,
                background: Some(theme.code_block_bg),
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            Some(MdElementKind::BlockQuote) => TextStyle {
                foreground: theme.blockquote,
                background: None,
                bold: false,
                dim: false,
                italic: true,
                underline: false,
            },
            Some(MdElementKind::ListItem) => TextStyle {
                foreground: theme.body,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            Some(MdElementKind::Table) => TextStyle {
                foreground: theme.body,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            Some(MdElementKind::HorizontalRule) => TextStyle {
                foreground: theme.rule,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            None => self.find_span_style_at(spans, char_idx),
        }
    }

    /// Helper: find the TextStyle from syntax-highlighted spans at a given character index.
    /// Used by live preview for non-styled characters to fall back to syntax highlighting.
    fn find_span_style_at(
        &self,
        spans: &[crate::tide_editor::highlight::StyledSpan],
        target_char: usize,
    ) -> TextStyle {
        let mut char_idx = 0usize;
        for span in spans {
            for _ch in span.text.chars() {
                if char_idx == target_char {
                    return span.style;
                }
                char_idx += 1;
            }
        }
        // Fallback: default text style
        TextStyle {
            foreground: Color::new(0.85, 0.85, 0.85, 1.0),
            background: None,
            bold: false,
            dim: false,
            italic: false,
            underline: false,
        }
    }

    /// Render the editor grid with soft wrapping (prose files).
    fn render_soft_wrap_grid(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        gutter_text: Color,
        gutter_active_text: Color,
        ime_preedit: &str,
        current_line_bg: Color,
    ) {
        let wrap_map = match self.wrap_map() {
            Some(m) => m,
            None => return,
        };
        self.render_soft_wrap_grid_with_map(
            rect,
            renderer,
            gutter_text,
            gutter_active_text,
            ime_preedit,
            current_line_bg,
            wrap_map,
        );
    }

    fn render_soft_wrap_grid_with_map(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        gutter_text: Color,
        gutter_active_text: Color,
        ime_preedit: &str,
        current_line_bg: Color,
        wrap_map: &WrapMap,
    ) {
        let cell_size = renderer.cell_size();
        let gutter_width = GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        let content_x = rect.x + gutter_width;
        let scrollbar_reserved = if self.needs_scrollbar_soft_wrap(rect, cell_size.height) {
            SCROLLBAR_WIDTH
        } else {
            0.0
        };
        let content_width = (rect.width - gutter_width - scrollbar_reserved).max(0.0);
        let wrap_cols = wrap_map.wrap_width();

        let visible_rows = (rect.height / cell_size.height).floor() as usize;
        let scroll = self.soft_wrap_visual_scroll();
        let logical_scroll = self.editor.scroll_offset();
        let cursor_pos = self.editor.cursor_position();
        let cursor_line = cursor_pos.line;

        // Calculate preedit width
        let preedit_width = if !ime_preedit.is_empty() {
            ime_preedit
                .chars()
                .map(|c| c.width().unwrap_or(1))
                .sum::<usize>()
        } else {
            0
        };
        let cursor_char_col = if preedit_width > 0 {
            if let Some(line_text) = self.editor.buffer.line(cursor_line) {
                let byte_col = cursor_pos.col.min(line_text.len());
                line_text[..byte_col].chars().count()
            } else {
                0
            }
        } else {
            0
        };

        // Get highlighted lines: we need enough logical lines to fill visible_rows visual rows.
        // Start from scroll_offset and fetch enough lines.
        // Worst case: every line is 1 visual row, so we need visible_rows logical lines.
        // Best case: one line fills everything. Fetch up to visible_rows as a start,
        // but may need more if lines don't wrap much.
        let line_count = self.editor.buffer.line_count();
        let start_sub_row = scroll.saturating_sub(wrap_map.visual_row_of_line(logical_scroll));
        let mut fetch_lines = 0usize;
        let mut remaining_rows = visible_rows + start_sub_row;
        for line in logical_scroll..line_count {
            fetch_lines += 1;
            let line_rows = wrap_map.visual_rows_for(line);
            if line_rows >= remaining_rows {
                break;
            }
            remaining_rows -= line_rows;
        }
        let highlighted = self.editor.visible_highlighted_lines(fetch_lines);

        // Render: iterate logical lines, expanding each into visual sub-rows.
        let mut vi = 0; // current visual row index on screen
        for (li_offset, spans) in highlighted.iter().enumerate() {
            let abs_line = logical_scroll + li_offset;
            if vi >= visible_rows {
                break;
            }

            let sub_rows = wrap_map.visual_rows_for(abs_line);
            let first_sub_row = if li_offset == 0 { start_sub_row } else { 0 };

            for sub_row in first_sub_row..sub_rows {
                if vi >= visible_rows {
                    break;
                }

                let y = rect.y + vi as f32 * cell_size.height;
                if y + cell_size.height > rect.y + rect.height {
                    break;
                }

                // Current line highlight
                if abs_line == cursor_line {
                    let row_rect = Rect::new(rect.x, y, rect.width, cell_size.height);
                    renderer.draw_grid_rect(row_rect, current_line_bg);
                }

                // Gutter: line number only on first sub-row
                if sub_row == 0 {
                    let line_num = format!("{:>4}  ", abs_line + 1);
                    let gutter_color = if abs_line == cursor_line {
                        gutter_active_text
                    } else {
                        gutter_text
                    };
                    let gutter_style = TextStyle {
                        foreground: gutter_color,
                        background: None,
                        bold: abs_line == cursor_line,
                        dim: false,
                        italic: false,
                        underline: false,
                    };
                    for (ci, ch) in line_num.chars().enumerate() {
                        if ch != ' ' {
                            renderer.draw_grid_cell(
                                ch,
                                vi,
                                ci,
                                gutter_style,
                                cell_size,
                                Vec2::new(rect.x, rect.y),
                            );
                        }
                    }
                }

                // Content: draw characters for this sub-row.
                // Compute the character range for this sub-row.
                let sub_row_start_col = sub_row * wrap_cols;
                let sub_row_end_col = sub_row_start_col + wrap_cols;

                let mut display_col_abs = 0usize; // absolute display column in the line
                let mut display_col = 0usize; // display column within this sub-row
                let mut char_idx = 0usize;
                let mut preedit_shifted = false;

                // Walk spans to find characters belonging to this sub-row
                for span in spans {
                    for ch in span.text.chars() {
                        if ch == '\n' {
                            continue;
                        }
                        let char_w = ch.width().unwrap_or(1);

                        // Check if this char starts on or after sub_row_end_col
                        if display_col_abs >= sub_row_end_col {
                            break;
                        }

                        // Check if this char is in this sub-row's range
                        if display_col_abs + char_w > sub_row_start_col {
                            // Handle wide char that would exceed sub-row boundary
                            if display_col_abs < sub_row_start_col {
                                // This wide char straddles the sub-row start — skip
                                display_col_abs += char_w;
                                char_idx += 1;
                                continue;
                            }

                            // IME preedit shift
                            if !preedit_shifted
                                && preedit_width > 0
                                && abs_line == cursor_line
                                && char_idx >= cursor_char_col
                            {
                                display_col += preedit_width;
                                preedit_shifted = true;
                            }

                            let px = content_x + display_col as f32 * cell_size.width;
                            if px < content_x + content_width {
                                if ch != ' ' || span.style.background.is_some() {
                                    renderer.draw_grid_cell(
                                        ch,
                                        vi,
                                        GUTTER_WIDTH_CELLS + display_col,
                                        span.style,
                                        cell_size,
                                        Vec2::new(rect.x, rect.y),
                                    );
                                }
                            }
                            display_col += char_w;
                        }

                        display_col_abs += char_w;
                        char_idx += 1;
                    }
                    if display_col_abs >= sub_row_end_col {
                        break;
                    }
                }

                vi += 1;
            }
        }
    }

    /// Whether soft-wrapped content needs a scrollbar.
    fn needs_scrollbar_soft_wrap(&self, rect: Rect, cell_height: f32) -> bool {
        let visible_rows = (rect.height / cell_height).floor() as usize;
        match self.wrap_map() {
            Some(map) => map.total_visual_rows() > visible_rows,
            None => self.editor.buffer.line_count() > visible_rows,
        }
    }

    /// Render the diff view grid.
    fn render_diff_grid(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        gutter_text: Color,
        disk_content: &[String],
        added_bg: Color,
        removed_bg: Color,
        added_gutter: Color,
        removed_gutter: Color,
    ) {
        use crate::state::diff::{compute_diff, DiffOp};

        let cell_size = renderer.cell_size();
        let gutter_width = GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        let content_x = rect.x + gutter_width;
        let content_width = (rect.width - gutter_width).max(0.0);

        let diff_ops = compute_diff(disk_content, &self.editor.buffer.lines);
        let visible_rows = (rect.height / cell_size.height).floor() as usize;
        let scroll = self.editor.scroll_offset();
        let h_scroll = self.editor.h_scroll_offset();

        // Render visible virtual lines
        for (vi, op) in diff_ops.iter().skip(scroll).take(visible_rows).enumerate() {
            let y = rect.y + vi as f32 * cell_size.height;
            if y + cell_size.height > rect.y + rect.height {
                break;
            }

            match op {
                DiffOp::Equal(buf_idx) | DiffOp::Insert(buf_idx) => {
                    let is_added = matches!(op, DiffOp::Insert(_));

                    // Draw full-row background rect for added lines
                    if is_added {
                        let row_rect = Rect::new(rect.x, y, rect.width, cell_size.height);
                        renderer.draw_grid_rect(row_rect, added_bg);
                    }

                    // Gutter: line number or + marker
                    let gutter_str = if is_added {
                        format!("{:>3}+  ", buf_idx + 1)
                    } else {
                        format!("{:>4}  ", buf_idx + 1)
                    };
                    let gc = if is_added { added_gutter } else { gutter_text };
                    let gutter_style = TextStyle {
                        foreground: gc,
                        background: None,
                        bold: false,
                        dim: false,
                        italic: false,
                        underline: false,
                    };
                    for (ci, ch) in gutter_str.chars().enumerate().take(GUTTER_WIDTH_CELLS) {
                        if ch != ' ' {
                            renderer.draw_grid_cell(
                                ch,
                                vi,
                                ci,
                                gutter_style,
                                cell_size,
                                Vec2::new(rect.x, rect.y),
                            );
                        }
                    }

                    // Content
                    if let Some(line) = self.editor.buffer.line(*buf_idx) {
                        let text_style = TextStyle {
                            foreground: Color::new(0.88, 0.88, 0.88, 1.0),
                            background: None,
                            bold: false,
                            dim: false,
                            italic: false,
                            underline: false,
                        };
                        let mut char_idx = 0usize;
                        let mut display_col = 0usize;
                        for ch in line.chars() {
                            if ch == '\n' {
                                continue;
                            }
                            let char_w = ch.width().unwrap_or(1);
                            if char_idx < h_scroll {
                                char_idx += 1;
                                continue;
                            }
                            let px = content_x + display_col as f32 * cell_size.width;
                            if px >= content_x + content_width {
                                break;
                            }
                            if ch != ' ' {
                                renderer.draw_grid_cell(
                                    ch,
                                    vi,
                                    GUTTER_WIDTH_CELLS + display_col,
                                    text_style,
                                    cell_size,
                                    Vec2::new(rect.x, rect.y),
                                );
                            }
                            display_col += char_w;
                            char_idx += 1;
                        }
                    }
                }
                DiffOp::Delete(disk_idx) => {
                    // Draw full-row background rect for removed lines
                    let row_rect = Rect::new(rect.x, y, rect.width, cell_size.height);
                    renderer.draw_grid_rect(row_rect, removed_bg);

                    // Gutter: - marker
                    let gutter_str = format!("{:>3}-  ", disk_idx + 1);
                    let gutter_style = TextStyle {
                        foreground: removed_gutter,
                        background: None,
                        bold: false,
                        dim: false,
                        italic: false,
                        underline: false,
                    };
                    for (ci, ch) in gutter_str.chars().enumerate().take(GUTTER_WIDTH_CELLS) {
                        if ch != ' ' {
                            renderer.draw_grid_cell(
                                ch,
                                vi,
                                ci,
                                gutter_style,
                                cell_size,
                                Vec2::new(rect.x, rect.y),
                            );
                        }
                    }

                    // Content from disk
                    if let Some(line) = disk_content.get(*disk_idx) {
                        let text_style = TextStyle {
                            foreground: Color::new(0.65, 0.65, 0.65, 1.0),
                            background: None,
                            bold: false,
                            dim: true,
                            italic: false,
                            underline: false,
                        };
                        let mut char_idx = 0usize;
                        let mut display_col = 0usize;
                        for ch in line.chars() {
                            if ch == '\n' {
                                continue;
                            }
                            let char_w = ch.width().unwrap_or(1);
                            if char_idx < h_scroll {
                                char_idx += 1;
                                continue;
                            }
                            let px = content_x + display_col as f32 * cell_size.width;
                            if px >= content_x + content_width {
                                break;
                            }
                            if ch != ' ' {
                                renderer.draw_grid_cell(
                                    ch,
                                    vi,
                                    GUTTER_WIDTH_CELLS + display_col,
                                    text_style,
                                    cell_size,
                                    Vec2::new(rect.x, rect.y),
                                );
                            }
                            display_col += char_w;
                            char_idx += 1;
                        }
                    }
                }
            }
        }
    }

    /// Render the markdown preview grid.
    fn render_preview_grid(&self, rect: Rect, renderer: &mut WgpuRenderer) {
        self.render_preview_lines_grid(
            rect,
            renderer,
            self.preview_lines(),
            self.preview_scroll,
            self.preview_h_scroll,
        );
    }

    fn render_preview_lines_grid(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        preview_lines: &[PreviewLine],
        preview_scroll: usize,
        preview_h_scroll: usize,
    ) {
        let cell_size = renderer.cell_size();
        let scrollbar_reserved = if self.preview_needs_scrollbar(rect, cell_size.height) {
            SCROLLBAR_WIDTH
        } else {
            0.0
        };
        let content_width = (rect.width - scrollbar_reserved).max(0.0);
        // 2-cell right padding for code block bg to match the 2-cell left indent
        let right_pad = 2.0 * cell_size.width;
        let bg_width = (content_width - right_pad).max(0.0);
        let visible_rows = (rect.height / cell_size.height).floor() as usize;

        for (vi, line) in preview_lines
            .iter()
            .skip(preview_scroll)
            .take(visible_rows)
            .enumerate()
        {
            let y = rect.y + vi as f32 * cell_size.height;

            if y + cell_size.height > rect.y + rect.height {
                break;
            }

            // Draw full-row background if present (for code blocks)
            if let Some(bg) = line.bg_color {
                let row_rect = Rect::new(rect.x, y, bg_width, cell_size.height);
                renderer.draw_grid_rect(row_rect, bg);
            }

            // Draw styled spans with horizontal scroll.
            // h-scroll only applies to code block lines; normal text is already wrapped.
            let is_code_block = line.bg_color.is_some();
            let h_scroll = if is_code_block { preview_h_scroll } else { 0 };
            let effective_width = if is_code_block {
                bg_width
            } else {
                content_width
            };
            let visible_cols = (effective_width / cell_size.width).floor() as usize;
            let mut abs_col = 0usize; // absolute column before h_scroll
            for span in &line.spans {
                for ch in span.text.chars() {
                    if ch == '\n' {
                        continue;
                    }
                    let char_w = ch.width().unwrap_or(1);
                    if abs_col + char_w <= h_scroll {
                        abs_col += char_w;
                        continue; // before visible region
                    }
                    let display_col = abs_col.saturating_sub(h_scroll);
                    if display_col >= visible_cols {
                        break; // past visible region
                    }
                    if ch != ' ' || span.style.background.is_some() {
                        renderer.draw_grid_cell(
                            ch,
                            vi,
                            display_col,
                            span.style,
                            cell_size,
                            Vec2::new(rect.x, rect.y),
                        );
                    }
                    abs_col += char_w;
                }
            }
        }
    }

    fn render_split_preview_grid(&self, rect: Rect, renderer: &mut WgpuRenderer) {
        let preview_lines = self.preview_lines();
        if preview_lines.is_empty() {
            return;
        }

        let raw_line_count = self.editor.buffer.line_count().max(1);
        let ratio = self.editor.scroll_offset() as f64 / raw_line_count as f64;
        let preview_scroll = ((ratio * preview_lines.len() as f64).round() as usize)
            .min(preview_lines.len().saturating_sub(1));
        self.render_preview_lines_grid(rect, renderer, &preview_lines, preview_scroll, 0);
    }

    /// Whether the preview content is long enough to need a scrollbar.
    fn preview_needs_scrollbar(&self, rect: Rect, cell_height: f32) -> bool {
        let visible_rows = (rect.height / cell_height).floor() as usize;
        self.preview_line_count() > visible_rows
    }

    /// Render the editor cursor into the overlay layer (always redrawn).
    /// `preedit_width_cells` shifts the cursor rightward during IME composition.
    pub fn render_cursor(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        cursor_color: Color,
        preedit_width_cells: usize,
    ) {
        let rect = self.authoring_rect(rect, renderer.cell_size());
        if self.effective_soft_wrap() {
            self.render_cursor_soft_wrap(rect, renderer, cursor_color, preedit_width_cells);
            return;
        }
        self.render_cursor_in_rect(rect, renderer, cursor_color, preedit_width_cells);
    }

    fn render_cursor_in_rect(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        cursor_color: Color,
        preedit_width_cells: usize,
    ) {
        let cell_size = renderer.cell_size();
        let pos = self.editor.cursor_position();
        let scroll = self.editor.scroll_offset();
        let h_scroll = self.editor.h_scroll_offset();

        // In diff mode, map buffer cursor line to virtual diff line
        let visual_row = if self.diff_mode {
            if let Some(ref disk_content) = self.disk_content {
                use crate::state::diff::{compute_diff, DiffOp};
                let diff_ops = compute_diff(disk_content, &self.editor.buffer.lines);
                let mut vline = None;
                for (vi, op) in diff_ops.iter().enumerate() {
                    match op {
                        DiffOp::Equal(buf_idx) | DiffOp::Insert(buf_idx) => {
                            if *buf_idx == pos.line {
                                vline = Some(vi);
                                break;
                            }
                        }
                        DiffOp::Delete(_) => {}
                    }
                }
                match vline {
                    Some(vl) if vl >= scroll => vl - scroll,
                    _ => return,
                }
            } else {
                return;
            }
        } else {
            if pos.line < scroll {
                return;
            }
            pos.line - scroll
        };

        // Convert byte offset to char index for comparison with h_scroll (char-indexed)
        let cursor_char_col = if let Some(line_text) = self.editor.buffer.line(pos.line) {
            let byte_col = pos.col.min(line_text.len());
            line_text[..byte_col].chars().count()
        } else {
            0
        };
        if cursor_char_col < h_scroll {
            return;
        }
        // Compute visual column accounting for wide characters
        let visual_col_offset = if let Some(line_text) = self.editor.buffer.line(pos.line) {
            line_text
                .chars()
                .skip(h_scroll)
                .take(cursor_char_col - h_scroll)
                .map(|c| c.width().unwrap_or(1))
                .sum::<usize>()
        } else {
            cursor_char_col - h_scroll
        };
        let visual_col = GUTTER_WIDTH_CELLS + visual_col_offset + preedit_width_cells;

        let cx = rect.x + visual_col as f32 * cell_size.width;
        let cy = rect.y + visual_row as f32 * cell_size.height;

        // Check if cursor is within visible area
        if cy + cell_size.height > rect.y + rect.height {
            return;
        }
        let gutter_width = GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        if cx > rect.x + rect.width || cx < rect.x + gutter_width {
            return;
        }

        // Beam cursor (thin vertical line) — standard for text editors
        renderer.draw_top_rect(Rect::new(cx, cy, 2.0, cell_size.height), cursor_color);
    }

    /// Render cursor for soft-wrapped mode.
    fn render_cursor_soft_wrap(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        cursor_color: Color,
        preedit_width_cells: usize,
    ) {
        let wrap_map = match self.wrap_map() {
            Some(m) => m,
            None => return,
        };
        self.render_cursor_soft_wrap_with_map(
            rect,
            renderer,
            cursor_color,
            preedit_width_cells,
            wrap_map,
        );
    }

    fn render_cursor_soft_wrap_with_map(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        cursor_color: Color,
        preedit_width_cells: usize,
        wrap_map: &WrapMap,
    ) {
        let cell_size = renderer.cell_size();
        let pos = self.editor.cursor_position();
        let scroll = self.soft_wrap_visual_scroll();

        let cursor_visual_row =
            wrap_map.buffer_pos_to_visual_row(pos.line, pos.col, &self.editor.buffer.lines);
        if cursor_visual_row < scroll {
            return;
        }
        let visual_row = cursor_visual_row - scroll;

        let visual_col_offset =
            wrap_map.buffer_pos_to_visual_col(pos.line, pos.col, &self.editor.buffer.lines);
        let visual_col = GUTTER_WIDTH_CELLS + visual_col_offset + preedit_width_cells;

        let cx = rect.x + visual_col as f32 * cell_size.width;
        let cy = rect.y + visual_row as f32 * cell_size.height;

        if cy + cell_size.height > rect.y + rect.height {
            return;
        }
        let gutter_width = GUTTER_WIDTH_CELLS as f32 * cell_size.width;
        if cx > rect.x + rect.width || cx < rect.x + gutter_width {
            return;
        }

        renderer.draw_top_rect(Rect::new(cx, cy, 2.0, cell_size.height), cursor_color);
    }

    /// Whether the file is long enough to need a scrollbar.
    pub fn needs_scrollbar(&self, rect: Rect, cell_height: f32) -> bool {
        if self.preview_mode {
            return self.preview_needs_scrollbar(rect, cell_height);
        }
        if self.effective_soft_wrap() {
            return self.needs_scrollbar_soft_wrap(rect, cell_height);
        }
        let visible_rows = (rect.height / cell_height).floor() as usize;
        self.editor.buffer.line_count() > visible_rows
    }

    /// Render a scrollbar on the right edge of the editor area.
    /// Includes match markers from search results when search is active.
    pub fn render_scrollbar(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        search: Option<&SearchState>,
        palette: &ThemePalette,
        hovered: bool,
    ) {
        let cell_size = renderer.cell_size();
        let rect = if let Some((editor_rect, _)) = self.split_preview_rects(rect, cell_size) {
            editor_rect
        } else {
            rect
        };
        let visible_rows = (rect.height / cell_size.height).floor() as usize;

        // In preview mode, use preview line count and scroll
        let (total_lines, scroll) = if self.preview_mode {
            (self.preview_line_count(), self.preview_scroll)
        } else if self.effective_soft_wrap() {
            if let Some(ref map) = self.wrap_map {
                (map.total_visual_rows(), self.soft_wrap_visual_scroll())
            } else {
                (self.editor.buffer.line_count(), self.editor.scroll_offset())
            }
        } else {
            (self.editor.buffer.line_count(), self.editor.scroll_offset())
        };

        if total_lines <= visible_rows {
            return;
        }

        let sb_width = if hovered {
            crate::theme::SCROLLBAR_WIDTH_HOVER
        } else {
            SCROLLBAR_WIDTH
        };
        let track_x = rect.x + rect.width - sb_width;
        let track_rect = Rect::new(track_x, rect.y, sb_width, rect.height);

        // Track background
        renderer.draw_rect(track_rect, palette.scrollbar_track);

        // Thumb
        let thumb_ratio_start = scroll as f32 / total_lines as f32;
        let thumb_ratio_end = (scroll + visible_rows) as f32 / total_lines as f32;
        let thumb_y = rect.y + thumb_ratio_start * rect.height;
        let thumb_h = (thumb_ratio_end - thumb_ratio_start) * rect.height;
        let thumb_h = thumb_h.max(4.0); // minimum thumb height
        let thumb_color = if hovered {
            palette.scrollbar_thumb_hover
        } else {
            palette.scrollbar_thumb
        };
        renderer.draw_rect(Rect::new(track_x, thumb_y, sb_width, thumb_h), thumb_color);

        // Search match markers (not applicable in preview mode)
        if !self.preview_mode {
            if let Some(search) = search {
                if search.visible && !search.input.is_empty() {
                    let marker_h = 2.0_f32;
                    for (mi, m) in search.matches.iter().enumerate() {
                        let line = if self.effective_soft_wrap() {
                            self.soft_wrap_visual_row_of_line(m.line).unwrap_or(m.line)
                        } else {
                            m.line
                        };
                        let ratio = line as f32 / total_lines as f32;
                        let my = rect.y + (ratio * rect.height).min(rect.height - marker_h);
                        let color = if search.current == Some(mi) {
                            palette.scrollbar_current
                        } else {
                            palette.scrollbar_match
                        };
                        renderer.draw_rect(Rect::new(track_x, my, sb_width, marker_h), color);
                    }
                }
            }
        }
    }
}
