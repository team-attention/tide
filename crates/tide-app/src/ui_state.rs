// UI state structs extracted from main.rs

use std::path::PathBuf;

use tide_core::{PaneId, Rect};
use crate::theme::{TAB_BAR_HEIGHT, PANE_PADDING, PANEL_TAB_HEIGHT, PANE_GAP, PANEL_TAB_WIDTH, PANEL_TAB_GAP, PANEL_TAB_CLOSE_SIZE, PANEL_TAB_CLOSE_PADDING, POPUP_INPUT_PADDING, POPUP_LINE_EXTRA, POPUP_MAX_VISIBLE, FILE_SWITCHER_POPUP_W};

/// Simple shell escaping: wrap in single quotes if the string contains any shell metacharacters.
pub(crate) fn shell_escape(s: &str) -> String {
    // Reject strings with control characters that could inject commands
    if s.bytes().any(|b| b < 0x20 && b != b'\t') {
        return "''".to_string();
    }
    if s.contains(' ') || s.contains('\'') || s.contains('"') || s.contains('\\')
        || s.contains('$') || s.contains('`') || s.contains('!') || s.contains('(')
        || s.contains(')') || s.contains('&') || s.contains(';') || s.contains('|')
        || s.contains('*') || s.contains('?') || s.contains('[') || s.contains(']')
        || s.contains('{') || s.contains('}') || s.contains('#') || s.contains('~')
        || s.contains('\t')
    {
        format!("'{}'", s.replace('\'', "'\\''"))
    } else {
        s.to_string()
    }
}

// ──────────────────────────────────────────────
// Layout side: which edge a sidebar/dock component is on
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LayoutSide {
    Left,
    Right,
}

/// Layout mode for the main terminal pane area.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PaneAreaMode {
    /// 2D spatial layout with per-pane headers (default).
    Split,
    /// Dock-like stacked view: tab bar + single visible pane, linear navigation.
    /// The `PaneId` is the currently active (visible) pane.
    Stacked(PaneId),
}

impl Default for PaneAreaMode {
    fn default() -> Self {
        PaneAreaMode::Split
    }
}

impl PaneAreaMode {
    /// Height from pane rect top to the start of the content area.
    /// Stacked mode uses a taller tab bar than Split mode headers.
    pub(crate) fn content_top(&self) -> f32 {
        match self {
            PaneAreaMode::Split => TAB_BAR_HEIGHT,
            PaneAreaMode::Stacked(_) => PANE_PADDING + PANEL_TAB_HEIGHT + PANE_GAP,
        }
    }
}

/// Computed geometry for a horizontal tab bar (stacked panes or editor panel).
/// Extracted to share layout math between hit-testing, rendering, and hover.
pub(crate) struct TabBarGeometry {
    pub tab_bar_top: f32,
    pub tab_start_x: f32,
}

impl TabBarGeometry {
    /// X position of the tab at `index`.
    pub fn tab_x(&self, index: usize) -> f32 {
        self.tab_start_x + index as f32 * (PANEL_TAB_WIDTH + PANEL_TAB_GAP)
    }

    /// Bounding rect of the tab at `index`.
    pub fn tab_rect(&self, index: usize) -> Rect {
        Rect::new(self.tab_x(index), self.tab_bar_top, PANEL_TAB_WIDTH, PANEL_TAB_HEIGHT)
    }

    /// Bounding rect of the close button inside the tab at `index`.
    pub fn close_rect(&self, index: usize) -> Rect {
        let tx = self.tab_x(index);
        let close_x = tx + PANEL_TAB_WIDTH - PANEL_TAB_CLOSE_SIZE - PANEL_TAB_CLOSE_PADDING;
        let close_y = self.tab_bar_top + (PANEL_TAB_HEIGHT - PANEL_TAB_CLOSE_SIZE) / 2.0;
        Rect::new(close_x, close_y, PANEL_TAB_CLOSE_SIZE, PANEL_TAB_CLOSE_SIZE)
    }
}

// ──────────────────────────────────────────────
// Save-as input state (floating popup with directory + filename)
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SaveAsField {
    Directory,
    Filename,
}

