//! Mouse event handling — platform-agnostic.

pub(crate) mod drag;
mod selection;

use crate::tide_core::{FileTreeSource, InputEvent, MouseButton, Rect, Vec2};
use crate::tide_platform::WindowProxy;

use crate::state::drag_types::PaneDragState;
use crate::pane::PaneKind;
use crate::theme::*;
use crate::FileOpsPort;
use crate::DockPort;
use crate::AppCorePort;
use crate::LayoutPort;
use crate::WorkspaceNavPort;
use crate::ActionPort;
use crate::PaneLifecyclePort;
use crate::ModalPort;
use crate::InputStatePort;
use crate::FocusNavPort;
use crate::PaneAccessPort;
use crate::FileTreePort;
use crate::GatewayPort;
use crate::RouterPort;

// ── Trait alias for mouse adapter ports ──

pub(crate) trait MousePorts:
    AppCorePort + FocusNavPort + PaneAccessPort + PaneLifecyclePort
    + ModalPort + InputStatePort + DockPort + WorkspaceNavPort
    + LayoutPort + FileOpsPort + ActionPort + FileTreePort
    + GatewayPort + RouterPort {}
impl<T: AppCorePort + FocusNavPort + PaneAccessPort + PaneLifecyclePort
    + ModalPort + InputStatePort + DockPort + WorkspaceNavPort
    + LayoutPort + FileOpsPort + ActionPort + FileTreePort
    + GatewayPort + RouterPort> MousePorts for T {}

