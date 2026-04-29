// ModalStack and all modal state types.

use super::state::input_line::{abbreviate_path, expand_tilde, InputLine};
use crate::theme::{CONTEXT_MENU_W, POPUP_INPUT_PADDING, POPUP_LINE_EXTRA};
use crate::tide_core::{PaneId, Rect, Vec2};
use std::path::PathBuf;

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
    pub filename: InputLine,
    pub directory: InputLine,
    pub active_field: SaveAsField,
    pub anchor_rect: Rect,
}

impl SaveAsInput {
    pub fn new(pane_id: PaneId, base_dir: PathBuf, anchor_rect: Rect) -> Self {
        let directory = abbreviate_path(&base_dir);
        Self {
            pane_id,
            filename: InputLine::new(),
            directory: InputLine::with_text(directory),
            active_field: SaveAsField::Filename,
            anchor_rect,
        }
    }

    /// Returns a mutable reference to the active field's InputLine.
    pub fn active_input_mut(&mut self) -> &mut InputLine {
        match self.active_field {
            SaveAsField::Filename => &mut self.filename,
            SaveAsField::Directory => &mut self.directory,
        }
    }

    pub fn toggle_field(&mut self) {
        self.active_field = match self.active_field {
            SaveAsField::Directory => SaveAsField::Filename,
            SaveAsField::Filename => SaveAsField::Directory,
        };
    }

    pub fn insert_char(&mut self, ch: char) {
        self.active_input_mut().insert_char(ch);
    }

    pub fn backspace(&mut self) {
        self.active_input_mut().backspace();
    }

    pub fn delete_char(&mut self) {
        self.active_input_mut().delete_char();
    }

    pub fn move_cursor_left(&mut self) {
        self.active_input_mut().move_cursor_left();
    }

    pub fn move_cursor_right(&mut self) {
        self.active_input_mut().move_cursor_right();
    }

    /// Resolve the full save path from directory + filename.
    pub fn resolve_path(&self) -> Option<PathBuf> {
        if self.filename.is_empty() {
            return None;
        }
        let filename_path = std::path::Path::new(&self.filename.text);
        if filename_path.is_absolute() {
            return Some(PathBuf::from(&self.filename.text));
        }
        let dir = expand_tilde(&self.directory.text);
        Some(PathBuf::from(dir).join(&self.filename.text))
    }
}

// ──────────────────────────────────────────────
// Save confirm state (inline bar when closing dirty editors)
// ──────────────────────────────────────────────

pub(crate) struct SaveConfirmState {
    pub pane_id: PaneId,
}

// ──────────────────────────────────────────────
// File finder state (floating popup file search/open UI)
// ──────────────────────────────────────────────

pub(crate) const FILE_FINDER_POPUP_W: f32 = 680.0;
pub(crate) const FILE_FINDER_MAX_VISIBLE: usize = 14;
const FILE_FINDER_MAX_WORKSPACE_SEARCH_HITS: usize = 200;

pub(crate) fn sort_file_finder_entries(entries: &mut [PathBuf]) {
    entries.sort_by(|left, right| {
        let left_hidden = file_finder_entry_is_hidden_or_tooling(left);
        let right_hidden = file_finder_entry_is_hidden_or_tooling(right);
        left_hidden
            .cmp(&right_hidden)
            .then_with(|| file_finder_sort_key(left).cmp(&file_finder_sort_key(right)))
    });
}

fn file_finder_entry_is_hidden_or_tooling(path: &std::path::Path) -> bool {
    path.components().any(|component| {
        let std::path::Component::Normal(part) = component else {
            return false;
        };
        part.to_string_lossy().starts_with('.')
    })
}