pub(crate) struct SaveAsInput {
    pub pane_id: PaneId,
    pub filename: String,
    pub filename_cursor: usize,
    pub directory: String,
    pub dir_cursor: usize,
    pub active_field: SaveAsField,
}

impl SaveAsInput {
    pub fn new(pane_id: PaneId, base_dir: PathBuf) -> Self {
        let directory = abbreviate_path(&base_dir);
        let dir_cursor = directory.len();
        Self {
            pane_id,
            filename: String::new(),
            filename_cursor: 0,
            directory,
            dir_cursor,
            active_field: SaveAsField::Filename,
        }
    }

    /// Returns mutable references to the active field's text and cursor.
    fn active_text_mut(&mut self) -> (&mut String, &mut usize) {
        match self.active_field {
            SaveAsField::Filename => (&mut self.filename, &mut self.filename_cursor),
            SaveAsField::Directory => (&mut self.directory, &mut self.dir_cursor),
        }
    }

    pub fn toggle_field(&mut self) {
        self.active_field = match self.active_field {
            SaveAsField::Directory => SaveAsField::Filename,
            SaveAsField::Filename => SaveAsField::Directory,
        };
    }

    pub fn insert_char(&mut self, ch: char) {
        let (text, cursor) = self.active_text_mut();
        text.insert(*cursor, ch);
        *cursor += ch.len_utf8();
    }

    pub fn backspace(&mut self) {
        let (text, cursor) = self.active_text_mut();
        if *cursor > 0 {
            let prev = text[..*cursor]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
            text.drain(prev..*cursor);
            *cursor = prev;
        }
    }

    pub fn delete_char(&mut self) {
        let (text, cursor) = self.active_text_mut();
        if *cursor < text.len() {
            let next = text[*cursor..]
                .char_indices()
                .nth(1)
                .map(|(i, _)| *cursor + i)
                .unwrap_or(text.len());
            text.drain(*cursor..next);
        }
    }

    pub fn move_cursor_left(&mut self) {
        let (text, cursor) = self.active_text_mut();
        if *cursor > 0 {
            *cursor = text[..*cursor]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
        }
    }

    pub fn move_cursor_right(&mut self) {
        let (text, cursor) = self.active_text_mut();
        if *cursor < text.len() {
            *cursor = text[*cursor..]
                .char_indices()
                .nth(1)
                .map(|(i, _)| *cursor + i)
                .unwrap_or(text.len());
        }
    }

    /// Resolve the full save path from directory + filename.
    pub fn resolve_path(&self) -> Option<PathBuf> {
        if self.filename.is_empty() {
            return None;
        }
        let filename_path = std::path::Path::new(&self.filename);
        if filename_path.is_absolute() {
            return Some(PathBuf::from(&self.filename));
        }
        let dir = expand_tilde(&self.directory);
        Some(PathBuf::from(dir).join(&self.filename))
    }
}

/// Expand `~` prefix to the user's home directory.
fn expand_tilde(path: &str) -> String {
    if path == "~" || path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.display(), &path[1..]);
        }
    }
    path.to_string()
}

/// Abbreviate a path for compact display (replace home dir with ~).
pub(crate) fn abbreviate_path(path: &std::path::Path) -> String {
    if let Some(home) = dirs::home_dir() {
        if let Ok(suffix) = path.strip_prefix(&home) {
            return format!("~/{}", suffix.display());
        }
    }
    path.to_string_lossy().to_string()
}

// ──────────────────────────────────────────────
// Save confirm state (inline bar when closing dirty editors)
// ──────────────────────────────────────────────

pub(crate) struct SaveConfirmState {
    pub pane_id: PaneId,
}

// ──────────────────────────────────────────────
// File finder state (in-panel file search/open UI)
// ──────────────────────────────────────────────

pub(crate) struct FileFinderState {
    pub query: String,
    pub cursor: usize,
    pub base_dir: PathBuf,
    pub entries: Vec<PathBuf>,          // all files (relative to base_dir)
    pub filtered: Vec<usize>,           // indices into entries
    pub selected: usize,                // index into filtered
    pub scroll_offset: usize,           // scroll offset in filtered list
}

