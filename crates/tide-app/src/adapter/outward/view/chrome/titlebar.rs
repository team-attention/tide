use crate::tide_core::{Rect, Renderer, TextStyle, Vec2};

use crate::state::drag_types::HoverTarget;
use crate::theme::*;
use crate::App;
use crate::PaneLifecyclePort;

pub(crate) fn workspace_item_indicator_status(
    _is_active: bool,
    has_running: bool,
    has_alert: bool,
    has_connected_idle: bool,
) -> Option<crate::header::AgentChromeState> {
    use crate::header::AgentChromeState;

    if has_alert {
        return Some(AgentChromeState::Attention);
    }

    if has_running {
        return Some(AgentChromeState::Running);
    }

    if has_connected_idle {
        return Some(AgentChromeState::ConnectedIdle);
    }

    None
}

pub(crate) fn workspace_item_indicator_color(
    status: impl Into<crate::header::AgentChromeState>,
    blink_time: Option<f64>,
) -> crate::tide_core::Color {
    use crate::header::AgentChromeState;

    match status.into() {
        AgentChromeState::Running => crate::tide_core::Color::new(0.3, 0.8, 0.4, 1.0),
        AgentChromeState::Attention => {
            let opacity = blink_time
                .map(|t| 0.65 + 0.35 * (t * crate::theme::AGENT_BLINK_FREQUENCY).sin() as f32)
                .unwrap_or(1.0);
            crate::tide_core::Color::new(0.95, 0.65, 0.2, opacity)
        }
        AgentChromeState::ConnectedIdle => crate::tide_core::Color::new(0.36, 0.56, 0.82, 1.0),
    }
}

pub(crate) fn integration_toggle_notification_indicator_color(
    auto_integration: bool,
    status: crate::state::NotificationAuthorizationStatus,
) -> Option<crate::tide_core::Color> {
    if !auto_integration {
        return None;
    }

    Some(match status {
        crate::state::NotificationAuthorizationStatus::Authorized
        | crate::state::NotificationAuthorizationStatus::Provisional
        | crate::state::NotificationAuthorizationStatus::Ephemeral => {
            crate::tide_core::Color::new(0.3, 0.8, 0.4, 1.0)
        }
        crate::state::NotificationAuthorizationStatus::Unknown
        | crate::state::NotificationAuthorizationStatus::NotDetermined => {
            crate::tide_core::Color::new(0.95, 0.65, 0.2, 1.0)
        }
        crate::state::NotificationAuthorizationStatus::Denied => DARK.diff_removed_gutter,
    })
}

pub(crate) fn titlebar_workspace_title(app: &App) -> String {
    let fallback = "Workspace".to_string();
    let name = app
        .ws
        .workspaces
        .get(app.ws.active)
        .map(|workspace| workspace.name.clone())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or(fallback);

    if app.ws.workspaces.len() > 1 {
        format!(
            "{} · {}/{}",
            name,
            app.ws.active + 1,
            app.ws.workspaces.len()
        )
    } else {
        name
    }
}

pub(crate) fn titlebar_toggle_button_width(cell_width: f32) -> f32 {
    cell_width * TITLEBAR_ICON_SCALE + TITLEBAR_ICON_BUTTON_PAD_H * 2.0
}

pub(crate) fn titlebar_toggle_button_height(cell_height: f32) -> f32 {
    cell_height * TITLEBAR_ICON_SCALE + TITLEBAR_ICON_BUTTON_PAD_V * 2.0
}

pub(crate) fn titlebar_toggle_button_draws_hotkey_hint() -> bool {
    false
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TitlebarSurfaceIcon {
    WorkspaceRail,
    DockContext,
    FileTree,
}

pub(crate) fn titlebar_surface_button_icon(target: &HoverTarget) -> Option<TitlebarSurfaceIcon> {
    match target {
        HoverTarget::TitlebarWorkspace => Some(TitlebarSurfaceIcon::WorkspaceRail),
        HoverTarget::TitlebarDock => Some(TitlebarSurfaceIcon::DockContext),
        HoverTarget::TitlebarFileTree => Some(TitlebarSurfaceIcon::FileTree),
        _ => None,
    }
}

pub(crate) fn titlebar_surface_icon_text_glyph(_icon: TitlebarSurfaceIcon) -> Option<&'static str> {
    None
}