fn file_finder_sort_key(path: &std::path::Path) -> String {
    path.to_string_lossy().to_lowercase()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileFinderMode {
    Files,
    Symbols,
    WorkspaceSymbols,
    WorkspaceSearch,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SymbolMatch {
    pub label: String,
    pub path: PathBuf,
    pub line: usize,
    pub col: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WorkspaceSearchHit {
    pub path: PathBuf,
    pub line: usize,
    pub col: usize,
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FileFinderDestination {
    OpenFile {
        path: PathBuf,
        line: Option<usize>,
    },
    FocusedEditorSymbol {
        pane_id: PaneId,
        line: usize,
        col: usize,
    },
}

/// Pre-computed popup geometry for the file finder, shared between rendering and hit-testing.
pub(crate) struct FileFinderGeometry {
    pub popup_x: f32,
    pub popup_y: f32,
    pub popup_w: f32,
    pub popup_h: f32,
    pub input_h: f32,
    pub line_height: f32,
    pub list_top: f32,
    pub max_visible: usize,
}

pub(crate) struct FileFinderState {
    pub input: InputLine,
    pub base_dir: PathBuf,
    pub mode: FileFinderMode,
    pub entries: Vec<PathBuf>, // all files (relative to base_dir)
    pub filtered: Vec<usize>,  // indices into entries
    pub selected: usize,       // index into filtered
    pub scroll_offset: usize,  // scroll offset in filtered list
    pub current_file_symbols: Vec<SymbolMatch>,
    pub workspace_symbols: Vec<SymbolMatch>,
    pub workspace_symbols_loaded: bool,
    pub workspace_search_hits: Vec<WorkspaceSearchHit>,
    pub symbol_source_pane_id: Option<PaneId>,
    /// When set, the selected file replaces this pane (e.g. a Launcher) instead of opening a new tab.
    pub replace_pane_id: Option<crate::tide_core::PaneId>,
}

impl FileFinderState {
    pub fn new(base_dir: PathBuf, entries: Vec<PathBuf>) -> Self {
        let filtered: Vec<usize> = (0..entries.len()).collect();
        Self {
            input: InputLine::new(),
            base_dir,
            mode: FileFinderMode::Files,
            entries,
            filtered,
            selected: 0,
            scroll_offset: 0,
            current_file_symbols: Vec::new(),
            workspace_symbols: Vec::new(),
            workspace_symbols_loaded: false,
            workspace_search_hits: Vec::new(),
            symbol_source_pane_id: None,
            replace_pane_id: None,
        }
    }

    pub fn with_symbol_sources(
        mut self,
        symbol_source_pane_id: Option<PaneId>,
        current_file_symbols: Vec<SymbolMatch>,
        workspace_symbols: Vec<SymbolMatch>,
    ) -> Self {
        self.symbol_source_pane_id = symbol_source_pane_id;
        self.current_file_symbols = current_file_symbols;
        self.workspace_symbols_loaded = !workspace_symbols.is_empty();
        self.workspace_symbols = workspace_symbols;
        self.filter();
        self
    }

    pub fn set_workspace_symbols(&mut self, workspace_symbols: Vec<SymbolMatch>) {
        self.workspace_symbols = workspace_symbols;
        self.workspace_symbols_loaded = true;
        self.filter();
    }

    pub fn set_query(&mut self, query: String) {
        self.input = InputLine::with_text(query);
        self.filter();
    }

    /// Compute popup geometry given cell size and logical window dimensions.
    pub fn geometry(
        &self,
        cell_height: f32,
        logical_width: f32,
        _logical_height: f32,
    ) -> FileFinderGeometry {
        let line_height = cell_height * crate::theme::FILE_TREE_LINE_SPACING;
        let input_h = cell_height + POPUP_INPUT_PADDING;
        let popup_w = FILE_FINDER_POPUP_W.min(logical_width - 32.0);
        let popup_x = (logical_width - popup_w) / 2.0;
        let popup_y = 120.0_f32.min(_logical_height * 0.15);
        let max_visible = FILE_FINDER_MAX_VISIBLE.min(self.filtered.len());
        let popup_h = input_h + 8.0 + max_visible as f32 * line_height + 8.0;
        let list_top = popup_y + 2.0 + input_h + 8.0;

        FileFinderGeometry {
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

    pub fn insert_char(&mut self, ch: char) {
        self.input.insert_char(ch);
        self.filter();
    }

    pub fn backspace(&mut self) {
        if self.input.cursor > 0 {
            self.input.backspace();
            self.filter();
        }
    }

    pub fn delete_char(&mut self) {
        if self.input.cursor < self.input.text.len() {
            self.input.delete_char();
            self.filter();
        }
    }

    pub fn move_cursor_left(&mut self) {
        self.input.move_cursor_left();
    }

    pub fn move_cursor_right(&mut self) {
        self.input.move_cursor_right();
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
            if self.selected >= self.scroll_offset + FILE_FINDER_MAX_VISIBLE {
                self.scroll_offset = self.selected.saturating_sub(FILE_FINDER_MAX_VISIBLE - 1);
            }
        }
    }

    pub fn scroll_by_lines(&mut self, lines: isize) {
        if self.filtered.is_empty() {
            self.selected = 0;
            self.scroll_offset = 0;
            return;
        }

        let max_offset = self.filtered.len().saturating_sub(FILE_FINDER_MAX_VISIBLE);
        let next = (self.scroll_offset as isize + lines).clamp(0, max_offset as isize) as usize;
        self.scroll_offset = next;

        let visible_end = (self.scroll_offset + FILE_FINDER_MAX_VISIBLE).min(self.filtered.len());
        if self.selected < self.scroll_offset {
            self.selected = self.scroll_offset;
        } else if self.selected >= visible_end {
            self.selected = visible_end.saturating_sub(1);
        }
    }

    pub fn selected_path(&self) -> Option<PathBuf> {
        if self.mode != FileFinderMode::Files {
            return None;
        }
        let idx = *self.filtered.get(self.selected)?;
        let rel = self.entries.get(idx)?;
        Some(self.base_dir.join(rel))
    }

    pub fn selected_destination(&self) -> Option<FileFinderDestination> {
        self.destination_at_filtered_index(self.selected)
    }

    pub fn destination_at_filtered_index(
        &self,
        filtered_index: usize,
    ) -> Option<FileFinderDestination> {
        let idx = *self.filtered.get(filtered_index)?;
        match self.mode {
            FileFinderMode::Files => {
                let rel = self.entries.get(idx)?;
                Some(FileFinderDestination::OpenFile {
                    path: self.base_dir.join(rel),
                    line: None,
                })
            }
            FileFinderMode::Symbols => {
                let pane_id = self.symbol_source_pane_id?;
                let symbol = self.current_file_symbols.get(idx)?;
                Some(FileFinderDestination::FocusedEditorSymbol {
                    pane_id,
                    line: symbol.line,
                    col: symbol.col,
                })
            }
            FileFinderMode::WorkspaceSymbols => {
                let symbol = self.workspace_symbols.get(idx)?;
                Some(FileFinderDestination::OpenFile {
                    path: self.base_dir.join(&symbol.path),
                    line: Some(symbol.line),
                })
            }
            FileFinderMode::WorkspaceSearch => {
                let hit = self.workspace_search_hits.get(idx)?;
                Some(FileFinderDestination::OpenFile {
                    path: self.base_dir.join(&hit.path),
                    line: Some(hit.line),
                })
            }
        }
    }

    pub fn mode_label(&self) -> &'static str {
        match self.mode {
            FileFinderMode::Files => "FILES",
            FileFinderMode::Symbols => "SYMS",
            FileFinderMode::WorkspaceSymbols => "WSYM",
            FileFinderMode::WorkspaceSearch => "TEXT",
        }
    }

    pub fn placeholder_text(&self) -> &'static str {
        match self.mode {
            FileFinderMode::Files => "Search files...",
            FileFinderMode::Symbols => "@ symbol in file",
            FileFinderMode::WorkspaceSymbols => "# symbol in workspace",
            FileFinderMode::WorkspaceSearch => "/ text in workspace",
        }
    }

    pub fn total_candidates(&self) -> usize {
        match self.mode {
            FileFinderMode::Files => self.entries.len(),
            FileFinderMode::Symbols => self.current_file_symbols.len(),
            FileFinderMode::WorkspaceSymbols => self.workspace_symbols.len(),
            FileFinderMode::WorkspaceSearch => self.workspace_search_hits.len(),
        }
    }

    pub fn row_text(&self, filtered_index: usize) -> Option<String> {
        let (primary, secondary) = self.row_parts(filtered_index)?;
        if secondary.is_empty() {
            return Some(primary);
        }
        Some(format!("{primary}  {secondary}"))
    }

    pub fn row_parts(&self, filtered_index: usize) -> Option<(String, String)> {
        let idx = *self.filtered.get(filtered_index)?;
        match self.mode {
            FileFinderMode::Files => {
                let rel_path = self.entries.get(idx)?;
                Some((rel_path.to_string_lossy().to_string(), String::new()))
            }
            FileFinderMode::Symbols | FileFinderMode::WorkspaceSymbols => {
                let symbol = if self.mode == FileFinderMode::Symbols {
                    self.current_file_symbols.get(idx)?
                } else {
                    self.workspace_symbols.get(idx)?
                };
                Some((
                    symbol.label.clone(),
                    format!("{}:{}", symbol.path.display(), symbol.line),
                ))
            }
            FileFinderMode::WorkspaceSearch => {
                let hit = self.workspace_search_hits.get(idx)?;
                Some((
                    trim_preview(&hit.preview),
                    format!("{}:{}", hit.path.display(), hit.line),
                ))
            }
        }
    }

    fn filter(&mut self) {
        let (mode, query) = self.mode_and_query();
        self.mode = mode;

        match mode {
            FileFinderMode::Files => self.filter_files(&query),
            FileFinderMode::Symbols => {
                self.filtered = filter_symbol_indices(&self.current_file_symbols, &query);
            }
            FileFinderMode::WorkspaceSymbols => {
                self.filtered = filter_symbol_indices(&self.workspace_symbols, &query);
            }
            FileFinderMode::WorkspaceSearch => self.filter_workspace_search(&query),
        }
        self.selected = 0;
        self.scroll_offset = 0;
    }

    fn mode_and_query(&self) -> (FileFinderMode, String) {
        let text = self.input.text.as_str();
        if let Some(rest) = text.strip_prefix('@') {
            (FileFinderMode::Symbols, rest.to_string())
        } else if let Some(rest) = text.strip_prefix('#') {
            (FileFinderMode::WorkspaceSymbols, rest.to_string())
        } else if let Some(rest) = text.strip_prefix('/') {
            (FileFinderMode::WorkspaceSearch, rest.to_string())
        } else {
            (FileFinderMode::Files, text.to_string())
        }
    }

    fn filter_files(&mut self, query: &str) {
        if query.is_empty() {
            self.filtered = (0..self.entries.len()).collect();
            return;
        }

        let mut ranked: Vec<(usize, (usize, usize, usize, String))> = self
            .entries
            .iter()
            .enumerate()
            .filter_map(|(idx, path)| {
                file_match_score(path, query).map(|score| {
                    (
                        idx,
                        (
                            score.0,
                            score.1,
                            score.2,
                            path.to_string_lossy().to_string(),
                        ),
                    )
                })
            })
            .collect();
        ranked.sort_by(|(_, left), (_, right)| left.cmp(right));
        self.filtered = ranked.into_iter().map(|(idx, _)| idx).collect();
    }

    fn filter_workspace_search(&mut self, query: &str) {
        self.workspace_search_hits.clear();
        if query.chars().count() < 2 {
            self.filtered.clear();
            return;
        }

        let query_lower = query.to_lowercase();
        'files: for rel_path in &self.entries {
            let full_path = self.base_dir.join(rel_path);
            let Ok(contents) = std::fs::read_to_string(&full_path) else {
                continue;
            };
            if contents.len() > 256 * 1024 {
                continue;
            }
            for (line_idx, line) in contents.lines().enumerate() {
                let line_lower = line.to_lowercase();
                if let Some(byte_col) = line_lower.find(&query_lower) {
                    let col = line[..byte_col].chars().count() + 1;
                    self.workspace_search_hits.push(WorkspaceSearchHit {
                        path: rel_path.clone(),
                        line: line_idx + 1,
                        col,
                        preview: line.trim().to_string(),
                    });
                    if self.workspace_search_hits.len() >= FILE_FINDER_MAX_WORKSPACE_SEARCH_HITS {
                        break 'files;
                    }
                }
            }
        }
        self.filtered = (0..self.workspace_search_hits.len()).collect();
    }
}

pub(crate) fn collect_symbol_matches(path: &std::path::Path, lines: &[String]) -> Vec<SymbolMatch> {
    let rel_path = path.to_path_buf();
    lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            symbol_signature_label(line).map(|label| SymbolMatch {
                label,
                path: rel_path.clone(),
                line: index + 1,
                col: 0,
            })
        })
        .collect()
}

