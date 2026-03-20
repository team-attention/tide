// Layout computation and geometry utility methods extracted from main.rs

use crate::tide_core::{LayoutEngine, PaneDecorations, Rect, Size, SplitDirection};

use crate::state::drag_types::HoverTarget;
use crate::pane::PaneKind;
use crate::theme::*;
use crate::state::LayoutSide;
use crate::App;
use crate::DockPort;
use crate::AppCorePort;
use crate::LayoutPort;

impl crate::application::ports::inward::LayoutPort for App {
    fn update_cursor_icon(&self, window: &crate::tide_platform::WindowProxy) {
        use crate::tide_platform::CursorIcon;
        let icon = match &self.interaction.hover_target {
            Some(HoverTarget::FileTreeEntry(_))
            | Some(HoverTarget::PaneTabBar(_))
            | Some(HoverTarget::PaneTabClose(_))
            | Some(HoverTarget::FileFinderItem(_))
            | Some(HoverTarget::TitlebarSwap)
            | Some(HoverTarget::TitlebarSettings)
            | Some(HoverTarget::TitlebarTheme)
            | Some(HoverTarget::TitlebarFileTree)
            | Some(HoverTarget::TitlebarWorkspace)
            | Some(HoverTarget::TitlebarDock)
            | Some(HoverTarget::PaneMaximize(_))
            | Some(HoverTarget::BrowserBack)
            | Some(HoverTarget::BrowserForward)
            | Some(HoverTarget::BrowserRefresh)
            | Some(HoverTarget::BrowserUrlBar)
            | Some(HoverTarget::WorkspaceSidebarItem(_))
            | Some(HoverTarget::WorkspaceSidebarNewBtn) => CursorIcon::Pointer,
            Some(HoverTarget::EditorScrollbar(_)) => CursorIcon::Default,
            Some(HoverTarget::SidebarHandle) => CursorIcon::Grab,
            Some(HoverTarget::FileTreeBorder) | Some(HoverTarget::WsSidebarBorder) | Some(HoverTarget::DockBorder) => CursorIcon::ColResize,
            Some(HoverTarget::SplitBorder(SplitDirection::Horizontal)) => CursorIcon::ColResize,
            Some(HoverTarget::SplitBorder(SplitDirection::Vertical)) => CursorIcon::RowResize,
            None => CursorIcon::Default,
        };
        window.set_cursor_icon(icon);
    }

    /// Check if a position is on a file finder item. Returns the index into filtered list.
    fn file_finder_item_at(&self, pos: crate::tide_core::Vec2) -> Option<usize> {
        let finder = self.modal.file_finder.as_ref()?;
        let cell_size = self.cell_size();
        let logical = self.logical_size();
        let geo = finder.geometry(cell_size.height, logical.width, logical.height);

        if pos.y < geo.list_top || pos.x < geo.popup_x || pos.x > geo.popup_x + geo.popup_w {
            return None;
        }

        let rel_y = pos.y - geo.list_top;
        let vi = (rel_y / geo.line_height) as usize;
        if vi >= geo.max_visible {
            return None;
        }
        let idx = vi + finder.scroll_offset;
        if idx < finder.filtered.len() {
            Some(idx)
        } else {
            None
        }
    }

    /// Hit-test the git switcher popup. Returns the filtered index of the item under pos.
    fn git_switcher_item_at(&self, pos: crate::tide_core::Vec2) -> Option<usize> {
        let gs = self.modal.git_switcher.as_ref()?;
        let cell_size = self.cell_size();
        let logical = self.logical_size();
        let geo = gs.geometry(cell_size.height, logical.width, logical.height);

        if pos.x < geo.popup_x || pos.x > geo.popup_x + geo.popup_w || pos.y < geo.list_top {
            return None;
        }

        let rel_y = pos.y - geo.list_top;
        let vi = (rel_y / geo.line_height) as usize;
        // Don't select items beyond the visible rows (e.g. clicks in the button area below)
        if vi >= geo.max_visible {
            return None;
        }
        let idx = vi + gs.scroll_offset;
        if idx < gs.current_filtered_len() {
            Some(idx)
        } else {
            None
        }
    }

