use crate::tide_core::{Rect, Vec2};

use crate::state::drag_types::{DropDestination, HoverTarget};
use crate::pane::PaneKind;
use crate::theme::*;
use crate::App;
use crate::DockPort;
use crate::AppCorePort;
use crate::LayoutPort;
use crate::WorkspaceNavPort;
use crate::PaneLifecyclePort;

impl App {
    /// Handle a browser nav bar click based on hover target.
    pub(crate) fn handle_browser_nav_click(&mut self, target: &HoverTarget) {
        let focused_id = match self.focus.focused {
            Some(id) => id,
            None => return,
        };
        match target {
            HoverTarget::BrowserBack => {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused_id) {
                    bp.go_back();
                }
            }
            HoverTarget::BrowserForward => {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused_id) {
                    bp.go_forward();
                }
            }
            HoverTarget::BrowserRefresh => {
                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused_id) {
                    bp.reload();
                }
            }
            HoverTarget::BrowserUrlBar => {
                // Compute geometry before mutably borrowing panes.
                let cell_w = self.cell_size().width;
                let click_x = self.window.last_cursor_pos.x;
                let pane_rect = self.visual_pane_rects.iter()
                    .find(|(id, _)| *id == focused_id)
                    .map(|&(_, r)| r);

                if let Some(PaneKind::Browser(bp)) = self.panes.get_mut(&focused_id) {
                    if !bp.url_input_focused {
                        bp.url_input_focused = true;
                        bp.url_input = bp.url.clone();
                        // Select all on initial focus (standard browser behavior)
                        let len = bp.url_input_char_len();
                        bp.url_selection = Some((0, len));
                        bp.url_input_cursor = len;
                    } else {
                        // Already focused: position cursor at click, clear selection
                        bp.url_selection = None;
                        if let Some(rect) = pane_rect {
                            let nav_x = rect.x + crate::theme::PANE_PADDING;
                            let url_text_x = nav_x + 8.0 + cell_w * 6.0 + 4.0 + 4.0;
                            let relative_x = (click_x - url_text_x).max(0.0);
                            let mut col_px = 0.0_f32;
                            let mut char_idx = 0;
                            for ch in bp.url_input.chars() {
                                let w = unicode_width::UnicodeWidthChar::width(ch).unwrap_or(1) as f32 * cell_w;
                                if relative_x < col_px + w * 0.5 {
                                    break;
                                }
                                col_px += w;
                                char_idx += 1;
                            }
                            bp.url_input_cursor = char_idx;
                        } else {
                            bp.url_input_cursor = bp.url_input.chars().count();
                        }
                    }
                }
            }
            _ => {}
        }
        self.cache.invalidate_chrome();
    }

    /// Handle notification bar button clicks (conflict bar + save confirm bar).
    /// Checks all editor panes. Returns true if the click was consumed.
    pub(crate) fn handle_notification_bar_click(&mut self, pos: Vec2) -> bool {
        // Try save confirm bar first
        if let Some(ref sc) = self.modal.save_confirm {
            let pane_id = sc.pane_id;
            if let Some(bar_rect) = self.notification_bar_rect(pane_id) {
                if pos.y >= bar_rect.y && pos.y <= bar_rect.y + bar_rect.height
                    && pos.x >= bar_rect.x && pos.x <= bar_rect.x + bar_rect.width
                {
                    let cell_size = self.cell_size();
                    let btn_pad = 8.0;

                    // Cancel (rightmost)
                    let cancel_w = 6.0 * cell_size.width + btn_pad * 2.0;
                    let cancel_x = bar_rect.x + bar_rect.width - cancel_w - 4.0;

                    // Don't Save
                    let dont_save_w = 10.0 * cell_size.width + btn_pad * 2.0;
                    let dont_save_x = cancel_x - dont_save_w - 4.0;

                    // Save
                    let save_w = 4.0 * cell_size.width + btn_pad * 2.0;
                    let save_x = dont_save_x - save_w - 4.0;

                    if pos.x >= cancel_x {
                        self.cancel_save_confirm();
                    } else if pos.x >= dont_save_x {
                        self.confirm_discard_and_close();
                    } else if pos.x >= save_x {
                        self.confirm_save_and_close();
                    }
                    self.cache.needs_redraw = true;
                    return true;
                }
            }
        }

        // Try conflict bar
        if self.handle_conflict_bar_click_inner(pos) {
            return true;
        }

        false
    }

    /// Get the notification bar rect for a pane.
    fn notification_bar_rect(&self, pane_id: crate::tide_core::PaneId) -> Option<Rect> {
        let content_top_off = TAB_BAR_HEIGHT;
        if let Some(&(_, rect)) = self.visual_pane_rects.iter().find(|(id, _)| *id == pane_id) {
            let content_top = rect.y + content_top_off;
            let bar_x = rect.x + PANE_PADDING;
            let bar_w = rect.width - 2.0 * PANE_PADDING;
            return Some(Rect::new(bar_x, content_top, bar_w, CONFLICT_BAR_HEIGHT));
        }
        None
    }

    /// Handle conflict bar button click for any pane. Returns true if the click was consumed.
    fn handle_conflict_bar_click_inner(&mut self, pos: Vec2) -> bool {
        // Find which pane has a conflict bar under the click
        let mut target_pane: Option<(crate::tide_core::PaneId, Rect)> = None;

        let content_top_off = TAB_BAR_HEIGHT;
        for &(id, rect) in &self.visual_pane_rects {
            if let Some(PaneKind::Editor(pane)) = self.panes.get(&id) {
                if pane.needs_notification_bar() {
                    let content_top = rect.y + content_top_off;
                    let bar_x = rect.x + PANE_PADDING;
                    let bar_w = rect.width - 2.0 * PANE_PADDING;
                    let bar_rect = Rect::new(bar_x, content_top, bar_w, CONFLICT_BAR_HEIGHT);
                    if pos.y >= bar_rect.y && pos.y <= bar_rect.y + CONFLICT_BAR_HEIGHT
                        && pos.x >= bar_rect.x && pos.x <= bar_rect.x + bar_rect.width
                    {
                        target_pane = Some((id, bar_rect));
                        break;
                    }
                }
            }
        }

        let (pane_id, bar_rect) = match target_pane {
            Some(t) => t,
            None => return false,
        };

        let cell_size = self.cell_size();

        let is_deleted = self.panes.get(&pane_id)
            .and_then(|pk| if let PaneKind::Editor(ep) = pk { Some(ep.file_deleted) } else { None })
            .unwrap_or(false);

        let btn_pad = 8.0;

        // Overwrite button (rightmost)
        let overwrite_w = 9.0 * cell_size.width + btn_pad * 2.0;
        let overwrite_x = bar_rect.x + bar_rect.width - overwrite_w - 4.0;

        // Reload button (not for deleted files)
        let reload_w = 6.0 * cell_size.width + btn_pad * 2.0;
        let reload_x = overwrite_x - reload_w - 4.0;

        if pos.x >= overwrite_x {
            if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
                if let Err(e) = pane.editor.buffer.save() {
                    log::error!("Conflict overwrite failed: {}", e);
                }
                pane.disk_changed = false;
                pane.file_deleted = false;
                pane.diff_mode = false;
                pane.disk_content = None;
            }
        } else if !is_deleted && pos.x >= reload_x {
            if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
                if let Err(e) = pane.editor.reload() {
                    log::error!("Reload failed: {}", e);
                }
                pane.disk_changed = false;
                pane.file_deleted = false;
                pane.diff_mode = false;
                pane.disk_content = None;
            }
        }

        self.cache.invalidate_chrome();
        self.cache.invalidate_pane(pane_id);
        true
    }

    /// Handle click when config page is open.
    pub(crate) fn handle_config_page_click(&mut self, pos: Vec2) {
        use crate::state::ConfigSection;

        let logical = self.logical_size();
        let popup_w = crate::theme::CONFIG_PAGE_W.min(logical.width - 80.0).max(300.0);
        let popup_h = crate::theme::CONFIG_PAGE_MAX_H.min(logical.height - 80.0).max(200.0);
        let popup_x = (logical.width - popup_w) / 2.0;
        let popup_y = (logical.height - popup_h) / 2.0;
        let popup_rect = Rect::new(popup_x, popup_y, popup_w, popup_h);

        // Click outside popup → close
        if !popup_rect.contains(pos) {
            self.close_config_page();
            return;
        }

        let cell_size = self.cell_size();
        let cell_height = cell_size.height;

        // Title bar area
        let title_h = crate::theme::CONFIG_PAGE_TITLE_H;
        let title_y = popup_y + 2.0;

        // Tab bar area
        let tab_h = crate::theme::CONFIG_PAGE_TAB_H;
        let tab_y = title_y + title_h + 1.0;
        let half_w = popup_w / 2.0;

        // Click on tab bar → switch section
        if pos.y >= tab_y && pos.y < tab_y + tab_h {
            if let Some(ref mut page) = self.modal.config_page {
                if pos.x < popup_x + half_w {
                    page.section = ConfigSection::Keybindings;
                } else {
                    page.section = ConfigSection::Worktree;
                }
                page.selected = 0;
                page.scroll_offset = 0;
            }
            self.cache.invalidate_chrome();
            return;
        }

        // Content area
        let content_top = tab_y + tab_h + 1.0;
        let hint_bar_h = crate::theme::CONFIG_PAGE_HINT_BAR_H;
        let content_bottom = popup_y + popup_h - hint_bar_h;
        let line_height = 32.0_f32.max(cell_height + crate::theme::POPUP_LINE_EXTRA);

        if pos.y >= content_top && pos.y < content_bottom {
            if let Some(ref mut page) = self.modal.config_page {
                match page.section {
                    ConfigSection::Keybindings => {
                        let vi = ((pos.y - content_top) / line_height).floor() as usize;
                        let fi = page.scroll_offset + vi;
                        if fi < page.bindings.len() {
                            page.selected = fi;
                        }
                    }
                    ConfigSection::Worktree => {
                        let input_h = cell_height + crate::theme::POPUP_INPUT_PADDING;

                        // Base dir pattern input field
                        let wt_input_y = content_top + 8.0 + line_height + 4.0;
                        if pos.y >= wt_input_y && pos.y < wt_input_y + input_h {
                            page.selected_field = 0;
                            page.worktree_editing = true;
                            page.copy_files_editing = false;
                        }

                        // Copy files input field
                        let help_y = wt_input_y + input_h + 8.0;
                        let cf_label_y = help_y + cell_height + 12.0;
                        let cf_input_y = cf_label_y + line_height + 4.0;
                        if pos.y >= cf_input_y && pos.y < cf_input_y + input_h {
                            page.selected_field = 1;
                            page.copy_files_editing = true;
                            page.worktree_editing = false;
                        }
                    }
                }
            }
            self.cache.invalidate_chrome();
        }
    }

    /// Handle branch cleanup bar button clicks.
    /// Returns true if the click was consumed.
    pub(crate) fn handle_branch_cleanup_click(&mut self, pos: crate::tide_core::Vec2) -> bool {
        let bc_pane_id = match self.modal.branch_cleanup {
            Some(ref bc) => bc.pane_id,
            None => return false,
        };
        let bar_rect = match self.notification_bar_rect(bc_pane_id) {
            Some(r) => r,
            None => return false,
        };
        if pos.y < bar_rect.y || pos.y > bar_rect.y + bar_rect.height
            || pos.x < bar_rect.x || pos.x > bar_rect.x + bar_rect.width
        {
            return false;
        }
        let cell_size = self.cell_size();
        let btn_pad = 8.0;

        // Cancel (rightmost)
        let cancel_w = 6.0 * cell_size.width + btn_pad * 2.0;
        let cancel_x = bar_rect.x + bar_rect.width - cancel_w - 4.0;

        // Keep
        let keep_w = 4.0 * cell_size.width + btn_pad * 2.0;
        let keep_x = cancel_x - keep_w - 4.0;

        // Delete
        let delete_w = 6.0 * cell_size.width + btn_pad * 2.0;
        let delete_x = keep_x - delete_w - 4.0;

        if pos.x >= cancel_x {
            self.cancel_branch_cleanup();
        } else if pos.x >= keep_x {
            self.confirm_branch_keep();
        } else if pos.x >= delete_x {
            self.confirm_branch_delete();
        }
        self.cache.needs_redraw = true;
        true
    }

    /// Handle a completed drop operation.
    /// Center zone swaps source and target. Directional zones create a new split.
    pub(crate) fn handle_drop(&mut self, source: crate::tide_core::PaneId, dest: DropDestination) {
        use crate::tide_core::{DropZone, LayoutEngine, SplitDirection};

        match dest {
            DropDestination::TreeRoot(zone) => {
                // Remove source from its current location
                self.layout.remove(source);
                // Insert at root level
                self.layout.insert_at_root(source, zone);
                self.focus.focused = Some(source);
                self.cache.invalidate_chrome();
                self.compute_layout();
            }
            DropDestination::DockRoot(zone) => {
                let was_pinned = self.is_pane_pinned(source);
                if was_pinned {
                    self.dock.pinned_dock_layout.remove(source);
                    let assoc_tid = self.assoc.associated_terminal.get(&source).copied();
                    let current_tid = self.focused_terminal_id();
                    if assoc_tid == current_tid {
                        // Same terminal: place with drop zone (normal behavior)
                        if let Some(tid) = current_tid {
                            if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                                tp.dock_layout.insert_at_root(source, zone);
                                tp.dock_focused = Some(source);
                                tp.dock_layout.set_active_tab(source);
                            }
                        }
                    } else {
                        // Different terminal: just unpin to associated terminal, no placement
                        if let Some(tid) = assoc_tid {
                            if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                                if tp.dock_layout.all_pane_ids().is_empty() {
                                    tp.dock_layout.insert_leaf_group(source);
                                } else {
                                    tp.dock_layout.add_tab_to_first_group(source);
                                }
                            }
                        }
                    }
                } else {
                    if let Some(tid) = self.terminal_owning(source) {
                        if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                            tp.dock_layout.remove(source);
                        }
                    }
                    // Insert into focused terminal's dock_layout
                    if let Some(tid) = self.focused_terminal_id() {
                        if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                            tp.dock_layout.insert_at_root(source, zone);
                            tp.dock_focused = Some(source);
                            tp.dock_layout.set_active_tab(source);
                        }
                        self.assoc.associated_terminal.insert(source, tid);
                    }
                }
                self.cache.invalidate_chrome();
                self.compute_layout();
            }
            DropDestination::TreePane(target_id, zone) => {
                // Drop: remove source, insert as new split next to target
                if source == target_id && zone == DropZone::Center {
                    return; // Can't drop on self as tab
                }
                let (direction, insert_first) = match zone {
                    DropZone::Top => (SplitDirection::Vertical, true),
                    DropZone::Bottom => (SplitDirection::Vertical, false),
                    DropZone::Left => (SplitDirection::Horizontal, true),
                    DropZone::Right => (SplitDirection::Horizontal, false),
                    DropZone::Center => (SplitDirection::Vertical, false), // Center = add below
                };

                let source_in_dock = self.is_pane_in_dock(source);
                let target_in_dock = self.is_pane_in_dock(target_id);

                if source_in_dock && target_in_dock {
                    let source_was_pinned = self.is_pane_pinned(source);
                    if source_was_pinned {
                        self.dock.pinned_dock_layout.remove(source);
                        // If dropping on a non-owning terminal, just unpin to associated terminal
                        let assoc_tid = self.assoc.associated_terminal.get(&source).copied();
                        let current_tid = self.focused_terminal_id();
                        if assoc_tid != current_tid {
                            if let Some(tid) = assoc_tid {
                                if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                                    if tp.dock_layout.all_pane_ids().is_empty() {
                                        tp.dock_layout.insert_leaf_group(source);
                                    } else {
                                        tp.dock_layout.add_tab_to_first_group(source);
                                    }
                                }
                            }
                            self.cache.invalidate_chrome();
                            self.compute_layout();
                            self.cache.needs_redraw = true;
                            return;
                        }
                    }
                    // Both panes in dock — route to the owning terminal's dock_layout
                    if let Some(tid) = self.terminal_owning(source) {
                        if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                            if source == target_id {
                                // Self-drop from tab group: find a sibling tab to use as split target
                                if let Some(tg) = tp.dock_layout.tab_group_containing(source) {
                                    let sibling = tg.tabs.iter().find(|&&t| t != source).copied();
                                    if let Some(sib) = sibling {
                                        tp.dock_layout.remove(source);
                                        tp.dock_layout.split_with_leaf_group(sib, source, direction, insert_first);
                                    }
                                }
                            } else {
                                tp.dock_layout.remove(source);
                                if zone == DropZone::Center {
                                    if !tp.dock_layout.add_tab(target_id, source) {
                                        tp.dock_layout.add_tab_to_first_group(source);
                                    }
                                } else {
                                    tp.dock_layout.split_with_leaf_group(target_id, source, direction, insert_first);
                                }
                            }
                            tp.dock_layout.set_active_tab(source);
                        }
                    }
                } else {
                    let insert_first = match zone {
                        DropZone::Top | DropZone::Left => true,
                        _ => false,
                    };
                    self.layout.remove(source);
                    self.layout.insert_pane(target_id, source, direction, insert_first);
                }
                self.focus.focused = Some(source);
                self.cache.invalidate_chrome();
                self.compute_layout();
            }
            DropDestination::Workspace(target_idx) => {
                // move_pane_to_workspace calls switch_workspace which sets needs_redraw
                self.move_pane_to_workspace(source, target_idx);
            }
            DropDestination::PinnedGroup => {
                // Drag into pinned group = pin the pane (use toggle_dock_pin logic)
                if !self.is_pane_pinned(source) {
                    // Temporarily focus the source so toggle_dock_pin finds it
                    let prev = self.focus.focused;
                    self.focus.focused = Some(source);
                    self.toggle_dock_pin();
                    self.focus.focused = prev;
                }
            }
        }
        self.cache.needs_redraw = true;
    }
}
