// Diff pane: displays git-changed files with inline unified diffs.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use crate::tide_core::{Color, PaneId, Rect, Renderer, TextStyle, Vec2};
use crate::tide_renderer::WgpuRenderer;

/// A line in a unified diff.
#[derive(Debug, Clone, PartialEq)]
pub enum DiffLine {
    Context(String),
    Added(String),
    Removed(String),
    Header(String),
}

/// A file entry in the diff pane.
#[derive(Debug, Clone, PartialEq)]
pub struct DiffFileEntry {
    pub status: String,
    pub path: String,
    pub additions: usize,
    pub deletions: usize,
}

pub struct DiffPane {
    pub cwd: PathBuf,
    pub files: Vec<DiffFileEntry>,
    pub expanded: HashSet<usize>,
    pub diff_cache: HashMap<usize, Vec<DiffLine>>,
    pub scroll: f32,
    pub scroll_target: f32,
    /// Per-file horizontal scroll offset (keyed by file index).
    pub h_scroll: HashMap<usize, usize>,
    pub selected: Option<usize>,
    pub generation: u64,
    /// When true, render diff as side-by-side (old | new) instead of unified.
    pub side_by_side: bool,
    /// Text selection (virtual row, col) coordinates.
    pub selection: Option<crate::pane::Selection>,
    /// False until the first `apply_poll_data` arrives from the git poller.
    /// While false the pane renders a loading state instead of a (misleading)
    /// clean tree — diff content comes only from the background poller now.
    pub loaded: bool,
    /// Longest content line across expanded diffs, cached so horizontal-scroll
    /// clamping is O(1) instead of O(all diff text) per tick. Recomputed
    /// whenever content or expansion changes.
    cached_max_line_len: usize,
}

/// A paired row for side-by-side diff display.
struct SbsRow<'a> {
    left: Option<&'a DiffLine>,
    right: Option<&'a DiffLine>,
}

/// Pair diff lines for side-by-side rendering.
/// Context/Header lines appear on both sides. Removed lines go left,
/// Added lines go right, paired in order within each hunk.
fn pair_diff_lines(lines: &[DiffLine]) -> Vec<SbsRow<'_>> {
    let mut result = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        match &lines[i] {
            DiffLine::Context(_) | DiffLine::Header(_) => {
                result.push(SbsRow {
                    left: Some(&lines[i]),
                    right: Some(&lines[i]),
                });
                i += 1;
            }
            DiffLine::Removed(_) => {
                let mut removed = Vec::new();
                while i < lines.len() && matches!(&lines[i], DiffLine::Removed(_)) {
                    removed.push(&lines[i]);
                    i += 1;
                }
                let mut added = Vec::new();
                while i < lines.len() && matches!(&lines[i], DiffLine::Added(_)) {
                    added.push(&lines[i]);
                    i += 1;
                }
                let max_len = removed.len().max(added.len());
                for j in 0..max_len {
                    result.push(SbsRow {
                        left: removed.get(j).copied(),
                        right: added.get(j).copied(),
                    });
                }
            }
            DiffLine::Added(_) => {
                result.push(SbsRow {
                    left: None,
                    right: Some(&lines[i]),
                });
                i += 1;
            }
        }
    }
    result
}

impl DiffPane {
    /// Create an empty DiffPane. Content is populated entirely by the
    /// background git poller via `apply_poll_data` — opening a DiffPane never
    /// spawns git on the app thread. Until the first poll result arrives the
    /// pane renders a loading state (`loaded == false`).
    pub fn new_empty(_id: PaneId, cwd: PathBuf) -> Self {
        Self {
            cwd,
            files: Vec::new(),
            expanded: HashSet::new(),
            diff_cache: HashMap::new(),
            scroll: 0.0,
            scroll_target: 0.0,
            h_scroll: HashMap::new(),
            selected: None,
            generation: 1,
            side_by_side: true,
            selection: None,
            loaded: false,
            cached_max_line_len: 0,
        }
    }