    /// Check if a position is inside the git switcher popup area.
    fn git_switcher_contains(&self, pos: crate::tide_core::Vec2) -> bool {
        if let Some(ref gs) = self.modal.git_switcher {
            let cs = self.cell_size();
            let logical = self.logical_size();
            let geo = gs.geometry(cs.height, logical.width, logical.height);
            let popup_rect = Rect::new(geo.popup_x, geo.popup_y, geo.popup_w, geo.popup_h);
            return popup_rect.contains(pos);
        }
        false
    }

    /// Hit-test the git switcher popup tab bar. Returns the mode for the clicked tab.
    fn git_switcher_tab_at(&self, pos: crate::tide_core::Vec2) -> Option<crate::GitSwitcherMode> {
        let gs = self.modal.git_switcher.as_ref()?;
        let cell_size = self.cell_size();
        let cell_height = cell_size.height;
        let logical = self.logical_size();
        let geo = gs.geometry(cell_height, logical.width, logical.height);

        // Tab bar is between input and list area
        let tab_y = geo.popup_y + 2.0 + geo.input_h;
        let tab_h = geo.tab_h;
        if pos.y < tab_y || pos.y > tab_y + tab_h {
            return None;
        }
        if pos.x < geo.popup_x || pos.x > geo.popup_x + geo.popup_w {
            return None;
        }
        let half_w = geo.popup_w / 2.0;
        if pos.x < geo.popup_x + half_w {
            Some(crate::GitSwitcherMode::Branches)
        } else {
            Some(crate::GitSwitcherMode::Worktrees)
        }
    }

