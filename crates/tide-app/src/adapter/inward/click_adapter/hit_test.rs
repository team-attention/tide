use crate::tide_core::{FileTreeSource, SplitDirection, Vec2};

use crate::pane::PaneKind;
use crate::state::drag_types::HoverTarget;
use crate::theme::*;
use crate::AppCorePort;
use crate::DockPort;
use crate::FileTreePort;
use crate::LayoutPort;
use crate::PaneAccessPort;
use crate::WorkspaceNavPort;

/// Convert a pixel position to a terminal cell (row, col) within a pane's content area.
/// Returns None if the position is outside any terminal pane's content area.
pub(crate) fn pixel_to_cell(
    ctx: &(impl AppCorePort + PaneAccessPort),
    pos: Vec2,
    pane_id: crate::tide_core::PaneId,
) -> Option<(usize, usize)> {
    let (_, visual_rect) = ctx
        .visual_pane_rects()
        .iter()
        .find(|(id, _)| *id == pane_id)?;
    let cell_size = ctx.cell_size();
    let content_top = terminal_content_top(cell_size.height);
    let inner_x = visual_rect.x + PANE_PADDING;
    let inner_y = visual_rect.y + content_top;
    // Center offset matching render_grid: grid is centered within the content area
    let inner_w = visual_rect.width - 2.0 * PANE_PADDING;
    let max_cols = (inner_w / cell_size.width).floor();
    let extra_x = (inner_w - max_cols * cell_size.width) / 2.0;
    let col = ((pos.x - inner_x - extra_x) / cell_size.width).floor() as isize;
    let row = ((pos.y - inner_y) / cell_size.height).floor() as isize;
    if row >= 0 && col >= 0 {
        Some((row as usize, col as usize))
    } else {
        None
    }
}