impl FileFinderState {
    pub fn new(base_dir: PathBuf, entries: Vec<PathBuf>) -> Self {
        let filtered: Vec<usize> = (0..entries.len()).collect();
        Self {
            query: String::new(),
            cursor: 0,
            base_dir,
            entries,
            filtered,
            selected: 0,
            scroll_offset: 0,
        }
    }

    pub fn insert_char(&mut self, ch: char) {
        self.query.insert(self.cursor, ch);
        self.cursor += ch.len_utf8();
        self.filter();
    }

    pub fn backspace(&mut self) {
        if self.cursor > 0 {
            let prev = self.query[..self.cursor]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
            self.query.drain(prev..self.cursor);
            self.cursor = prev;
            self.filter();
        }
    }

    pub fn delete_char(&mut self) {
        if self.cursor < self.query.len() {
            let next = self.query[self.cursor..]
                .char_indices()
                .nth(1)
                .map(|(i, _)| self.cursor + i)
                .unwrap_or(self.query.len());
            self.query.drain(self.cursor..next);
            self.filter();
        }
    }

    pub fn move_cursor_left(&mut self) {
        if self.cursor > 0 {
            self.cursor = self.query[..self.cursor]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
        }
    }

    pub fn move_cursor_right(&mut self) {
        if self.cursor < self.query.len() {
            self.cursor = self.query[self.cursor..]
                .char_indices()
                .nth(1)
                .map(|(i, _)| self.cursor + i)
                .unwrap_or(self.query.len());
        }
    }

    pub fn select_up(&mut self) {
        if self.selected > 0 {
            self.selected -= 1;
            if self.selected < self.scroll_offset {
                self.scroll_offset = self.selected;
            }
        }
    }

    pub fn select_down(&mut self) {
        if !self.filtered.is_empty() && self.selected + 1 < self.filtered.len() {
            self.selected += 1;
        }
    }

    pub fn selected_path(&self) -> Option<PathBuf> {
        let idx = *self.filtered.get(self.selected)?;
        let rel = self.entries.get(idx)?;
        Some(self.base_dir.join(rel))
    }

    fn filter(&mut self) {
        if self.query.is_empty() {
            self.filtered = (0..self.entries.len()).collect();
        } else {
            let query_lower = self.query.to_lowercase();
            self.filtered = self.entries.iter().enumerate()
                .filter(|(_, path)| {
                    let name = path.to_string_lossy().to_lowercase();
                    name.contains(&query_lower)
                })
                .map(|(i, _)| i)
                .collect();
        }
        self.selected = 0;
        self.scroll_offset = 0;
    }
}

// ──────────────────────────────────────────────
// Git switcher popup state (integrated branch + worktree)
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GitSwitcherMode {
    Branches,
    Worktrees,
}

/// Button types available in the git switcher popup (both Branches and Worktrees tabs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SwitcherButton {
    Switch(usize),     // filtered index
    NewPane(usize),    // filtered index
    Delete(usize),     // filtered index (worktree only)
}

/// Pre-computed popup geometry for the git switcher, shared between rendering and hit-testing.
pub(crate) struct GitSwitcherGeometry {
    pub popup_x: f32,
    pub popup_y: f32,
    pub popup_w: f32,
    pub popup_h: f32,
    pub input_h: f32,
    pub tab_h: f32,
    pub line_height: f32,
    pub list_top: f32,
    pub max_visible: usize,
    pub new_wt_btn_h: f32,
}

pub(crate) const GIT_SWITCHER_POPUP_W: f32 = 420.0;
pub(crate) const GIT_SWITCHER_MAX_VISIBLE: usize = 10;

pub(crate) struct GitSwitcherState {
    pub pane_id: PaneId,
    pub query: String,
    pub cursor: usize,
    pub mode: GitSwitcherMode,
    pub branches: Vec<tide_terminal::git::BranchInfo>,
    pub worktrees: Vec<tide_terminal::git::WorktreeInfo>,
    pub filtered_branches: Vec<usize>,
    pub filtered_worktrees: Vec<usize>,
    pub selected: usize,
    pub scroll_offset: usize,
    pub anchor_rect: Rect,
    /// Branch names that have a corresponding worktree
    pub worktree_branch_names: std::collections::HashSet<String>,
}