fn file_match_score(path: &std::path::Path, query: &str) -> Option<(usize, usize, usize)> {
    let query_lower = query.to_lowercase();
    let full = path.to_string_lossy().to_lowercase();
    let base = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    if let Some(pos) = base.find(&query_lower) {
        let tier = if pos == 0 { 0 } else { 1 };
        return Some((tier, pos, full.len()));
    }
    full.find(&query_lower).map(|pos| (2, pos, full.len()))
}

fn filter_symbol_indices(symbols: &[SymbolMatch], query: &str) -> Vec<usize> {
    if query.is_empty() {
        return (0..symbols.len()).collect();
    }

    let query_lower = query.to_lowercase();
    let mut ranked: Vec<(usize, (usize, usize, String))> = symbols
        .iter()
        .enumerate()
        .filter_map(|(idx, symbol)| {
            let label_lower = symbol.label.to_lowercase();
            if let Some(pos) = label_lower.find(&query_lower) {
                let tier = if pos == 0 { 0 } else { 1 };
                return Some((idx, (tier, pos, symbol.label.clone())));
            }

            let path_lower = symbol.path.to_string_lossy().to_lowercase();
            path_lower
                .find(&query_lower)
                .map(|pos| (idx, (2, pos, symbol.label.clone())))
        })
        .collect();
    ranked.sort_by(|(_, left), (_, right)| left.cmp(right));
    ranked.into_iter().map(|(idx, _)| idx).collect()
}

