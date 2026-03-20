// WrapMap: maps logical lines to visual rows for soft-wrap rendering.

use unicode_width::UnicodeWidthChar;

/// A cached mapping from logical lines to visual rows.
///
/// Each logical line is broken into one or more visual rows based on
/// a fixed column width. The map stores cumulative visual row offsets
/// so that lookups are O(1) after an O(n) build.
pub struct WrapMap {
    /// For each logical line `i`, `offsets[i]` is the visual row index
    /// where that line starts. `offsets[line_count]` == total visual rows.
    offsets: Vec<usize>,
    /// The column width used to build this map.
    wrap_width: usize,
    /// Content generation at the time of build.
    generation: u64,
}

/// A position within a visual row: which logical line and the byte offset
/// within that line where this visual row starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VisualRowInfo {
    pub logical_line: usize,
    /// Byte offset in the logical line where this visual row starts.
    pub byte_offset: usize,
    /// Character index in the logical line where this visual row starts.
    pub char_offset: usize,
    /// Character index where the NEXT visual row starts (or total chars if last sub-row).
    /// Use this to clamp click coordinates to avoid jumping to the next visual row.
    pub char_end: usize,
}

impl WrapMap {
    /// Build a new WrapMap from the given lines.
    pub fn build(lines: &[String], wrap_width: usize, generation: u64) -> Self {
        let mut offsets = Vec::with_capacity(lines.len() + 1);
        let mut visual_row = 0;
        for line in lines {
            offsets.push(visual_row);
            visual_row += visual_rows_for_line(line, wrap_width);
        }
        offsets.push(visual_row);
        Self {
            offsets,
            wrap_width,
            generation,
        }
    }

    /// Total number of visual rows across all lines.
    pub fn total_visual_rows(&self) -> usize {
        *self.offsets.last().unwrap_or(&0)
    }

    /// The column width used to build this map.
    pub fn wrap_width(&self) -> usize {
        self.wrap_width
    }

    /// The content generation used to build this map.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// How many visual rows a given logical line occupies.
    pub fn visual_rows_for(&self, logical_line: usize) -> usize {
        if logical_line + 1 >= self.offsets.len() {
            return 1;
        }
        self.offsets[logical_line + 1] - self.offsets[logical_line]
    }

    /// The visual row index where a logical line starts.
    pub fn visual_row_of_line(&self, logical_line: usize) -> usize {
        if logical_line >= self.offsets.len() {
            return self.total_visual_rows();
        }
        self.offsets[logical_line]
    }

    /// Map a visual row index to (logical_line, char_offset, byte_offset).
    /// Returns None if the visual row is out of range.
    pub fn visual_row_to_line_info(
        &self,
        visual_row: usize,
        lines: &[String],
    ) -> Option<VisualRowInfo> {
        if visual_row >= self.total_visual_rows() {
            return None;
        }
        // Binary search: find the logical line whose offset range contains visual_row.
        let line_count = self.offsets.len() - 1;
        let logical_line = match self.offsets[..line_count].binary_search(&visual_row) {
            Ok(i) => {
                // Exact match — could be the start of line `i`, but if multiple
                // lines start at the same visual row (can't happen normally, but
                // be safe), find the last one.
                let mut li = i;
                while li + 1 < line_count && self.offsets[li + 1] == visual_row {
                    li += 1;
                }
                li
            }
            Err(i) => i - 1,
        };
        let row_within_line = visual_row - self.offsets[logical_line];
        let line = lines.get(logical_line)?;
        let total_sub_rows = self.visual_rows_for(logical_line);

        // Walk the line to find the byte/char offset for this visual sub-row.
        let (byte_offset, char_offset) =
            offset_for_visual_sub_row(line, self.wrap_width, row_within_line);

        // Compute char_end: start of next sub-row, or total chars if last sub-row
        let char_end = if row_within_line + 1 < total_sub_rows {
            let (_, next_char) =
                offset_for_visual_sub_row(line, self.wrap_width, row_within_line + 1);
            next_char
        } else {
            line.chars().count()
        };

        Some(VisualRowInfo {
            logical_line,
            byte_offset,
            char_offset,
            char_end,
        })
    }

