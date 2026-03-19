//! Mouse drag handling — border resize, pane drag, scrollbar drag, sidebar.

use tide_core::{InputEvent, LayoutEngine, Vec2};
use tide_platform::WindowProxy;

use crate::event_handler::drag_drop::PaneDragState;
use crate::theme::*;
use crate::App;

impl App {
    /// Main entry point for cursor-moved events. Dispatches to drag handlers,
    /// selection drag, or hover tracking depending on current state.
    pub(crate) fn handle_cursor_moved_logical(&mut self, pos: Vec2, window: &WindowProxy) {
        self.window.last_cursor_pos = pos;

        // Handle workspace sidebar drag
        if let Some((src, press_y, _)) = self.ws.drag {
            if (pos.y - press_y).abs() > DRAG_THRESHOLD {
                let gap = if let Some(geo) = self.ws_sidebar_geometry() {
                    let mut result = self.ws.workspaces.len();
                    for i in 0..self.ws.workspaces.len() {
                        let r = geo.item_rect(i);
                        if pos.y < r.y + r.height / 2.0 {
                            result = i;
                            break;
                        }
                    }
                    result
                } else {
                    src
                };
                self.ws.drag = Some((src, press_y, gap));
                self.cache.invalidate_chrome();
            }
            return;
        }

        // Handle scrollbar drag
        if let (Some(pane_id), Some(rect)) = (
            self.interaction.scrollbar_dragging,
            self.interaction.scrollbar_drag_rect,
        ) {
            self.apply_scrollbar_drag(pane_id, rect, pos.y);
            self.cache.needs_redraw = true;
            return;
        }

        // Handle workspace sidebar border resize
        if self.ws.border_dragging {
            let logical = self.logical_size();
            let ws_x = self.ws.sidebar_rect.map(|r| r.x).unwrap_or(PANE_GAP);
            let max_w = (logical.width - 200.0).max(80.0);
            let new_width = (pos.x - ws_x).max(80.0).min(max_w);
            self.ws.width = new_width;
            self.compute_layout();
            self.cache.invalidate_chrome();
            return;
        }

        // Handle context area border resize
        if self.dock.dock_border_dragging {
            let logical = self.logical_size();
            let max_w = (logical.width - 200.0).max(100.0);
            let new_width = (logical.width - pos.x - PANE_GAP).max(100.0).min(max_w);
            self.dock.dock_width = new_width;
            self.compute_layout();
            self.cache.invalidate_chrome();
            return;
        }

        // Handle pinned group / terminal dock border resize
        if self.dock.pinned_border_dragging {
            if let Some(dock_rect) = self.dock_area_rect {
                let local_x = pos.x - dock_rect.x;
                let new_ratio = (local_x / dock_rect.width).clamp(0.1, 0.9);
                self.dock.pinned_dock_ratio = new_ratio;
                self.compute_layout();
                self.cache.invalidate_chrome();
            }
            return;
        }

        // Handle intra-dock split border resize
        if self.dock.dock_split_dragging {
            if let Some(dock_rect) = self.dock_area_rect {
                let local_pos = Vec2::new(pos.x - dock_rect.x, pos.y - dock_rect.y);
                if let Some(tid) = self.focused_terminal_id() {
                    if let Some(crate::pane::PaneKind::Terminal(tp)) = self.panes.get_mut(&tid) {
                        tp.dock_layout.drag_border(local_pos);
                    }
                }
                self.compute_layout();
                self.cache.needs_redraw = true;
            }
            return;
        }

        // Handle file-tree border resize
        if self.ft.border_dragging {
            let logical = self.logical_size();
            let max_w = (logical.width - 100.0).max(120.0);
            let new_width = match self.window.sidebar_side {
                crate::LayoutSide::Left => {
                    let ft_x = self.ft.rect.map(|r| r.x).unwrap_or(0.0);
                    (pos.x - ft_x).max(120.0).min(max_w)
                }
                crate::LayoutSide::Right => (logical.width - pos.x).max(120.0).min(max_w),
            };
            self.ft.width = new_width;
            self.compute_layout();
            self.cache.invalidate_chrome();
            return;
        }

        // Handle sidebar handle drag (side swap preview)
        if self.window.sidebar_handle_dragging {
            let logical = self.logical_size();
            let win_center = logical.width / 2.0;
            let target_side = if pos.x < win_center {
                crate::LayoutSide::Left
            } else {
                crate::LayoutSide::Right
            };
            self.window.sidebar_side = target_side;
            self.compute_layout();
            self.cache.invalidate_chrome();
            return;
        }

        // Handle pane drag
        match &self.interaction.pane_drag {
            PaneDragState::PendingDrag {
                source_pane,
                press_pos,
            } => {
                let dx = pos.x - press_pos.x;
                let dy = pos.y - press_pos.y;
                if (dx * dx + dy * dy).sqrt() >= DRAG_THRESHOLD {
                    let source = *source_pane;
                    let target = self.compute_drop_destination(pos, source);
                    let preview = self.compute_drop_preview_rect(source, &target);
                    self.interaction.pane_drag = PaneDragState::Dragging {
                        source_pane: source,
                        drop_target: target,
                        cached_preview_rect: preview,
                    };
                    // Hide browser webviews so drag preview renders on top
                    self.sync_browser_webview_frames();
                }
                self.cache.needs_redraw = true;
                return;
            }
            PaneDragState::Dragging {
                source_pane,
                drop_target: prev_target,
                ..
            } => {
                let source = *source_pane;
                let prev_target = prev_target.clone();
                let new_target = self.compute_drop_destination(pos, source);
                let preview = if new_target == prev_target {
                    match &self.interaction.pane_drag {
                        PaneDragState::Dragging {
                            cached_preview_rect,
                            ..
                        } => *cached_preview_rect,
                        _ => None,
                    }
                } else {
                    self.compute_drop_preview_rect(source, &new_target)
                };
                self.interaction.pane_drag = PaneDragState::Dragging {
                    source_pane: source,
                    drop_target: new_target,
                    cached_preview_rect: preview,
                };
                self.cache.needs_redraw = true;
                return;
            }
            PaneDragState::Idle => {}
        }

        if self.router.is_dragging_border() {
            let mut left = 0.0_f32;
            if self.ft.visible && self.window.sidebar_side == crate::LayoutSide::Left {
                left += self.ft.width;
            }
            let drag_pos = Vec2::new(pos.x - left, pos.y);
            self.layout.drag_border(drag_pos);
            self.compute_layout();
            self.cache.needs_redraw = true;
        } else {
            // URL bar drag selection
            if self.interaction.mouse_left_pressed {
                self.handle_url_bar_drag(pos);
            }

            // Text selection drag
            if self.interaction.mouse_left_pressed {
                self.handle_selection_drag(pos);
            }

            // Hover target
            let new_hover = self.compute_hover_target(pos);
            if new_hover != self.interaction.hover_target {
                let chrome_affected = self
                    .interaction
                    .hover_target
                    .as_ref()
                    .map_or(false, |h| h.affects_chrome())
                    || new_hover.as_ref().map_or(false, |h| h.affects_chrome());
                let visual_changed = self
                    .interaction
                    .hover_target
                    .as_ref()
                    .map_or(false, |h| h.has_visual_feedback())
                    || new_hover.as_ref().map_or(false, |h| h.has_visual_feedback());
                self.interaction.hover_target = new_hover;
                self.update_cursor_icon(window);
                if chrome_affected {
                    self.cache.invalidate_chrome();
                }
                if visual_changed {
                    self.cache.needs_redraw = true;
                }
            }

            let input = InputEvent::MouseMove { position: pos };
            let _ = self.router.process(input, &self.pane_rects);
        }
    }
}
