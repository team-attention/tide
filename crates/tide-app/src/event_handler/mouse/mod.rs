//! Mouse event handling — platform-agnostic.

mod drag;
mod selection;

use tide_core::{FileTreeSource, InputEvent, MouseButton, Rect, Vec2};
use tide_platform::WindowProxy;

use crate::event_handler::drag_drop::PaneDragState;
use crate::pane::PaneKind;
use crate::theme::*;
use crate::App;

impl App {
    pub(crate) fn handle_mouse_down(&mut self, button: MouseButton, window: &WindowProxy) {
        if button == MouseButton::Left {
            self.interaction.mouse_left_pressed = true;

            // Check editor scrollbar click
            if self.check_scrollbar_click(self.window.last_cursor_pos) {
                self.cache.needs_redraw = true;
                return;
            }

            // Start text selection if clicking on pane content
            if self.start_text_selection() {
                // selection started — fall through to continue processing
            }
        }

        // Handle search bar clicks
        if button == MouseButton::Left {
            if self.check_search_bar_click() {
                self.cache.needs_redraw = true;
                return;
            }
        }

        // Handle file finder click
        if button == MouseButton::Left {
            if self.modal.context_menu.is_some() {
                if let Some(idx) = self.context_menu_item_at(self.window.last_cursor_pos) {
                    self.execute_context_menu_action(idx);
                }
                self.modal.context_menu = None;
                self.cache.needs_redraw = true;
                return;
            }

            if self.modal.save_as_input.is_some() {
                if !self.save_as_contains(self.window.last_cursor_pos) {
                    self.modal.save_as_input = None;
                }
                self.cache.needs_redraw = true;
                return;
            }

            if self.modal.file_finder.is_some() {
                if let Some(idx) = self.file_finder_item_at(self.window.last_cursor_pos) {
                    if let Some(ref finder) = self.modal.file_finder {
                        if let Some(&entry_idx) = finder.filtered.get(idx) {
                            let path = finder.base_dir.join(&finder.entries[entry_idx]);
                            self.close_file_finder();
                            self.open_editor_pane(path);
                            self.cache.needs_redraw = true;
                            return;
                        }
                    }
                } else if !self.file_finder_contains(self.window.last_cursor_pos) {
                    self.close_file_finder();
                }
                self.cache.needs_redraw = true;
                return;
            }

            if self.modal.git_switcher.is_some() {
                // Tab click: switch between Branches / Worktrees
                if let Some(mode) = self.git_switcher_tab_at(self.window.last_cursor_pos) {
                    if let Some(ref mut gs) = self.modal.git_switcher {
                        if gs.mode != mode {
                            gs.set_mode(mode);
                            self.cache.invalidate_chrome();
                        }
                    }
                    self.cache.needs_redraw = true;
                    return;
                }
                if let Some(btn) = self.git_switcher_button_at(self.window.last_cursor_pos) {
                    self.handle_git_switcher_button(btn);
                    self.cache.needs_redraw = true;
                    return;
                }
                if let Some(idx) = self.git_switcher_item_at(self.window.last_cursor_pos) {
                    if let Some(ref mut gs) = self.modal.git_switcher {
                        gs.selected = idx;
                        self.cache.invalidate_chrome();
                    }
                    self.cache.needs_redraw = true;
                    return;
                } else if !self.git_switcher_contains(self.window.last_cursor_pos) {
                    self.modal.git_switcher = None;
                    self.cache.needs_redraw = true;
                    return;
                }
            }
        }

        // Branch cleanup bar clicks
        if button == MouseButton::Left && self.modal.branch_cleanup.is_some() {
            if self.handle_branch_cleanup_click(self.window.last_cursor_pos) {
                return;
            }
        }

        // Notification bar clicks
        if button == MouseButton::Left {
            if self.handle_notification_bar_click(self.window.last_cursor_pos) {
                return;
            }
        }

        // Header clicks
        if button == MouseButton::Left {
            if self.check_header_click() {
                return;
            }
        }

        // Pane tab close
        if button == MouseButton::Left {
            if let Some(pane_id) = self.pane_tab_close_at(self.window.last_cursor_pos) {
                self.close_specific_pane(pane_id);
                self.cache.needs_redraw = true;
                return;
            }
        }

        // Right-click on file tree
        if button == MouseButton::Right {
            if self.ft.visible {
                if let Some(ft_rect) = self.ft.rect {
                    let pos = self.window.last_cursor_pos;
                    if pos.x >= ft_rect.x
                        && pos.x < ft_rect.x + ft_rect.width
                        && pos.y >= ft_rect.y + PANE_CORNER_RADIUS + FILE_TREE_HEADER_HEIGHT
                    {
                        {
                            let cell_size = self.cell_size();
                            let line_height = cell_size.height * FILE_TREE_LINE_SPACING;
                            let content_y = ft_rect.y + PANE_CORNER_RADIUS;
                            let adjusted_y = pos.y - content_y - FILE_TREE_HEADER_HEIGHT;
                            let index =
                                ((adjusted_y + self.ft.scroll) / line_height) as usize;

                            if let Some(tree) = self.ft.tree.as_ref() {
                                let entries = tree.visible_entries();
                                if index < entries.len() {
                                    let entry = &entries[index];
                                    self.modal.context_menu = None;
                                    self.modal.file_tree_rename = None;
                                    let shell_idle = self.focus.focused
                                        .and_then(|tid| self.panes.get(&tid))
                                        .map(|pk| if let crate::PaneKind::Terminal(tp) = pk { tp.context.shell_idle } else { false })
                                        .unwrap_or(false);
                                    self.modal.context_menu = Some(crate::ContextMenuState {
                                        entry_index: index,
                                        path: entry.entry.path.clone(),
                                        is_dir: entry.entry.is_dir,
                                        shell_idle,
                                        position: pos,
                                        selected: 0,
                                    });
                                    self.cache.needs_redraw = true;
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }

        // File tree clicks
        if button == MouseButton::Left {
            if self.ft.visible {
                if let Some(ft_rect) = self.ft.rect {
                    let pos = self.window.last_cursor_pos;
                    if pos.x >= ft_rect.x
                        && pos.x < ft_rect.x + ft_rect.width
                        && pos.y >= ft_rect.y + PANE_CORNER_RADIUS + FILE_TREE_HEADER_HEIGHT
                    {
                        self.handle_file_tree_click(pos);
                        return;
                    }
                }
            }
        }

        // Config page
        if button == MouseButton::Left && self.modal.config_page.is_some() {
            self.handle_config_page_click(self.window.last_cursor_pos);
            self.cache.needs_redraw = true;
            return;
        }

        // General mouse input routing
        self.handle_mouse_input_core(button, window);
        self.cache.needs_redraw = true;
    }

    fn handle_mouse_input_core(&mut self, button: MouseButton, _window: &WindowProxy) {
        if button == MouseButton::Left {
            // Workspace sidebar (always clickable, including fullscreen)
            match &self.interaction.hover_target {
                Some(crate::event_handler::drag_drop::HoverTarget::WorkspaceSidebarItem(idx)) => {
                    let idx = *idx;
                    // Start pending drag
                    self.ws.drag = Some((idx, self.window.last_cursor_pos.y, idx));
                    return;
                }
                Some(crate::event_handler::drag_drop::HoverTarget::WorkspaceSidebarNewBtn) => {
                    self.new_workspace();
                    return;
                }
                _ => {}
            }

            // Titlebar buttons (only when titlebar is visible)
            if self.window.top_inset > 0.0 {
                match &self.interaction.hover_target {
                    Some(crate::event_handler::drag_drop::HoverTarget::TitlebarSettings) => {
                        self.toggle_config_page();
                        return;
                    }
                    Some(crate::event_handler::drag_drop::HoverTarget::TitlebarTheme) => {
                        self.handle_global_action(tide_input::GlobalAction::ToggleTheme);
                        return;
                    }
                    Some(crate::event_handler::drag_drop::HoverTarget::TitlebarSwap) => {
                        self.window.sidebar_side = match self.window.sidebar_side {
                            crate::LayoutSide::Left => crate::LayoutSide::Right,
                            crate::LayoutSide::Right => crate::LayoutSide::Left,
                        };
                        self.compute_layout();
                        self.cache.invalidate_chrome();
                        return;
                    }
                    Some(crate::event_handler::drag_drop::HoverTarget::TitlebarWorkspace) => {
                        self.ws.show_sidebar = !self.ws.show_sidebar;
                        self.cache.invalidate_chrome();
                        self.compute_layout();
                        return;
                    }
                    Some(crate::event_handler::drag_drop::HoverTarget::TitlebarFileTree) => {
                        self.toggle_file_tree_visibility();
                        return;
                    }
                    Some(crate::event_handler::drag_drop::HoverTarget::TitlebarDock) => {
                        self.toggle_dock_visibility();
                        return;
                    }
                    _ => {}
                }
            }


            // Browser navigation bar clicks
            match &self.interaction.hover_target {
                Some(target @ crate::event_handler::drag_drop::HoverTarget::BrowserBack)
                | Some(target @ crate::event_handler::drag_drop::HoverTarget::BrowserForward)
                | Some(target @ crate::event_handler::drag_drop::HoverTarget::BrowserRefresh)
                | Some(target @ crate::event_handler::drag_drop::HoverTarget::BrowserUrlBar) => {
                    let target = target.clone();
                    // Focus the browser pane first
                    for &(id, rect) in &self.visual_pane_rects {
                        if let Some(crate::pane::PaneKind::Browser(_)) = self.panes.get(&id) {
                            if rect.contains(self.window.last_cursor_pos) {
                                self.focus_terminal(id);
                                break;
                            }
                        }
                    }
                    self.handle_browser_nav_click(&target);
                    return;
                }
                _ => {}
            }

            // Handle drags — sidebar handle
            if let Some(ft_rect) = self.ft.rect {
                if self.window.last_cursor_pos.y >= ft_rect.y
                    && self.window.last_cursor_pos.y < ft_rect.y + PANE_PADDING
                    && self.window.last_cursor_pos.x >= ft_rect.x
                    && self.window.last_cursor_pos.x < ft_rect.x + ft_rect.width
                {
                    self.window.sidebar_handle_dragging = true;
                    return;
                }
            }

            // Workspace sidebar border
            if let Some(ws_rect) = self.ws.sidebar_rect {
                let border_x = ws_rect.x + ws_rect.width + PANE_GAP;
                if (self.window.last_cursor_pos.x - border_x).abs() < 5.0 {
                    self.ws.border_dragging = true;
                    return;
                }
            }

            // Context area border
            if self.dock.dock_open {
                if let Some(pa_rect) = self.pane_area_rect {
                    let border_x = pa_rect.x + pa_rect.width;
                    if (self.window.last_cursor_pos.x - border_x).abs() < 5.0 {
                        self.dock.dock_border_dragging = true;
                        return;
                    }
                }

                // Pinned group / terminal dock border drag
                if let Some(dock_rect) = self.dock_area_rect {
                    let has_term_dock = self.focused_terminal_id().map(|tid| {
                        if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get(&tid) {
                            !tp.dock_layout.pane_ids().is_empty()
                        } else { false }
                    }).unwrap_or(false);
                    if self.has_pinned_panes() && has_term_dock {
                        let pinned_w = (dock_rect.width * self.dock.pinned_dock_ratio).max(60.0).min(dock_rect.width - 60.0);
                        let border_x = dock_rect.x + pinned_w;
                        if (self.window.last_cursor_pos.x - border_x).abs() < 5.0 {
                            self.dock.pinned_border_dragging = true;
                            return;
                        }
                    }
                }

                // Intra-dock split border drag
                if let Some(dock_rect) = self.dock_area_rect {
                    if dock_rect.contains(self.window.last_cursor_pos) {
                        let local_pos = Vec2::new(
                            self.window.last_cursor_pos.x - dock_rect.x,
                            self.window.last_cursor_pos.y - dock_rect.y,
                        );
                        let dock_size = tide_core::Size::new(dock_rect.width, dock_rect.height);
                        if let Some(tid) = self.focused_terminal_id() {
                            if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                                tp.dock_layout.begin_drag(local_pos, dock_size);
                                if tp.dock_layout.is_dragging() {
                                    self.dock.dock_split_dragging = true;
                                    return;
                                }
                            }
                        }
                    }
                }
            }

            // Sidebar border
            if let Some(ft_rect) = self.ft.rect {
                let border_x = if self.window.sidebar_side == crate::LayoutSide::Left {
                    ft_rect.x + ft_rect.width + PANE_GAP
                } else {
                    ft_rect.x - PANE_GAP
                };
                if (self.window.last_cursor_pos.x - border_x).abs() < 5.0 {
                    self.ft.border_dragging = true;
                    return;
                }
            }

            // Pane tab drag init — check header_hit_zones first for accurate tab ID
            // Initiate pane drag from header tab bar click.
            {
                let pos = self.window.last_cursor_pos;
                let drag_pane = self.pane_at_tab_bar(pos);
                if let Some(pane_id) = drag_pane {
                    self.interaction.pane_drag = PaneDragState::PendingDrag {
                        source_pane: pane_id,
                        press_pos: pos,
                    };
                    self.focus_terminal(pane_id);
                    return;
                }
            }
        }

        let input = InputEvent::MouseClick {
            position: self.window.last_cursor_pos,
            button,
        };
        let action = self.router.process(input, &self.pane_rects);
        self.handle_action(action, Some(input));
    }

    pub(crate) fn handle_mouse_up(&mut self, button: MouseButton) {
        if button == MouseButton::Left {
            self.interaction.mouse_left_pressed = false;
        }

        // End workspace sidebar drag
        if let Some((src, press_y, gap)) = self.ws.drag.take() {
            let moved = (self.window.last_cursor_pos.y - press_y).abs() > DRAG_THRESHOLD;
            let target = if gap <= src { gap } else { gap - 1 };
            if moved && target != src {
                let ws = self.ws.workspaces.remove(src);
                self.ws.workspaces.insert(target, ws);
                if self.ws.active == src {
                    self.ws.active = target;
                } else if src < self.ws.active && target >= self.ws.active {
                    self.ws.active -= 1;
                } else if src > self.ws.active && target <= self.ws.active {
                    self.ws.active += 1;
                }
            } else if !moved {
                self.switch_workspace(src);
            }
            self.cache.invalidate_chrome();
            return;
        }

        // End scrollbar drag
        if self.interaction.scrollbar_dragging.is_some() {
            self.interaction.scrollbar_dragging = None;
            self.interaction.scrollbar_drag_rect = None;
            return;
        }

        // End sidebar handle drag on release
        if self.window.sidebar_handle_dragging {
            self.window.sidebar_handle_dragging = false;
            self.compute_layout();
            self.cache.invalidate_chrome();
            return;
        }

        if self.ft.border_dragging {
            self.ft.border_dragging = false;
            self.compute_layout();
            self.cache.invalidate_chrome();
            return;
        }

        if self.ws.border_dragging {
            self.ws.border_dragging = false;
            self.compute_layout();
            self.cache.invalidate_chrome();
            return;
        }

        if self.dock.dock_border_dragging {
            self.dock.dock_border_dragging = false;
            self.compute_layout();
            self.cache.invalidate_chrome();
            return;
        }

        if self.dock.pinned_border_dragging {
            self.dock.pinned_border_dragging = false;
            self.compute_layout();
            self.cache.invalidate_chrome();
            return;
        }

        if self.dock.dock_split_dragging {
            self.dock.dock_split_dragging = false;
            if let Some(tid) = self.focused_terminal_id() {
                if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                    tp.dock_layout.end_drag();
                }
            }
            self.compute_layout();
            self.cache.invalidate_chrome();
            return;
        }

        let drag_state = std::mem::replace(&mut self.interaction.pane_drag, PaneDragState::Idle);
        match drag_state {
            PaneDragState::Dragging {
                source_pane,
                drop_target: Some(dest),
                ..
            } => {
                self.handle_drop(source_pane, dest);
                return;
            }
            PaneDragState::PendingDrag { source_pane, .. } => {
                self.focus_terminal(source_pane);
                if self.focus.zoomed_pane.is_some() && !self.is_pane_in_dock(source_pane) {
                    self.focus.zoomed_pane = Some(source_pane);
                }
                self.cache.invalidate_chrome();
                self.cache.pane_generations.clear();
                self.compute_layout();
                self.cache.needs_redraw = true;
                return;
            }
            PaneDragState::Dragging { .. } => {
                return;
            }
            PaneDragState::Idle => {}
        }

        let was_dragging = self.router.is_dragging_border();
        self.layout.end_drag();
        self.router.end_drag();
        if was_dragging {
            self.compute_layout();
        }
    }

    /// Check if a click position hits an editor scrollbar. If so, starts
    /// scrollbar drag and applies the initial jump. Returns true if consumed.
    fn check_scrollbar_click(&mut self, pos: Vec2) -> bool {
        let cell_height = self.cell_size().height;
        let hit_width = 16.0_f32; // wider hit area than visual scrollbar

        // Check editor panes in the split tree
        let content_top_offset = TAB_BAR_HEIGHT;
        let rects: Vec<_> = self.visual_pane_rects.iter().map(|(id, r)| (*id, *r)).collect();
        for (pid, vrect) in rects {
            if let Some(PaneKind::Editor(pane)) = self.panes.get(&pid) {
                let inner = Rect::new(
                    vrect.x + PANE_PADDING,
                    vrect.y + content_top_offset,
                    vrect.width - 2.0 * PANE_PADDING,
                    vrect.height - content_top_offset - PANE_PADDING,
                );
                let scrollbar_right = inner.x + inner.width;
                let scrollbar_left = scrollbar_right - hit_width;
                if pos.x >= scrollbar_left && pos.x <= scrollbar_right
                    && pos.y >= inner.y && pos.y <= inner.y + inner.height
                    && pane.needs_scrollbar(inner, cell_height)
                {
                    self.interaction.scrollbar_dragging = Some(pid);
                    self.interaction.scrollbar_drag_rect = Some(inner);
                    self.apply_scrollbar_drag(pid, inner, pos.y);
                    return true;
                }
            }
        }

        false
    }

    /// Apply scrollbar drag: set scroll position based on mouse Y within rect.
    pub(super) fn apply_scrollbar_drag(&mut self, pane_id: tide_core::PaneId, rect: Rect, mouse_y: f32) {
        let cell_height = self.cell_size().height;
        let visible_rows = (rect.height / cell_height).floor() as usize;
        let ratio = ((mouse_y - rect.y) / rect.height).clamp(0.0, 1.0);

        if let Some(PaneKind::Editor(pane)) = self.panes.get_mut(&pane_id) {
            let (total_lines, _) = if pane.preview_mode {
                (pane.preview_line_count(), pane.preview_scroll)
            } else {
                (pane.editor.buffer.line_count(), pane.editor.scroll_offset())
            };
            let max_scroll = total_lines.saturating_sub(visible_rows);
            // Center viewport around click position
            let center = (ratio * total_lines as f32).round() as usize;
            let target = center.saturating_sub(visible_rows / 2).min(max_scroll);

            if pane.preview_mode {
                pane.preview_scroll = target;
            } else {
                pane.editor.set_scroll_offset(target);
            }
            self.cache.invalidate_pane(pane_id);
        }
    }
}