impl GitSwitcherState {
    pub fn new(
        pane_id: PaneId,
        mode: GitSwitcherMode,
        branches: Vec<tide_terminal::git::BranchInfo>,
        worktrees: Vec<tide_terminal::git::WorktreeInfo>,
        anchor_rect: Rect,
    ) -> Self {
        let filtered_branches: Vec<usize> = (0..branches.len()).collect();
        let filtered_worktrees: Vec<usize> = (0..worktrees.len()).collect();
        let worktree_branch_names: std::collections::HashSet<String> = worktrees.iter()
            .filter_map(|wt| wt.branch.clone())
            .collect();
        Self {
            pane_id,
            query: String::new(),
            cursor: 0,
            mode,
            branches,
            worktrees,
            filtered_branches,
            filtered_worktrees,
            selected: 0,
            scroll_offset: 0,
            anchor_rect,
            worktree_branch_names,
        }
    }

    /// Compute popup geometry given cell size and logical window dimensions.
    pub fn geometry(&self, cell_height: f32, logical_width: f32, logical_height: f32) -> GitSwitcherGeometry {
        let line_height = cell_height + POPUP_LINE_EXTRA;
        let tab_h = cell_height + 8.0; // git-switcher 고유 tab 높이
        let input_h = cell_height + POPUP_INPUT_PADDING;
        let popup_w = GIT_SWITCHER_POPUP_W;
        let popup_x = self.anchor_rect.x.min(logical_width - popup_w - 4.0).max(0.0);
        let current_len = self.current_filtered_len();
        let max_visible = GIT_SWITCHER_MAX_VISIBLE.min(current_len);
        let new_wt_btn_h = 0.0;
        // input_y = popup_y + 2.0, tab_y = input_y + input_h, tab_sep_y = tab_y + tab_h
        // list_top = tab_sep_y + 2.0 = popup_y + 2.0 + input_h + tab_h + 2.0
        let content_h = 4.0 + input_h + tab_h + 2.0 + max_visible as f32 * line_height + new_wt_btn_h + 4.0;
        // Vertical clamping: prefer below anchor, flip above if not enough space
        let below_y = self.anchor_rect.y + self.anchor_rect.height + 4.0;
        let popup_y = if below_y + content_h > logical_height {
            // Try above the anchor
            let above_y = self.anchor_rect.y - content_h - 4.0;
            if above_y >= 0.0 { above_y } else { below_y.min(logical_height - content_h).max(0.0) }
        } else {
            below_y
        };
        let popup_h = content_h;
        let list_top = popup_y + 2.0 + input_h + tab_h + 2.0;

        GitSwitcherGeometry {
            popup_x,
            popup_y,
            popup_w,
            popup_h,
            input_h,
            tab_h,
            line_height,
            list_top,
            max_visible,
            new_wt_btn_h,
        }
    }

    pub fn insert_char(&mut self, ch: char) {
        self.query.insert(self.cursor, ch);
        self.cursor += ch.len_utf8();
        self.filter();
    }

    pub fn backspace(&mut self) {
        if self.cursor > 0 {
            let prev = self.query[..self.cursor]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
            self.query.drain(prev..self.cursor);
            self.cursor = prev;
            self.filter();
        }
    }

    pub fn delete_char(&mut self) {
        if self.cursor < self.query.len() {
            let next = self.query[self.cursor..]
                .char_indices()
                .nth(1)
                .map(|(i, _)| self.cursor + i)
                .unwrap_or(self.query.len());
            self.query.drain(self.cursor..next);
            self.filter();
        }
    }

    pub fn move_cursor_left(&mut self) {
        if self.cursor > 0 {
            self.cursor = self.query[..self.cursor]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
        }
    }

    pub fn move_cursor_right(&mut self) {
        if self.cursor < self.query.len() {
            self.cursor = self.query[self.cursor..]
                .char_indices()
                .nth(1)
                .map(|(i, _)| self.cursor + i)
                .unwrap_or(self.query.len());
        }
    }

    pub fn select_up(&mut self) {
        if self.selected > 0 {
            self.selected -= 1;
            if self.selected < self.scroll_offset {
                self.scroll_offset = self.selected;
            }
        }
    }