    /// Map a buffer position (logical_line, byte_col) to a visual row index.
    pub fn buffer_pos_to_visual_row(
        &self,
        logical_line: usize,
        byte_col: usize,
        lines: &[String],
    ) -> usize {
        let base = self.visual_row_of_line(logical_line);
        let line = match lines.get(logical_line) {
            Some(l) => l,
            None => return base,
        };
        // Count how many display columns precede byte_col
        let display_col: usize = line[..byte_col.min(line.len())]
            .chars()
            .map(|c| c.width().unwrap_or(1))
            .sum();
        if self.wrap_width == 0 {
            return base;
        }
        let sub_row = display_col / self.wrap_width;
        base + sub_row
    }

    /// Map a buffer position (logical_line, byte_col) to the display column
    /// within its visual row.
    pub fn buffer_pos_to_visual_col(
        &self,
        logical_line: usize,
        byte_col: usize,
        lines: &[String],
    ) -> usize {
        let line = match lines.get(logical_line) {
            Some(l) => l,
            None => return 0,
        };
        let display_col: usize = line[..byte_col.min(line.len())]
            .chars()
            .map(|c| c.width().unwrap_or(1))
            .sum();
        if self.wrap_width == 0 {
            return display_col;
        }
        display_col % self.wrap_width
    }
}

/// Count how many visual rows a single line occupies at the given wrap width.
pub fn visual_rows_for_line(line: &str, wrap_width: usize) -> usize {
    if wrap_width == 0 {
        return 1;
    }
    let mut rows = 1;
    let mut col = 0;
    for ch in line.chars() {
        let w = ch.width().unwrap_or(1);
        if col + w > wrap_width && col > 0 {
            rows += 1;
            col = 0;
        }
        col += w;
    }
    // Empty line still occupies 1 visual row.
    rows
}

