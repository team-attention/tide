// Pane types: Terminal, Editor, Browser, Diff, Launcher.

pub(crate) mod browser;
pub(crate) mod browser_bridge;
pub(crate) mod diff;
pub(crate) mod editor;

use std::path::PathBuf;

use unicode_width::UnicodeWidthChar;

use crate::tide_core::{
    Color, CursorShape, Key, Modifiers, Rect, Renderer, Size, TerminalBackend, TerminalGraphicProtocol,
    TerminalGrid, Vec2,
};
use crate::tide_renderer::WgpuRenderer;
use crate::tide_terminal::git::GitInfo;
use crate::tide_terminal::Terminal;

use crate::state::search::SearchState;
use crate::state::ViewMode;
use crate::theme::PANE_PADDING;
use browser::BrowserPane;
use diff::DiffPane;
use editor::EditorPane;

pub type PaneId = crate::tide_core::PaneId;

pub(crate) fn pane_content_rect(pane_rect: Rect, content_top_offset: f32) -> Rect {
    Rect::new(
        pane_rect.x + PANE_PADDING,
        pane_rect.y + content_top_offset,
        pane_rect.width - 2.0 * PANE_PADDING,
        (pane_rect.height - content_top_offset - PANE_PADDING).max(1.0),
    )
}

pub(crate) fn terminal_grid_origin(content_rect: Rect) -> Vec2 {
    Vec2::new(content_rect.x, content_rect.y)
}

pub(crate) fn terminal_grid_cols(content_rect: Rect, cell_size: Size) -> usize {
    (content_rect.width / cell_size.width).floor().max(0.0) as usize
}

const MIN_READABLE_TERMINAL_BACKEND_COLS: u16 = 4;

/// Polymorphic pane: terminal, editor, diff viewer, embedded browser, or launcher.
pub enum PaneKind {
    Terminal(TerminalPane),
    Editor(EditorPane),
    Diff(DiffPane),
    Browser(BrowserPane),
    /// Launcher: type-selection screen. Press T/E/O/B to create a pane.
    Launcher(PaneId),
}

/// Text selection state (anchor = drag start, end = current position).
#[derive(Debug, Clone)]
pub struct Selection {
    pub anchor: (usize, usize), // (row, col)
    pub end: (usize, usize),    // (row, col)
}

/// Lightweight terminal context: cached state that can outlive the PTY process.
/// Separated from the heavy backend so it can be retained after terminal close.
#[derive(Clone)]
pub struct TerminalContext {
    /// Cached CWD for header badge display (updated periodically).
    pub cwd: Option<PathBuf>,
    /// Cached git info for header badge display (updated periodically).
    pub git_info: Option<GitInfo>,
    /// Whether the shell is idle (no foreground process).
    pub shell_idle: bool,
    /// Cached worktree count for badge display (updated periodically).
    pub worktree_count: usize,
    /// Cached current worktree metadata for close-path decisions.
    pub current_worktree: Option<crate::tide_terminal::git::WorktreeInfo>,
    /// Whether the child shell process has died.
    pub child_dead: bool,
    /// Program-set title from OSC 0/2. `None` = no program title (use default).
    pub osc_title: Option<String>,
}

impl Default for TerminalContext {
    fn default() -> Self {
        Self {
            cwd: None,
            git_info: None,
            shell_idle: true,
            worktree_count: 0,
            current_worktree: None,
            child_dead: false,
            osc_title: None,
        }
    }
}

fn terminal_selection_row_fills_width(
    line: &[crate::tide_core::TerminalCell],
    selected_col_end: usize,
) -> bool {
    if selected_col_end < line.len() {
        return false;
    }

    line.iter()
        .rposition(|cell| cell.character != ' ')
        .is_some_and(|last_used_col| last_used_col >= line.len().saturating_sub(2))
}

fn terminal_selection_row_starts_new_block(trimmed: &str) -> bool {
    trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
        || trimmed.starts_with("+ ")
        || trimmed.starts_with("> ")
        || trimmed.starts_with('#')
        || trimmed.starts_with("```")
        || trimmed.chars().next().is_some_and(|ch| ch.is_ascii_digit())
            && trimmed
                .chars()
                .skip_while(|ch| ch.is_ascii_digit())
                .next()
                .is_some_and(|ch| ch == '.' || ch == ')')
}