    /// Hit-test the git switcher popup for button clicks (both Branches and Worktrees tabs).
    fn git_switcher_button_at(&self, pos: crate::tide_core::Vec2) -> Option<crate::SwitcherButton> {
        let gs = self.modal.git_switcher.as_ref()?;
        let cell_size = self.cell_size();
        let cell_height = cell_size.height;
        let logical = self.logical_size();
        let geo = gs.geometry(cell_height, logical.width, logical.height);

        // Check per-item buttons
        if pos.y < geo.list_top {
            return None;
        }
        let rel_y = pos.y - geo.list_top;
        let vi = (rel_y / geo.line_height) as usize;
        if vi >= geo.max_visible {
            return None;
        }
        let fi = gs.scroll_offset + vi;
        if fi >= gs.current_filtered_len() {
            return None;
        }

        let y = geo.list_top + vi as f32 * geo.line_height;
        let btn_h = cell_height + 4.0;
        let btn_y = y + (geo.line_height - btn_h) / 2.0;
        if pos.y < btn_y || pos.y > btn_y + btn_h {
            return None;
        }

        let busy = gs.shell_busy;

        // New button layout: [Switch (filled)] [New Pane (outlined)]
        // Button sizing matches render_action_buttons in overlays.rs
        let btn_pad_h = 10.0_f32;
        let item_pad = 12.0_f32;
        let btn_gap = 8.0_f32;

        // Create row: buttons vary by mode (no create when busy)
        if gs.is_create_row(fi) {
            if busy { return None; }
            let btn_right = geo.popup_x + geo.popup_w - item_pad;

            if gs.mode == crate::GitSwitcherMode::Worktrees {
                // Worktrees: single "New Pane" button
                let new_pane_label = "New Pane";
                let new_pane_w = new_pane_label.len() as f32 * cell_size.width + btn_pad_h * 2.0;
                let new_pane_x = btn_right - new_pane_w;
                if pos.x >= new_pane_x && pos.x <= new_pane_x + new_pane_w {
                    return Some(crate::SwitcherButton::NewPane(fi));
                }
            } else {
                // Branches: "New Pane" + "Switch"
                let mut cur_right = btn_right;

                let new_pane_label = "New Pane";
                let new_pane_w = new_pane_label.len() as f32 * cell_size.width + btn_pad_h * 2.0;
                let new_pane_x = cur_right - new_pane_w;
                if pos.x >= new_pane_x && pos.x <= new_pane_x + new_pane_w {
                    return Some(crate::SwitcherButton::NewPane(fi));
                }
                cur_right = new_pane_x - btn_gap;

                let switch_label = "Switch";
                let switch_w = switch_label.len() as f32 * cell_size.width + btn_pad_h * 2.0;
                let switch_x = cur_right - switch_w;
                if pos.x >= switch_x && pos.x <= switch_x + switch_w {
                    return Some(crate::SwitcherButton::Switch(fi));
                }
            }
            return None;
        }

        let delete_btn_w_normal = cell_size.width + btn_pad_h * 2.0;
        let confirming = gs.delete_confirm == Some(fi);
        let delete_btn_w = if confirming {
            "Delete?".len() as f32 * cell_size.width + btn_pad_h * 2.0
        } else {
            delete_btn_w_normal
        };

        match gs.mode {
            crate::GitSwitcherMode::Branches => {
                let entry_idx = gs.filtered_branches[fi];
                let branch = &gs.branches[entry_idx];
                if branch.is_current {
                    return None;
                }

                let mut btn_right = geo.popup_x + geo.popup_w - item_pad;

                // [New Pane] button
                let new_pane_label = "New Pane";
                let new_pane_w = new_pane_label.len() as f32 * cell_size.width + btn_pad_h * 2.0;
                let new_pane_x = btn_right - new_pane_w;
                if pos.x >= new_pane_x && pos.x <= new_pane_x + new_pane_w {
                    return Some(crate::SwitcherButton::NewPane(fi));
                }

                if !busy {
                    btn_right = new_pane_x - btn_gap;

                    // [Switch] button -- hidden when busy
                    let switch_label = "Switch";
                    let switch_w = switch_label.len() as f32 * cell_size.width + btn_pad_h * 2.0;
                    let switch_x = btn_right - switch_w;
                    if pos.x >= switch_x && pos.x <= switch_x + switch_w {
                        return Some(crate::SwitcherButton::Switch(fi));
                    }
                    btn_right = switch_x - btn_gap;

                    // [Delete] button -- outlined red (or "Delete?" when confirming)
                    let del_x = btn_right - delete_btn_w;
                    if pos.x >= del_x && pos.x <= del_x + delete_btn_w {
                        return Some(crate::SwitcherButton::Delete(fi));
                    }
                }
            }
            crate::GitSwitcherMode::Worktrees => {
                let entry_idx = gs.filtered_worktrees[fi];
                let wt = &gs.worktrees[entry_idx];
                if wt.is_current {
                    return None;
                }

                let mut btn_right = geo.popup_x + geo.popup_w - item_pad;

                // Worktrees: single "New Pane" button (no Switch)
                let new_pane_label = "New Pane";
                let new_pane_w = new_pane_label.len() as f32 * cell_size.width + btn_pad_h * 2.0;
                let new_pane_x = btn_right - new_pane_w;
                if pos.x >= new_pane_x && pos.x <= new_pane_x + new_pane_w {
                    return Some(crate::SwitcherButton::NewPane(fi));
                }

                // [Delete] button -- hidden when busy or main worktree
                if !busy && !wt.is_main {
                    btn_right = new_pane_x - btn_gap;
                    let del_x = btn_right - delete_btn_w;
                    if pos.x >= del_x && pos.x <= del_x + delete_btn_w {
                        return Some(crate::SwitcherButton::Delete(fi));
                    }
                }
            }
        }

        None
    }