fn symbol_signature_label(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("//") {
        return None;
    }

    let prefixes = [
        "fn ",
        "pub fn ",
        "pub(crate) fn ",
        "async fn ",
        "pub async fn ",
        "struct ",
        "pub struct ",
        "enum ",
        "pub enum ",
        "trait ",
        "pub trait ",
        "impl ",
        "mod ",
        "pub mod ",
        "type ",
        "pub type ",
        "const ",
        "pub const ",
        "function ",
        "export function ",
        "class ",
        "export class ",
        "interface ",
        "export interface ",
        "export type ",
        "def ",
        "async def ",
        "func ",
    ];

    if prefixes.iter().any(|prefix| trimmed.starts_with(prefix)) {
        return Some(trimmed.to_string());
    }

    let arrow_prefixes = ["const ", "let ", "var ", "export const "];
    if arrow_prefixes
        .iter()
        .any(|prefix| trimmed.starts_with(prefix))
        && trimmed.contains("=>")
    {
        return Some(trimmed.to_string());
    }

    None
}

fn trim_preview(preview: &str) -> String {
    const MAX_PREVIEW_CHARS: usize = 52;
    let mut chars = preview.chars();
    let trimmed: String = chars.by_ref().take(MAX_PREVIEW_CHARS).collect();
    if chars.next().is_some() {
        format!("{}...", trimmed)
    } else {
        trimmed
    }
}