pub(crate) fn handle_mouse_down(ctx: &mut impl MousePorts, button: MouseButton, window: &WindowProxy) {
    if button == MouseButton::Left {
        ctx.interaction_mut().mouse_left_pressed = true;

        // Check editor scrollbar click
        if check_scrollbar_click(ctx, ctx.last_cursor_pos()) {
            ctx.request_redraw();
            return;
        }

        // Start text selection if clicking on pane content
        if selection::start_text_selection(ctx) {
            // selection started — fall through to continue processing
        }
    }

    // Handle search bar clicks
    if button == MouseButton::Left {
        if crate::adapter::inward::search_adapter::check_search_bar_click(ctx) {
            ctx.request_redraw();
            return;
        }
    }

    // Handle modal/popup clicks
    if button == MouseButton::Left {
        if ctx.modal().context_menu.is_some() {
            if let Some(idx) = ctx.context_menu_item_at(ctx.last_cursor_pos()) {
                ctx.execute_context_menu_action(idx);
            }
            ctx.modal_mut().context_menu = None;
            ctx.request_redraw();
            return;
        }


        if ctx.modal().save_as_input.is_some() {
            if !ctx.save_as_contains(ctx.last_cursor_pos()) {
                ctx.modal_mut().save_as_input = None;
            }
            ctx.request_redraw();
            return;
        }

        if ctx.modal().file_finder.is_some() {
            if let Some(idx) = ctx.file_finder_item_at(ctx.last_cursor_pos()) {
                let path = {
                    let finder = ctx.modal().file_finder.as_ref().unwrap();
                    if let Some(&entry_idx) = finder.filtered.get(idx) {
                        Some(finder.base_dir.join(&finder.entries[entry_idx]))
                    } else {
                        None
                    }
                };
                if let Some(path) = path {
                    ctx.close_file_finder();
                    ctx.open_editor_pane(path);
                    ctx.request_redraw();
                    return;
                }
            } else if !ctx.file_finder_contains(ctx.last_cursor_pos()) {
                ctx.close_file_finder();
            }
            ctx.request_redraw();
            return;
        }

        if ctx.modal().git_switcher.is_some() {
            if let Some(btn) = ctx.git_switcher_button_at(ctx.last_cursor_pos()) {
                crate::adapter::inward::click_adapter::header::handle_git_switcher_button(ctx, btn);
                ctx.request_redraw();
                return;
            }
            if let Some(idx) = ctx.git_switcher_item_at(ctx.last_cursor_pos()) {
                if let Some(ref mut gs) = ctx.modal_mut().git_switcher {
                    gs.selected = idx;
                }
                ctx.invalidate_chrome();
                ctx.request_redraw();
                return;
            } else if !ctx.git_switcher_contains(ctx.last_cursor_pos()) {
                ctx.modal_mut().git_switcher = None;
                ctx.request_redraw();
                return;
            }
        }
    }

    // Branch cleanup bar clicks
    if button == MouseButton::Left && ctx.modal().branch_cleanup.is_some() {
        if crate::adapter::inward::click_adapter::pane::handle_branch_cleanup_click(ctx, ctx.last_cursor_pos()) {
            return;
        }
    }

    // Notification bar clicks
    if button == MouseButton::Left {
        if crate::adapter::inward::click_adapter::pane::handle_notification_bar_click(ctx, ctx.last_cursor_pos()) {
            return;
        }
    }

    // Header clicks
    if button == MouseButton::Left {
        if crate::adapter::inward::click_adapter::header::check_header_click(ctx) {
            return;
        }
    }

    // Pane tab close
    if button == MouseButton::Left {
        if let Some(pane_id) = ctx.pane_tab_close_at(ctx.last_cursor_pos()) {
            ctx.close_specific_pane(pane_id);
            ctx.request_redraw();
            return;
        }
    }

    // Right-click on file tree
    if button == MouseButton::Right {
        if ctx.ft().visible {
            if let Some(ft_rect) = ctx.ft().rect {
                let pos = ctx.last_cursor_pos();
                if pos.x >= ft_rect.x
                    && pos.x < ft_rect.x + ft_rect.width
                    && pos.y >= ft_rect.y + PANE_CORNER_RADIUS + FILE_TREE_HEADER_HEIGHT
                {
                    let cell_size = ctx.cell_size();
                    let line_height = cell_size.height * FILE_TREE_LINE_SPACING;
                    let content_y = ft_rect.y + PANE_CORNER_RADIUS;
                    let adjusted_y = pos.y - content_y - FILE_TREE_HEADER_HEIGHT;
                    let ft_scroll = ctx.ft().scroll;
                    let index =
                        ((adjusted_y + ft_scroll) / line_height) as usize;

                    let entry_info = ctx.ft().tree.as_ref().and_then(|tree| {
                        let entries = tree.visible_entries();
                        entries.get(index).map(|entry| {
                            (entry.entry.path.clone(), entry.entry.is_dir)
                        })
                    });

                    if let Some((path, is_dir)) = entry_info {
                        ctx.modal_mut().context_menu = None;
                        ctx.modal_mut().file_tree_rename = None;
                        let shell_idle = ctx.focused_pane()
                            .and_then(|tid| ctx.pane(tid))
                            .map(|pk| if let crate::PaneKind::Terminal(tp) = pk { tp.context.shell_idle } else { false })
                            .unwrap_or(false);
                        ctx.modal_mut().context_menu = Some(crate::ContextMenuState {
                            entry_index: index,
                            path,
                            is_dir,
                            shell_idle,
                            position: pos,
                            selected: 0,
                        });
                        ctx.request_redraw();
                        return;
                    }
                }
            }
        }
    }

    // File tree clicks
    if button == MouseButton::Left {
        if ctx.ft().visible {
            if let Some(ft_rect) = ctx.ft().rect {
                let pos = ctx.last_cursor_pos();
                if pos.x >= ft_rect.x
                    && pos.x < ft_rect.x + ft_rect.width
                    && pos.y >= ft_rect.y + PANE_CORNER_RADIUS + FILE_TREE_HEADER_HEIGHT
                {
                    ctx.handle_file_tree_click(pos);
                    return;
                }
            }
        }
    }

    // Diff pane file header click (toggle expand/collapse) — only on header rows
    if button == MouseButton::Left {
        let pos = ctx.last_cursor_pos();
        let cell_size = ctx.cell_size();
        let content_top = TAB_BAR_HEIGHT;
        let rects: Vec<_> = ctx.visual_pane_rects().to_vec();
        for &(id, rect) in &rects {
            let content = crate::tide_core::Rect::new(
                rect.x + PANE_PADDING,
                rect.y + content_top,
                rect.width - 2.0 * PANE_PADDING,
                rect.height - content_top - PANE_PADDING,
            );
            if content.contains(pos) {
                if let Some(crate::pane::PaneKind::Diff(dp)) = ctx.pane_mut(id) {
                    let visual_row = ((pos.y - content.y) / cell_size.height).floor() as usize;
                    if dp.is_file_header_row(visual_row) {
                        dp.click_row(visual_row);
                        ctx.focus_pane(id);
                        ctx.set_focus_area(crate::state::FocusArea::Dock);
                        ctx.request_redraw();
                        return;
                    }
                    // Non-header: focus the pane but let text selection handle the rest
                    ctx.focus_pane(id);
                    ctx.set_focus_area(crate::state::FocusArea::Dock);
                }
            }
        }
    }

    // Config page
    if button == MouseButton::Left && ctx.modal().config_page.is_some() {
        crate::adapter::inward::click_adapter::pane::handle_config_page_click(ctx, ctx.last_cursor_pos());
        ctx.request_redraw();
        return;
    }

    // General mouse input routing
    handle_mouse_input_core(ctx, button, window);
    ctx.request_redraw();
}