/// Find the byte offset and char offset of the start of a given visual sub-row
/// within a line.
fn offset_for_visual_sub_row(
    line: &str,
    wrap_width: usize,
    target_sub_row: usize,
) -> (usize, usize) {
    if wrap_width == 0 || target_sub_row == 0 {
        return (0, 0);
    }
    let mut current_row = 0;
    let mut col = 0;
    let mut char_idx = 0;
    for (byte_idx, ch) in line.char_indices() {
        if current_row == target_sub_row {
            return (byte_idx, char_idx);
        }
        let w = ch.width().unwrap_or(1);
        if col + w > wrap_width && col > 0 {
            current_row += 1;
            col = 0;
            if current_row == target_sub_row {
                return (byte_idx, char_idx);
            }
        }
        col += w;
        char_idx += 1;
    }
    // Past the end — return end of line
    (line.len(), char_idx)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(strs: &[&str]) -> Vec<String> {
        strs.iter().map(|s| s.to_string()).collect()
    }

    // --- visual_rows_for_line ---

    #[test]
    fn empty_line_is_one_visual_row() {
        assert_eq!(visual_rows_for_line("", 80), 1);
    }

    #[test]
    fn short_line_is_one_visual_row() {
        assert_eq!(visual_rows_for_line("hello", 80), 1);
    }

    #[test]
    fn line_exactly_at_wrap_width_is_one_row() {
        let line = "a".repeat(40);
        assert_eq!(visual_rows_for_line(&line, 40), 1);
    }

    #[test]
    fn line_one_char_over_wraps_to_two_rows() {
        let line = "a".repeat(41);
        assert_eq!(visual_rows_for_line(&line, 40), 2);
    }

    #[test]
    fn long_line_wraps_to_three_rows() {
        let line = "a".repeat(100);
        assert_eq!(visual_rows_for_line(&line, 40), 3);
    }

    #[test]
    fn wide_characters_count_double_width() {
        // 20 CJK chars = 40 display cols → fits in 40
        let line: String = std::iter::repeat('가').take(20).collect();
        assert_eq!(visual_rows_for_line(&line, 40), 1);
        // 21 CJK chars = 42 display cols → wraps
        let line2: String = std::iter::repeat('가').take(21).collect();
        assert_eq!(visual_rows_for_line(&line2, 40), 2);
    }

    #[test]
    fn wide_char_at_boundary_wraps() {
        // 39 ASCII + 1 CJK = 39 + 2 = 41 > 40 → CJK wraps to next row
        let mut line = "a".repeat(39);
        line.push('가');
        assert_eq!(visual_rows_for_line(&line, 40), 2);
    }

    // --- WrapMap::build + total_visual_rows ---

    #[test]
    fn wrap_map_single_short_line() {
        let l = lines(&["hello"]);
        let map = WrapMap::build(&l, 80, 0);
        assert_eq!(map.total_visual_rows(), 1);
    }

    #[test]
    fn wrap_map_mixed_lines() {
        // line 0: 10 chars → 1 row
        // line 1: 50 chars → 2 rows at width 40
        // line 2: 5 chars → 1 row
        let l = lines(&[
            "short line",
            &"a".repeat(50),
            "end",
        ]);
        let map = WrapMap::build(&l, 40, 0);
        assert_eq!(map.total_visual_rows(), 4);
        assert_eq!(map.visual_rows_for(0), 1);
        assert_eq!(map.visual_rows_for(1), 2);
        assert_eq!(map.visual_rows_for(2), 1);
    }

    // --- visual_row_to_line_info ---

    #[test]
    fn visual_row_maps_to_correct_logical_line() {
        let l = lines(&["short", &"a".repeat(50), "end"]);
        let map = WrapMap::build(&l, 40, 0);

        // visual row 0 → line 0, offset 0
        let info = map.visual_row_to_line_info(0, &l).unwrap();
        assert_eq!(info.logical_line, 0);
        assert_eq!(info.byte_offset, 0);

        // visual row 1 → line 1, first sub-row (chars 0..40)
        let info = map.visual_row_to_line_info(1, &l).unwrap();
        assert_eq!(info.logical_line, 1);
        assert_eq!(info.byte_offset, 0);
        assert_eq!(info.char_end, 40); // next sub-row starts at char 40

        // visual row 2 → line 1, second sub-row (chars 40..50)
        let info = map.visual_row_to_line_info(2, &l).unwrap();
        assert_eq!(info.logical_line, 1);
        assert_eq!(info.byte_offset, 40);
        assert_eq!(info.char_offset, 40);
        assert_eq!(info.char_end, 50); // last sub-row, total chars = 50

        // visual row 3 → line 2
        let info = map.visual_row_to_line_info(3, &l).unwrap();
        assert_eq!(info.logical_line, 2);
        assert_eq!(info.byte_offset, 0);
        assert_eq!(info.char_end, 3); // "end" = 3 chars
    }

    #[test]
    fn visual_row_out_of_range_returns_none() {
        let l = lines(&["hello"]);
        let map = WrapMap::build(&l, 80, 0);
        assert!(map.visual_row_to_line_info(1, &l).is_none());
    }

    // --- buffer_pos_to_visual_row ---

    #[test]
    fn buffer_pos_on_first_sub_row() {
        let l = lines(&["short", &"a".repeat(50)]);
        let map = WrapMap::build(&l, 40, 0);
        // line 1, byte 10 → display col 10 → sub_row 0 → visual row 1
        assert_eq!(map.buffer_pos_to_visual_row(1, 10, &l), 1);
    }

    #[test]
    fn buffer_pos_on_second_sub_row() {
        let l = lines(&["short", &"a".repeat(50)]);
        let map = WrapMap::build(&l, 40, 0);
        // line 1, byte 45 → display col 45 → sub_row 1 → visual row 2
        assert_eq!(map.buffer_pos_to_visual_row(1, 45, &l), 2);
    }

    // --- buffer_pos_to_visual_col ---

    #[test]
    fn visual_col_on_first_sub_row() {
        let l = lines(&[&"a".repeat(50)]);
        let map = WrapMap::build(&l, 40, 0);
        assert_eq!(map.buffer_pos_to_visual_col(0, 10, &l), 10);
    }

    #[test]
    fn visual_col_on_second_sub_row() {
        let l = lines(&[&"a".repeat(50)]);
        let map = WrapMap::build(&l, 40, 0);
        // byte 45 → display col 45 → 45 % 40 = 5
        assert_eq!(map.buffer_pos_to_visual_col(0, 45, &l), 5);
    }

    // --- Wide character wrapping ---

    #[test]
    fn wrap_map_with_cjk_characters() {
        // 21 CJK chars = 42 display cols → wraps at width 40
        let cjk: String = std::iter::repeat('가').take(21).collect();
        let l = lines(&[&cjk]);
        let map = WrapMap::build(&l, 40, 0);
        assert_eq!(map.total_visual_rows(), 2);

        let info = map.visual_row_to_line_info(1, &l).unwrap();
        assert_eq!(info.logical_line, 0);
        // 20 CJK chars fit (40 cols), so sub-row 1 starts at char 20
        assert_eq!(info.char_offset, 20);
    }
}