pub struct TerminalPane {
    #[allow(dead_code)]
    pub id: PaneId,
    pub backend: Terminal,
    pub selection: Option<Selection>,
    pub search: Option<SearchState>,
    /// Suppress cursor rendering for N frames after creation to avoid flicker
    /// while the shell re-renders its prompt after SIGWINCH resize.
    pub cursor_suppress: u8,
    /// Cached terminal context (cwd, git info, shell state).
    pub context: TerminalContext,
    /// Panes bound to this terminal, displayed in the Terminal Context Surface.
    /// Split view renders this SplitLayout; Stacked view renders one active pane.
    pub dock_layout: crate::tide_layout::SplitLayout,
    /// Presentation mode for this Terminal's Terminal Context Surface.
    pub dock_view_mode: ViewMode,
    /// Last focused pane in this terminal's Dock.
    pub dock_focused: Option<PaneId>,
}

impl TerminalPane {
    /// Construct a terminal pane with no agent-integration env (tests / simple
    /// cases). Use `with_cwd_for_window` with a spawn config for integration.
    pub fn with_cwd(
        id: PaneId,
        cols: u16,
        rows: u16,
        cwd: Option<std::path::PathBuf>,
        dark_mode: bool,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        Self::with_cwd_for_window(
            id,
            cols,
            rows,
            cwd,
            dark_mode,
            crate::tide_core::TideWindowId::default(),
            None,
            None,
        )
    }

    pub fn with_cwd_for_window(
        id: PaneId,
        cols: u16,
        rows: u16,
        cwd: Option<std::path::PathBuf>,
        dark_mode: bool,
        tide_window_id: crate::tide_core::TideWindowId,
        workspace_name: Option<&str>,
        spawn_config: Option<&crate::tide_terminal::TerminalSpawnConfig>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let backend = Terminal::with_cwd_for_window(
            cols,
            rows,
            cwd,
            dark_mode,
            Some(id),
            Some(tide_window_id),
            workspace_name,
            spawn_config,
        )?;
        Ok(Self {
            id,
            backend,
            selection: None,
            search: None,
            cursor_suppress: 3,
            context: TerminalContext::default(),
            dock_layout: crate::tide_layout::SplitLayout::new(),
            dock_view_mode: ViewMode::Stacked,
            dock_focused: None,
        })
    }

    /// Create a TerminalPane from a pre-existing Terminal backend.
    /// Used for early PTY spawn: the terminal was created before GPU init
    /// so the shell starts loading in parallel with GPU initialization.
    pub fn with_terminal(id: PaneId, backend: Terminal) -> Self {
        Self {
            id,
            backend,
            selection: None,
            search: None,
            cursor_suppress: 3,
            context: TerminalContext::default(),
            dock_layout: crate::tide_layout::SplitLayout::new(),
            dock_view_mode: ViewMode::Stacked,
            dock_focused: None,
        }
    }

    /// Extract selected text from the terminal grid.
    /// Selection coords are absolute (accounting for scrollback history).
    /// grid.cells is screen-relative, so we convert before indexing.
    pub fn selected_text(&self, sel: &Selection) -> String {
        let grid = self.backend.grid();
        let (start, end) = if sel.anchor < sel.end {
            (sel.anchor, sel.end)
        } else {
            (sel.end, sel.anchor)
        };

        // Convert absolute row to screen-relative row
        let history_size = self.backend.history_size();
        let display_offset = self.backend.display_offset();
        let visible_start = history_size.saturating_sub(display_offset);
        let visible_end = visible_start + grid.cells.len();

        let mut logical_lines = Vec::new();
        let mut current_line = String::new();
        let mut saw_visible_row = false;
        for row in start.0..=end.0 {
            let Some((line, row_is_wrapped)) =
                self.selected_terminal_row(row, visible_start, visible_end, grid)
            else {
                continue;
            };
            saw_visible_row = true;
            let col_start = if row == start.0 { start.1 } else { 0 };
            let col_end = if row == end.0 {
                end.1.min(line.len())
            } else {
                line.len()
            };
            let mut line_text = String::new();
            for col in col_start..col_end {
                if col < line.len() {
                    let ch = line[col].character;
                    if ch != '\0' {
                        line_text.push(ch);
                    }
                }
            }
            let trimmed_len = line_text.trim_end_matches(' ').len();
            line_text.truncate(trimmed_len);
            current_line.push_str(&line_text);
            if row != end.0 {
                let application_reflow_continuation =
                    terminal_selection_row_fills_width(&line, col_end)
                        && self.selected_next_terminal_row_is_continuation(
                            row,
                            end.0,
                            end.1,
                            visible_start,
                            visible_end,
                            grid,
                        );
                if !row_is_wrapped && !application_reflow_continuation {
                    logical_lines.push(current_line);
                    current_line = String::new();
                }
            }
        }
        if saw_visible_row {
            logical_lines.push(current_line);
        }

        let non_empty_lines: Vec<&mut String> = logical_lines
            .iter_mut()
            .filter(|line| !line.is_empty())
            .collect();

        if non_empty_lines.len() > 1 {
            let common_blank_margin = non_empty_lines
                .iter()
                .map(|line| line.chars().take_while(|&ch| ch == ' ').count())
                .min()
                .unwrap_or(0);

            if common_blank_margin > 0 {
                for line in non_empty_lines {
                    line.drain(..common_blank_margin);
                }
            }
        }

        logical_lines.join("\n")
    }

