use crate::tide_core::{DropZone, PaneId, Rect, Vec2};
use crate::theme::*;
use crate::AppCorePort;
use crate::DockPort;
use crate::PaneAccessPort;
use crate::WorkspaceNavPort;
use crate::LayoutPort;
use crate::state::drag_types::{DropDestination, WsSidebarGeometry};

/// Threshold for outer zone detection (0–12% of pane extent).
const OUTER_ZONE_THRESHOLD: f32 = 0.12;

/// Hit-test whether the position is within a pane's tab bar area.
pub(crate) fn pane_at_tab_bar(ctx: &(impl AppCorePort), pos: Vec2) -> Option<PaneId> {
    for &(id, rect) in ctx.visual_pane_rects() {
        let tab_rect = Rect::new(rect.x, rect.y, rect.width, TAB_BAR_HEIGHT);
        if tab_rect.contains(pos) {
            return Some(id);
        }
    }
    None
}

/// Hit-test whether the position is on a pane tab bar close button.
pub(crate) fn pane_tab_close_at(ctx: &(impl AppCorePort), pos: Vec2) -> Option<PaneId> {
    for &(id, rect) in ctx.visual_pane_rects() {
        let tab_rect = Rect::new(rect.x, rect.y, rect.width, TAB_BAR_HEIGHT);
        if !tab_rect.contains(pos) {
            continue;
        }
        // Close badge is the rightmost badge, grid-aligned
        let cell_w = ctx.cell_size().width;
        let grid_cols = ((rect.width - 2.0 * PANE_PADDING) / cell_w).floor();
        let grid_right = rect.x + PANE_PADDING + grid_cols * cell_w;
        let close_w = cell_w + BADGE_PADDING_H * 2.0;
        let close_x = grid_right - close_w;
        let close_y = rect.y + (TAB_BAR_HEIGHT - PANE_CLOSE_SIZE) / 2.0;
        if pos.x >= close_x
            && pos.x <= close_x + close_w
            && pos.y >= close_y
            && pos.y <= close_y + PANE_CLOSE_SIZE
        {
            return Some(id);
        }
    }
    None
}

/// Hit-test whether the position is on a pane header maximize button.
pub(crate) fn pane_maximize_at(ctx: &(impl AppCorePort), pos: Vec2) -> Option<PaneId> {
    for &(id, rect) in ctx.visual_pane_rects() {
        let tab_rect = Rect::new(rect.x, rect.y, rect.width, TAB_BAR_HEIGHT);
        if !tab_rect.contains(pos) {
            continue;
        }
        let cell_w = ctx.cell_size().width;
        let grid_cols = ((rect.width - 2.0 * PANE_PADDING) / cell_w).floor();
        let grid_right = rect.x + PANE_PADDING + grid_cols * cell_w;
        let close_w = cell_w + BADGE_PADDING_H * 2.0;
        let close_x = grid_right - close_w;
        let max_w = cell_w + BADGE_PADDING_H * 2.0;
        let max_x = close_x - BADGE_GAP - max_w;
        let max_y = rect.y;
        if pos.x >= max_x && pos.x <= max_x + max_w
            && pos.y >= max_y && pos.y <= max_y + TAB_BAR_HEIGHT
        {
            return Some(id);
        }
    }
    None
}

