// ModalStack and all modal state types.

use std::path::PathBuf;
use tide_core::{PaneId, Rect, Vec2};
use crate::theme::{POPUP_INPUT_PADDING, POPUP_LINE_EXTRA, CONTEXT_MENU_W};
use super::state::input_line::{InputLine, abbreviate_path, expand_tilde};

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

pub(crate) const FILE_FINDER_POPUP_W: f32 = 500.0;
pub(crate) const FILE_FINDER_MAX_VISIBLE: usize = 12;

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
    pub entries: Vec<PathBuf>,          // all files (relative to base_dir)
    pub filtered: Vec<usize>,           // indices into entries
    pub selected: usize,                // index into filtered
    pub scroll_offset: usize,           // scroll offset in filtered list
    /// When set, the selected file replaces this pane (e.g. a Launcher) instead of opening a new tab.
    pub replace_pane_id: Option<tide_core::PaneId>,
}

impl FileFinderState {
    pub fn new(base_dir: PathBuf, entries: Vec<PathBuf>) -> Self {
        let filtered: Vec<usize> = (0..entries.len()).collect();
        Self {
            input: InputLine::new(),
            base_dir,
            entries,
            filtered,
            selected: 0,
            scroll_offset: 0,
            replace_pane_id: None,
        }
    }