    fn selected_terminal_row(
        &self,
        row: usize,
        visible_start: usize,
        visible_end: usize,
        grid: &TerminalGrid,
    ) -> Option<(Vec<crate::tide_core::TerminalCell>, bool)> {
        if row >= visible_start && row < visible_end {
            let screen_row = row - visible_start;
            return grid
                .cells
                .get(screen_row)
                .cloned()
                .map(|cells| (cells, self.backend.visible_row_is_wrapped(screen_row)));
        }

        let cells = self.backend.buffer_row_cells(row)?;
        let wrapped = self.backend.buffer_row_is_wrapped(row);
        Some((cells, wrapped))
    }

    fn selected_next_terminal_row_is_continuation(
        &self,
        row: usize,
        selection_end_row: usize,
        selection_end_col: usize,
        visible_start: usize,
        visible_end: usize,
        grid: &TerminalGrid,
    ) -> bool {
        let next_row = row + 1;
        if next_row > selection_end_row {
            return false;
        }

        let Some((line, _)) =
            self.selected_terminal_row(next_row, visible_start, visible_end, grid)
        else {
            return false;
        };
        let col_end = if next_row == selection_end_row {
            selection_end_col.min(line.len())
        } else {
            line.len()
        };
        let mut text = String::new();
        for col in 0..col_end {
            let ch = line[col].character;
            if ch != '\0' {
                text.push(ch);
            }
        }
        let trimmed = text.trim_start();
        !trimmed.is_empty() && !terminal_selection_row_starts_new_block(trimmed)
    }

    /// Render the grid cells into the cached grid layer.
    pub fn render_grid(&self, rect: Rect, renderer: &mut WgpuRenderer) {
        let cell_size = renderer.cell_size();
        let grid = self.backend.grid();

        let max_cols = terminal_grid_cols(rect, cell_size);
        let offset = terminal_grid_origin(rect);

        // Clamp to the number of rows/cols that fit within the pane rect
        let max_rows = (rect.height / cell_size.height).ceil() as usize;
        let rows = (grid.rows as usize).min(max_rows).min(grid.cells.len());
        let cols = (grid.cols as usize).min(max_cols);

        for row in 0..rows {
            renderer.draw_grid_row(&grid.cells[row], row, cols, cell_size, offset);
        }
    }

    pub fn render_graphics(&self, rect: Rect, renderer: &mut WgpuRenderer) {
        let cell_size = renderer.cell_size();
        let offset = terminal_grid_origin(rect);

        for graphic in self.backend.graphics() {
            if !matches!(
                graphic.protocol,
                TerminalGraphicProtocol::Kitty | TerminalGraphicProtocol::Sixel
            ) {
                continue;
            }
            let rect = Rect::new(
                offset.x + graphic.col as f32 * cell_size.width,
                offset.y + graphic.row as f32 * cell_size.height,
                graphic.width_cells as f32 * cell_size.width,
                graphic.height_cells as f32 * cell_size.height,
            );
            renderer.draw_terminal_image(graphic.key, &graphic.bytes, rect);
        }
    }

    /// Render URL underlines when Cmd/Meta is held.
    pub fn render_url_underlines(
        &self,
        rect: Rect,
        renderer: &mut WgpuRenderer,
        link_color: Color,
    ) {
        let cell_size = renderer.cell_size();
        let url_ranges = self.backend.url_ranges();
        let hyperlink_ranges = self.backend.hyperlink_ranges();

        let max_cols = terminal_grid_cols(rect, cell_size);
        let offset = terminal_grid_origin(rect);

        let max_rows = (rect.height / cell_size.height).ceil() as usize;

        for (row, ranges) in hyperlink_ranges.iter().enumerate() {
            if row >= max_rows {
                break;
            }
            for &(start_col, end_col, _) in ranges {
                let clamped_end = end_col.min(max_cols);
                if start_col >= max_cols {
                    continue;
                }
                let x = offset.x + start_col as f32 * cell_size.width;
                let y = offset.y + (row as f32 + 1.0) * cell_size.height - 1.0;
                let w = (clamped_end - start_col) as f32 * cell_size.width;
                renderer.draw_rect(Rect::new(x, y, w, 1.0), link_color);
            }
        }

        for (row, ranges) in url_ranges.iter().enumerate() {
            if row >= max_rows {
                break;
            }
            for &(start_col, end_col) in ranges {
                let clamped_end = end_col.min(max_cols);
                if start_col >= max_cols {
                    continue;
                }
                let x = offset.x + start_col as f32 * cell_size.width;
                let y = offset.y + (row as f32 + 1.0) * cell_size.height - 1.0;
                let w = (clamped_end - start_col) as f32 * cell_size.width;
                renderer.draw_rect(Rect::new(x, y, w, 1.0), link_color);
            }
        }
    }

