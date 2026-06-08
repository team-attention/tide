use std::path::PathBuf;

use crate::tide_core::{TerminalBackend, Vec2};

use crate::pane::PaneKind;
use crate::theme::*;
use crate::App;
use crate::AppCorePort;

impl crate::TextExtractPort for App {
    /// Try to extract a URL from the terminal grid at the given click position.
    /// Checks if the click is within a detected URL range and extracts the URL string.
    fn extract_url_at(&self, pane_id: crate::tide_core::PaneId, position: Vec2) -> Option<String> {
        match self.panes.get(&pane_id) {
            Some(PaneKind::Terminal(pane)) => {
                let (_, visual_rect) = self
                    .visual_pane_rects
                    .iter()
                    .find(|(id, _)| *id == pane_id)?;
                let cell_size = self.cell_size();

                let content_top = terminal_content_top(cell_size.height);
                let inner = crate::pane::pane_content_rect(*visual_rect, content_top);
                let origin = crate::pane::terminal_grid_origin(inner);

                let col = ((position.x - origin.x) / cell_size.width).floor() as isize;
                let row = ((position.y - origin.y) / cell_size.height).floor() as isize;
                if row < 0 || col < 0 {
                    return None;
                }

                Self::extract_wrapped_terminal_url(&pane.backend, row as usize, col as usize)
            }
            // Editor Panes have no clickable-URL extraction (LivePreviewMode,
            // which provided it, was removed).
            Some(PaneKind::Editor(_)) => None,
            _ => None,
        }
    }

    /// Try to extract a file path from the terminal grid at the given click position.
    /// Scans the clicked row for path-like text and resolves against the terminal's CWD.
    /// Returns the resolved path and an optional line number (from `:42` suffix).
    fn extract_file_path_at(
        &self,
        pane_id: crate::tide_core::PaneId,
        position: Vec2,
    ) -> Option<(PathBuf, Option<usize>)> {
        let pane = match self.panes.get(&pane_id) {
            Some(PaneKind::Terminal(p)) => p,
            _ => return None,
        };

        let (_, visual_rect) = self
            .visual_pane_rects
            .iter()
            .find(|(id, _)| *id == pane_id)?;
        let cell_size = self.cell_size();

        let content_top = terminal_content_top(cell_size.height);
        let inner = crate::pane::pane_content_rect(*visual_rect, content_top);
        let origin = crate::pane::terminal_grid_origin(inner);

        let col = ((position.x - origin.x) / cell_size.width).floor() as isize;
        let row = ((position.y - origin.y) / cell_size.height).floor() as isize;
        if row < 0 || col < 0 {
            return None;
        }

        let grid = pane.backend.grid();
        if row as usize >= grid.cells.len() {
            return None;
        }
        let line = &grid.cells[row as usize];

        // Build the full text of the row
        let row_text: String = line.iter().map(|c| c.character).collect();
        let row_text = row_text.trim_end();

        if row_text.is_empty() {
            return None;
        }

        // Find the word/path segment under the cursor.
        // Expand left and right from the click column to find path-like characters.
        let chars: Vec<char> = row_text.chars().collect();
        if col as usize >= chars.len() {
            return None;
        }
        let col = col as usize;

        let is_path_char = |c: char| -> bool {
            c.is_alphanumeric() || matches!(c, '/' | '\\' | '.' | '-' | '_' | '~')
        };

        let mut start = col;
        while start > 0 && is_path_char(chars[start - 1]) {
            start -= 1;
        }
        let mut end = col;
        while end < chars.len() && is_path_char(chars[end]) {
            end += 1;
        }

        // Capture :line_number suffix (e.g., "file.rs:42")
        if end < chars.len() && chars[end] == ':' {
            let mut probe = end + 1;
            while probe < chars.len() && chars[probe].is_ascii_digit() {
                probe += 1;
            }
            if probe > end + 1 {
                end = probe;
            }
        }

        let segment: String = chars[start..end].iter().collect();
        let mut parts = segment.splitn(3, ':');
        let path_str = parts.next().unwrap_or("");
        let line_number: Option<usize> = parts.next().and_then(|s| s.parse().ok());

        if path_str.is_empty() || !path_str.contains('.') && !path_str.contains('/') {
            return None;
        }

        let path = std::path::Path::new(path_str);

        // If relative, resolve against terminal CWD
        let cwd = pane.backend.detect_cwd_fallback();
        let resolved = if path.is_absolute() {
            path.to_path_buf()
        } else if let Some(ref cwd) = cwd {
            cwd.join(path)
        } else {
            return None;
        };

        // Return if the file exists at the resolved path
        if resolved.is_file() {
            return Some((resolved, line_number));
        }

        // If not found directly, search the project tree recursively
        if let Some(found) = self.find_file_in_project(pane_id, path_str) {
            return Some((found, line_number));
        }

        None
    }
}