// ──────────────────────────────────────────────
// Git switcher popup state (integrated branch + worktree)
// ──────────────────────────────────────────────

/// Button types available in the git switcher popup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SwitcherButton {
    Switch(usize),  // filtered index
    NewPane(usize), // filtered index
    Delete(usize),  // filtered index
}

/// Pre-computed popup geometry for the git switcher, shared between rendering and hit-testing.
pub(crate) struct GitSwitcherGeometry {
    pub popup_x: f32,
    pub popup_y: f32,
    pub popup_w: f32,
    pub popup_h: f32,
    pub input_h: f32,
    pub line_height: f32,
    pub list_top: f32,
    pub max_visible: usize,
    pub new_wt_btn_h: f32,
}

pub(crate) const GIT_SWITCHER_POPUP_W: f32 = 320.0;
pub(crate) const GIT_SWITCHER_MAX_VISIBLE: usize = 8;

pub(crate) struct GitSwitcherState {
    pub pane_id: PaneId,
    pub input: InputLine,
    pub worktrees: Vec<crate::tide_terminal::git::WorktreeInfo>,
    pub filtered_worktrees: Vec<usize>,
    pub selected: usize,
    pub scroll_offset: usize,
    pub anchor_rect: Rect,
    /// True when the owning terminal has a running process (hides Switch/Delete buttons)
    pub shell_busy: bool,
    /// When Some(fi), the row at filtered index `fi` shows a "Confirm delete?" prompt
    pub delete_confirm: Option<usize>,
}

impl GitSwitcherState {
    pub fn new(
        pane_id: PaneId,
        worktrees: Vec<crate::tide_terminal::git::WorktreeInfo>,
        anchor_rect: Rect,
    ) -> Self {
        let filtered_worktrees: Vec<usize> = (0..worktrees.len()).collect();
        Self {
            pane_id,
            input: InputLine::new(),
            worktrees,
            filtered_worktrees,
            selected: 0,
            scroll_offset: 0,
            anchor_rect,
            shell_busy: false,
            delete_confirm: None,
        }
    }