fn handle_mouse_input_core(ctx: &mut impl MousePorts, button: MouseButton, _window: &WindowProxy) {
    if button == MouseButton::Left {
        // Workspace sidebar (always clickable, including fullscreen)
        let hover = ctx.interaction().hover_target.clone();
        match &hover {
            Some(crate::state::drag_types::HoverTarget::WorkspaceSidebarItem(idx)) => {
                let idx = *idx;
                let press_y = ctx.last_cursor_pos().y;
                // Start pending drag
                ctx.ws_set_drag(Some((idx, press_y, idx)));
                return;
            }
            Some(crate::state::drag_types::HoverTarget::WorkspaceSidebarNewBtn) => {
                ctx.new_workspace();
                return;
            }
            _ => {}
        }

        // Titlebar buttons (only when titlebar is visible)
        if ctx.top_inset() > 0.0 {
            match &hover {
                Some(crate::state::drag_types::HoverTarget::TitlebarSettings) => {
                    ctx.toggle_config_page();
                    return;
                }
                Some(crate::state::drag_types::HoverTarget::TitlebarTheme) => {
                    ctx.handle_global_action(crate::tide_input::GlobalAction::ToggleTheme);
                    return;
                }
                Some(crate::state::drag_types::HoverTarget::TitlebarIntegration) => {
                    ctx.toggle_auto_integration();
                    ctx.invalidate_chrome();
                    return;
                }
                Some(crate::state::drag_types::HoverTarget::TitlebarSwap) => {
                    let new_side = match ctx.sidebar_side() {
                        crate::LayoutSide::Left => crate::LayoutSide::Right,
                        crate::LayoutSide::Right => crate::LayoutSide::Left,
                    };
                    ctx.set_sidebar_side(new_side);
                    ctx.compute_layout();
                    ctx.invalidate_chrome();
                    return;
                }
                Some(crate::state::drag_types::HoverTarget::TitlebarWorkspace) => {
                    let v = !ctx.ws_show_sidebar();
                    ctx.set_ws_show_sidebar(v);
                    ctx.invalidate_chrome();
                    ctx.compute_layout();
                    return;
                }
                Some(crate::state::drag_types::HoverTarget::TitlebarFileTree) => {
                    ctx.toggle_file_tree_visibility();
                    return;
                }
                Some(crate::state::drag_types::HoverTarget::TitlebarDock) => {
                    ctx.toggle_dock_visibility();
                    return;
                }
                _ => {}
            }
        }


        // Browser navigation bar clicks
        match &hover {
            Some(target @ crate::state::drag_types::HoverTarget::BrowserBack)
            | Some(target @ crate::state::drag_types::HoverTarget::BrowserForward)
            | Some(target @ crate::state::drag_types::HoverTarget::BrowserRefresh)
            | Some(target @ crate::state::drag_types::HoverTarget::BrowserCopyUrl)
            | Some(target @ crate::state::drag_types::HoverTarget::BrowserOpenExternal)
            | Some(target @ crate::state::drag_types::HoverTarget::BrowserUrlBar) => {
                let target = target.clone();
                // Focus the browser pane first
                let rects: Vec<_> = ctx.visual_pane_rects().to_vec();
                let pos = ctx.last_cursor_pos();
                for &(id, rect) in &rects {
                    if let Some(crate::pane::PaneKind::Browser(_)) = ctx.pane(id) {
                        if rect.contains(pos) {
                            ctx.focus_terminal(id);
                            break;
                        }
                    }
                }
                crate::adapter::inward::click_adapter::pane::handle_browser_nav_click(ctx, &target);
                return;
            }
            _ => {}
        }

        // Handle drags — sidebar handle
        if let Some(ft_rect) = ctx.ft().rect {
            let pos = ctx.last_cursor_pos();
            if pos.y >= ft_rect.y
                && pos.y < ft_rect.y + PANE_PADDING
                && pos.x >= ft_rect.x
                && pos.x < ft_rect.x + ft_rect.width
            {
                ctx.set_sidebar_handle_dragging(true);
                return;
            }
        }

        // Workspace sidebar border
        if let Some(ws_rect) = ctx.ws_sidebar_rect() {
            let border_x = ws_rect.x + ws_rect.width + PANE_GAP;
            if (ctx.last_cursor_pos().x - border_x).abs() < 5.0 {
                ctx.set_ws_border_dragging(true);
                return;
            }
        }

        // Context area border
        if ctx.dock_open() {
            if let Some(pa_rect) = ctx.pane_area_rect() {
                let border_x = pa_rect.x + pa_rect.width;
                if (ctx.last_cursor_pos().x - border_x).abs() < 5.0 {
                    ctx.set_dock_border_dragging(true);
                    return;
                }
            }

            // Pinned group / terminal dock border drag
            if let Some(dock_rect) = ctx.dock_area_rect() {
                let has_term_dock = ctx.focused_terminal_id().map(|tid| {
                    if let Some(crate::pane::PaneKind::Terminal(tp)) = ctx.pane(tid) {
                        !tp.dock_layout.pane_ids().is_empty()
                    } else { false }
                }).unwrap_or(false);
                if ctx.has_pinned_panes() && has_term_dock {
                    let pinned_w = (dock_rect.width * ctx.dock_pinned_ratio()).max(60.0).min(dock_rect.width - 60.0);
                    let border_x = dock_rect.x + pinned_w;
                    if (ctx.last_cursor_pos().x - border_x).abs() < 5.0 {
                        ctx.set_dock_pinned_border_dragging(true);
                        return;
                    }
                }
            }

            // Intra-dock split border drag
            if let Some(dock_rect) = ctx.dock_area_rect() {
                if dock_rect.contains(ctx.last_cursor_pos()) {
                    let local_pos = Vec2::new(
                        ctx.last_cursor_pos().x - dock_rect.x,
                        ctx.last_cursor_pos().y - dock_rect.y,
                    );
                    let dock_size = crate::tide_core::Size::new(dock_rect.width, dock_rect.height);
                    if ctx.dock_begin_split_drag(local_pos, dock_size) {
                        ctx.set_dock_split_dragging(true);
                        return;
                    }
                }
            }
        }

        // Sidebar border
        if let Some(ft_rect) = ctx.ft().rect {
            let border_x = if ctx.sidebar_side() == crate::LayoutSide::Left {
                ft_rect.x + ft_rect.width + PANE_GAP
            } else {
                ft_rect.x - PANE_GAP
            };
            if (ctx.last_cursor_pos().x - border_x).abs() < 5.0 {
                ctx.ft_mut().border_dragging = true;
                return;
            }
        }

        // Pane tab drag init — check header_hit_zones first for accurate tab ID
        // Initiate pane drag from header tab bar click.
        {
            let pos = ctx.last_cursor_pos();
            let drag_pane = ctx.pane_at_tab_bar(pos);
            if let Some(pane_id) = drag_pane {
                ctx.interaction_mut().pane_drag = PaneDragState::PendingDrag {
                    source_pane: pane_id,
                    press_pos: pos,
                };
                ctx.focus_terminal(pane_id);
                return;
            }
        }
    }

    let pos = ctx.last_cursor_pos();
    let input = InputEvent::MouseClick {
        position: pos,
        button,
    };
    let action = ctx.route_input(input);
    ctx.handle_action(action, Some(input));
}