    /// Compute popup geometry given cell size and logical window dimensions.
    pub fn geometry(&self, cell_height: f32, logical_width: f32, _logical_height: f32) -> FileFinderGeometry {
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

    pub fn selected_path(&self) -> Option<PathBuf> {
        let idx = *self.filtered.get(self.selected)?;
        let rel = self.entries.get(idx)?;
        Some(self.base_dir.join(rel))
    }

    fn filter(&mut self) {
        if self.input.is_empty() {
            self.filtered = (0..self.entries.len()).collect();
        } else {
            let query_lower = self.input.text.to_lowercase();
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
    Delete(usize),     // filtered index
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

pub(crate) const GIT_SWITCHER_POPUP_W: f32 = 320.0;
pub(crate) const GIT_SWITCHER_MAX_VISIBLE: usize = 8;

pub(crate) struct GitSwitcherState {
    pub pane_id: PaneId,
    pub input: InputLine,
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
    /// True when the owning terminal has a running process (hides Switch/Delete buttons)
    pub shell_busy: bool,
    /// When Some(fi), the row at filtered index `fi` shows a "Confirm delete?" prompt
    pub delete_confirm: Option<usize>,
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
            input: InputLine::new(),
            mode,
            branches,
            worktrees,
            filtered_branches,
            filtered_worktrees,
            selected: 0,
            scroll_offset: 0,
            anchor_rect,
            worktree_branch_names,
            shell_busy: false,
            delete_confirm: None,
        }
    }

    /// Compute popup geometry given cell size and logical window dimensions.
    pub fn geometry(&self, cell_height: f32, logical_width: f32, logical_height: f32) -> GitSwitcherGeometry {
        // Git switcher uses 36px rows to match Pen design (spacious branch items)
        let line_height = 36.0_f32.max(cell_height + POPUP_LINE_EXTRA);
        let tab_h = 32.0_f32; // per Pen design
        let input_h = 36.0_f32; // per Pen design
        let popup_w = GIT_SWITCHER_POPUP_W;
        let popup_x = self.anchor_rect.x.min(logical_width - popup_w - 4.0).max(0.0);
        let current_len = self.current_filtered_len();
        let max_visible = GIT_SWITCHER_MAX_VISIBLE.min(current_len);
        let new_wt_btn_h = 0.0;
        // input_y = popup_y + 2.0, tab_y = input_y + input_h, tab_sep_y = tab_y + tab_h
        // list_top = tab_sep_y + 4.0 (4px top padding on list per Pen)
        let hint_bar_h = 28.0_f32;
        let content_h = 2.0 + input_h + tab_h + 4.0 + max_visible as f32 * line_height + new_wt_btn_h + 4.0 + hint_bar_h;
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
        let list_top = popup_y + 2.0 + input_h + tab_h + 4.0;

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

    pub fn toggle_mode(&mut self) {
        let new_mode = match self.mode {
            GitSwitcherMode::Branches => GitSwitcherMode::Worktrees,
            GitSwitcherMode::Worktrees => GitSwitcherMode::Branches,
        };
        self.set_mode(new_mode);
    }

    pub fn set_mode(&mut self, mode: GitSwitcherMode) {
        self.mode = mode;
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
        let q = self.input.text.trim();
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


    fn filter(&mut self) {
        let query_lower = self.input.text.to_lowercase();
        if self.input.is_empty() {
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
// Context menu state (right-click on file tree)
// ──────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ContextMenuAction {
    CdHere,
    OpenTerminalHere,
    RevealInFinder,
    Rename,
    Delete,
}

impl ContextMenuAction {
    const FILE_ACTIONS: [ContextMenuAction; 2] = [ContextMenuAction::Rename, ContextMenuAction::Delete];
    const DIR_ACTIONS: [ContextMenuAction; 5] = [ContextMenuAction::CdHere, ContextMenuAction::OpenTerminalHere, ContextMenuAction::RevealInFinder, ContextMenuAction::Rename, ContextMenuAction::Delete];
    const DIR_ACTIONS_BUSY: [ContextMenuAction; 4] = [ContextMenuAction::OpenTerminalHere, ContextMenuAction::RevealInFinder, ContextMenuAction::Rename, ContextMenuAction::Delete];

    pub fn items(is_dir: bool, shell_idle: bool) -> &'static [ContextMenuAction] {
        if is_dir {
            if shell_idle { &Self::DIR_ACTIONS } else { &Self::DIR_ACTIONS_BUSY }
        } else {
            &Self::FILE_ACTIONS
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            ContextMenuAction::CdHere => "cd",
            ContextMenuAction::OpenTerminalHere => "Open Terminal Here",
            ContextMenuAction::RevealInFinder => "Open in Finder",
            ContextMenuAction::Rename => "Rename",
            ContextMenuAction::Delete => "Delete",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            ContextMenuAction::CdHere => "\u{f07b}",  // folder icon
            ContextMenuAction::OpenTerminalHere => "\u{f120}",  // terminal icon
            ContextMenuAction::RevealInFinder => "\u{f07c}",  // folder-open icon
            ContextMenuAction::Rename => "\u{f044}",  //
            ContextMenuAction::Delete => "\u{f1f8}",  //
        }
    }
}

pub(crate) struct ContextMenuState {
    pub entry_index: usize,
    pub path: PathBuf,
    pub is_dir: bool,
    pub shell_idle: bool,
    pub position: Vec2,
    pub selected: usize,
}

impl ContextMenuState {
    pub fn items(&self) -> &'static [ContextMenuAction] {
        ContextMenuAction::items(self.is_dir, self.shell_idle)
    }

    /// Compute the popup rect, clamped to window bounds.
    pub fn geometry(&self, cell_height: f32, logical_width: f32, logical_height: f32) -> Rect {
        let line_height = cell_height + POPUP_LINE_EXTRA;
        let item_count = self.items().len() as f32;
        let popup_w = CONTEXT_MENU_W;
        let popup_h = item_count * line_height + 8.0;  // items + padding
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
    pub bindings: Vec<(tide_input::GlobalAction, tide_input::Hotkey)>,
    pub dirty: bool,
}

impl ConfigPageState {
    pub fn new(
        bindings: Vec<(tide_input::GlobalAction, tide_input::Hotkey)>,
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
// Branch cleanup state (confirmation when closing terminal on feature branch)
// ──────────────────────────────────────────────

pub(crate) struct BranchCleanupState {
    pub pane_id: PaneId,
    pub branch: String,
    pub worktree_path: Option<PathBuf>,  // Some if in a worktree
    pub cwd: PathBuf,
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
        self.file_tree_rename = None;
        self.branch_cleanup = None;
    }
}