    /// Compute popup geometry given cell size and logical window dimensions.
    pub fn geometry(
        &self,
        cell_height: f32,
        logical_width: f32,
        logical_height: f32,
    ) -> GitSwitcherGeometry {
        // Git switcher uses 36px rows to match Pen design (spacious branch items)
        let line_height = 36.0_f32.max(cell_height + POPUP_LINE_EXTRA);
        let input_h = 36.0_f32; // per Pen design
        let popup_w = GIT_SWITCHER_POPUP_W;
        let popup_x = self
            .anchor_rect
            .x
            .min(logical_width - popup_w - 4.0)
            .max(0.0);
        let current_len = self.current_filtered_len();
        let max_visible = GIT_SWITCHER_MAX_VISIBLE.min(current_len);
        let new_wt_btn_h = 0.0;
        let hint_bar_h = 28.0_f32;
        let content_h = 2.0
            + input_h
            + 4.0
            + max_visible as f32 * line_height
            + new_wt_btn_h
            + 4.0
            + hint_bar_h;
        // Vertical clamping: prefer below anchor, flip above if not enough space
        let below_y = self.anchor_rect.y + self.anchor_rect.height + 4.0;
        let popup_y = if below_y + content_h > logical_height {
            // Try above the anchor
            let above_y = self.anchor_rect.y - content_h - 4.0;
            if above_y >= 0.0 {
                above_y
            } else {
                below_y.min(logical_height - content_h).max(0.0)
            }
        } else {
            below_y
        };
        let popup_h = content_h;
        let list_top = popup_y + 2.0 + input_h + 4.0;

        GitSwitcherGeometry {
            popup_x,
            popup_y,
            popup_w,
            popup_h,
            input_h,
            line_height,
            list_top,
            max_visible,
            new_wt_btn_h,
        }
    }

    pub fn insert_char(&mut self, ch: char) {
        self.input.insert_char(ch);
        self.filter();
    }

    pub fn backspace(&mut self) {
        if self.input.cursor > 0 {
            self.input.backspace();
            self.filter();
        }
    }

    pub fn delete_char(&mut self) {
        if self.input.cursor < self.input.text.len() {
            self.input.delete_char();
            self.filter();
        }
    }

    pub fn move_cursor_left(&mut self) {
        self.input.move_cursor_left();
    }