    /// Apply pre-computed diff data from the background git poller.
    /// Only updates files whose content actually changed.
    /// Preserves expanded/collapsed state, scroll, and selection for unchanged files.
    /// Does not bump generation if nothing changed (avoids unnecessary re-render).
    pub fn apply_poll_data(
        &mut self,
        files: Vec<DiffFileEntry>,
        diff_cache: HashMap<usize, Vec<DiffLine>>,
    ) {
        // Build old state index: path → (old_index, expanded)
        let old_state: HashMap<&str, (usize, bool)> = self
            .files
            .iter()
            .enumerate()
            .map(|(i, f)| (f.path.as_str(), (i, self.expanded.contains(&i))))
            .collect();

        // First poll result settles the loading state (BR-6/BR-7), even when
        // the content is unchanged (e.g. a clean tree: empty → empty).
        let was_loaded = self.loaded;
        self.loaded = true;

        // Check if anything actually changed
        let same_files = files.len() == self.files.len()
            && files.iter().enumerate().all(|(i, f)| {
                self.files.get(i).map_or(false, |old| {
                    old == f && self.diff_cache.get(&i) == diff_cache.get(&i)
                })
            });
        if same_files {
            // Content unchanged. Repaint once if we just left the loading state
            // so the renderer drops the "Loading…" row (cache is keyed on generation).
            if !was_loaded {
                self.generation = self.generation.wrapping_add(1);
            }
            return;
        }

        // Rebuild expanded set, preserving state for files that existed before
        let mut new_expanded = HashSet::new();
        for (i, f) in files.iter().enumerate() {
            if let Some(&(_, was_expanded)) = old_state.get(f.path.as_str()) {
                if was_expanded {
                    new_expanded.insert(i);
                }
            } else {
                // New file — expand by default
                new_expanded.insert(i);
            }
        }

        self.files = files;
        self.diff_cache = diff_cache;
        self.expanded = new_expanded;
        self.recompute_max_line_len();
        self.generation = self.generation.wrapping_add(1);
    }

    /// Recompute the cached longest content line across expanded diffs.
    /// Called whenever content or expansion changes; `max_line_len` reads the
    /// cached value so per-tick horizontal-scroll clamping stays O(1).
    fn recompute_max_line_len(&mut self) {
        let mut max = 0;
        for (i, _) in self.files.iter().enumerate() {
            if self.expanded.contains(&i) {
                if let Some(lines) = self.diff_cache.get(&i) {
                    for line in lines {
                        let len = match line {
                            DiffLine::Added(t)
                            | DiffLine::Removed(t)
                            | DiffLine::Header(t)
                            | DiffLine::Context(t) => t.chars().count(),
                        };
                        if len > max {
                            max = len;
                        }
                    }
                }
            }
        }
        self.cached_max_line_len = max;
    }

    /// Total lines for the diff pane (file entries + expanded diff lines).
    /// Includes 1 blank spacer row before each file header (except the first).
    pub fn total_lines(&self) -> usize {
        let mut count = 0;
        for (i, _) in self.files.iter().enumerate() {
            if i > 0 {
                count += 1;
            } // spacer before file header
            count += 1; // file entry
            if self.expanded.contains(&i) {
                if let Some(lines) = self.diff_cache.get(&i) {
                    if self.side_by_side {
                        count += pair_diff_lines(lines).len();
                    } else {
                        count += lines.len();
                    }
                }
            }
        }
        count
    }

    /// Longest content line length across all expanded diffs (cached; see
    /// `recompute_max_line_len`).
    pub fn max_line_len(&self) -> usize {
        self.cached_max_line_len
    }

