use crate::tide_core::{Rect, Renderer};

use crate::state::drag_types::PaneDragState;
use crate::theme::*;
use crate::App;


/// Render hover highlights (overlay layer) for the currently hovered UI element.
pub(crate) fn render_hover(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    _logical: crate::tide_core::Size,
    visual_pane_rects: &[(u64, Rect)],
    show_file_tree: bool,
    file_tree_scroll: f32,
) {
    if let Some(ref hover) = app.interaction.hover_target {
        // Skip hover rendering during drag
        if matches!(app.interaction.pane_drag, PaneDragState::Idle) && !app.ft.border_dragging && !app.ws.border_dragging && !app.dock.dock_border_dragging {
            match hover {
                crate::state::drag_types::HoverTarget::FileTreeEntry(index) => {
                    if show_file_tree {
                        if let Some(ft_rect) = app.ft.rect {
                            let cell_size = renderer.cell_size();
                            let line_height = cell_size.height * FILE_TREE_LINE_SPACING;
                            // File tree rows are rendered in an inset content rect.
                            let content_y = ft_rect.y + PANE_CORNER_RADIUS;
                            let content_h = ft_rect.height - PANE_CORNER_RADIUS * 2.0;
                            let y = content_y + FILE_TREE_HEADER_HEIGHT + *index as f32 * line_height - file_tree_scroll;
                            if y + line_height > content_y && y < content_y + content_h {
                                let row_rect = Rect::new(ft_rect.x, y, ft_rect.width, line_height);
                                renderer.draw_rect(row_rect, p.hover_file_tree);
                            }
                        }
                    }
                }
                crate::state::drag_types::HoverTarget::PaneTabBar(pane_id) => {
                    if let Some(&(_, rect)) = visual_pane_rects.iter().find(|(id, _)| id == pane_id) {
                        let tab_rect = Rect::new(rect.x, rect.y, rect.width, TAB_BAR_HEIGHT);
                        renderer.draw_rect(tab_rect, p.hover_tab);
                    }
                }
                crate::state::drag_types::HoverTarget::PaneTabClose(pane_id) => {
                    if let Some(&(_, rect)) = visual_pane_rects.iter().find(|(id, _)| id == pane_id) {
                        let cell_w = renderer.cell_size().width;
                        let grid_cols = ((rect.width - 2.0 * PANE_PADDING) / cell_w).floor();
                        let grid_right = rect.x + PANE_PADDING + grid_cols * cell_w;
                        let close_w = cell_w + BADGE_PADDING_H * 2.0;
                        let close_x = grid_right - close_w;
                        let close_y = rect.y + (TAB_BAR_HEIGHT - renderer.cell_size().height - 2.0) / 2.0;
                        let close_rect = Rect::new(close_x, close_y, close_w, renderer.cell_size().height + 2.0);
                        renderer.draw_rect(close_rect, p.hover_close);
                    }
                }
                crate::state::drag_types::HoverTarget::FileFinderItem(_) => {
                    // File finder hover — rendered inline in overlays
                }
                crate::state::drag_types::HoverTarget::EditorScrollbar(_) => {
                    // Scrollbar hover expansion handled in render_scrollbar
                }
                crate::state::drag_types::HoverTarget::SplitBorder(dir) => {
                    // Highlight the border line between adjacent panes
                    for &(id_a, rect_a) in visual_pane_rects {
                        match dir {
                            crate::tide_core::SplitDirection::Horizontal => {
                                let right_edge = rect_a.x + rect_a.width;
                                for &(id_b, rect_b) in visual_pane_rects {
                                    if id_b != id_a && (rect_b.x - right_edge).abs() <= PANE_GAP + 1.0 {
                                        let y = rect_a.y.max(rect_b.y);
                                        let h = (rect_a.y + rect_a.height).min(rect_b.y + rect_b.height) - y;
                                        if h > 0.0 {
                                            let border_rect = Rect::new(right_edge - 1.0, y, rect_b.x - right_edge + 2.0, h);
                                            renderer.draw_rect(border_rect, p.hover_panel_border);
                                        }
                                    }
                                }
                            }
                            crate::tide_core::SplitDirection::Vertical => {
                                let bottom_edge = rect_a.y + rect_a.height;
                                for &(id_b, rect_b) in visual_pane_rects {
                                    if id_b != id_a && (rect_b.y - bottom_edge).abs() <= PANE_GAP + 1.0 {
                                        let x = rect_a.x.max(rect_b.x);
                                        let w = (rect_a.x + rect_a.width).min(rect_b.x + rect_b.width) - x;
                                        if w > 0.0 {
                                            let border_rect = Rect::new(x, bottom_edge - 1.0, w, rect_b.y - bottom_edge + 2.0);
                                            renderer.draw_rect(border_rect, p.hover_panel_border);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                crate::state::drag_types::HoverTarget::WsSidebarBorder => {
                    if let Some(ws_rect) = app.ws.sidebar_rect {
                        let border_x = ws_rect.x + ws_rect.width;
                        let border_rect = Rect::new(border_x, ws_rect.y, 4.0, ws_rect.height);
                        renderer.draw_rect(border_rect, p.hover_panel_border);
                    }
                }
                crate::state::drag_types::HoverTarget::FileTreeBorder => {
                    if let Some(ft_rect) = app.ft.rect {
                        let border_x = if app.window.sidebar_side == crate::LayoutSide::Left {
                            ft_rect.x + ft_rect.width
                        } else {
                            ft_rect.x - PANE_GAP
                        };
                        let border_rect = Rect::new(border_x, ft_rect.y, 4.0, ft_rect.height);
                        renderer.draw_rect(border_rect, p.hover_panel_border);
                    }
                }
                crate::state::drag_types::HoverTarget::DockBorder => {
                    if let Some(pa_rect) = app.pane_area_rect {
                        let border_x = pa_rect.x + pa_rect.width;
                        let border_rect = Rect::new(border_x, pa_rect.y, 4.0, pa_rect.height);
                        renderer.draw_rect(border_rect, p.hover_panel_border);
                    }
                }
                crate::state::drag_types::HoverTarget::SidebarHandle => {
                    if let Some(ft_rect) = app.ft.rect {
                        // Highlight top edge of file tree panel
                        let handle_rect = Rect::new(ft_rect.x, ft_rect.y, ft_rect.width, PANE_PADDING);
                        renderer.draw_rect(handle_rect, p.hover_panel_border);
                    }
                }
                crate::state::drag_types::HoverTarget::TitlebarSwap => {
                    // Hover is rendered via chrome.rs
                }
                crate::state::drag_types::HoverTarget::TitlebarFileTree => {
                    // Hover is rendered via chrome.rs (badge_bg on sidebar button)
                }
                crate::state::drag_types::HoverTarget::TitlebarWorkspace => {
                    // Hover is rendered via chrome.rs (badge_bg on workspace button)
                }
                crate::state::drag_types::HoverTarget::TitlebarDock => {
                    // Hover is rendered via chrome.rs (badge_bg on dock button)
                }
                crate::state::drag_types::HoverTarget::PaneMaximize(pane_id) => {
                    // Highlight maximize icon on split pane header
                    if let Some(&(_, rect)) = visual_pane_rects.iter().find(|(id, _)| id == pane_id) {
                        let cell_w = renderer.cell_size().width;
                        let cell_h = renderer.cell_size().height;
                        let grid_cols = ((rect.width - 2.0 * PANE_PADDING) / cell_w).floor();
                        let grid_right = rect.x + PANE_PADDING + grid_cols * cell_w;
                        let close_w = cell_w + BADGE_PADDING_H * 2.0;
                        let close_x = grid_right - close_w;
                        let max_w = cell_w + BADGE_PADDING_H * 2.0;
                        let max_x = close_x - BADGE_GAP - max_w;
                        let max_y = rect.y + (TAB_BAR_HEIGHT - cell_h - 2.0) / 2.0;
                        renderer.draw_rect(
                            Rect::new(max_x, max_y, max_w, cell_h + 2.0),
                            p.hover_tab,
                        );
                    }
                }
                crate::state::drag_types::HoverTarget::BrowserBack
                | crate::state::drag_types::HoverTarget::BrowserForward
                | crate::state::drag_types::HoverTarget::BrowserRefresh => {
                    // Hover highlight on browser nav buttons
                    // Rendered inline via chrome nav bar
                }
                crate::state::drag_types::HoverTarget::BrowserUrlBar => {
                    // No additional overlay for URL bar hover
                }
                crate::state::drag_types::HoverTarget::TitlebarSettings => {
                    // Hover is rendered via chrome.rs (bg on settings gear icon)
                }
                crate::state::drag_types::HoverTarget::TitlebarTheme => {
                    // Hover is rendered via chrome.rs (bg on theme toggle icon)
                }
                crate::state::drag_types::HoverTarget::TitlebarGateway => {
                    // Hover is rendered via chrome.rs (bg on gateway badge)
                }
                crate::state::drag_types::HoverTarget::WorkspaceSidebarItem(_)
                | crate::state::drag_types::HoverTarget::WorkspaceSidebarNewBtn => {
                    // Hover is rendered via chrome.rs (workspace sidebar)
                }
                crate::state::drag_types::HoverTarget::PaneContent => {
                    // No visual overlay — only affects cursor icon (IBeam)
                }
                crate::state::drag_types::HoverTarget::DiffFileHeader => {
                    // No visual overlay — only affects cursor icon (Pointer)
                }
            }
        }
    }
}