pub(crate) fn handle_mouse_up(ctx: &mut impl MousePorts, button: MouseButton) {
    if button == MouseButton::Left {
        ctx.interaction_mut().mouse_left_pressed = false;
    }

    // End workspace sidebar drag
    if let Some((src, press_y, gap)) = ctx.ws_take_drag() {
        let moved = (ctx.last_cursor_pos().y - press_y).abs() > DRAG_THRESHOLD;
        let target = if gap <= src { gap } else { gap - 1 };
        if moved && target != src {
            ctx.ws_reorder(src, target);
        } else if !moved {
            ctx.switch_workspace(src);
        }
        ctx.invalidate_chrome();
        return;
    }

    // End scrollbar drag
    if ctx.interaction().scrollbar_dragging.is_some() {
        ctx.interaction_mut().scrollbar_dragging = None;
        ctx.interaction_mut().scrollbar_drag_rect = None;
        return;
    }

    // End sidebar handle drag on release
    if ctx.sidebar_handle_dragging() {
        ctx.set_sidebar_handle_dragging(false);
        ctx.compute_layout();
        ctx.invalidate_chrome();
        return;
    }

    if ctx.ft().border_dragging {
        ctx.ft_mut().border_dragging = false;
        ctx.compute_layout();
        ctx.invalidate_chrome();
        return;
    }

    if ctx.ws_border_dragging() {
        ctx.set_ws_border_dragging(false);
        ctx.compute_layout();
        ctx.invalidate_chrome();
        return;
    }

    if ctx.dock_border_dragging() {
        ctx.set_dock_border_dragging(false);
        ctx.compute_layout();
        ctx.invalidate_chrome();
        return;
    }

    if ctx.dock_pinned_border_dragging() {
        ctx.set_dock_pinned_border_dragging(false);
        ctx.compute_layout();
        ctx.invalidate_chrome();
        return;
    }

    if ctx.dock_split_dragging() {
        ctx.set_dock_split_dragging(false);
        ctx.dock_end_split_drag();
        ctx.compute_layout();
        ctx.invalidate_chrome();
        return;
    }

    let interaction = ctx.interaction_mut();
    let drag_state = std::mem::replace(&mut interaction.pane_drag, PaneDragState::Idle);
    interaction.drop_preview_start = None;
    match drag_state {
        PaneDragState::Dragging {
            source_pane,
            drop_target: Some(dest),
            ..
        } => {
            crate::adapter::inward::click_adapter::pane::handle_drop(ctx, source_pane, dest);
            return;
        }
        PaneDragState::PendingDrag { source_pane, .. } => {
            ctx.focus_terminal(source_pane);
            if ctx.zoomed_pane().is_some() && !ctx.is_pane_in_dock(source_pane) {
                ctx.set_zoom(Some(source_pane));
            }
            ctx.invalidate_chrome();
            ctx.invalidate_all_panes();
            ctx.compute_layout();
            ctx.request_redraw();
            return;
        }
        PaneDragState::Dragging { .. } => {
            return;
        }
        PaneDragState::Idle => {}
    }

    let was_dragging = ctx.router_is_dragging_border();
    ctx.layout_end_drag();
    ctx.router_end_drag();
    if was_dragging {
        ctx.compute_layout();
    }
}

