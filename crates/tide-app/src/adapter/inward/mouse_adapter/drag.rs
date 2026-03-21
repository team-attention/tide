//! Mouse drag handling — border resize, pane drag, scrollbar drag, sidebar.

use crate::tide_core::{InputEvent, Vec2};
use crate::tide_platform::WindowProxy;

use crate::state::drag_types::PaneDragState;
use crate::theme::*;
use super::MousePorts;

/// Main entry point for cursor-moved events. Dispatches to drag handlers,
/// selection drag, or hover tracking depending on current state.
pub(crate) fn handle_cursor_moved_logical(ctx: &mut impl MousePorts, pos: Vec2, window: &WindowProxy) {
    ctx.set_last_cursor_pos(pos);

    // Handle workspace sidebar drag
    if let Some((src, press_y, _)) = ctx.ws_drag() {
        if (pos.y - press_y).abs() > DRAG_THRESHOLD {
            let gap = if let Some(geo) = ctx.ws_sidebar_geometry() {
                let ws_len = ctx.ws_workspaces_len();
                let mut result = ws_len;
                for i in 0..ws_len {
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
            ctx.ws_set_drag(Some((src, press_y, gap)));
            ctx.invalidate_chrome();
        }
        return;
    }

    // Handle scrollbar drag
    if let (Some(pane_id), Some(rect)) = (
        ctx.interaction().scrollbar_dragging,
        ctx.interaction().scrollbar_drag_rect,
    ) {
        super::apply_scrollbar_drag(ctx, pane_id, rect, pos.y);
        ctx.request_redraw();
        return;
    }

    // Handle workspace sidebar border resize
    if ctx.ws_border_dragging() {
        let logical = ctx.logical_size();
        let ws_x = ctx.ws_sidebar_rect().map(|r| r.x).unwrap_or(PANE_GAP);
        let max_w = (logical.width - 200.0).max(80.0);
        let new_width = (pos.x - ws_x).max(80.0).min(max_w);
        ctx.ws_set_width(new_width);
        ctx.compute_layout();
        ctx.invalidate_chrome();
        return;
    }

    // Handle context area border resize
    if ctx.dock_border_dragging() {
        let logical = ctx.logical_size();
        let max_w = (logical.width - 200.0).max(100.0);
        let new_width = (logical.width - pos.x - PANE_GAP).max(100.0).min(max_w);
        ctx.set_dock_width(new_width);
        ctx.compute_layout();
        ctx.invalidate_chrome();
        return;
    }

    // Handle pinned group / terminal dock border resize
    if ctx.dock_pinned_border_dragging() {
        if let Some(dock_rect) = ctx.dock_area_rect() {
            let local_x = pos.x - dock_rect.x;
            let new_ratio = (local_x / dock_rect.width).clamp(0.1, 0.9);
            ctx.set_dock_pinned_ratio(new_ratio);
            ctx.compute_layout();
            ctx.invalidate_chrome();
        }
        return;
    }

    // Handle intra-dock split border resize
    if ctx.dock_split_dragging() {
        if let Some(dock_rect) = ctx.dock_area_rect() {
            let local_pos = Vec2::new(pos.x - dock_rect.x, pos.y - dock_rect.y);
            ctx.dock_drag_split_border(local_pos);
            ctx.compute_layout();
            ctx.request_redraw();
        }
        return;
    }

    // Handle file-tree border resize
    if ctx.ft().border_dragging {
        let logical = ctx.logical_size();
        let max_w = (logical.width - 100.0).max(120.0);
        let new_width = match ctx.sidebar_side() {
            crate::LayoutSide::Left => {
                let ft_x = ctx.ft().rect.map(|r| r.x).unwrap_or(0.0);
                (pos.x - ft_x).max(120.0).min(max_w)
            }
            crate::LayoutSide::Right => (logical.width - pos.x).max(120.0).min(max_w),
        };
        ctx.ft_mut().width = new_width;
        ctx.compute_layout();
        ctx.invalidate_chrome();
        return;
    }

    // Handle sidebar handle drag (side swap preview)
    if ctx.sidebar_handle_dragging() {
        let logical = ctx.logical_size();
        let win_center = logical.width / 2.0;
        let target_side = if pos.x < win_center {
            crate::LayoutSide::Left
        } else {
            crate::LayoutSide::Right
        };
        ctx.set_sidebar_side(target_side);
        ctx.compute_layout();
        ctx.invalidate_chrome();
        return;
    }

    // Handle pane drag — extract needed values to avoid borrow conflicts.
    enum DragSnapshot {
        Idle,
        Pending { source: crate::tide_core::PaneId, press_pos: Vec2 },
        Active { source: crate::tide_core::PaneId, prev_target: Option<crate::state::drag_types::DropDestination>, prev_preview: Option<crate::tide_core::Rect> },
    }
    let snap = match &ctx.interaction().pane_drag {
        PaneDragState::Idle => DragSnapshot::Idle,
        PaneDragState::PendingDrag { source_pane, press_pos } => {
            DragSnapshot::Pending { source: *source_pane, press_pos: *press_pos }
        }
        PaneDragState::Dragging { source_pane, drop_target, cached_preview_rect } => {
            DragSnapshot::Active { source: *source_pane, prev_target: drop_target.clone(), prev_preview: *cached_preview_rect }
        }
    };
    match snap {
        DragSnapshot::Pending { source, press_pos } => {
            let dx = pos.x - press_pos.x;
            let dy = pos.y - press_pos.y;
            if (dx * dx + dy * dy).sqrt() >= DRAG_THRESHOLD {
                let target = ctx.compute_drop_destination(pos, source);
                let preview = ctx.compute_drop_preview_rect(source, &target);
                ctx.interaction_mut().pane_drag = PaneDragState::Dragging {
                    source_pane: source,
                    drop_target: target,
                    cached_preview_rect: preview,
                };
                // Hide browser webviews so drag preview renders on top
                ctx.sync_browser_webview_frames();
            }
            ctx.request_redraw();
            return;
        }
        DragSnapshot::Active { source, prev_target, prev_preview } => {
            let new_target = ctx.compute_drop_destination(pos, source);
            let preview = if new_target == prev_target {
                prev_preview
            } else {
                ctx.compute_drop_preview_rect(source, &new_target)
            };
            ctx.interaction_mut().pane_drag = PaneDragState::Dragging {
                source_pane: source,
                drop_target: new_target,
                cached_preview_rect: preview,
            };
            ctx.request_redraw();
            return;
        }
        DragSnapshot::Idle => {}
    }

    if ctx.router_is_dragging_border() {
        let mut left = 0.0_f32;
        if ctx.ft().visible && ctx.sidebar_side() == crate::LayoutSide::Left {
            left += ctx.ft().width;
        }
        let drag_pos = Vec2::new(pos.x - left, pos.y);
        ctx.layout_drag_border(drag_pos);
        ctx.compute_layout();
        ctx.request_redraw();
    } else {
        // URL bar drag selection
        if ctx.interaction().mouse_left_pressed {
            super::selection::handle_url_bar_drag(ctx, pos);
        }

        // Text selection drag
        if ctx.interaction().mouse_left_pressed {
            super::selection::handle_selection_drag(ctx, pos);
        }

        // Hover target
        let new_hover = crate::adapter::inward::click_adapter::hit_test::compute_hover_target(ctx, pos);
        let old_hover = ctx.interaction().hover_target.clone();
        if new_hover != old_hover {
            let chrome_affected = old_hover
                .as_ref()
                .map_or(false, |h| h.affects_chrome())
                || new_hover.as_ref().map_or(false, |h| h.affects_chrome());
            let visual_changed = old_hover
                .as_ref()
                .map_or(false, |h| h.has_visual_feedback())
                || new_hover.as_ref().map_or(false, |h| h.has_visual_feedback());
            ctx.interaction_mut().hover_target = new_hover;
            ctx.update_cursor_icon(window);
            if chrome_affected {
                ctx.invalidate_chrome();
            }
            if visual_changed {
                ctx.request_redraw();
            }
        }

        let input = InputEvent::MouseMove { position: pos };
        let _ = ctx.route_input(input);
    }
}