/// Compute the drop destination for a given mouse position during drag.
pub(crate) fn compute_drop_destination(
    ctx: &(impl AppCorePort + DockPort + PaneAccessPort + WorkspaceNavPort),
    mouse: Vec2,
    source: PaneId,
) -> Option<DropDestination> {
    // Check workspace sidebar first — allow cross-workspace pane moves
    if let Some(idx) = workspace_sidebar_item_at_pos(ctx, mouse) {
        if idx != ctx.ws_active() {
            return Some(DropDestination::Workspace(idx));
        }
    }

    // Check pinned group area — detect drops onto the pinned group region
    if ctx.dock_open() && ctx.has_pinned_panes() {
        if let Some(dock_rect) = ctx.dock_area_rect() {
            let has_term_dock = ctx.focused_terminal_id().map(|tid| {
                if let Some(crate::pane::PaneKind::Terminal(tp)) = ctx.pane(tid) {
                    !tp.dock_layout.pane_ids().is_empty()
                } else { false }
            }).unwrap_or(false);

            if has_term_dock {
                let pinned_w = (dock_rect.width * ctx.dock_pinned_ratio()).max(60.0).min(dock_rect.width - 60.0);
                let pinned_rect = Rect::new(dock_rect.x, dock_rect.y, pinned_w, dock_rect.height);
                if pinned_rect.contains(mouse) && !ctx.is_pane_pinned(source) {
                    return Some(DropDestination::PinnedGroup);
                }
            }
        }
    }

    compute_tree_drop_target(ctx, mouse, source)
}

/// Pre-compute the simulate_drop preview rect for a given drop destination.
/// Called only when drop_target changes, not every frame.
pub(crate) fn compute_drop_preview_rect(
    ctx: &(impl AppCorePort + DockPort + PaneAccessPort + LayoutPort),
    source: PaneId,
    target: &Option<DropDestination>,
) -> Option<Rect> {
    let dest = target.as_ref()?;
    match dest {
        DropDestination::TreeRoot(zone) | DropDestination::TreePane(_, zone)
        | DropDestination::DockRoot(zone) => {
            if *zone == crate::tide_core::DropZone::Center {
                return None;
            }
            let target_id = match dest {
                DropDestination::TreePane(tid, _) => Some(*tid),
                _ => None,
            };

            // Use dock layout for dock drops
            let use_dock = matches!(dest, DropDestination::DockRoot(_))
                || target_id.map(|t| ctx.is_pane_in_dock(t)).unwrap_or(false);

            // Pinned pane dropping on non-owning terminal: no preview
            if use_dock && ctx.is_pane_pinned(source) {
                let assoc_tid = ctx.associated_terminal(source);
                if assoc_tid != ctx.focused_terminal_id() {
                    return None;
                }
            }

            if use_dock {
                let dock_area = ctx.dock_area_rect()?;
                let dock_size = crate::tide_core::Size::new(dock_area.width, dock_area.height);

                // Self-drop from tab group: compute preview rect directly
                // (simulate_drop fails because active tab's rect gets filtered out)
                if target_id == Some(source) {
                    let (w, h) = (dock_size.width, dock_size.height);
                    return Some(match *zone {
                        crate::tide_core::DropZone::Top => Rect::new(0.0, 0.0, w, h * 0.5),
                        crate::tide_core::DropZone::Bottom => Rect::new(0.0, h * 0.5, w, h * 0.5),
                        crate::tide_core::DropZone::Left => Rect::new(0.0, 0.0, w * 0.5, h),
                        crate::tide_core::DropZone::Right => Rect::new(w * 0.5, 0.0, w * 0.5, h),
                        _ => return None,
                    });
                }

                if let Some(tid) = ctx.focused_terminal_id() {
                    if let Some(crate::pane::PaneKind::Terminal(tp)) = ctx.pane(tid) {
                        return tp.dock_layout.simulate_drop(source, target_id, *zone, true, dock_size);
                    }
                }
                return None;
            }

            let pane_area = ctx.pane_area_rect()?;
            let pane_area_size = crate::tide_core::Size::new(pane_area.width, pane_area.height);
            ctx.layout_simulate_drop(source, target_id, *zone, true, pane_area_size)
        }
        DropDestination::Workspace(_) => None,
        DropDestination::PinnedGroup => {
            // Show preview covering the pinned group area
            if let Some(dock_rect) = ctx.dock_area_rect() {
                let pinned_w = (dock_rect.width * ctx.dock_pinned_ratio()).max(60.0).min(dock_rect.width - 60.0);
                Some(Rect::new(0.0, 0.0, pinned_w, dock_rect.height))
            } else {
                None
            }
        }
    }
}