    /// Check if a position is inside the file finder popup area.
    fn file_finder_contains(&self, pos: crate::tide_core::Vec2) -> bool {
        if let Some(ref finder) = self.modal.file_finder {
            let cell_size = self.cell_size();
            let logical = self.logical_size();
            let geo = finder.geometry(cell_size.height, logical.width, logical.height);
            let popup_rect = Rect::new(geo.popup_x, geo.popup_y, geo.popup_w, geo.popup_h);
            return popup_rect.contains(pos);
        }
        false
    }

    /// Check if a position is inside the save-as popup area.
    /// Uses the anchor_rect from the save-as input to position the popup.
    fn save_as_contains(&self, pos: crate::tide_core::Vec2) -> bool {
        if let Some(ref save_as) = self.modal.save_as_input {
            let cell_size = self.cell_size();
            let cell_height = cell_size.height;
            let logical = self.logical_size();
            let field_h = cell_height + POPUP_INPUT_PADDING;
            let hint_h = cell_height + 8.0;
            let padding = POPUP_TEXT_INSET;
            let popup_w = SAVE_AS_POPUP_W.min(logical.width - 2.0 * PANE_PADDING);
            let popup_h = field_h * 2.0 + POPUP_SEPARATOR + hint_h + 2.0 * padding;
            let popup_x = save_as.anchor_rect.x.clamp(
                PANE_PADDING,
                (logical.width - popup_w - PANE_PADDING).max(PANE_PADDING),
            );
            let popup_y = save_as.anchor_rect.y + save_as.anchor_rect.height + 4.0;
            let popup_rect = Rect::new(popup_x, popup_y, popup_w, popup_h);
            return popup_rect.contains(pos);
        }
        false
    }

    /// Hit-test the context menu. Returns the item index.
    fn context_menu_item_at(&self, pos: crate::tide_core::Vec2) -> Option<usize> {
        let menu = self.modal.context_menu.as_ref()?;
        let cell_size = self.cell_size();
        let logical = self.logical_size();
        let rect = menu.geometry(cell_size.height, logical.width, logical.height);

        if !rect.contains(pos) {
            return None;
        }

        let line_height = cell_size.height + POPUP_LINE_EXTRA;
        let rel_y = pos.y - rect.y - 4.0; // 4.0 = top padding
        let idx = (rel_y / line_height) as usize;
        if idx < menu.items().len() {
            Some(idx)
        } else {
            None
        }
    }