    pub fn select_down(&mut self) {
        let len = self.current_filtered_len();
        if len > 0 && self.selected + 1 < len {
            self.selected += 1;
            if self.selected >= self.scroll_offset + GIT_SWITCHER_MAX_VISIBLE {
                self.scroll_offset = self.selected.saturating_sub(GIT_SWITCHER_MAX_VISIBLE - 1);
            }
        }
    }

    pub fn toggle_mode(&mut self) {
        self.mode = match self.mode {
            GitSwitcherMode::Branches => GitSwitcherMode::Worktrees,
            GitSwitcherMode::Worktrees => GitSwitcherMode::Branches,
        };
        self.selected = 0;
        self.scroll_offset = 0;
        self.filter();
    }

    /// Number of filtered items excluding the create row.
    pub fn base_filtered_len(&self) -> usize {
        match self.mode {
            GitSwitcherMode::Branches => self.filtered_branches.len(),
            GitSwitcherMode::Worktrees => self.filtered_worktrees.len(),
        }
    }

    /// Whether a "Create" row should appear (query non-empty and no exact match).
    pub fn has_create_row(&self) -> bool {
        let q = self.query.trim();
        if q.is_empty() {
            return false;
        }
        let q_lower = q.to_lowercase();
        match self.mode {
            GitSwitcherMode::Branches => {
                !self.filtered_branches.iter().any(|&i| {
                    self.branches[i].name.to_lowercase() == q_lower
                })
            }
            GitSwitcherMode::Worktrees => {
                !self.filtered_worktrees.iter().any(|&i| {
                    self.worktrees[i].branch.as_ref()
                        .map(|b| b.to_lowercase() == q_lower)
                        .unwrap_or(false)
                })
            }
        }
    }

    /// Whether `fi` is the create row index.
    pub fn is_create_row(&self, fi: usize) -> bool {
        self.has_create_row() && fi == self.base_filtered_len()
    }

    pub fn current_filtered_len(&self) -> usize {
        self.base_filtered_len() + if self.has_create_row() { 1 } else { 0 }
    }

    /// Refresh the branch list (e.g. after delete) while preserving selection position.
    pub fn refresh_branches(&mut self, cwd: &std::path::Path) {
        self.branches = tide_terminal::git::list_branches(cwd);
        let prev_selected = self.selected;
        let prev_scroll = self.scroll_offset;
        self.filter();
        let len = self.current_filtered_len();
        if len > 0 && prev_selected < len {
            self.selected = prev_selected;
            self.scroll_offset = prev_scroll.min(len.saturating_sub(GIT_SWITCHER_MAX_VISIBLE));
        } else if len > 0 {
            self.selected = len - 1;
            self.scroll_offset = len.saturating_sub(GIT_SWITCHER_MAX_VISIBLE);
        }
    }

    /// Refresh the worktree list (e.g. after add/delete) while preserving selection position.
    pub fn refresh_worktrees(&mut self, cwd: &std::path::Path) {
        self.worktrees = tide_terminal::git::list_worktrees(cwd);
        self.worktree_branch_names = self.worktrees.iter()
            .filter_map(|wt| wt.branch.clone())
            .collect();
        let prev_selected = self.selected;
        let prev_scroll = self.scroll_offset;
        self.filter();
        // Clamp selected index to new list length, preserving position
        let len = self.current_filtered_len();
        if len > 0 && prev_selected < len {
            self.selected = prev_selected;
            self.scroll_offset = prev_scroll.min(len.saturating_sub(GIT_SWITCHER_MAX_VISIBLE));
        } else if len > 0 {
            self.selected = len - 1;
            self.scroll_offset = len.saturating_sub(GIT_SWITCHER_MAX_VISIBLE);
        }
    }

    fn filter(&mut self) {
        let query_lower = self.query.to_lowercase();
        if self.query.is_empty() {
            self.filtered_branches = (0..self.branches.len()).collect();
            self.filtered_worktrees = (0..self.worktrees.len()).collect();
        } else {
            self.filtered_branches = self.branches.iter().enumerate()
                .filter(|(_, b)| b.name.to_lowercase().contains(&query_lower))
                .map(|(i, _)| i)
                .collect();
            self.filtered_worktrees = self.worktrees.iter().enumerate()
                .filter(|(_, wt)| {
                    let branch_match = wt.branch.as_ref()
                        .map(|b| b.to_lowercase().contains(&query_lower))
                        .unwrap_or_else(|| "(detached)".contains(&query_lower));
                    let path_match = wt.path.to_string_lossy().to_lowercase().contains(&query_lower);
                    branch_match || path_match
                })
                .map(|(i, _)| i)
                .collect();
        }
        self.selected = 0;
        self.scroll_offset = 0;
    }
}