    /// Given a visual row (relative to scroll), find which file index it
    /// corresponds to and whether it's a file header. If it's a header, toggle
    /// expand/collapse for that file.
    pub fn click_row(&mut self, visual_row: usize) {
        let target_row = self.scroll as usize + visual_row;
        let mut row_idx = 0usize;
        for (fi, _) in self.files.iter().enumerate() {
            // Spacer row before each file header (except the first)
            if fi > 0 {
                if row_idx == target_row {
                    return;
                } // clicked spacer — ignore
                row_idx += 1;
            }
            if row_idx == target_row {
                // Clicked on file header → toggle. Diff lines are pre-loaded by
                // the poller; if a cache entry is somehow missing the body just
                // renders empty (no synchronous git on the app thread).
                if self.expanded.contains(&fi) {
                    self.expanded.remove(&fi);
                } else {
                    self.expanded.insert(fi);
                }
                self.selected = Some(fi);
                self.recompute_max_line_len();
                self.generation = self.generation.wrapping_add(1);
                return;
            }
            row_idx += 1;
            if self.expanded.contains(&fi) {
                if let Some(lines) = self.diff_cache.get(&fi) {
                    let line_count = if self.side_by_side {
                        pair_diff_lines(lines).len()
                    } else {
                        lines.len()
                    };
                    row_idx += line_count;
                }
            }
        }
    }

    /// Check if a visual row (relative to scroll) is a file header row.
    pub fn is_file_header_row(&self, visual_row: usize) -> bool {
        let target_row = self.scroll as usize + visual_row;
        let mut row_idx = 0usize;
        for (fi, _) in self.files.iter().enumerate() {
            if fi > 0 {
                row_idx += 1;
            } // spacer
            if row_idx == target_row {
                return true;
            } // file header
            row_idx += 1;
            if self.expanded.contains(&fi) {
                if let Some(lines) = self.diff_cache.get(&fi) {
                    let line_count = if self.side_by_side {
                        pair_diff_lines(lines).len()
                    } else {
                        lines.len()
                    };
                    row_idx += line_count;
                }
            }
        }
        false
    }

    /// Find which file index a virtual row belongs to.
    pub fn file_index_at_row(&self, visual_row: usize) -> Option<usize> {
        let target_row = self.scroll as usize + visual_row;
        self.file_index_at_virtual_row(target_row)
    }

    fn file_index_at_virtual_row(&self, target_row: usize) -> Option<usize> {
        let mut row_idx = 0usize;
        for (fi, _) in self.files.iter().enumerate() {
            if fi > 0 {
                row_idx += 1;
            } // spacer
            let header_row = row_idx;
            row_idx += 1;
            if self.expanded.contains(&fi) {
                if let Some(lines) = self.diff_cache.get(&fi) {
                    let line_count = if self.side_by_side {
                        pair_diff_lines(lines).len()
                    } else {
                        lines.len()
                    };
                    if target_row >= header_row && target_row < row_idx + line_count {
                        return Some(fi);
                    }
                    row_idx += line_count;
                }
            } else if target_row == header_row {
                return Some(fi);
            }
        }
        None
    }

    pub fn file_index_for_selection(&self, selection: &crate::pane::Selection) -> Option<usize> {
        let (start, end) = if selection.anchor < selection.end {
            (selection.anchor, selection.end)
        } else {
            (selection.end, selection.anchor)
        };

        for row in start.0..=end.0 {
            if let Some(file_index) = self.file_index_at_virtual_row(row) {
                return Some(file_index);
            }
        }
        None
    }

    pub fn review_source_label(&self) -> String {
        let file_index = self
            .selection
            .as_ref()
            .and_then(|selection| self.file_index_for_selection(selection))
            .or(self.selected)
            .filter(|index| self.files.get(*index).is_some())
            .or_else(|| (self.files.len() == 1).then_some(0));

        if let Some(file) = file_index.and_then(|index| self.files.get(index)) {
            return self.cwd.join(&file.path).display().to_string();
        }

        if self.files.len() > 1 {
            format!("{} ({} files)", self.cwd.display(), self.files.len())
        } else {
            self.cwd.display().to_string()
        }
    }

    /// Get horizontal scroll for a specific file.
    fn h_scroll_for(&self, fi: usize) -> usize {
        self.h_scroll.get(&fi).copied().unwrap_or(0)
    }

