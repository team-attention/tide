// Git switcher popup state (branch + worktree switcher). Extracted from
// modal/mod.rs; re-exported there so `crate::GitSwitcherState` etc. are unchanged.

use crate::tide_core::Rect;

use super::*;

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