// ──────────────────────────────────────────────
// File switcher popup (open files list for editor panel)
// ──────────────────────────────────────────────

pub(crate) struct FileSwitcherEntry {
    pub pane_id: PaneId,
    pub name: String,
    pub is_active: bool,
}

/// Pre-computed popup geometry for the file switcher, shared between rendering and hit-testing.
pub(crate) struct FileSwitcherGeometry {
    pub popup_x: f32,
    pub popup_y: f32,
    pub popup_w: f32,
    pub popup_h: f32,
    pub input_h: f32,
    pub line_height: f32,
    pub list_top: f32,
    pub max_visible: usize,
}

pub(crate) struct FileSwitcherState {
    pub query: String,
    pub cursor: usize,
    pub entries: Vec<FileSwitcherEntry>,
    pub filtered: Vec<usize>,
    pub selected: usize,
    pub scroll_offset: usize,
    pub anchor_rect: tide_core::Rect,
}

impl FileSwitcherState {
    /// Compute popup geometry given cell height.
    pub fn geometry(&self, cell_height: f32) -> FileSwitcherGeometry {
        let line_height = cell_height + POPUP_LINE_EXTRA;
        let popup_w = FILE_SWITCHER_POPUP_W;
        let popup_x = self.anchor_rect.x;
        let popup_y = self.anchor_rect.y + self.anchor_rect.height + 4.0;
        let input_h = cell_height + POPUP_INPUT_PADDING;
        let max_visible = POPUP_MAX_VISIBLE.min(self.filtered.len());
        let popup_h = input_h + max_visible as f32 * line_height + 8.0;
        // input_y = popup_y + 2.0, sep_y = input_y + input_h, list_top = sep_y + 2.0
        let list_top = popup_y + 2.0 + input_h + 2.0;
        FileSwitcherGeometry {
            popup_x,
            popup_y,
            popup_w,
            popup_h,
            input_h,
            line_height,
            list_top,
            max_visible,
        }
    }

    pub fn new(entries: Vec<FileSwitcherEntry>, anchor_rect: tide_core::Rect) -> Self {
        let filtered: Vec<usize> = (0..entries.len()).collect();
        // Pre-select the active entry
        let selected = entries.iter().position(|e| e.is_active).unwrap_or(0);
        Self {
            query: String::new(),
            cursor: 0,
            entries,
            filtered,
            selected,
            scroll_offset: 0,
            anchor_rect,
        }
    }

    pub fn insert_char(&mut self, ch: char) {
        self.query.insert(self.cursor, ch);
        self.cursor += ch.len_utf8();
        self.filter();
    }

    pub fn backspace(&mut self) {
        if self.cursor > 0 {
            let prev = self.query[..self.cursor]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
            self.query.drain(prev..self.cursor);
            self.cursor = prev;
            self.filter();
        }
    }

    pub fn select_up(&mut self) {
        if self.selected > 0 {
            self.selected -= 1;
            if self.selected < self.scroll_offset {
                self.scroll_offset = self.selected;
            }
        }
    }

    pub fn select_down(&mut self) {
        if !self.filtered.is_empty() && self.selected + 1 < self.filtered.len() {
            self.selected += 1;
        }
    }

    pub fn selected_entry(&self) -> Option<&FileSwitcherEntry> {
        let idx = *self.filtered.get(self.selected)?;
        self.entries.get(idx)
    }

    fn filter(&mut self) {
        if self.query.is_empty() {
            self.filtered = (0..self.entries.len()).collect();
        } else {
            let query_lower = self.query.to_lowercase();
            self.filtered = self.entries.iter().enumerate()
                .filter(|(_, e)| e.name.to_lowercase().contains(&query_lower))
                .map(|(i, _)| i)
                .collect();
        }
        self.selected = 0;
        self.scroll_offset = 0;
    }
}
