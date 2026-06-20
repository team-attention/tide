//! Mouse event handling — platform-agnostic.

pub(crate) mod drag;
mod selection;

use crate::tide_core::{
    FileTreeSource, InputEvent, MouseButton, PaneId, Rect, TerminalBackend, Vec2,
};
use crate::tide_platform::WindowProxy;

use crate::pane::PaneKind;
use crate::state::drag_types::PaneDragState;
use crate::theme::*;
use crate::ActionPort;
use crate::AppCorePort;
use crate::DockPort;
use crate::FileOpsPort;
use crate::FileTreePort;
use crate::FocusNavPort;
use crate::GatewayPort;
use crate::InputStatePort;
use crate::LayoutPort;
use crate::ModalPort;
use crate::PaneAccessPort;
use crate::PaneLifecyclePort;
use crate::RouterPort;
use crate::WorkspaceNavPort;

// ── Trait alias for mouse adapter ports ──

pub(crate) trait MousePorts:
    AppCorePort
    + FocusNavPort
    + PaneAccessPort
    + PaneLifecyclePort
    + ModalPort
    + InputStatePort
    + DockPort
    + WorkspaceNavPort
    + LayoutPort
    + FileOpsPort
    + ActionPort
    + FileTreePort
    + GatewayPort
    + RouterPort
{
}
impl<
        T: AppCorePort
            + FocusNavPort
            + PaneAccessPort
            + PaneLifecyclePort
            + ModalPort
            + InputStatePort
            + DockPort
            + WorkspaceNavPort
            + LayoutPort
            + FileOpsPort
            + ActionPort
            + FileTreePort
            + GatewayPort
            + RouterPort,
    > MousePorts for T
{
}

#[derive(Debug, Clone, Copy)]
enum TerminalMouseReport {
    Press(MouseButton),
    Release(MouseButton),
    Drag(MouseButton),
    Move,
}

fn clamp_to_rect(pos: Vec2, rect: Rect) -> Vec2 {
    let max_x = (rect.x + rect.width - 0.001).max(rect.x);
    let max_y = (rect.y + rect.height - 0.001).max(rect.y);
    Vec2::new(pos.x.max(rect.x).min(max_x), pos.y.max(rect.y).min(max_y))
}

fn usize_to_u16(value: usize) -> u16 {
    value.min(u16::MAX as usize) as u16
}

fn terminal_cell_for_pane(
    ctx: &(impl AppCorePort + PaneAccessPort),
    pos: Vec2,
    pane_id: PaneId,
    clamp: bool,
) -> Option<(u16, u16)> {
    if !matches!(ctx.pane(pane_id), Some(PaneKind::Terminal(_))) {
        return None;
    }

    let (_, visual_rect) = ctx
        .visual_pane_rects()
        .iter()
        .find(|(id, _)| *id == pane_id)?;
    let cell_size = ctx.cell_size();
    let inner =
        crate::pane::pane_content_rect(*visual_rect, terminal_content_top(cell_size.height));
    let target_pos = if clamp {
        clamp_to_rect(pos, inner)
    } else {
        if !inner.contains(pos) {
            return None;
        }
        pos
    };
    let (row, col) =
        crate::adapter::inward::click_adapter::hit_test::pixel_to_cell(ctx, target_pos, pane_id)?;
    Some((usize_to_u16(col), usize_to_u16(row)))
}

fn terminal_cell_at(
    ctx: &(impl AppCorePort + PaneAccessPort),
    pos: Vec2,
) -> Option<(PaneId, u16, u16)> {
    for (pane_id, _) in ctx.visual_pane_rects().to_vec() {
        if let Some((col, row)) = terminal_cell_for_pane(ctx, pos, pane_id, false) {
            return Some((pane_id, col, row));
        }
    }
    None
}