    /// Build a flat list of text lines corresponding to virtual rows.
    /// Used for text selection and copy.
    pub(crate) fn flat_lines(&self) -> Vec<String> {
        let mut result = Vec::new();
        for (fi, file) in self.files.iter().enumerate() {
            if fi > 0 {
                result.push(String::new());
            } // spacer
              // File header
            let status_ch = match file.status.trim() {
                "M" | " M" => 'M',
                "D" | " D" => 'D',
                "A" => 'A',
                "??" => 'U',
                _ => '?',
            };
            result.push(format!("{} {}", status_ch, file.path));
            if self.expanded.contains(&fi) {
                if let Some(lines) = self.diff_cache.get(&fi) {
                    if self.side_by_side {
                        for pair in pair_diff_lines(lines) {
                            let left = match pair.left {
                                Some(DiffLine::Removed(t)) => format!("- {}", t),
                                Some(DiffLine::Context(t)) => format!("  {}", t),
                                Some(DiffLine::Header(t)) => t.clone(),
                                _ => String::new(),
                            };
                            let right = match pair.right {
                                Some(DiffLine::Added(t)) => format!("+ {}", t),
                                Some(DiffLine::Context(t)) => format!("  {}", t),
                                Some(DiffLine::Header(t)) => t.clone(),
                                _ => String::new(),
                            };
                            result.push(format!("{} | {}", left, right));
                        }
                    } else {
                        for line in lines {
                            let text = match line {
                                DiffLine::Added(t) => format!("+ {}", t),
                                DiffLine::Removed(t) => format!("- {}", t),
                                DiffLine::Header(t) => t.clone(),
                                DiffLine::Context(t) => format!("  {}", t),
                            };
                            result.push(text);
                        }
                    }
                }
            }
        }
        result
    }