pub(crate) fn titlebar_workspace_meta_text(app: &App, workspace_index: usize) -> String {
    workspace_terminal_cwd(app, workspace_index)
        .map(|path| crate::state::abbreviate_path(&path))
        .unwrap_or_default()
}

fn workspace_terminal_cwd(app: &App, workspace_index: usize) -> Option<std::path::PathBuf> {
    if workspace_index == app.ws.active {
        return app.focused_terminal_cwd();
    }

    let workspace = app.ws.workspaces.get(workspace_index)?;
    let preferred_terminal = app
        .ws
        .workspace_extras
        .get(workspace_index)
        .and_then(|extras| extras.stage_focused)
        .or(workspace.focused);

    preferred_terminal
        .and_then(|pane_id| terminal_cwd_from_workspace(workspace, pane_id))
        .or_else(|| {
            workspace
                .layout
                .pane_ids()
                .into_iter()
                .find_map(|pane_id| terminal_cwd_from_workspace(workspace, pane_id))
        })
        .or_else(|| {
            workspace
                .panes
                .values()
                .find_map(|pane| terminal_cwd_from_pane(pane))
        })
}

fn terminal_cwd_from_workspace(
    workspace: &crate::Workspace,
    pane_id: crate::tide_core::PaneId,
) -> Option<std::path::PathBuf> {
    workspace
        .panes
        .get(&pane_id)
        .and_then(terminal_cwd_from_pane)
}

fn terminal_cwd_from_pane(pane: &crate::pane::PaneKind) -> Option<std::path::PathBuf> {
    match pane {
        crate::pane::PaneKind::Terminal(terminal) => terminal
            .context
            .cwd
            .clone()
            .or_else(|| terminal.backend.detect_cwd_fallback()),
        _ => None,
    }
}

pub(crate) fn titlebar_button_backdrop_level(is_active: bool, is_hovered: bool) -> u8 {
    match (is_active, is_hovered) {
        (false, false) => 0,
        (false, true) => 1,
        (true, false) => 2,
        (true, true) => 3,
    }
}

fn with_alpha(color: crate::tide_core::Color, alpha: f32) -> crate::tide_core::Color {
    crate::tide_core::Color::new(color.r, color.g, color.b, alpha)
}

fn draw_titlebar_button_backdrop(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    rect: Rect,
    p: &ThemePalette,
    is_active: bool,
    is_hovered: bool,
) {
    let level = titlebar_button_backdrop_level(is_active, is_hovered);
    if level == 0 {
        return;
    }

    let (fill, stroke) = match level {
        1 => (p.badge_bg, with_alpha(p.tab_text, 0.08)),
        2 => (
            with_alpha(p.dock_tab_underline, 0.16),
            with_alpha(p.dock_tab_underline, 0.36),
        ),
        _ => (
            with_alpha(p.dock_tab_underline, 0.24),
            with_alpha(p.dock_tab_underline, 0.52),
        ),
    };
    let radius = 7.0;
    renderer.draw_chrome_rounded_rect(rect, stroke, radius);
    renderer.draw_chrome_rounded_rect(
        Rect::new(
            rect.x + 1.0,
            rect.y + 1.0,
            (rect.width - 2.0).max(0.0),
            (rect.height - 2.0).max(0.0),
        ),
        fill,
        (radius - 1.0).max(0.0),
    );
}

fn draw_icon_stroke(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    rect: Rect,
    color: crate::tide_core::Color,
) {
    let radius = (rect.width.min(rect.height) / 2.0).min(1.2);
    renderer.draw_chrome_rounded_rect(rect, color, radius);
}