/// Compute workspace sidebar item layout geometry.
pub(crate) fn ws_sidebar_geometry(ctx: &(impl AppCorePort + WorkspaceNavPort)) -> Option<WsSidebarGeometry> {
    let ws_rect = ctx.ws_sidebar_rect()?;
    let cs = ctx.cell_size();
    let name_h = cs.height;
    let content_w = ws_rect.width - WS_SIDEBAR_PADDING * 2.0;
    let text_avail_w = content_w - WS_SIDEBAR_ITEM_PAD_H * 2.0;
    let compact = text_avail_w < cs.width * 12.0;
    let item_h = if compact {
        // Compact mode: name only, vertically centered, with extra breathing room
        WS_SIDEBAR_ITEM_PAD_V * 2.0 + name_h + WS_SIDEBAR_LINE_GAP + name_h
    } else {
        // Full mode: name + 2 summary lines (terminal CWD + branch)
        let sub_h = cs.height;
        WS_SIDEBAR_ITEM_PAD_V * 2.0 + name_h + (WS_SIDEBAR_LINE_GAP + sub_h) * 2.0
    };
    Some(WsSidebarGeometry {
        content_x: ws_rect.x + WS_SIDEBAR_PADDING,
        content_w,
        start_y: ws_rect.y + PANE_CORNER_RADIUS + WS_SIDEBAR_PADDING,
        item_h,
        item_gap: WS_SIDEBAR_ITEM_GAP,
    })
}

/// Hit-test workspace sidebar items. Returns the 0-based workspace index if hit.
fn workspace_sidebar_item_at_pos(ctx: &(impl AppCorePort + WorkspaceNavPort), pos: Vec2) -> Option<usize> {
    if !ctx.ws_show_sidebar() {
        return None;
    }
    let geo = ws_sidebar_geometry(ctx)?;
    for i in 0..ctx.ws_workspaces_len() {
        if geo.item_rect(i).contains(pos) {
            return Some(i);
        }
    }
    None
}

/// Get the visual rect of a workspace sidebar item (for rendering drag highlights).
pub(crate) fn workspace_sidebar_item_rect(ctx: &(impl AppCorePort + WorkspaceNavPort), idx: usize) -> Option<Rect> {
    let geo = ws_sidebar_geometry(ctx)?;
    if idx < ctx.ws_workspaces_len() {
        Some(geo.item_rect(idx))
    } else {
        None
    }
}