/// Compute the hover target for a given cursor position.
/// Priority: TopHandles → SplitBorder → PaneTabBar → FileTreeBorder → FileTreeEntry → None
pub(crate) fn compute_hover_target(
    ctx: &(impl AppCorePort + PaneAccessPort + LayoutPort + FileTreePort + WorkspaceNavPort + DockPort),
    pos: Vec2,
) -> Option<HoverTarget> {
    // Titlebar buttons (right-to-left: swap icon, settings, theme, area toggles)
    if ctx.top_inset() > 0.0 {
        let logical = ctx.logical_size();
        let cs = ctx.cell_size();

        // Swap icon dimensions (enlarged)
        let swap_icon_h = 16.0_f32;
        let swap_rect_w = 7.0_f32;
        let swap_gap = 3.0_f32;
        let swap_icon_w = swap_rect_w * 2.0 + swap_gap;
        let swap_x = logical.width - PANE_PADDING - swap_icon_w;
        let swap_y = (ctx.top_inset() - swap_icon_h) / 2.0;
        let swap_pad = 4.0_f32;
        if pos.x >= swap_x - swap_pad
            && pos.x <= swap_x + swap_icon_w + swap_pad
            && pos.y >= swap_y - swap_pad
            && pos.y <= swap_y + swap_icon_h + swap_pad
        {
            return Some(HoverTarget::TitlebarSwap);
        }

        // Settings gear icon
        let gear_pad = 4.0_f32;
        let gear_w = cs.width + gear_pad * 2.0;
        let gear_h = cs.height + 6.0;
        let gear_x = swap_x - gear_w - 8.0;
        let gear_y = (ctx.top_inset() - gear_h) / 2.0;
        if pos.x >= gear_x
            && pos.x <= gear_x + gear_w
            && pos.y >= gear_y
            && pos.y <= gear_y + gear_h
        {
            return Some(HoverTarget::TitlebarSettings);
        }

        // Theme toggle icon
        let theme_pad = 4.0_f32;
        let theme_w = cs.width + theme_pad * 2.0;
        let theme_h = cs.height + 6.0;
        let theme_x = gear_x - theme_w - 8.0;
        let theme_y = (ctx.top_inset() - theme_h) / 2.0;
        if pos.x >= theme_x
            && pos.x <= theme_x + theme_w
            && pos.y >= theme_y
            && pos.y <= theme_y + theme_h
        {
            return Some(HoverTarget::TitlebarTheme);
        }

        // Integration toggle button (left of theme icon)
        let integ_pad = 4.0_f32;
        let integ_w = cs.width + integ_pad * 2.0;
        let integ_h = cs.height + 6.0;
        let integ_x = theme_x - integ_w - 8.0;
        let integ_y = (ctx.top_inset() - integ_h) / 2.0;

        if pos.x >= integ_x
            && pos.x <= integ_x + integ_w
            && pos.y >= integ_y
            && pos.y <= integ_y + integ_h
        {
            return Some(HoverTarget::TitlebarIntegration);
        }

        // Titlebar toggle buttons (right-to-left: Dock, FileTree, Workspace)
        let btn_pad_h = 6.0_f32;
        let btn_chars = 4.0_f32;
        let btn_w = btn_chars * cs.width + btn_pad_h * 2.0;
        let btn_h = cs.height + 6.0;
        let btn_y = (ctx.top_inset() - btn_h) / 2.0;

        let mut cur_right = integ_x - TITLEBAR_BUTTON_GAP;
        let buttons = [
            HoverTarget::TitlebarDock,
            HoverTarget::TitlebarFileTree,
            HoverTarget::TitlebarWorkspace,
        ];
        for hover in &buttons {
            let btn_x = cur_right - btn_w;
            if pos.x >= btn_x && pos.x <= btn_x + btn_w && pos.y >= btn_y && pos.y <= btn_y + btn_h
            {
                return Some(hover.clone());
            }
            cur_right -= btn_w + TITLEBAR_BUTTON_GAP;
        }
    }

    // Workspace sidebar items
    if let Some(ws_rect) = ctx.ws_sidebar_rect() {
        if pos.x >= ws_rect.x
            && pos.x < ws_rect.x + ws_rect.width
            && pos.y >= ws_rect.y
            && pos.y < ws_rect.y + ws_rect.height
        {
            if let Some(geo) = ctx.ws_sidebar_geometry() {
                for i in 0..ctx.ws_workspaces_len() {
                    if geo.item_rect(i).contains(pos) {
                        return Some(HoverTarget::WorkspaceSidebarItem(i));
                    }
                }

                // "+ New Workspace" button at bottom
                let cs = ctx.cell_size();
                let btn_h = cs.height + 12.0;
                let edge_inset = PANE_CORNER_RADIUS;
                let btn_y = ws_rect.y + ws_rect.height - edge_inset - btn_h - WS_SIDEBAR_PADDING;
                let btn_rect =
                    crate::tide_core::Rect::new(geo.content_x, btn_y, geo.content_w, btn_h);
                if btn_rect.contains(pos) {
                    return Some(HoverTarget::WorkspaceSidebarNewBtn);
                }
            }
        }
    }

    // Top-edge drag handles (top strip of sidebar)
    let ft = ctx.ft();
    if let Some(ft_rect) = ft.rect {
        if pos.y >= ft_rect.y
            && pos.y < ft_rect.y + PANE_PADDING
            && pos.x >= ft_rect.x
            && pos.x < ft_rect.x + ft_rect.width
        {
            return Some(HoverTarget::SidebarHandle);
        }
    }

    // File finder item hover
    if let Some(idx) = ctx.file_finder_item_at(pos) {
        return Some(HoverTarget::FileFinderItem(idx));
    }

    // Context area border (resize handle) — right edge of pane area
    // Must be checked before SplitBorder so dock border isn't mistaken for a split border
    if ctx.dock_open() {
        if let Some(pa_rect) = ctx.pane_area_rect() {
            let border_x = pa_rect.x + pa_rect.width;
            if (pos.x - border_x).abs() < 5.0 {
                return Some(HoverTarget::DockBorder);
            }
        }
    }

    // Split pane border (resize handle between tiled panes)
    if let Some(dir) = split_border_at(ctx, pos) {
        return Some(HoverTarget::SplitBorder(dir));
    }

    // Focused header action strip buttons
    for zone in ctx.header_hit_zones() {
        if zone.rect.contains(pos) && crate::header::is_header_action_strip_action(&zone.action) {
            return Some(HoverTarget::HeaderAction(zone.pane_id, zone.action));
        }
    }

    // Pane tab bar close button (before general tab bar check)
    if let Some(pane_id) = ctx.pane_tab_close_at(pos) {
        return Some(HoverTarget::PaneTabClose(pane_id));
    }

    // Pane header maximize button (between close and badges)
    if let Some(pane_id) = ctx.pane_maximize_at(pos) {
        return Some(HoverTarget::PaneMaximize(pane_id));
    }

    // Pane tab bar (split tree panes)
    if let Some(pane_id) = ctx.pane_at_tab_bar(pos) {
        return Some(HoverTarget::PaneTabBar(pane_id));
    }

    // Workspace sidebar border (resize handle)
    if let Some(ws_rect) = ctx.ws_sidebar_rect() {
        let border_x = ws_rect.x + ws_rect.width + PANE_GAP;
        if (pos.x - border_x).abs() < 5.0 {
            return Some(HoverTarget::WsSidebarBorder);
        }
    }

    // File tree border (resize handle) — position depends on sidebar side
    let ft = ctx.ft();
    if let Some(ft_rect) = ft.rect {
        let border_x = if ctx.sidebar_side() == crate::LayoutSide::Left {
            ft_rect.x + ft_rect.width + PANE_GAP
        } else {
            ft_rect.x - PANE_GAP
        };
        if (pos.x - border_x).abs() < 5.0 {
            return Some(HoverTarget::FileTreeBorder);
        }
    }

    // File tree entry
    let ft = ctx.ft();
    if ft.visible
        && ft
            .rect
            .is_some_and(|r| pos.x >= r.x && pos.x < r.x + r.width)
    {
        let ft_rect = ft.rect.unwrap();
        let cell_size = ctx.cell_size();
        let line_height = cell_size.height * FILE_TREE_LINE_SPACING;
        let content_y = ft_rect.y + PANE_CORNER_RADIUS;
        if pos.y < content_y + FILE_TREE_HEADER_HEIGHT {
            return None;
        }
        let adjusted_y = pos.y - content_y - FILE_TREE_HEADER_HEIGHT;
        let index = ((adjusted_y + ft.scroll) / line_height) as usize;
        if let Some(tree) = &ft.tree {
            let entries = tree.visible_entries();
            if index < entries.len() {
                return Some(HoverTarget::FileTreeEntry(index));
            }
        }
    }

    // Browser navigation bar (back, forward, refresh, URL bar)
    for &(id, rect) in ctx.visual_pane_rects() {
        if let Some(PaneKind::Browser(_)) = ctx.pane(id) {
            let cell_size = ctx.cell_size();
            let cell_w = cell_size.width;
            let cell_h = cell_size.height;
            let nav_h = (cell_h * 1.5).round();
            let nav_y = rect.y + TAB_BAR_HEIGHT + 2.0;
            let nav_x = rect.x + PANE_PADDING;
            let nav_w = rect.width - PANE_PADDING * 2.0;

            if pos.y >= nav_y && pos.y <= nav_y + nav_h && pos.x >= nav_x && pos.x <= nav_x + nav_w
            {
                let mut cx = nav_x + 8.0;

                // Back button
                if pos.x >= cx && pos.x < cx + cell_w * 2.0 {
                    return Some(HoverTarget::BrowserBack);
                }
                cx += cell_w * 2.0;

                // Forward button
                if pos.x >= cx && pos.x < cx + cell_w * 2.0 {
                    return Some(HoverTarget::BrowserForward);
                }
                cx += cell_w * 2.0;

                // Refresh button
                if pos.x >= cx && pos.x < cx + cell_w * 2.0 {
                    return Some(HoverTarget::BrowserRefresh);
                }
                cx += cell_w * 2.0 + 4.0;

                // Copy URL button
                if pos.x >= cx && pos.x < cx + cell_w * 2.0 {
                    return Some(HoverTarget::BrowserCopyUrl);
                }
                cx += cell_w * 2.0;

                // Open externally button
                if pos.x >= cx && pos.x < cx + cell_w * 2.0 {
                    return Some(HoverTarget::BrowserOpenExternal);
                }
                cx += cell_w * 2.0 + 4.0;

                // URL bar (rest of nav area)
                if pos.x >= cx {
                    return Some(HoverTarget::BrowserUrlBar);
                }
            }
        }
    }

    // Editor scrollbar hover
    {
        let cell_size = ctx.cell_size();
        for &(id, rect) in ctx.visual_pane_rects() {
            if let Some(PaneKind::Editor(pane)) = ctx.pane(id) {
                let inner = pane.content_rect(rect, TAB_BAR_HEIGHT, cell_size);
                if pane.needs_scrollbar(inner, cell_size.height) {
                    let sb_x = inner.x + inner.width - SCROLLBAR_WIDTH_HOVER;
                    if pos.x >= sb_x
                        && pos.x <= inner.x + inner.width
                        && pos.y >= inner.y
                        && pos.y <= inner.y + inner.height
                    {
                        return Some(HoverTarget::EditorScrollbar(id));
                    }
                }
            }
        }
    }

    // Pane content area — show text cursor for terminal, editor, diff panes
    for &(id, rect) in ctx.visual_pane_rects() {
        let content = match ctx.pane(id) {
            Some(PaneKind::Terminal(_)) => {
                crate::pane::pane_content_rect(rect, terminal_content_top(ctx.cell_size().height))
            }
            Some(PaneKind::Editor(pane)) => {
                pane.content_rect(rect, TAB_BAR_HEIGHT, ctx.cell_size())
            }
            Some(PaneKind::Diff(_))
            | Some(PaneKind::Browser(_))
            | Some(PaneKind::Launcher(_))
            | None => crate::pane::pane_content_rect(rect, TAB_BAR_HEIGHT),
        };
        if content.contains(pos) {
            match ctx.pane(id) {
                Some(PaneKind::Terminal(_)) | Some(PaneKind::Editor(_)) => {
                    return Some(HoverTarget::PaneContent);
                }
                Some(PaneKind::Diff(dp)) => {
                    let cell_size = ctx.cell_size();
                    let visual_row = ((pos.y - content.y) / cell_size.height).floor() as usize;
                    if dp.is_file_header_row(visual_row) {
                        return Some(HoverTarget::DiffFileHeader);
                    }
                    return Some(HoverTarget::PaneContent);
                }
                _ => {}
            }
        }
    }

    None
}