    fn palette(&self) -> &'static ThemePalette {
        if self.window.dark_mode { &DARK } else { &LIGHT }
    }

    /// Compute the full layout: sidebar (optional file tree) + pane area (split tree fills remaining space).
    fn compute_layout(&mut self) {
        let logical = self.logical_size();
        let top = self.window.top_inset;
        let pane_ids = self.layout.pane_ids();

        let show_file_tree = self.ft.visible;
        let show_ws_sidebar = self.ws.show_sidebar;

        // Clamp workspace sidebar width
        let max_ws = (logical.width - 200.0).max(80.0);
        if show_ws_sidebar && self.ws.width > max_ws {
            self.ws.width = max_ws;
        }
        let ws_sidebar_width = if show_ws_sidebar { self.ws.width } else { 0.0 };

        // Clamp file tree width so it never exceeds the window (leave at least 100px for panes).
        let max_sidebar = (logical.width - ws_sidebar_width - 100.0).max(0.0);
        if show_file_tree && self.ft.width > max_sidebar {
            self.ft.width = max_sidebar;
        }
        let sidebar_width = if show_file_tree { self.ft.width } else { 0.0 };

        let mut left_reserved = 0.0_f32;
        let mut right_reserved = 0.0_f32;

        // Reserve workspace sidebar space (always on the left, with edge gap)
        if show_ws_sidebar {
            left_reserved += PANE_GAP + ws_sidebar_width;
        }

        if show_file_tree {
            match self.window.sidebar_side {
                LayoutSide::Left => {
                    left_reserved += PANE_GAP + sidebar_width;
                }
                LayoutSide::Right => {
                    right_reserved += PANE_GAP + sidebar_width;
                }
            }
        }

        // Safety: close dock if no terminal has dock panes and no pinned panes
        if self.dock.dock_open {
            let any_has_dock = self.panes.values().any(|pk| {
                if let PaneKind::Terminal(tp) = pk {
                    !tp.dock_layout.all_pane_ids().is_empty()
                } else { false }
            });
            if !any_has_dock && !self.has_pinned_panes() {
                self.dock.dock_open = false;
            }
        }

        // Reserve Dock space on the right (when open)
        let show_dock = self.dock.dock_open;
        // Dock width is global (not per-terminal)
        let effective_dock_width = self.dock.dock_width;
        let dock_width = if show_dock {
            let max_ctx = (logical.width - left_reserved - right_reserved - 200.0).max(100.0);
            effective_dock_width.min(max_ctx)
        } else {
            0.0
        };
        if show_dock {
            right_reserved += PANE_GAP + dock_width;
        }

        let terminal_area = Size::new(
            (logical.width - left_reserved - right_reserved).max(100.0),
            logical.height - top,
        );

        let terminal_offset_x = left_reserved;

        // Compute workspace sidebar rect
        if show_ws_sidebar {
            self.ws.sidebar_rect = Some(Rect::new(
                PANE_GAP,
                top,
                ws_sidebar_width,
                logical.height - top,
            ));
        } else {
            self.ws.sidebar_rect = None;
        }

        // Compute file_tree_rect
        if show_file_tree {
            let sidebar_x = match self.window.sidebar_side {
                LayoutSide::Left => left_reserved - sidebar_width,
                LayoutSide::Right => logical.width - sidebar_width - PANE_GAP,
            };
            self.ft.rect = Some(Rect::new(
                sidebar_x,
                top,
                sidebar_width,
                logical.height - top,
            ));
        } else {
            self.ft.rect = None;
        }

        // Store the pane area rect for root-level drop zone detection
        self.pane_area_rect = Some(Rect::new(terminal_offset_x, top, terminal_area.width, terminal_area.height));

        // Store dock area rect for dock drop preview
        if show_dock {
            let ctx_offset_x = terminal_offset_x + terminal_area.width + PANE_GAP;
            self.dock_area_rect = Some(Rect::new(ctx_offset_x, top, dock_width, logical.height - top));
        } else {
            self.dock_area_rect = None;
        }

        // Snap ratios to cell boundaries, then recompute with snapped ratios.
        // Skip during active border drags to prevent cumulative drift.
        let is_dragging = self.router.is_dragging_border()
            || self.ft.border_dragging
            || self.ws.border_dragging
            || self.dock.dock_border_dragging
            || self.dock.dock_split_dragging
            || self.dock.pinned_border_dragging;
        if !is_dragging {
            let cell_size = self.cell_size();
            if cell_size.width > 0.0 {
                let decorations = PaneDecorations {
                    gap: PANE_GAP,
                    padding: PANE_PADDING,
                    tab_bar_height: TAB_BAR_HEIGHT,
                };
                self.layout
                    .snap_ratios_to_cells(terminal_area, cell_size, &decorations);
            }
        }

        let mut rects = self.layout.compute(terminal_area, &pane_ids, self.focus.focused);

        // Offset rects to account for file tree panel and titlebar inset
        for (_, rect) in &mut rects {
            rect.x += terminal_offset_x;
            rect.y += top;
        }

        // Zoom: if a pane is zoomed, override rects so only that pane is shown fullscreen.
        // If the zoomed pane no longer exists, transfer zoom to the focused pane
        // to preserve stacked mode. Only clear zoom if no valid pane remains.
        if let Some(zp) = self.focus.zoomed_pane {
            if !self.panes.contains_key(&zp) || self.is_pane_in_dock(zp) {
                // Zoomed pane gone — try to keep stacked mode on focused pane
                if let Some(f) = self.focus.focused {
                    if self.panes.contains_key(&f) && !self.is_pane_in_dock(f) {
                        self.focus.zoomed_pane = Some(f);
                    } else {
                        self.focus.zoomed_pane = None;
                    }
                } else {
                    self.focus.zoomed_pane = None;
                }
            }
            // Re-check after potential transfer
            if let Some(zp) = self.focus.zoomed_pane {
                rects = vec![(zp, Rect::new(
                    terminal_offset_x, top,
                    terminal_area.width, terminal_area.height,
                ))];
            }
        }

        // Dock: compute rects from pinned_dock_layout + focused terminal's dock_layout
        if show_dock {
            let ctx_offset_x = terminal_offset_x + terminal_area.width + PANE_GAP;
            let dock_height = logical.height - top;

            let is_dock_zoomed = self.dock.dock_zoomed;

            if is_dock_zoomed {
                if let Some(zp) = self.dock_zoomed_pane() {
                    rects.push((zp, Rect::new(ctx_offset_x, top, dock_width, dock_height)));
                }
            } else {
                // Normal: split between pinned and terminal dock
                let has_pinned = self.has_pinned_panes();
                let owner_terminal = self.focused_terminal_id();
                let has_terminal_dock_panes = owner_terminal.map(|tid| {
                    if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                        !tp.dock_layout.pane_ids().is_empty()
                    } else { false }
                }).unwrap_or(false);

                let (pinned_width, terminal_dock_offset_x, terminal_dock_width) = if !has_pinned {
                    (0.0, ctx_offset_x, dock_width)
                } else if !has_terminal_dock_panes {
                    (dock_width, ctx_offset_x, 0.0)
                } else {
                    let pw = (dock_width * self.dock.pinned_dock_ratio).max(60.0).min(dock_width - 60.0);
                    let tw = dock_width - pw - PANE_GAP;
                    (pw, ctx_offset_x + pw + PANE_GAP, tw.max(0.0))
                };

                // Render pinned dock layout
                if has_pinned && pinned_width > 0.0 {
                    let pinned_pane_ids = self.dock.pinned_dock_layout.pane_ids();
                    if !pinned_pane_ids.is_empty() {
                        let pinned_size = Size::new(pinned_width, dock_height);
                        let pinned_focused = self.focus.focused.filter(|id| self.is_pane_pinned(*id));
                    let mut pr = self.dock.pinned_dock_layout.compute(pinned_size, &pinned_pane_ids, pinned_focused);
                        for (_, rect) in &mut pr {
                            rect.x += ctx_offset_x;
                            rect.y += top;
                        }
                        rects.extend(pr);
                    }
                }

                // Render terminal's dock_layout
                if terminal_dock_width > 0.0 {
                    if let Some(tid) = owner_terminal {
                        if let Some(PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                            let dock_pane_ids = tp.dock_layout.pane_ids();
                            if !dock_pane_ids.is_empty() {
                                let ctx_size = Size::new(terminal_dock_width, dock_height);
                                let mut cr = tp.dock_layout.compute(ctx_size, &dock_pane_ids, tp.dock_focused);
                                for (_, rect) in &mut cr {
                                    rect.x += terminal_dock_offset_x;
                                    rect.y += top;
                                }
                                rects.extend(cr);
                            }
                        }
                    }
                }
            }
        }

        // Force grid rebuild if rects changed
        let rects_changed = rects != self.pane_rects;
        self.pane_rects = rects;

        // Compute visual rects: half-gap between panes, edge-inset at window boundaries.
        // Each pane uses bounds from its own region (TerminalArea or ContextArea).
        let half = PANE_GAP / 2.0;
        let edge_inset = PANE_CORNER_RADIUS.max(half);
        let term_area_x = terminal_offset_x;
        let term_area_y = top;
        let term_area_right = terminal_offset_x + terminal_area.width;
        let term_area_bottom = top + terminal_area.height;

        let ctx_area_x = if show_dock { term_area_right + PANE_GAP } else { 0.0 };
        let ctx_area_right = if show_dock { ctx_area_x + dock_width } else { 0.0 };

        // Collect all dock pane IDs across all terminals + pinned dock
        let mut dock_pane_ids: std::collections::HashSet<u64> = self.panes.iter()
            .filter_map(|(_, pk)| {
                if let PaneKind::Terminal(tp) = pk {
                    Some(tp.dock_layout.all_pane_ids())
                } else {
                    None
                }
            })
            .flatten()
            .collect();
        for pid in self.dock.pinned_dock_layout.all_pane_ids() {
            dock_pane_ids.insert(pid);
        }

        self.visual_pane_rects = self
            .pane_rects
            .iter()
            .map(|&(id, r)| {
                let is_dock = dock_pane_ids.contains(&id);
                let (area_x, area_right) = if is_dock {
                    (ctx_area_x, ctx_area_right)
                } else {
                    (term_area_x, term_area_right)
                };
                let area_y = term_area_y;
                let area_bottom = term_area_bottom;

                // At the boundary between Stage and Dock, use half gap
                // (not edge_inset) so the gap matches FileTree↔Stage
                let at_left_edge = (r.x - area_x).abs() < 1.0;
                let at_right_edge = ((r.x + r.width) - area_right).abs() < 1.0;
                let l = if at_left_edge {
                    if is_dock { half } else { edge_inset } // dock left = inter-region gap
                } else { half };
                let t = if (r.y - area_y).abs() < 1.0 { edge_inset } else { half };
                let ri = if at_right_edge {
                    if !is_dock && show_dock { half } else { edge_inset } // terminal right = inter-region gap
                } else { half };
                let b = if ((r.y + r.height) - area_bottom).abs() < 1.0 { edge_inset } else { half };
                let vr = Rect::new(
                    r.x + l,
                    r.y + t,
                    (r.width - l - ri).max(1.0),
                    (r.height - t - b).max(1.0),
                );
                (id, vr)
            })
            .collect();

        // Resize terminal backends to match the actual visible content area.
        // Uses visual rects + PANE_PADDING to match the render inner rect exactly.
        // During border drag, skip PTY resize to avoid SIGWINCH spam and drift.
        // During window resize, always apply PTY resize so content reflows
        // incrementally instead of jumping all at once when the drag ends.
        let skip_pty_resize = self.router.is_dragging_border()
            || self.ft.border_dragging
            || self.ws.border_dragging;
        if !skip_pty_resize {
            let content_top = TAB_BAR_HEIGHT;
            let cell_size = self.cell_size();
            if cell_size.width > 0.0 {
                for &(id, vr) in &self.visual_pane_rects {
                    if let Some(PaneKind::Terminal(pane)) = self.panes.get_mut(&id) {
                        let content_rect = Rect::new(
                            vr.x + PANE_PADDING,
                            vr.y + content_top,
                            (vr.width - 2.0 * PANE_PADDING).max(cell_size.width),
                            (vr.height - content_top - PANE_PADDING).max(cell_size.height),
                        );
                        pane.resize_to_rect(content_rect, cell_size);
                    }
                }
            }
        }

        if rects_changed {
            self.cache.layout_generation += 1;
            // Don't clear all pane_generations -- render() handles per-pane
            // invalidation via prev_visual_pane_rects comparison, only rebuilding
            // grids for panes whose rects actually changed.
            self.cache.invalidate_chrome();
        }

        // Store window size for layout drag operations
        self.layout.last_window_size = Some(terminal_area);

        // Sync browser webview frames to match the computed layout
        self.sync_browser_webview_frames();
    }

    /// Create/show/hide/reposition WKWebView instances for browser panes.
    /// Browser panes now live in the split tree and use visual_pane_rects for positioning.
    fn sync_browser_webview_frames(&mut self) {
        let content_view = match self.ports.platform.content_view_ptr() {
            Some(ptr) => ptr,
            None => return,
        };

        // Collect browser pane IDs
        let browser_ids: Vec<crate::tide_core::PaneId> = self
            .panes
            .iter()
            .filter_map(|(&id, pk)| {
                if matches!(pk, PaneKind::Browser(_)) {
                    Some(id)
                } else {
                    None
                }
            })
            .collect();

        for id in browser_ids {
            // Find the visual rect for this browser pane in the split tree
            let visual_rect = self.visual_pane_rects.iter().find(|(pid, _)| *pid == id).map(|(_, r)| *r);

            let bp = match self.panes.get_mut(&id) {
                Some(PaneKind::Browser(bp)) => bp,
                _ => continue,
            };

            // Create webview if not yet initialized
            if bp.webview.is_none() {
                let handle = unsafe {
                    crate::tide_platform::macos::webview::WebViewHandle::new(content_view)
                };
                if let Some(handle) = handle {
                    bp.webview = Some(handle);
                }
            }

            // Hide browser webview when a modal popup is open (file finder, etc.)
            // because native NSView sits on top of wgpu-rendered overlays.
            let popup_open = self.modal.file_finder.is_some()
                || self.modal.save_as_input.is_some()
                || self.modal.git_switcher.is_some()
                || self.modal.config_page.is_some()
                || self.modal.save_confirm.is_some()
                || self.modal.branch_cleanup.is_some()
                || matches!(self.interaction.pane_drag, crate::state::drag_types::PaneDragState::Dragging { .. });

            if let Some(vr) = visual_rect {
                if popup_open {
                    bp.set_visible(false);
                } else {
                // Position webview inside the pane's visual rect, below the tab bar + nav bar
                let nav_bar_h = (self.window.cached_cell_size.height * 1.5).round() + 4.0; // 2px gap top + nav_h + 2px gap bottom
                let content_top = TAB_BAR_HEIGHT + nav_bar_h;

                let x = (vr.x + PANE_PADDING) as f64;
                let y = (vr.y + content_top) as f64;
                let w = ((vr.width - PANE_PADDING * 2.0).max(1.0)) as f64;
                let h = ((vr.height - content_top - PANE_PADDING).max(1.0)) as f64;

                bp.set_frame(x, y, w, h);
                bp.set_visible(true);

                // Navigate AFTER the webview has a proper frame and is visible.
                if bp.needs_initial_navigate && !bp.url.is_empty() {
                    let url = bp.url.clone();
                    bp.navigate(&url);
                    bp.needs_initial_navigate = false;
                }

                // Poll webview for state changes (URL, loading, back/forward)
                if bp.sync_webview_state() {
                    self.cache.invalidate_chrome();
                }

                // First responder management: only the focused browser pane
                // should become first responder. A visible-but-unfocused
                // browser pane must NOT steal first responder from the
                // terminal's IME proxy (causes input loss after app switch).
                let is_focused_pane = self.focus.focused == Some(id);
                let search_bar_active = self.focus.search_focus == Some(id);
                let should_be_first_responder = is_focused_pane && !bp.url_input_focused && !search_bar_active;
                if should_be_first_responder && !bp.is_first_responder {
                    if let (Some(wv), Some(win_ptr)) =
                        (&bp.webview, self.ports.platform.window_ptr())
                    {
                        unsafe { wv.make_first_responder(win_ptr); }
                    }
                    bp.is_first_responder = true;
                } else if !should_be_first_responder && bp.is_first_responder {
                    bp.is_first_responder = false;
                }
                } // else (not popup_open)
            } else {
                // Browser pane not in the visible layout -- hide it
                if bp.is_first_responder {
                    if let (Some(wv), Some(win_ptr), Some(view_ptr)) =
                        (&bp.webview, self.ports.platform.window_ptr(), self.ports.platform.content_view_ptr())
                    {
                        unsafe { wv.resign_first_responder(win_ptr, view_ptr); }
                    }
                    bp.is_first_responder = false;
                }
                bp.set_visible(false);
            }
        }
    }
}