fn terminal_mouse_report_bytes(
    ctx: &impl MousePorts,
    pane_id: PaneId,
    report: TerminalMouseReport,
    col: u16,
    row: u16,
) -> Option<Vec<u8>> {
    let modifiers = ctx.modifiers();
    match ctx.pane(pane_id) {
        Some(PaneKind::Terminal(pane)) => match report {
            TerminalMouseReport::Press(button) => pane
                .backend
                .mouse_press_to_bytes(button, &modifiers, col, row),
            TerminalMouseReport::Release(button) => pane
                .backend
                .mouse_release_to_bytes(button, &modifiers, col, row),
            TerminalMouseReport::Drag(button) => pane
                .backend
                .mouse_drag_to_bytes(button, &modifiers, col, row),
            TerminalMouseReport::Move => pane.backend.mouse_move_to_bytes(&modifiers, col, row),
        },
        _ => None,
    }
}

fn forward_terminal_mouse_report(
    ctx: &mut impl MousePorts,
    pane_id: PaneId,
    report: TerminalMouseReport,
    col: u16,
    row: u16,
) -> bool {
    let Some(bytes) = terminal_mouse_report_bytes(ctx, pane_id, report, col, row) else {
        return false;
    };

    ctx.focus_terminal(pane_id);
    if let Some(PaneKind::Terminal(pane)) = ctx.pane_mut(pane_id) {
        pane.backend.write(&bytes);
        true
    } else {
        false
    }
}

fn forward_terminal_mouse_press(ctx: &mut impl MousePorts, button: MouseButton) -> bool {
    let pos = ctx.last_cursor_pos();
    let Some((pane_id, col, row)) = terminal_cell_at(ctx, pos) else {
        return false;
    };
    if forward_terminal_mouse_report(ctx, pane_id, TerminalMouseReport::Press(button), col, row) {
        ctx.interaction_mut().terminal_mouse_source = Some(pane_id);
        return true;
    }
    false
}

fn forward_terminal_mouse_release(ctx: &mut impl MousePorts, button: MouseButton) -> bool {
    let Some(pane_id) = ctx.interaction().terminal_mouse_source else {
        return false;
    };
    ctx.interaction_mut().terminal_mouse_source = None;

    let pos = ctx.last_cursor_pos();
    let Some((col, row)) = terminal_cell_for_pane(ctx, pos, pane_id, true) else {
        return false;
    };
    forward_terminal_mouse_report(ctx, pane_id, TerminalMouseReport::Release(button), col, row)
}

pub(super) fn forward_terminal_mouse_drag(
    ctx: &mut impl MousePorts,
    pos: Vec2,
    button: MouseButton,
) -> bool {
    let Some(pane_id) = ctx.interaction().terminal_mouse_source else {
        return false;
    };
    let Some((col, row)) = terminal_cell_for_pane(ctx, pos, pane_id, true) else {
        return false;
    };
    forward_terminal_mouse_report(ctx, pane_id, TerminalMouseReport::Drag(button), col, row)
}

pub(super) fn forward_terminal_mouse_move(ctx: &mut impl MousePorts, pos: Vec2) -> bool {
    let Some((pane_id, col, row)) = terminal_cell_at(ctx, pos) else {
        return false;
    };
    forward_terminal_mouse_report(ctx, pane_id, TerminalMouseReport::Move, col, row)
}