/// Check if a click position hits an editor scrollbar. If so, starts
/// scrollbar drag and applies the initial jump. Returns true if consumed.
fn check_scrollbar_click(ctx: &mut impl MousePorts, pos: Vec2) -> bool {
    let cell_height = ctx.cell_size().height;
    let hit_width = 16.0_f32; // wider hit area than visual scrollbar

    // Check editor panes in the split tree
    let content_top_offset = TAB_BAR_HEIGHT;
    let rects: Vec<_> = ctx.visual_pane_rects().to_vec();
    for (pid, vrect) in rects {
        if let Some(PaneKind::Editor(pane)) = ctx.pane(pid) {
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
                ctx.interaction_mut().scrollbar_dragging = Some(pid);
                ctx.interaction_mut().scrollbar_drag_rect = Some(inner);
                apply_scrollbar_drag(ctx, pid, inner, pos.y);
                return true;
            }
        }
    }

    false
}

/// Apply scrollbar drag: set scroll position based on mouse Y within rect.
pub(super) fn apply_scrollbar_drag(ctx: &mut (impl AppCorePort + PaneAccessPort), pane_id: crate::tide_core::PaneId, rect: Rect, mouse_y: f32) {
    let cell_height = ctx.cell_size().height;
    let visible_rows = (rect.height / cell_height).floor() as usize;
    let ratio = ((mouse_y - rect.y) / rect.height).clamp(0.0, 1.0);

    if let Some(PaneKind::Editor(pane)) = ctx.pane_mut(pane_id) {
        let (total_lines, _) = if pane.preview_mode {
            (pane.preview_line_count(), pane.preview_scroll)
        } else if pane.effective_soft_wrap() {
            (
                pane.soft_wrap_total_visual_rows()
                    .unwrap_or_else(|| pane.editor.buffer.line_count()),
                pane.soft_wrap_visual_scroll(),
            )
        } else {
            (pane.editor.buffer.line_count(), pane.editor.scroll_offset())
        };
        let max_scroll = total_lines.saturating_sub(visible_rows);
        // Center viewport around click position
        let center = (ratio * total_lines as f32).round() as usize;
        let target = center.saturating_sub(visible_rows / 2).min(max_scroll);

        if pane.preview_mode {
            pane.preview_scroll = target;
        } else if pane.effective_soft_wrap() {
            pane.set_soft_wrap_visual_scroll(target, visible_rows);
        } else {
            pane.editor.set_scroll_offset(target);
        }
        ctx.invalidate_pane(pane_id);
    }
}