/// Compute tree pane drop target (pane + zone) for drag.
/// Uses tiling rects for hit-testing so the gap between panes is a valid drop area.
fn compute_tree_drop_target(
    ctx: &(impl AppCorePort + DockPort + PaneAccessPort),
    mouse: Vec2,
    source: PaneId,
) -> Option<DropDestination> {
    let source_tiling = ctx.pane_rects()
        .iter()
        .find(|(id, _)| *id == source)
        .map(|(_, r)| *r);

    // Iterate tiling rects for hit-testing (covers gap areas between panes)
    for &(id, tiling_rect) in ctx.pane_rects() {
        if !tiling_rect.contains(mouse) {
            continue;
        }

        // Skip if dragging onto self — UNLESS source is in a dock tab group
        // (allows splitting a tab out of its group by dropping on directional zones)
        if id == source {
            // Check if source is in a dock tab group with multiple tabs
            let in_multi_tab_group = ctx.is_pane_in_dock(source) && {
                ctx.focused_terminal_id()
                    .and_then(|tid| {
                        if let Some(crate::pane::PaneKind::Terminal(tp)) = ctx.pane(tid) {
                            tp.dock_layout.tab_group_containing(source)
                                .map(|tg| tg.tabs.len() > 1)
                        } else { None }
                    })
                    .unwrap_or(false)
            };
            if !in_multi_tab_group {
                continue;
            }
        }

        // Use visual rect for zone computation: rel coords outside [0,1] = in gap → edge zone
        let visual_rect = ctx.visual_pane_rects()
            .iter()
            .find(|(vid, _)| *vid == id)
            .map(|(_, r)| *r)
            .unwrap_or(tiling_rect);

        let rel_x = (mouse.x - visual_rect.x) / visual_rect.width;
        let rel_y = (mouse.y - visual_rect.y) / visual_rect.height;

        let zone = if rel_y < 0.25 {
            DropZone::Top
        } else if rel_y > 0.75 {
            DropZone::Bottom
        } else if rel_x < 0.25 {
            DropZone::Left
        } else if rel_x > 0.75 {
            DropZone::Right
        } else {
            DropZone::Center
        };

        // Check for outer zone: if the zone is directional and the target pane's
        // tiling rect edge touches the area boundary, AND the relative
        // position is within the outer threshold → Root-level drop.
        // Use dock_area_rect for dock panes, pane_area_rect for stage panes.
        if zone != DropZone::Center {
            let (area_opt, is_dock_area) = if let Some(dock_rect) = ctx.dock_area_rect() {
                if dock_rect.contains(mouse) {
                    (Some(dock_rect), true)
                } else {
                    (ctx.pane_area_rect(), false)
                }
            } else {
                (ctx.pane_area_rect(), false)
            };
            if let Some(area) = area_opt {
                let touches_boundary = match zone {
                    DropZone::Top => tiling_rect.y <= area.y + 0.5,
                    DropZone::Bottom => tiling_rect.y + tiling_rect.height >= area.y + area.height - 0.5,
                    DropZone::Left => tiling_rect.x <= area.x + 0.5,
                    DropZone::Right => tiling_rect.x + tiling_rect.width >= area.x + area.width - 0.5,
                    DropZone::Center => false,
                };

                let is_outer = match zone {
                    DropZone::Top => rel_y < OUTER_ZONE_THRESHOLD,
                    DropZone::Bottom => rel_y > (1.0 - OUTER_ZONE_THRESHOLD),
                    DropZone::Left => rel_x < OUTER_ZONE_THRESHOLD,
                    DropZone::Right => rel_x > (1.0 - OUTER_ZONE_THRESHOLD),
                    DropZone::Center => false,
                };

                if touches_boundary && is_outer {
                    // Redundancy check: root-level drop is redundant only if the source
                    // already spans the full perpendicular extent on that edge.
                    let source_redundant = if let Some(src_rect) = source_tiling {
                        match zone {
                            DropZone::Top => {
                                src_rect.y <= area.y + 0.5
                                    && src_rect.x <= area.x + 0.5
                                    && src_rect.x + src_rect.width >= area.x + area.width - 0.5
                            }
                            DropZone::Bottom => {
                                src_rect.y + src_rect.height >= area.y + area.height - 0.5
                                    && src_rect.x <= area.x + 0.5
                                    && src_rect.x + src_rect.width >= area.x + area.width - 0.5
                            }
                            DropZone::Left => {
                                src_rect.x <= area.x + 0.5
                                    && src_rect.y <= area.y + 0.5
                                    && src_rect.y + src_rect.height >= area.y + area.height - 0.5
                            }
                            DropZone::Right => {
                                src_rect.x + src_rect.width >= area.x + area.width - 0.5
                                    && src_rect.y <= area.y + 0.5
                                    && src_rect.y + src_rect.height >= area.y + area.height - 0.5
                            }
                            DropZone::Center => false,
                        }
                    } else {
                        false
                    };

                    if !source_redundant {
                        return Some(if is_dock_area {
                            DropDestination::DockRoot(zone)
                        } else {
                            DropDestination::TreeRoot(zone)
                        });
                    }
                }
            }
        }

        return Some(DropDestination::TreePane(id, zone));
    }
    None
}