impl App {
    fn extract_wrapped_terminal_url(
        terminal: &crate::tide_terminal::Terminal,
        row: usize,
        col: usize,
    ) -> Option<String> {
        let grid = terminal.grid();
        if row >= grid.cells.len() {
            return None;
        }

        let wrapped_bounds = Self::wrapped_cluster_bounds(terminal, grid.cells.len(), row);
        let mut logical_text = String::new();
        let mut row_offsets = Vec::new();

        for screen_row in wrapped_bounds.0..=wrapped_bounds.1 {
            let row_text = Self::terminal_row_text(&grid.cells[screen_row]);
            let logical_start = logical_text.chars().count();
            let row_char_len = row_text.chars().count();
            logical_text.push_str(&row_text);
            row_offsets.push((screen_row, logical_start, row_char_len));
        }

        let (_, logical_start, row_char_len) = row_offsets
            .iter()
            .find(|(screen_row, _, _)| *screen_row == row)
            .copied()?;
        if col >= row_char_len {
            return None;
        }
        let logical_col = logical_start + col;

        let re = crate::tide_terminal::terminal_url_regex();

        for matched in re.find_iter(&logical_text) {
            let url = crate::tide_terminal::trim_url_trailing(matched.as_str());
            let start_col = logical_text[..matched.start()].chars().count();
            let end_col = start_col + url.chars().count();
            if logical_col >= start_col && logical_col < end_col {
                return Some(url.to_string());
            }
        }

        None
    }

    fn wrapped_cluster_bounds(
        terminal: &crate::tide_terminal::Terminal,
        row_count: usize,
        row: usize,
    ) -> (usize, usize) {
        let mut start = row;
        while start > 0 && terminal.visible_row_is_wrapped(start - 1) {
            start -= 1;
        }

        let mut end = row;
        while end + 1 < row_count && terminal.visible_row_is_wrapped(end) {
            end += 1;
        }

        (start, end)
    }

    fn terminal_row_text(line: &[crate::tide_core::TerminalCell]) -> String {
        let mut row_text: String = line
            .iter()
            .map(|cell| {
                if cell.character == '\0' {
                    ' '
                } else {
                    cell.character
                }
            })
            .collect();
        let trimmed_len = row_text.trim_end_matches(' ').len();
        row_text.truncate(trimmed_len);
        row_text
    }

    /// Search for a file by name/relative-path in the project root directory.
    fn find_file_in_project(
        &self,
        pane_id: crate::tide_core::PaneId,
        filename: &str,
    ) -> Option<PathBuf> {
        let pane = match self.panes.get(&pane_id) {
            Some(PaneKind::Terminal(p)) => p,
            _ => return None,
        };
        let cwd = pane.backend.detect_cwd_fallback()?;
        let root = self.bg.cached_repo_roots.get(&cwd)?.as_ref()?;
        Self::find_file_recursive(root, filename, 10)
    }

    /// Recursively search for a target file under `dir`, up to `max_depth`.
    /// If `target` contains `/`, match as a relative path suffix; otherwise match filename only.
    fn find_file_recursive(
        dir: &std::path::Path,
        target: &str,
        max_depth: usize,
    ) -> Option<PathBuf> {
        if max_depth == 0 {
            return None;
        }
        let has_slash = target.contains('/');
        let read_dir = std::fs::read_dir(dir).ok()?;
        let mut subdirs: Vec<PathBuf> = Vec::new();
        for entry in read_dir.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name_str = name.to_string_lossy();

            // Skip hidden and common ignored directories
            if name_str.starts_with('.')
                || name_str == "node_modules"
                || name_str == "target"
                || name_str == "__pycache__"
            {
                continue;
            }

            if path.is_dir() {
                subdirs.push(path);
            } else if path.is_file() {
                if has_slash {
                    // Match as relative path suffix
                    if let Some(s) = path.to_str() {
                        if s.ends_with(target) {
                            let prefix_end = s.len() - target.len();
                            if prefix_end == 0 || s.as_bytes()[prefix_end - 1] == b'/' {
                                return Some(path);
                            }
                        }
                    }
                } else if name_str == target {
                    return Some(path);
                }
            }
        }
        for subdir in subdirs {
            if let Some(found) = Self::find_file_recursive(&subdir, target, max_depth - 1) {
                return Some(found);
            }
        }
        None
    }
}