    /// Extract selected text from the diff pane.
    pub fn selected_text(&self, sel: &crate::pane::Selection) -> String {
        let lines = self.flat_lines();
        let (start, end) = if sel.anchor < sel.end {
            (sel.anchor, sel.end)
        } else {
            (sel.end, sel.anchor)
        };
        let mut result = String::new();
        for row in start.0..=end.0 {
            if row >= lines.len() {
                break;
            }
            let line = &lines[row];
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

    /// Navigate to next/previous file header.
    pub fn move_selection(&mut self, delta: isize) {
        let count = self.files.len();
        if count == 0 {
            return;
        }
        let current = self.selected.unwrap_or(0) as isize;
        let next = (current + delta).clamp(0, count as isize - 1) as usize;
        self.selected = Some(next);
        self.generation = self.generation.wrapping_add(1);
    }

    /// Toggle expand/collapse of the currently selected file.
    pub fn toggle_selected(&mut self) {
        if let Some(fi) = self.selected {
            if self.expanded.contains(&fi) {
                self.expanded.remove(&fi);
            } else {
                self.expanded.insert(fi);
            }
            self.recompute_max_line_len();
            self.generation = self.generation.wrapping_add(1);
        }
    }

    /// Summary stats across all files.
    pub fn total_stats(&self) -> (usize, usize) {
        let add: usize = self.files.iter().map(|f| f.additions).sum();
        let del: usize = self.files.iter().map(|f| f.deletions).sum();
        (add, del)
    }

    /// Render the diff pane content into the grid layer.
    pub fn render_grid(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        text_color: Color,
        dimmed_color: Color,
        added_bg: Color,
        removed_bg: Color,
        added_gutter: Color,
        removed_gutter: Color,
        divider_color: Color,
    ) {
        let cell_size = renderer.cell_size();
        let visible_rows = (rect.height / cell_size.height).floor() as usize;
        let scroll = self.scroll as usize;

        // Until the first poll result arrives, render a loading state rather
        // than a (misleading) empty/clean tree. Diff content comes only from
        // the background git poller now (no synchronous git on the app thread).
        if !self.loaded {
            let dim_style = TextStyle {
                foreground: dimmed_color,
                background: None,
                bold: false,
                dim: true,
                italic: false,
                underline: false,
            };
            for (col, ch) in "Loading changes…".chars().enumerate() {
                renderer.draw_grid_cell(
                    ch,
                    0,
                    col,
                    dim_style,
                    cell_size,
                    Vec2::new(rect.x, rect.y),
                );
            }
            return;
        }

        let mut row_idx = 0usize; // global virtual row
        let mut vi = 0usize; // visual row being drawn

        for (fi, file) in self.files.iter().enumerate() {
            // Spacer row before each file header (except the first)
            if fi > 0 {
                if row_idx >= scroll && vi < visible_rows {
                    vi += 1; // blank row
                }
                row_idx += 1;
            }

            // File header row
            if row_idx >= scroll && vi < visible_rows {
                let y = rect.y + vi as f32 * cell_size.height;
                let is_expanded = self.expanded.contains(&fi);
                let is_selected = self.selected == Some(fi);

                // File header background — visually distinct from diff content
                let header_bg = Color::new(1.0, 1.0, 1.0, if is_selected { 0.12 } else { 0.06 });
                renderer.draw_grid_rect(
                    Rect::new(rect.x, y, rect.width, cell_size.height),
                    header_bg,
                );
                // Bottom border to separate header from diff content
                let border_y = y + cell_size.height - 1.0;
                renderer
                    .draw_grid_rect(Rect::new(rect.x, border_y, rect.width, 1.0), divider_color);

                let max_cols = (rect.width / cell_size.width).floor() as usize;
                let mut col = 0usize;

                // Expand indicator: simple arrow
                let arrow = if is_expanded { '▾' } else { '▸' };
                let dim_style = TextStyle {
                    foreground: dimmed_color,
                    background: None,
                    bold: false,
                    dim: false,
                    italic: false,
                    underline: false,
                };
                renderer.draw_grid_cell(
                    arrow,
                    vi,
                    col,
                    dim_style,
                    cell_size,
                    Vec2::new(rect.x, rect.y),
                );
                col += 2; // arrow + space

                // Status letter (colored, no brackets)
                let status_str = file.status.trim();
                let status_color = match status_str {
                    "M" | " M" => added_gutter,
                    "D" | " D" => removed_gutter,
                    "A" | "??" => added_gutter,
                    _ => text_color,
                };
                let status_ch = match status_str {
                    "M" | " M" => 'M',
                    "D" | " D" => 'D',
                    "A" => 'A',
                    "??" => 'U',
                    _ => '?',
                };
                let status_style = TextStyle {
                    foreground: status_color,
                    background: None,
                    bold: true,
                    dim: false,
                    italic: false,
                    underline: false,
                };
                renderer.draw_grid_cell(
                    status_ch,
                    vi,
                    col,
                    status_style,
                    cell_size,
                    Vec2::new(rect.x, rect.y),
                );
                col += 2; // status + space

                // File path: directory/ dimmed, filename bold
                let (dir_part, file_part) = if let Some(pos) = file.path.rfind('/') {
                    (&file.path[..=pos], &file.path[pos + 1..])
                } else {
                    ("", file.path.as_str())
                };
                let dir_style = TextStyle {
                    foreground: dimmed_color,
                    background: None,
                    bold: false,
                    dim: true,
                    italic: false,
                    underline: false,
                };
                let file_style = TextStyle {
                    foreground: text_color,
                    background: None,
                    bold: true,
                    dim: false,
                    italic: false,
                    underline: false,
                };
                // Build stats string early so we know how much space to reserve
                let stats_str = if file.additions > 0 || file.deletions > 0 {
                    format!("+{}  -{}", file.additions, file.deletions)
                } else {
                    String::new()
                };
                let stats_reserve = stats_str.chars().count() + 2;
                let path_max = max_cols.saturating_sub(col + stats_reserve);
                for (ci, ch) in dir_part.chars().enumerate() {
                    if ci >= path_max {
                        break;
                    }
                    renderer.draw_grid_cell(
                        ch,
                        vi,
                        col + ci,
                        dir_style,
                        cell_size,
                        Vec2::new(rect.x, rect.y),
                    );
                }
                let file_col = col + dir_part.chars().count();
                for (ci, ch) in file_part.chars().enumerate() {
                    if dir_part.chars().count() + ci >= path_max {
                        break;
                    }
                    renderer.draw_grid_cell(
                        ch,
                        vi,
                        file_col + ci,
                        file_style,
                        cell_size,
                        Vec2::new(rect.x, rect.y),
                    );
                }

                // Stats at end: +N  -N
                if !stats_str.is_empty() {
                    let stats_chars: Vec<char> = stats_str.chars().collect();
                    let start_col = max_cols.saturating_sub(stats_chars.len() + 1);
                    let dash_pos = stats_str.find('-').unwrap_or(stats_str.len());
                    for (ci, &ch) in stats_chars.iter().enumerate() {
                        let color = if ci < dash_pos {
                            added_gutter
                        } else {
                            removed_gutter
                        };
                        let stat_style = TextStyle {
                            foreground: color,
                            background: None,
                            bold: false,
                            dim: false,
                            italic: false,
                            underline: false,
                        };
                        renderer.draw_grid_cell(
                            ch,
                            vi,
                            start_col + ci,
                            stat_style,
                            cell_size,
                            Vec2::new(rect.x, rect.y),
                        );
                    }
                }

                vi += 1;
            } else if row_idx >= scroll {
                // past visible area
            }
            row_idx += 1;

            // Expanded diff lines
            if self.expanded.contains(&fi) {
                let file_h_scroll = self.h_scroll_for(fi);
                if let Some(lines) = self.diff_cache.get(&fi) {
                    if self.side_by_side {
                        // --- Side-by-side rendering ---
                        let half_w = (rect.width - 1.0) / 2.0;
                        let right_x = rect.x + half_w + 1.0;
                        let half_cols = (half_w / cell_size.width).floor() as usize;
                        let left_origin = Vec2::new(rect.x, rect.y);
                        let right_origin = Vec2::new(right_x, rect.y);

                        let pairs = pair_diff_lines(lines);
                        for pair in &pairs {
                            if row_idx >= scroll && vi < visible_rows {
                                let y = rect.y + vi as f32 * cell_size.height;

                                // Left pane (context / removed / header)
                                if let Some(line) = pair.left {
                                    let (text, fg, bg, gutter_ch, is_dim) = match line {
                                        DiffLine::Removed(t) => (
                                            t.as_str(),
                                            removed_gutter,
                                            Some(removed_bg),
                                            '-',
                                            false,
                                        ),
                                        DiffLine::Header(t) => {
                                            (t.as_str(), dimmed_color, None, '@', false)
                                        }
                                        DiffLine::Context(t) => {
                                            (t.as_str(), dimmed_color, None, ' ', true)
                                        }
                                        DiffLine::Added(_) => ("", dimmed_color, None, ' ', true),
                                    };
                                    if let Some(bg_color) = bg {
                                        renderer.draw_grid_rect(
                                            Rect::new(rect.x, y, half_w, cell_size.height),
                                            bg_color,
                                        );
                                    }
                                    let style = TextStyle {
                                        foreground: fg,
                                        background: None,
                                        bold: false,
                                        dim: is_dim,
                                        italic: false,
                                        underline: false,
                                    };
                                    renderer.draw_grid_cell(
                                        gutter_ch,
                                        vi,
                                        1,
                                        style,
                                        cell_size,
                                        left_origin,
                                    );
                                    for (ci, ch) in text
                                        .chars()
                                        .skip(file_h_scroll)
                                        .enumerate()
                                        .take(half_cols.saturating_sub(3))
                                    {
                                        if ch != ' ' && ch != '\t' {
                                            renderer.draw_grid_cell(
                                                ch,
                                                vi,
                                                3 + ci,
                                                style,
                                                cell_size,
                                                left_origin,
                                            );
                                        }
                                    }
                                }

                                // Right pane (context / added / header)
                                if let Some(line) = pair.right {
                                    let (text, fg, bg, gutter_ch, is_dim) = match line {
                                        DiffLine::Added(t) => {
                                            (t.as_str(), added_gutter, Some(added_bg), '+', false)
                                        }
                                        DiffLine::Header(t) => {
                                            (t.as_str(), dimmed_color, None, '@', false)
                                        }
                                        DiffLine::Context(t) => {
                                            (t.as_str(), dimmed_color, None, ' ', true)
                                        }
                                        DiffLine::Removed(_) => ("", dimmed_color, None, ' ', true),
                                    };
                                    if let Some(bg_color) = bg {
                                        renderer.draw_grid_rect(
                                            Rect::new(right_x, y, half_w, cell_size.height),
                                            bg_color,
                                        );
                                    }
                                    let style = TextStyle {
                                        foreground: fg,
                                        background: None,
                                        bold: false,
                                        dim: is_dim,
                                        italic: false,
                                        underline: false,
                                    };
                                    renderer.draw_grid_cell(
                                        gutter_ch,
                                        vi,
                                        1,
                                        style,
                                        cell_size,
                                        right_origin,
                                    );
                                    for (ci, ch) in text
                                        .chars()
                                        .skip(file_h_scroll)
                                        .enumerate()
                                        .take(half_cols.saturating_sub(3))
                                    {
                                        if ch != ' ' && ch != '\t' {
                                            renderer.draw_grid_cell(
                                                ch,
                                                vi,
                                                3 + ci,
                                                style,
                                                cell_size,
                                                right_origin,
                                            );
                                        }
                                    }
                                }

                                vi += 1;
                            }
                            row_idx += 1;
                        }
                    } else {
                        // --- Unified rendering ---
                        for line in lines {
                            if row_idx >= scroll && vi < visible_rows {
                                let y = rect.y + vi as f32 * cell_size.height;
                                let (text, fg, bg) = match line {
                                    DiffLine::Added(t) => {
                                        (t.as_str(), added_gutter, Some(added_bg))
                                    }
                                    DiffLine::Removed(t) => {
                                        (t.as_str(), removed_gutter, Some(removed_bg))
                                    }
                                    DiffLine::Header(t) => (t.as_str(), dimmed_color, None),
                                    DiffLine::Context(t) => (t.as_str(), dimmed_color, None),
                                };

                                if let Some(bg_color) = bg {
                                    renderer.draw_grid_rect(
                                        Rect::new(rect.x, y, rect.width, cell_size.height),
                                        bg_color,
                                    );
                                }

                                let gutter_ch = match line {
                                    DiffLine::Added(_) => '+',
                                    DiffLine::Removed(_) => '-',
                                    DiffLine::Header(_) => '@',
                                    DiffLine::Context(_) => ' ',
                                };
                                let gutter_style = TextStyle {
                                    foreground: fg,
                                    background: None,
                                    bold: false,
                                    dim: false,
                                    italic: false,
                                    underline: false,
                                };
                                renderer.draw_grid_cell(
                                    gutter_ch,
                                    vi,
                                    2,
                                    gutter_style,
                                    cell_size,
                                    Vec2::new(rect.x, rect.y),
                                );

                                let content_style = TextStyle {
                                    foreground: fg,
                                    background: None,
                                    bold: false,
                                    dim: matches!(line, DiffLine::Context(_)),
                                    italic: false,
                                    underline: false,
                                };
                                let max_cols = (rect.width / cell_size.width).floor() as usize;
                                for (ci, ch) in text
                                    .chars()
                                    .skip(file_h_scroll)
                                    .enumerate()
                                    .take(max_cols.saturating_sub(4))
                                {
                                    if ch != ' ' && ch != '\t' {
                                        renderer.draw_grid_cell(
                                            ch,
                                            vi,
                                            4 + ci,
                                            content_style,
                                            cell_size,
                                            Vec2::new(rect.x, rect.y),
                                        );
                                    }
                                }

                                vi += 1;
                            }
                            row_idx += 1;
                        }
                    }
                }
            }
        }

        // Draw full-height divider for side-by-side mode
        if self.side_by_side {
            let half_w = (rect.width - 1.0) / 2.0;
            renderer.draw_grid_rect(
                Rect::new(rect.x + half_w, rect.y, 1.0, rect.height),
                divider_color,
            );
        }
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }
}