pub(crate) fn handle_mouse_down(
    ctx: &mut impl MousePorts,
    button: MouseButton,
    window: &WindowProxy,
) {
    {
        let interaction = ctx.interaction_mut();
        interaction.mouse_pressed_button = Some(button);
        interaction.terminal_mouse_source = None;
        if button == MouseButton::Left {
            interaction.mouse_left_pressed = true;
            interaction.text_selection_drag_source = None;
        }
    }

    if button == MouseButton::Left {
        // Check editor scrollbar click
        if check_scrollbar_click(ctx, ctx.last_cursor_pos()) {
            ctx.request_redraw();
            return;
        }
    }

    // Handle search bar clicks
    if button == MouseButton::Left {
        if crate::adapter::inward::search_adapter::check_search_bar_click(ctx) {
            ctx.request_redraw();
            return;
        }
    }

    if button == MouseButton::Left
        && !ctx.modal().is_any_open()
        && ctx.dismiss_first_run_guide_at(ctx.last_cursor_pos())
    {
        ctx.request_redraw();
        return;
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
                let (destination, replace_id) = {
                    let finder = ctx.modal().file_finder.as_ref().unwrap();
                    let replace_id = if finder.mode == crate::state::FileFinderMode::Files {
                        finder.replace_pane_id
                    } else {
                        None
                    };
                    (finder.destination_at_filtered_index(idx), replace_id)
                };
                if let Some(destination) = destination {
                    ctx.close_file_finder();
                    match destination {
                        crate::state::FileFinderDestination::OpenFile { path, line } => {
                            if let Some(pane_id) = replace_id {
                                ctx.replace_pane_with_editor(pane_id, path);
                            } else {
                                ctx.open_editor_pane_at_line(path, line);
                            }
                        }
                        crate::state::FileFinderDestination::FocusedEditorSymbol {
                            pane_id,
                            line,
                            col,
                        } => {
                            ctx.jump_to_editor_location(pane_id, line, col);
                        }
                    }
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
                crate::adapter::inward::click_adapter::header::handle_git_switcher_button(
                    ctx,
                    crate::SwitcherButton::Switch(idx),
                );
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
        if crate::adapter::inward::click_adapter::pane::handle_branch_cleanup_click(
            ctx,
            ctx.last_cursor_pos(),
        ) {
            return;
        }
    }

    // Notification bar clicks
    if button == MouseButton::Left {
        if crate::adapter::inward::click_adapter::pane::handle_notification_bar_click(
            ctx,
            ctx.last_cursor_pos(),
        ) {
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
            ctx.close_specific_pane_with_split_animation(pane_id);
            ctx.request_redraw();
            return;
        }
    }

    // Launcher Pane choice rows
    if button == MouseButton::Left {
        if crate::adapter::inward::click_adapter::pane::handle_launcher_choice_click(
            ctx,
            ctx.last_cursor_pos(),
        ) {
            return;
        }
    }

    // Right-click on Workspace rail item
    if button == MouseButton::Right {
        let pos = ctx.last_cursor_pos();
        let new_hover =
            crate::adapter::inward::click_adapter::hit_test::compute_hover_target(ctx, pos);
        if let Some(crate::state::drag_types::HoverTarget::WorkspaceSidebarItem(idx)) = new_hover {
            ctx.modal_mut().file_tree_rename = None;
            ctx.modal_mut().workspace_rename = None;
            ctx.modal_mut().context_menu = Some(crate::ContextMenuState {
                target: crate::ContextMenuTarget::WorkspaceSidebarItem { ws_index: idx },
                position: pos,
                selected: 0,
            });
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
                    let index = ((adjusted_y + ft_scroll) / line_height) as usize;

                    let entry_info = ctx.ft().tree.as_ref().and_then(|tree| {
                        let entries = tree.visible_entries();
                        entries
                            .get(index)
                            .map(|entry| (entry.entry.path.clone(), entry.entry.is_dir))
                    });

                    if let Some((path, is_dir)) = entry_info {
                        let is_app_bundle = is_dir
                            && path
                                .extension()
                                .and_then(std::ffi::OsStr::to_str)
                                .map(|ext| ext.eq_ignore_ascii_case("app"))
                                .unwrap_or(false);
                        ctx.modal_mut().context_menu = None;
                        ctx.modal_mut().file_tree_rename = None;
                        let shell_idle = ctx
                            .focused_pane()
                            .and_then(|tid| ctx.pane(tid))
                            .map(|pk| {
                                if let crate::PaneKind::Terminal(tp) = pk {
                                    tp.context.shell_idle
                                } else {
                                    false
                                }
                            })
                            .unwrap_or(false);
                        ctx.modal_mut().context_menu = Some(crate::ContextMenuState {
                            target: crate::ContextMenuTarget::FileTreeEntry {
                                entry_index: index,
                                path,
                                is_dir,
                                is_app_bundle,
                                shell_idle,
                            },
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

    // Right-click on an Editor Pane: open the Go to Definition / Find
    // References context menu for the identifier under the pointer.
    if button == MouseButton::Right {
        let pos = ctx.last_cursor_pos();
        let editor_pane = ctx
            .visual_pane_rects()
            .iter()
            .find(|(id, rect)| {
                pos.x >= rect.x
                    && pos.x < rect.x + rect.width
                    && pos.y >= rect.y
                    && pos.y < rect.y + rect.height
                    && matches!(ctx.pane(*id), Some(PaneKind::Editor(ep)) if !ep.preview_mode)
            })
            .map(|(id, _)| *id);
        if let Some(id) = editor_pane {
            if ctx.open_editor_symbol_context_menu(id, pos) {
                ctx.request_redraw();
                return;
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
                    && pos.x >= ft_rect.x + SIDE_SURFACE_BORDER_HIT_SLOP
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
        crate::adapter::inward::click_adapter::pane::handle_config_page_click(
            ctx,
            ctx.last_cursor_pos(),
        );
        ctx.request_redraw();
        return;
    }

    if forward_terminal_mouse_press(ctx, button) {
        ctx.request_redraw();
        return;
    }

    if button == MouseButton::Left {
        // Start text selection if clicking on pane content.
        if selection::start_text_selection(ctx) {
            // Selection started — fall through to keep existing focus/click routing behavior.
        }
    }

    // General mouse input routing
    handle_mouse_input_core(ctx, button, window);
    ctx.request_redraw();
}

fn handle_mouse_input_core(ctx: &mut impl MousePorts, button: MouseButton, _window: &WindowProxy) {
    if button == MouseButton::Left {
        let pos = ctx.last_cursor_pos();
        let new_hover =
            crate::adapter::inward::click_adapter::hit_test::compute_hover_target(ctx, pos);
        if ctx.interaction().hover_target != new_hover {
            ctx.interaction_mut().hover_target = new_hover;
            ctx.invalidate_chrome();
        }

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
                Some(crate::state::drag_types::HoverTarget::TitlebarIntegration) => {
                    ctx.toggle_auto_integration();
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
            let border_x = ws_rect.x + ws_rect.width;
            if (ctx.last_cursor_pos().x - border_x).abs() < SIDE_SURFACE_BORDER_HIT_SLOP {
                ctx.set_ws_border_dragging(true);
                return;
            }
        }

        // Context area border
        if ctx.dock_open() {
            if let Some(pa_rect) = ctx.pane_area_rect() {
                let border_x = pa_rect.x + pa_rect.width;
                if (ctx.last_cursor_pos().x - border_x).abs() < SIDE_SURFACE_BORDER_HIT_SLOP {
                    ctx.set_dock_border_dragging(true);
                    return;
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

        // FileTree View border; FileTree is always the outer-right view.
        if let Some(ft_rect) = ctx.ft().rect {
            let border_x = ft_rect.x;
            if (ctx.last_cursor_pos().x - border_x).abs() < SIDE_SURFACE_BORDER_HIT_SLOP {
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
    if ctx.interaction().mouse_pressed_button == Some(button) {
        ctx.interaction_mut().mouse_pressed_button = None;
    }

    let hover_cleared = if button == MouseButton::Left {
        let interaction = ctx.interaction_mut();
        interaction.mouse_left_pressed = false;
        interaction.text_selection_drag_source = None;
        interaction.hover_target.take().is_some()
    } else {
        false
    };
    if hover_cleared {
        ctx.invalidate_chrome();
        ctx.request_redraw();
    } else if button == MouseButton::Left {
        ctx.interaction_mut().mouse_left_pressed = false;
    }

    if ctx.interaction().terminal_mouse_source.is_some() {
        if forward_terminal_mouse_release(ctx, button) {
            ctx.request_redraw();
            return;
        }
        ctx.request_redraw();
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
            let inner = crate::pane::pane_content_rect(vrect, content_top_offset);
            let scrollbar_right = inner.x + inner.width;
            let scrollbar_left = scrollbar_right - hit_width;
            if pos.x >= scrollbar_left
                && pos.x <= scrollbar_right
                && pos.y >= inner.y
                && pos.y <= inner.y + inner.height
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
pub(crate) fn apply_scrollbar_drag(
    ctx: &mut (impl AppCorePort + PaneAccessPort),
    pane_id: crate::tide_core::PaneId,
    rect: Rect,
    mouse_y: f32,
) {
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