    /// Render the cursor into the overlay layer (always redrawn).
    pub fn render_cursor(&self, rect: Rect, renderer: &mut WgpuRenderer, cursor_color: Color) {
        if self.cursor_suppress > 0 {
            return;
        }
        let cell_size = renderer.cell_size();
        let cursor = self.backend.cursor();
        // Hide cursor when scrolled into history (cursor is at the prompt below viewport)
        if self.backend.display_offset() != 0 {
            return;
        }

        let offset = terminal_grid_origin(rect);
        let cx = offset.x + cursor.col as f32 * cell_size.width;
        let cy = rect.y + cursor.row as f32 * cell_size.height;

        // Skip rendering if cursor is outside the visible pane rect
        if cy + cell_size.height > rect.y + rect.height
            || cy < rect.y
            || cx + cell_size.width > rect.x + rect.width
            || cx < rect.x
        {
            return;
        }

        match cursor.shape {
            CursorShape::Block => {
                // Always render block cursor — TUI apps (like Claude Code / Ink) hide
                // the terminal cursor and draw their own, but Tide's block cursor overlay
                // provides consistent visibility.  It is suppressed during IME preedit
                // in the caller (rendering.rs) instead.

                // Check if the character under the cursor is wide (e.g. Korean, CJK)
                let grid = self.backend.grid();
                let row = cursor.row as usize;
                let col = cursor.col as usize;
                let char_width = if row < grid.cells.len() && col < grid.cells[row].len() {
                    let ch = grid.cells[row][col].character;
                    ch.width().unwrap_or(1)
                } else {
                    1
                };
                let cursor_w = char_width as f32 * cell_size.width;

                renderer.draw_top_rect(Rect::new(cx, cy, cursor_w, cell_size.height), cursor_color);

                // Draw the character under the cursor in inverse color
                if row < grid.cells.len() && col < grid.cells[row].len() {
                    let cell = &grid.cells[row][col];
                    if cell.character != ' ' && cell.character != '\0' {
                        // Pick inverse text color based on cursor brightness
                        let lum = cursor_color.r * 0.299
                            + cursor_color.g * 0.587
                            + cursor_color.b * 0.114;
                        let inv_color = if lum > 0.5 {
                            Color::rgb(0.0, 0.0, 0.0)
                        } else {
                            Color::rgb(1.0, 1.0, 1.0)
                        };
                        renderer.draw_top_glyph(
                            cell.character,
                            Vec2::new(cx, cy),
                            inv_color,
                            cell.style.bold,
                            cell.style.italic,
                        );
                    }
                }
            }
            CursorShape::Beam => {
                if cursor.visible {
                    renderer.draw_top_rect(Rect::new(cx, cy, 3.0, cell_size.height), cursor_color);
                }
            }
            CursorShape::Underline => {
                if cursor.visible {
                    renderer.draw_top_rect(
                        Rect::new(cx, cy + cell_size.height - 2.0, cell_size.width, 2.0),
                        cursor_color,
                    );
                }
            }
        }
    }

    pub fn handle_key(&mut self, key: &Key, modifiers: &Modifiers) {
        let bytes = self.backend.key_event_to_bytes(key, modifiers);
        if !bytes.is_empty() {
            // Scroll back to bottom on user input (applied atomically during next grid sync)
            if self.backend.display_offset() > 0 {
                self.backend.request_scroll_to_bottom();
            }
            self.backend.write(&bytes);
        }
    }

    pub fn scroll_display(&mut self, delta: i32) {
        self.backend.scroll_display(delta);
    }

    pub fn resize_to_rect(&mut self, rect: Rect, cell_size: Size) {
        let cols = ((rect.width / cell_size.width).max(1.0).min(1000.0)) as u16;
        let rows = ((rect.height / cell_size.height).max(1.0).min(500.0)) as u16;
        let cols = cols.max(MIN_READABLE_TERMINAL_BACKEND_COLS);
        self.backend.resize(cols, rows);
    }
}