/// Check if cursor is near an internal border between split panes.
/// Returns the split direction (Horizontal for vertical line, Vertical for horizontal line).
fn split_border_at(ctx: &impl AppCorePort, pos: Vec2) -> Option<SplitDirection> {
    let t = 5.0_f32;
    let rects = ctx.pane_rects();
    if rects.len() < 2 {
        return None;
    }
    for &(id_a, rect_a) in rects {
        // Check right edge → adjacent left edge = Horizontal split (side by side)
        let right_edge = rect_a.x + rect_a.width;
        if (pos.x - right_edge).abs() <= t && pos.y >= rect_a.y && pos.y <= rect_a.y + rect_a.height
        {
            for &(id_b, rect_b) in rects {
                if id_b != id_a
                    && (rect_b.x - right_edge).abs() <= t * 2.0
                    && pos.y >= rect_b.y
                    && pos.y <= rect_b.y + rect_b.height
                {
                    return Some(SplitDirection::Horizontal);
                }
            }
        }
        // Check bottom edge → adjacent top edge = Vertical split (stacked)
        let bottom_edge = rect_a.y + rect_a.height;
        if (pos.y - bottom_edge).abs() <= t && pos.x >= rect_a.x && pos.x <= rect_a.x + rect_a.width
        {
            for &(id_b, rect_b) in rects {
                if id_b != id_a
                    && (rect_b.y - bottom_edge).abs() <= t * 2.0
                    && pos.x >= rect_b.x
                    && pos.x <= rect_b.x + rect_b.width
                {
                    return Some(SplitDirection::Vertical);
                }
            }
        }
    }
    None
}