fn draw_icon_outline(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    rect: Rect,
    color: crate::tide_core::Color,
    stroke: f32,
) {
    draw_icon_stroke(
        renderer,
        Rect::new(rect.x, rect.y, rect.width, stroke),
        color,
    );
    draw_icon_stroke(
        renderer,
        Rect::new(rect.x, rect.y + rect.height - stroke, rect.width, stroke),
        color,
    );
    draw_icon_stroke(
        renderer,
        Rect::new(rect.x, rect.y, stroke, rect.height),
        color,
    );
    draw_icon_stroke(
        renderer,
        Rect::new(rect.x + rect.width - stroke, rect.y, stroke, rect.height),
        color,
    );
}

fn draw_titlebar_surface_icon(
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    icon: TitlebarSurfaceIcon,
    button_rect: Rect,
    color: crate::tide_core::Color,
) {
    if let Some(glyph) = titlebar_surface_icon_text_glyph(icon) {
        let cell = renderer.cell_size();
        let icon_w = cell.width * TITLEBAR_ICON_SCALE;
        let icon_h = cell.height * TITLEBAR_ICON_SCALE;
        renderer.draw_chrome_text_scaled(
            glyph,
            Vec2::new(
                button_rect.x + (button_rect.width - icon_w) / 2.0,
                button_rect.y + (button_rect.height - icon_h) / 2.0,
            ),
            TextStyle {
                foreground: color,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            button_rect,
            TITLEBAR_ICON_SCALE,
        );
        return;
    }

    let stroke = 1.35_f32;
    let icon_w = 16.0_f32;
    let icon_h = 13.0_f32;
    let x = (button_rect.x + (button_rect.width - icon_w) / 2.0).round();
    let y = (button_rect.y + (button_rect.height - icon_h) / 2.0).round();
    let body = Rect::new(x, y, icon_w, icon_h);
    let secondary = with_alpha(color, color.a * 0.52);

    match icon {
        TitlebarSurfaceIcon::WorkspaceRail => {
            draw_icon_outline(renderer, body, secondary, stroke);
            draw_icon_stroke(
                renderer,
                Rect::new(x + 2.4, y + 2.4, 3.0, icon_h - 4.8),
                secondary,
            );
            draw_icon_stroke(
                renderer,
                Rect::new(x + 6.4, y + 1.0, stroke, icon_h - 2.0),
                color,
            );
            draw_icon_stroke(renderer, Rect::new(x + 9.0, y + 4.0, 4.6, stroke), color);
            draw_icon_stroke(
                renderer,
                Rect::new(x + 9.0, y + 7.6, 3.4, stroke),
                secondary,
            );
        }
        TitlebarSurfaceIcon::DockContext => {
            draw_icon_outline(renderer, body, secondary, stroke);
            draw_icon_stroke(
                renderer,
                Rect::new(x + icon_w - 5.2, y + 1.0, stroke, icon_h - 2.0),
                color,
            );
            draw_icon_stroke(
                renderer,
                Rect::new(x + icon_w - 4.0, y + 2.4, 2.6, icon_h - 4.8),
                secondary,
            );
            draw_icon_stroke(renderer, Rect::new(x + 3.0, y + 4.0, 5.2, stroke), color);
            draw_icon_stroke(
                renderer,
                Rect::new(x + 3.0, y + 7.6, 4.0, stroke),
                secondary,
            );
        }
        TitlebarSurfaceIcon::FileTree => {
            draw_icon_stroke(renderer, Rect::new(x + 1.5, y + 1.8, 4.2, stroke), color);
            draw_icon_stroke(renderer, Rect::new(x + 1.5, y + 1.8, stroke, 3.0), color);
            draw_icon_stroke(renderer, Rect::new(x + 5.0, y + 3.2, 4.4, stroke), color);
            draw_icon_stroke(renderer, Rect::new(x + 1.5, y + 4.6, 8.0, stroke), color);
            draw_icon_stroke(
                renderer,
                Rect::new(x + 1.5, y + 4.6, stroke, 3.8),
                secondary,
            );
            draw_icon_stroke(
                renderer,
                Rect::new(x + 1.5, y + 7.2, 8.0, stroke),
                secondary,
            );

            draw_icon_stroke(
                renderer,
                Rect::new(x + 4.0, y + 8.4, stroke, 3.0),
                secondary,
            );
            draw_icon_stroke(renderer, Rect::new(x + 5.8, y + 9.0, 7.4, stroke), color);
            draw_icon_stroke(
                renderer,
                Rect::new(x + 5.8, y + 11.2, 5.2, stroke),
                secondary,
            );
        }
    }
}

/// Render the titlebar background, title text, icons, and toggle buttons.
/// Also renders the workspace sidebar if visible.
pub(super) fn render_titlebar_and_sidebar(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    logical: crate::tide_core::Size,
) {
    let blink_time = crate::adapter::outward::view::wrapped_agent_blink_time(
        app.ports.clock.now(),
        app.timing.wrapped_agent_blink_at,
        app.has_any_stage_wrapped_agent_alert(),
    );

    // Draw titlebar background, border, and title (macOS transparent titlebar)
    if app.window.top_inset > 0.0 {
        let tb = Rect::new(0.0, 0.0, logical.width, app.window.top_inset);
        renderer.draw_chrome_rect(tb, p.file_tree_bg);
        // Bottom border
        renderer.draw_chrome_rect(
            Rect::new(
                0.0,
                app.window.top_inset - BORDER_WIDTH,
                logical.width,
                BORDER_WIDTH,
            ),
            p.border_subtle,
        );
        // Centered title keeps active Workspace identity visible when the rail is collapsed.
        let cs = renderer.cell_size();
        {
            let title_text = titlebar_workspace_title(app);
            let title_w = title_text.chars().count() as f32 * cs.width;
            let title_x = (logical.width - title_w) / 2.0;
            let title_y = (app.window.top_inset - cs.height) / 2.0;
            renderer.draw_chrome_text(
                &title_text,
                Vec2::new(title_x, title_y),
                TextStyle {
                    foreground: p.tab_text,
                    background: None,
                    bold: false,
                    dim: false,
                    italic: false,
                    underline: false,
                },
                tb,
            );
        }
        // Right: titlebar icons
        {
            let btn_w = titlebar_toggle_button_width(cs.width);
            let btn_h = titlebar_toggle_button_height(cs.height);
            let icon_logical_w = cs.width * TITLEBAR_ICON_SCALE;
            let icon_logical_h = cs.height * TITLEBAR_ICON_SCALE;
            let draw_titlebar_icon = |renderer: &mut crate::tide_renderer::WgpuRenderer,
                                      icon: &str,
                                      rect: Rect,
                                      foreground: crate::tide_core::Color,
                                      clip: Rect| {
                renderer.draw_chrome_text_scaled(
                    icon,
                    Vec2::new(
                        rect.x + (rect.width - icon_logical_w) / 2.0,
                        rect.y + (rect.height - icon_logical_h) / 2.0,
                    ),
                    TextStyle {
                        foreground,
                        background: None,
                        bold: false,
                        dim: false,
                        italic: false,
                        underline: false,
                    },
                    clip,
                    TITLEBAR_ICON_SCALE,
                );
            };

            // Settings gear icon
            {
                let gear_icon = "\u{f013}"; // FontAwesome gear
                let gear_w = btn_w;
                let gear_h = btn_h;
                let gear_x = logical.width - PANE_PADDING - gear_w;
                let gear_y = (app.window.top_inset - gear_h) / 2.0;
                let gear_rect = Rect::new(gear_x, gear_y, gear_w, gear_h);
                let gear_hovered = matches!(
                    app.interaction.hover_target,
                    Some(HoverTarget::TitlebarSettings)
                );
                let gear_color = if app.modal.config_page.is_some() {
                    p.dock_tab_underline
                } else {
                    p.tab_text
                };
                draw_titlebar_button_backdrop(
                    renderer,
                    gear_rect,
                    p,
                    app.modal.config_page.is_some(),
                    gear_hovered,
                );
                draw_titlebar_icon(renderer, gear_icon, gear_rect, gear_color, tb);
            }

            // Titlebar toggle buttons: [Workspace] [Dock] [FileTree] [Integration] [Theme] [Settings]
            // Positioned right-to-left from the settings icon
            let settings_w = btn_w;
            let settings_x = logical.width - PANE_PADDING - settings_w;

            // Theme toggle icon (between settings and toggle buttons)
            let theme_w = btn_w;
            let theme_h = btn_h;
            let theme_x = settings_x - theme_w - TITLEBAR_BUTTON_GAP;
            let theme_y = (app.window.top_inset - theme_h) / 2.0;
            let theme_rect = Rect::new(theme_x, theme_y, theme_w, theme_h);
            let theme_hovered = matches!(
                app.interaction.hover_target,
                Some(HoverTarget::TitlebarTheme)
            );
            let theme_icon = if app.window.dark_mode {
                "\u{f186}"
            } else {
                "\u{f185}"
            }; // moon / sun
            draw_titlebar_button_backdrop(renderer, theme_rect, p, false, theme_hovered);
            draw_titlebar_icon(renderer, theme_icon, theme_rect, p.tab_text, tb);

            // Integration toggle button (left of theme icon)
            let integ_w = btn_w;
            let integ_h = btn_h;
            let integ_x = theme_x - integ_w - TITLEBAR_BUTTON_GAP;
            let integ_y = (app.window.top_inset - integ_h) / 2.0;
            let integ_rect = Rect::new(integ_x, integ_y, integ_w, integ_h);
            {
                let is_active = app.settings.auto_integration;
                let is_hovered = matches!(
                    app.interaction.hover_target,
                    Some(HoverTarget::TitlebarIntegration)
                );
                let icon = "\u{f1e6}"; // FontAwesome plug icon
                let icon_color = if is_active {
                    p.dock_tab_underline
                } else {
                    p.tab_text
                };
                draw_titlebar_button_backdrop(renderer, integ_rect, p, is_active, is_hovered);
                draw_titlebar_icon(renderer, icon, integ_rect, icon_color, tb);
                if let Some(indicator_color) = integration_toggle_notification_indicator_color(
                    is_active,
                    app.window.notification_authorization_status,
                ) {
                    let indicator_size = 5.0_f32;
                    let indicator_x = integ_x + integ_w - indicator_size - 3.0;
                    let indicator_y = integ_y + 3.0;
                    renderer.draw_chrome_rounded_rect(
                        Rect::new(indicator_x, indicator_y, indicator_size, indicator_size),
                        indicator_color,
                        indicator_size / 2.0,
                    );
                }
            }

            let btn_right = integ_x - TITLEBAR_BUTTON_GAP;
            // Helper: render a larger icon-only titlebar toggle button.
            // Returns the total width consumed
            let render_titlebar_btn = |renderer: &mut crate::tide_renderer::WgpuRenderer,
                                       icon: TitlebarSurfaceIcon,
                                       right_edge: f32,
                                       is_active: bool,
                                       is_hovered: bool|
             -> f32 {
                let btn_w = titlebar_toggle_button_width(cs.width);
                let btn_h = titlebar_toggle_button_height(cs.height);
                let btn_x = right_edge - btn_w;
                let btn_y = (app.window.top_inset - btn_h) / 2.0;
                let btn_rect = Rect::new(btn_x, btn_y, btn_w, btn_h);

                draw_titlebar_button_backdrop(renderer, btn_rect, p, is_active, is_hovered);

                // Icon
                let icon_color = if is_active {
                    p.dock_tab_underline
                } else {
                    p.tab_text
                };
                draw_titlebar_surface_icon(renderer, icon, btn_rect, icon_color);

                btn_w
            };

            // Render buttons right-to-left: [FileTree] [Dock] [Workspace]
            let mut cur_right = btn_right;

            // FileTree button
            let w = render_titlebar_btn(
                renderer,
                titlebar_surface_button_icon(&HoverTarget::TitlebarFileTree).unwrap(),
                cur_right,
                app.ft.visible,
                app.interaction.hover_target.as_ref() == Some(&HoverTarget::TitlebarFileTree),
            );
            cur_right -= w + TITLEBAR_BUTTON_GAP;

            // Dock button
            let w = render_titlebar_btn(
                renderer,
                titlebar_surface_button_icon(&HoverTarget::TitlebarDock).unwrap(),
                cur_right,
                app.dock.dock_open,
                app.interaction.hover_target.as_ref() == Some(&HoverTarget::TitlebarDock),
            );
            cur_right -= w + TITLEBAR_BUTTON_GAP;

            // Workspace sidebar button
            let _w = render_titlebar_btn(
                renderer,
                titlebar_surface_button_icon(&HoverTarget::TitlebarWorkspace).unwrap(),
                cur_right,
                app.ws.show_sidebar,
                app.interaction.hover_target.as_ref() == Some(&HoverTarget::TitlebarWorkspace),
            );
        }
    }

    // Draw workspace sidebar if visible
    if let Some(ws_rect) = app.ws.sidebar_rect {
        let cs = renderer.cell_size();
        let edge_inset = PANE_CORNER_RADIUS;

        // Focus-dependent styling (matches file_tree.rs pattern)
        let sidebar_focused = app.focus.focus_area == crate::state::FocusArea::FileTree && false; // sidebar has no FocusArea yet
        let border_color = crate::tide_core::Color::new(0.0, 0.0, 0.0, 0.0);
        let border_w = 0.0_f32;

        // Sidebar visual rect: inset from top/bottom for corner radius visibility
        let sb_border = Rect::new(
            ws_rect.x,
            ws_rect.y + edge_inset,
            ws_rect.width,
            ws_rect.height - edge_inset * 2.0,
        );

        // Shadow when focused (matches file_tree.rs pattern)
        if sidebar_focused {
            let shadow_color = crate::tide_core::Color::new(0.769, 0.722, 0.651, 0.25);
            renderer.draw_chrome_shadow(sb_border, shadow_color, PANE_CORNER_RADIUS, 16.0, -4.0);
        }

        // Outer rounded rect (border)
        renderer.draw_chrome_rounded_rect(sb_border, border_color, PANE_CORNER_RADIUS);
        // Inner fill (dynamic border width)
        let inset = Rect::new(
            sb_border.x + border_w,
            sb_border.y + border_w,
            sb_border.width - 2.0 * border_w,
            sb_border.height - 2.0 * border_w,
        );
        renderer.draw_chrome_rounded_rect(
            inset,
            p.file_tree_bg,
            (PANE_CORNER_RADIUS - border_w).max(0.0),
        );

        // Workspace items
        let geo = crate::adapter::inward::drag_drop_adapter::ws_sidebar_geometry(app).unwrap();
        let content_x = geo.content_x;
        let content_w = geo.content_w;
        let item_gap = geo.item_gap;

        // Determine available text width for compact mode detection
        let text_avail_w = content_w - WS_SIDEBAR_ITEM_PAD_H * 2.0;
        let compact = text_avail_w < cs.width * 12.0; // < 12 chars -> compact

        // Collect workspace info: for the active workspace, use live App data;
        // for others, read from the stored workspace vec.
        for i in 0..app.ws.workspaces.len() {
            let is_active = i == app.ws.active;
            let ws_name = app.ws.workspaces[i].name.clone();
            let (has_running, has_alert, has_connected_idle) = app.workspace_stage_agent_flags(i);
            let indicator_status = workspace_item_indicator_status(
                is_active,
                has_running,
                has_alert,
                has_connected_idle,
            );
            let indicator_color =
                indicator_status.map(|status| workspace_item_indicator_color(status, blink_time));

            let item_rect = geo.item_rect(i);

            // Active item: pane-bg background with accent bar (matches file_tree.rs cursor row pattern)
            if is_active {
                // Warm accent row highlight background
                let accent = p.dock_tab_underline;
                let row_bg = crate::tide_core::Color::new(accent.r, accent.g, accent.b, 0.12);
                renderer.draw_chrome_rounded_rect(item_rect, row_bg, FILE_TREE_ROW_RADIUS);
                // Left accent bar (matches file_tree.rs cursor row accent bar)
                renderer.draw_chrome_rect(
                    Rect::new(
                        item_rect.x + 2.0,
                        item_rect.y + 2.0,
                        2.0,
                        item_rect.height - 4.0,
                    ),
                    accent,
                );
            } else {
                if matches!(
                    app.interaction.hover_target,
                    Some(HoverTarget::WorkspaceSidebarItem(idx)) if idx == i
                ) {
                    // Hover highlight (matches file_tree.rs row radius)
                    renderer.draw_chrome_rounded_rect(item_rect, p.badge_bg, FILE_TREE_ROW_RADIUS);
                }
            }

            // Name text -- one-line rows keep the rail useful as a dense task monitor.
            let indicator_reserved_w = if indicator_color.is_some() {
                WS_SIDEBAR_ITEM_PAD_H + 10.0
            } else {
                0.0
            };
            let meta_text = if !compact {
                titlebar_workspace_meta_text(app, i)
            } else {
                String::new()
            };
            let meta_w = if meta_text.is_empty() {
                0.0
            } else {
                (meta_text.chars().count() as f32 * cs.width).min(text_avail_w * 0.45)
            };
            let meta_gap = if meta_w > 0.0 { cs.width } else { 0.0 };
            let name_avail_w =
                (text_avail_w - indicator_reserved_w - meta_w - meta_gap).max(cs.width * 2.0);
            let display_name = if compact {
                format!("W{}", i + 1)
            } else {
                let max_chars = (name_avail_w / cs.width).floor() as usize;
                if ws_name.chars().count() > max_chars && max_chars > 1 {
                    let truncated: String =
                        ws_name.chars().take(max_chars.saturating_sub(1)).collect();
                    format!("{}…", truncated)
                } else {
                    ws_name
                }
            };
            let name_color = if is_active {
                p.tab_text_focused
            } else {
                p.ws_sidebar_text_inactive
            };
            // Center text vertically; compact mode also centers horizontally.
            let (name_text_x, name_text_y) = if compact {
                let name_w = display_name.len() as f32 * cs.width;
                (
                    content_x + (content_w - name_w) / 2.0,
                    item_rect.y + (item_rect.height - cs.height) / 2.0,
                )
            } else {
                (
                    content_x + WS_SIDEBAR_ITEM_PAD_H,
                    item_rect.y + (item_rect.height - cs.height) / 2.0,
                )
            };
            renderer.draw_chrome_text(
                &display_name,
                Vec2::new(name_text_x, name_text_y),
                TextStyle {
                    foreground: name_color,
                    background: None,
                    bold: is_active,
                    dim: false,
                    italic: false,
                    underline: false,
                },
                inset,
            );

            if !meta_text.is_empty() && meta_w > 0.0 {
                let max_chars = (meta_w / cs.width).floor() as usize;
                let display_meta = if meta_text.chars().count() > max_chars && max_chars > 1 {
                    let truncated: String = meta_text
                        .chars()
                        .take(max_chars.saturating_sub(1))
                        .collect();
                    format!("{}…", truncated)
                } else {
                    meta_text
                };
                let display_meta_w = display_meta.chars().count() as f32 * cs.width;
                let meta_x = item_rect.x + item_rect.width
                    - WS_SIDEBAR_ITEM_PAD_H
                    - indicator_reserved_w
                    - display_meta_w;
                renderer.draw_chrome_text(
                    &display_meta,
                    Vec2::new(meta_x, item_rect.y + (item_rect.height - cs.height) / 2.0),
                    TextStyle {
                        foreground: p.tab_text,
                        background: None,
                        bold: false,
                        dim: false,
                        italic: false,
                        underline: false,
                    },
                    inset,
                );
            }

            if let Some(color) = indicator_color {
                let dot_size = 8.0_f32;
                let dot_x = item_rect.x + item_rect.width - WS_SIDEBAR_ITEM_PAD_H - dot_size;
                let dot_y = item_rect.y + (item_rect.height - dot_size) / 2.0;
                renderer.draw_chrome_rounded_rect(
                    Rect::new(dot_x, dot_y, dot_size, dot_size),
                    color,
                    dot_size / 2.0,
                );
                if matches!(
                    indicator_status,
                    Some(crate::header::AgentChromeState::Attention)
                ) {
                    renderer.draw_chrome_rounded_rect(
                        Rect::new(dot_x - 2.0, dot_y - 2.0, dot_size + 4.0, dot_size + 4.0),
                        crate::tide_core::Color::new(color.r, color.g, color.b, color.a * 0.3),
                        (dot_size + 4.0) / 2.0,
                    );
                }
            }

            // Draw drag drop indicator line before this item (gap == i)
            if let Some((src, press_y, gap)) = app.ws.drag {
                let dragging =
                    (app.window.last_cursor_pos.y - press_y).abs() > crate::theme::DRAG_THRESHOLD;
                if dragging && gap == i && gap != src && gap != src + 1 {
                    let line_y = item_rect.y - item_gap / 2.0;
                    let line_rect = Rect::new(content_x + 4.0, line_y - 1.0, content_w - 8.0, 2.0);
                    renderer.draw_chrome_rounded_rect(line_rect, p.border_focused, 1.0);
                }
            }
        }

        // Draw drop indicator after the last item (gap == len)
        if let Some((src, press_y, gap)) = app.ws.drag {
            let dragging =
                (app.window.last_cursor_pos.y - press_y).abs() > crate::theme::DRAG_THRESHOLD;
            let len = app.ws.workspaces.len();
            if dragging && gap == len && gap != src + 1 {
                let last_bottom = geo.item_rect(len - 1);
                let line_y = last_bottom.y + last_bottom.height + item_gap / 2.0;
                let line_rect = Rect::new(content_x + 4.0, line_y - 1.0, content_w - 8.0, 2.0);
                renderer.draw_chrome_rounded_rect(line_rect, p.border_focused, 1.0);
            }
        }

        // "+ New Workspace" button at bottom -- use "+" when narrow
        let btn_h = cs.height + 12.0;
        let btn_y = ws_rect.y + ws_rect.height - edge_inset - btn_h - WS_SIDEBAR_PADDING;
        let btn_rect = Rect::new(content_x, btn_y, content_w, btn_h);

        if matches!(
            app.interaction.hover_target,
            Some(HoverTarget::WorkspaceSidebarNewBtn)
        ) {
            renderer.draw_chrome_rounded_rect(btn_rect, p.badge_bg, FILE_TREE_ROW_RADIUS);
        }

        let btn_text = if compact { "+" } else { "+ New Workspace" };
        let btn_text_w = btn_text.len() as f32 * cs.width;
        let btn_text_x = content_x + (content_w - btn_text_w) / 2.0;
        let btn_text_y = btn_y + (btn_h - cs.height) / 2.0;
        renderer.draw_chrome_text(
            btn_text,
            Vec2::new(btn_text_x, btn_text_y),
            TextStyle {
                foreground: p.tab_text,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            inset,
        );
    }
}