    pub fn move_cursor_right(&mut self) {
        self.input.move_cursor_right();
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

    /// Number of filtered items excluding the create row.
    pub fn base_filtered_len(&self) -> usize {
        self.filtered_worktrees.len()
    }

    /// Whether a "Create" row should appear (query non-empty and no exact match).
    pub fn has_create_row(&self) -> bool {
        let q = self.input.text.trim();
        if q.is_empty() {
            return false;
        }
        let q_lower = q.to_lowercase();
        !self.filtered_worktrees.iter().any(|&i| {
            self.worktrees[i]
                .branch
                .as_ref()
                .map(|b| b.to_lowercase() == q_lower)
                .unwrap_or(false)
        })
    }

    /// Whether `fi` is the create row index.
    pub fn is_create_row(&self, fi: usize) -> bool {
        self.has_create_row() && fi == self.base_filtered_len()
    }

    pub fn current_filtered_len(&self) -> usize {
        self.base_filtered_len() + if self.has_create_row() { 1 } else { 0 }
    }

    fn filter(&mut self) {
        if self.input.is_empty() {
            self.filtered_worktrees = (0..self.worktrees.len()).collect();
        } else {
            let query_lower = self.input.text.to_lowercase();
            self.filtered_worktrees = self
                .worktrees
                .iter()
                .enumerate()
                .filter(|(_, wt)| {
                    let branch_match = wt
                        .branch
                        .as_ref()
                        .map(|b| b.to_lowercase().contains(&query_lower))
                        .unwrap_or_else(|| "(detached)".contains(&query_lower));
                    let path_match = wt
                        .path
                        .to_string_lossy()
                        .to_lowercase()
                        .contains(&query_lower);
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
// Context menu state (right-click on file tree)
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ContextMenuAction {
    CdHere,
    OpenTerminalHere,
    OpenApp,
    RevealInFinder,
    Rename,
    Delete,
}

impl ContextMenuAction {
    const FILE_ACTIONS: [ContextMenuAction; 2] =
        [ContextMenuAction::Rename, ContextMenuAction::Delete];
    const APP_BUNDLE_ACTIONS: [ContextMenuAction; 4] = [
        ContextMenuAction::OpenApp,
        ContextMenuAction::RevealInFinder,
        ContextMenuAction::Rename,
        ContextMenuAction::Delete,
    ];
    const DIR_ACTIONS: [ContextMenuAction; 5] = [
        ContextMenuAction::CdHere,
        ContextMenuAction::OpenTerminalHere,
        ContextMenuAction::RevealInFinder,
        ContextMenuAction::Rename,
        ContextMenuAction::Delete,
    ];
    const DIR_ACTIONS_BUSY: [ContextMenuAction; 4] = [
        ContextMenuAction::OpenTerminalHere,
        ContextMenuAction::RevealInFinder,
        ContextMenuAction::Rename,
        ContextMenuAction::Delete,
    ];

    pub fn items(
        is_dir: bool,
        is_app_bundle: bool,
        shell_idle: bool,
    ) -> &'static [ContextMenuAction] {
        if is_app_bundle {
            return &Self::APP_BUNDLE_ACTIONS;
        }
        if is_dir {
            if shell_idle {
                &Self::DIR_ACTIONS
            } else {
                &Self::DIR_ACTIONS_BUSY
            }
        } else {
            &Self::FILE_ACTIONS
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            ContextMenuAction::CdHere => "cd",
            ContextMenuAction::OpenTerminalHere => "Open Terminal Here",
            ContextMenuAction::OpenApp => "Open App",
            ContextMenuAction::RevealInFinder => "Reveal in Finder",
            ContextMenuAction::Rename => "Rename",
            ContextMenuAction::Delete => "Delete",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            ContextMenuAction::CdHere => "\u{f07b}", // folder icon
            ContextMenuAction::OpenTerminalHere => "\u{f120}", // terminal icon
            ContextMenuAction::OpenApp => "\u{f04b}", // play icon
            ContextMenuAction::RevealInFinder => "\u{f07c}", // folder-open icon
            ContextMenuAction::Rename => "\u{f044}", //
            ContextMenuAction::Delete => "\u{f1f8}", //
        }
    }
}

pub(crate) struct ContextMenuState {
    pub entry_index: usize,
    pub path: PathBuf,
    pub is_dir: bool,
    pub is_app_bundle: bool,
    pub shell_idle: bool,
    pub position: Vec2,
    pub selected: usize,
}

impl ContextMenuState {
    pub fn items(&self) -> &'static [ContextMenuAction] {
        ContextMenuAction::items(self.is_dir, self.is_app_bundle, self.shell_idle)
    }

    /// Compute the popup rect, clamped to window bounds.
    pub fn geometry(&self, cell_height: f32, logical_width: f32, logical_height: f32) -> Rect {
        let line_height = cell_height + POPUP_LINE_EXTRA;
        let item_count = self.items().len() as f32;
        // Width from longest label: left inset + icon (2.5 cells) + label chars + right padding
        let cell_w = cell_height * 0.6; // approximate cell width from height
        let max_label_len = self
            .items()
            .iter()
            .map(|a| a.label().chars().count())
            .max()
            .unwrap_or(0) as f32;
        let content_w = crate::theme::POPUP_TEXT_INSET
            + 2.5 * cell_w
            + max_label_len * cell_w
            + crate::theme::POPUP_TEXT_INSET;
        let popup_w = content_w.max(CONTEXT_MENU_W);
        let popup_h = item_count * line_height + 8.0; // items + padding
        let x = self.position.x.min(logical_width - popup_w - 4.0).max(0.0);
        let y = self.position.y.min(logical_height - popup_h - 4.0).max(0.0);
        Rect::new(x, y, popup_w, popup_h)
    }
}

// ──────────────────────────────────────────────
// Config page state
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConfigSection {
    Keybindings,
    Worktree,
    Appearance,
}

pub(crate) struct RecordingState {
    pub action_index: usize,
}

pub(crate) struct ConfigPageState {
    pub section: ConfigSection,
    pub selected: usize,
    pub scroll_offset: usize,
    pub recording: Option<RecordingState>,
    pub worktree_input: InputLine,
    pub worktree_editing: bool,
    pub copy_files_input: InputLine,
    pub copy_files_editing: bool,
    /// Which field is selected in Worktree tab (0 = base_dir_pattern, 1 = copy_files)
    pub selected_field: usize,
    pub bindings: Vec<(crate::tide_input::GlobalAction, crate::tide_input::Hotkey)>,
    pub dirty: bool,
}

impl ConfigPageState {
    pub fn new(
        bindings: Vec<(crate::tide_input::GlobalAction, crate::tide_input::Hotkey)>,
        worktree_pattern: String,
        copy_files: String,
    ) -> Self {
        Self {
            section: ConfigSection::Keybindings,
            selected: 0,
            scroll_offset: 0,
            recording: None,
            worktree_input: InputLine::with_text(worktree_pattern),
            worktree_editing: false,
            copy_files_input: InputLine::with_text(copy_files),
            copy_files_editing: false,
            selected_field: 0,
            bindings,
            dirty: false,
        }
    }
}

// ──────────────────────────────────────────────
// Branch cleanup state (confirmation when closing terminal in a worktree)
// ──────────────────────────────────────────────

pub(crate) struct BranchCleanupState {
    pub pane_id: PaneId,
    pub branch: String,
    pub worktree_path: PathBuf,
    pub cwd: PathBuf,
}

// ──────────────────────────────────────────────
// Context comment composer state (selection + comment)
// ──────────────────────────────────────────────

pub(crate) struct ContextCommentComposerState {
    pub source_pane_id: PaneId,
    pub associated_terminal_id: PaneId,
    pub pane_kind: String,
    pub selection: Option<crate::pane::Selection>,
    pub content: String,
    pub comment: InputLine,
    pub pinned: bool,
}

impl ContextCommentComposerState {
    pub fn new(
        source_pane_id: PaneId,
        associated_terminal_id: PaneId,
        pane_kind: String,
        selection: Option<crate::pane::Selection>,
        content: String,
    ) -> Self {
        Self {
            source_pane_id,
            associated_terminal_id,
            pane_kind,
            selection,
            content,
            comment: InputLine::new(),
            pinned: false,
        }
    }

    pub fn insert_char(&mut self, ch: char) {
        self.comment.insert_char(ch);
    }

    pub fn insert_newline(&mut self) {
        self.comment.insert_char('\n');
    }

    pub fn backspace(&mut self) {
        self.comment.backspace();
    }

    pub fn delete_char(&mut self) {
        self.comment.delete_char();
    }

    pub fn move_cursor_left(&mut self) {
        self.comment.move_cursor_left();
    }

    pub fn move_cursor_right(&mut self) {
        self.comment.move_cursor_right();
    }

    pub fn toggle_pinned(&mut self) {
        self.pinned = !self.pinned;
    }
}

// ──────────────────────────────────────────────
// File tree inline rename state
// ──────────────────────────────────────────────

pub(crate) struct FileTreeRenameState {
    pub entry_index: usize,
    pub original_path: PathBuf,
    pub input: InputLine,
}

// ──────────────────────────────────────────────
// ModalStack
// ──────────────────────────────────────────────

pub(crate) struct ModalStack {
    pub file_finder: Option<FileFinderState>,
    pub git_switcher: Option<GitSwitcherState>,
    pub config_page: Option<ConfigPageState>,
    pub save_as_input: Option<SaveAsInput>,
    pub save_confirm: Option<SaveConfirmState>,
    pub context_menu: Option<ContextMenuState>,
    pub context_comment_composer: Option<ContextCommentComposerState>,
    pub file_tree_rename: Option<FileTreeRenameState>,
    pub branch_cleanup: Option<BranchCleanupState>,
}

impl ModalStack {
    pub fn new() -> Self {
        Self {
            file_finder: None,
            git_switcher: None,
            config_page: None,
            save_as_input: None,
            save_confirm: None,
            context_menu: None,
            context_comment_composer: None,
            file_tree_rename: None,
            branch_cleanup: None,
        }
    }

    /// Whether any popup/modal overlay is currently open.
    #[allow(dead_code)]
    pub fn is_any_open(&self) -> bool {
        self.file_finder.is_some()
            || self.git_switcher.is_some()
            || self.config_page.is_some()
            || self.save_as_input.is_some()
            || self.save_confirm.is_some()
            || self.context_menu.is_some()
            || self.context_comment_composer.is_some()
            || self.file_tree_rename.is_some()
            || self.branch_cleanup.is_some()
    }

    /// Clear save_confirm and return whether it was set.
    pub fn clear_save_confirm(&mut self) -> bool {
        self.save_confirm.take().is_some()
    }

    /// Clear branch_cleanup and return whether it was set.
    pub fn clear_branch_cleanup(&mut self) -> bool {
        self.branch_cleanup.take().is_some()
    }

    /// Clear file_finder and return whether it was set.
    pub fn clear_file_finder(&mut self) -> bool {
        self.file_finder.take().is_some()
    }

    /// Close all popups/modals.
    #[allow(dead_code)]
    pub fn close_all(&mut self) {
        self.file_finder = None;
        self.git_switcher = None;
        self.config_page = None;
        self.save_as_input = None;
        self.save_confirm = None;
        self.context_menu = None;
        self.context_comment_composer = None;
        self.file_tree_rename = None;
        self.branch_cleanup = None;
    }
}
