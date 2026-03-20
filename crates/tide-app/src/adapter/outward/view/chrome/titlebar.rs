use crate::tide_core::{Rect, Renderer, TextStyle, Vec2};

use crate::state::drag_types::HoverTarget;
use crate::theme::*;
use crate::App;
use crate::AppCorePort;
use crate::PaneLifecyclePort;

/// Render the titlebar background, title text, icons, and toggle buttons.
/// Also renders the workspace sidebar if visible.
pub(super) fn render_titlebar_and_sidebar(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    logical: crate::tide_core::Size,
) {
    // Draw titlebar background, border, and title (macOS transparent titlebar)
    if app.window.top_inset > 0.0 {
        let tb = Rect::new(0.0, 0.0, logical.width, app.window.top_inset);
        renderer.draw_chrome_rect(tb, p.file_tree_bg);
        // Bottom border
        renderer.draw_chrome_rect(
            Rect::new(0.0, app.window.top_inset - BORDER_WIDTH, logical.width, BORDER_WIDTH),
            p.border_subtle,
        );
        // Centered title: show "Tide" or "Tide · N" when multiple workspaces
        let cs = renderer.cell_size();
        {
            let title_text = if app.ws.workspaces.len() > 1 {
                format!("Tide · {}", app.ws.active + 1)
            } else {
                "Tide".to_string()
            };
            let title_w = title_text.chars().count() as f32 * cs.width;
            let title_x = (logical.width - title_w) / 2.0;
            let title_y = (app.window.top_inset - cs.height) / 2.0;
            renderer.draw_chrome_text(
                &title_text,
                Vec2::new(title_x, title_y),
                TextStyle {
                    foreground: p.tab_text,
                    background: None,
                    bold: false, dim: false, italic: false, underline: false,
                },
                tb,
            );
        }
        // Right: titlebar icons
        {
            let _icon_h = 16.0_f32;
            let rect_w = 7.0_f32;
            let gap = 3.0_f32;
            let icon_w = rect_w * 2.0 + gap;
            let icon_x = logical.width - PANE_PADDING - icon_w;

            // Settings gear icon
            {
                let gear_pad = 4.0_f32;
                let gear_icon = "\u{f013}"; // FontAwesome gear
                let gear_w = cs.width + gear_pad * 2.0;
                let gear_h = cs.height + 6.0;
                let gear_x = icon_x - gear_w - 8.0;
                let gear_y = (app.window.top_inset - gear_h) / 2.0;
                let gear_hovered = matches!(app.interaction.hover_target, Some(HoverTarget::TitlebarSettings));
                if gear_hovered {
                    let bg_rect = Rect::new(gear_x, gear_y, gear_w, gear_h);
                    renderer.draw_chrome_rounded_rect(bg_rect, p.badge_bg, 4.0);
                }
                let gear_text_y = gear_y + (gear_h - cs.height) / 2.0;
                let gear_color = if app.modal.config_page.is_some() { p.dock_tab_underline } else { p.tab_text };
                renderer.draw_chrome_text(
                    gear_icon,
                    Vec2::new(gear_x + gear_pad, gear_text_y),
                    TextStyle {
                        foreground: gear_color,
                        background: None,
                        bold: false, dim: false, italic: false, underline: false,
                    },
                    tb,
                );
            }

            // Titlebar toggle buttons: [Sidebar] [PaneArea] [Dock] [gap] [Theme] [Settings] [Swap icon]
            // Positioned right-to-left from the settings icon
            let settings_pad = 4.0_f32;
            let settings_w = cs.width + settings_pad * 2.0;
            let settings_x = icon_x - settings_w - 8.0;

            // Theme toggle icon (between settings and toggle buttons)
            let theme_pad = 4.0_f32;
            let theme_w = cs.width + theme_pad * 2.0;
            let theme_h = cs.height + 6.0;
            let theme_x = settings_x - theme_w - 8.0;
            let theme_y = (app.window.top_inset - theme_h) / 2.0;
            let theme_hovered = matches!(app.interaction.hover_target, Some(HoverTarget::TitlebarTheme));
            if theme_hovered {
                let bg_rect = Rect::new(theme_x, theme_y, theme_w, theme_h);
                renderer.draw_chrome_rounded_rect(bg_rect, p.badge_bg, 4.0);
            }
            let theme_icon = if app.window.dark_mode { "\u{f186}" } else { "\u{f185}" }; // moon / sun
            let theme_text_y = theme_y + (theme_h - cs.height) / 2.0;
            renderer.draw_chrome_text(
                theme_icon,
                Vec2::new(theme_x + theme_pad, theme_text_y),
                TextStyle {
                    foreground: p.tab_text,
                    background: None,
                    bold: false, dim: false, italic: false, underline: false,
                },
                tb,
            );

            let btn_right = theme_x - TITLEBAR_BUTTON_GAP;
            let tb_clip = Rect::new(0.0, 0.0, logical.width, app.window.top_inset);

            // Helper: render a titlebar toggle button (icon + ⌘N hint, badge style)
            // Returns the total width consumed
            let render_titlebar_btn = |renderer: &mut crate::tide_renderer::WgpuRenderer,
                                        icon_char: &str,
                                        hint: &str,
                                        hint_char_count: usize,
                                        right_edge: f32,
                                        is_active: bool,
                                        is_hovered: bool| -> f32 {
                let btn_pad_h = 6.0_f32;
                let icon_w_chars = 1;
                let gap_chars = 1; // space between icon and hint
                let total_chars = (icon_w_chars + gap_chars + hint_char_count) as f32;
                let btn_w = total_chars * cs.width + btn_pad_h * 2.0;
                let btn_h = cs.height + 6.0;
                let btn_x = right_edge - btn_w;
                let btn_y = (app.window.top_inset - btn_h) / 2.0;
                let btn_rect = Rect::new(btn_x, btn_y, btn_w, btn_h);

                // Background
                let bg_color = if is_hovered {
                    p.badge_bg
                } else if is_active {
                    p.badge_bg_unfocused
                } else {
                    crate::tide_core::Color::new(0.0, 0.0, 0.0, 0.0)
                };
                if bg_color.a > 0.0 {
                    renderer.draw_chrome_rounded_rect(btn_rect, bg_color, 4.0);
                }

                // Icon
                let text_y = btn_y + (btn_h - cs.height) / 2.0;
                let icon_color = if is_active { p.dock_tab_underline } else { p.tab_text };
                renderer.draw_chrome_text(
                    icon_char,
                    Vec2::new(btn_x + btn_pad_h, text_y),
                    TextStyle {
                        foreground: icon_color,
                        background: None,
                        bold: false, dim: false, italic: false, underline: false,
                    },
                    tb_clip,
                );

                // Hint text
                let hint_x = btn_x + btn_pad_h + (icon_w_chars + gap_chars) as f32 * cs.width;
                let hint_color = if is_active { p.badge_text } else { p.badge_text_dimmed };
                renderer.draw_chrome_text(
                    hint,
                    Vec2::new(hint_x, text_y),
                    TextStyle {
                        foreground: hint_color,
                        background: None,
                        bold: false, dim: false, italic: false, underline: false,
                    },
                    tb_clip,
                );

                btn_w
            };

            // Render buttons right-to-left: [Dock ⌘4] [FileTree ⌘2] [Workspace ⌘1]
            let mut cur_right = btn_right;

            // Dock button
            let w = render_titlebar_btn(
                renderer, "\u{f009}", "\u{2318}4", 2, cur_right, app.dock.dock_open,
                app.interaction.hover_target.as_ref() == Some(&HoverTarget::TitlebarDock),
            );
            cur_right -= w + TITLEBAR_BUTTON_GAP;

            // FileTree button
            let w = render_titlebar_btn(
                renderer, "\u{f07b}", "\u{2318}2", 2, cur_right, app.ft.visible,
                app.interaction.hover_target.as_ref() == Some(&HoverTarget::TitlebarFileTree),
            );
            cur_right -= w + TITLEBAR_BUTTON_GAP;

            // Workspace sidebar button
            let _w = render_titlebar_btn(
                renderer, "\u{f24d}", "\u{2318}1", 2, cur_right, app.ws.show_sidebar,
                app.interaction.hover_target.as_ref() == Some(&HoverTarget::TitlebarWorkspace),
            );
        }
    }

    // Draw workspace sidebar if visible
    if let Some(ws_rect) = app.ws.sidebar_rect {
        let cs = renderer.cell_size();
        let edge_inset = PANE_CORNER_RADIUS;

        // Sidebar visual rect: inset from top/bottom for corner radius visibility
        let sb_border = Rect::new(
            ws_rect.x,
            ws_rect.y + edge_inset,
            ws_rect.width,
            ws_rect.height - edge_inset * 2.0,
        );

        // Outer rounded rect (border)
        renderer.draw_chrome_rounded_rect(sb_border, p.border_subtle, PANE_CORNER_RADIUS);
        // Inner fill
        let inset = Rect::new(
            sb_border.x + 1.0,
            sb_border.y + 1.0,
            sb_border.width - 2.0,
            sb_border.height - 2.0,
        );
        renderer.draw_chrome_rounded_rect(inset, p.file_tree_bg, (PANE_CORNER_RADIUS - 1.0).max(0.0));

        // Workspace items
        let geo = app.ws_sidebar_geometry().unwrap();
        let content_x = geo.content_x;
        let content_w = geo.content_w;
        let item_gap = geo.item_gap;
        let name_h = cs.height;

        // Determine available text width for compact mode detection
        let text_avail_w = content_w - WS_SIDEBAR_ITEM_PAD_H * 2.0;
        let compact = text_avail_w < cs.width * 12.0; // < 12 chars -> compact

        // Collect workspace info: for the active workspace, use live App data;
        // for others, read from the stored workspace vec.
        for i in 0..app.ws.workspaces.len() {
            let is_active = i == app.ws.active;
            let ws_name = app.ws.workspaces[i].name.clone();

            let item_rect = geo.item_rect(i);

            // Active item: pane-bg background with 1px rounded border
            if is_active {
                // Outer rounded rect = border color
                renderer.draw_chrome_rounded_rect(item_rect, p.border_focused, PANE_CORNER_RADIUS);
                // Inner rounded rect = fill color (inset by 1px)
                let inner = Rect::new(
                    item_rect.x + 1.0,
                    item_rect.y + 1.0,
                    item_rect.width - 2.0,
                    item_rect.height - 2.0,
                );
                renderer.draw_chrome_rounded_rect(inner, p.pane_bg, (PANE_CORNER_RADIUS - 1.0).max(0.0));
            } else {
                // Hover highlight
                if matches!(app.interaction.hover_target, Some(HoverTarget::WorkspaceSidebarItem(idx)) if idx == i) {
                    renderer.draw_chrome_rounded_rect(item_rect, p.badge_bg, PANE_CORNER_RADIUS);
                }
            }

            // Name text -- use "W{n}" when sidebar is too narrow
            let display_name = if compact {
                format!("W{}", i + 1)
            } else {
                // Truncate name to fit available width
                let max_chars = (text_avail_w / cs.width).floor() as usize;
                if ws_name.chars().count() > max_chars && max_chars > 1 {
                    let truncated: String = ws_name.chars().take(max_chars.saturating_sub(1)).collect();
                    format!("{}…", truncated)
                } else {
                    ws_name
                }
            };
            let name_color = if is_active { p.tab_text_focused } else {
                crate::tide_core::Color::new(0.627, 0.627, 0.647, 1.0) // #A0A0A5
            };
            // Center text horizontally and vertically in compact mode
            let (name_text_x, name_text_y) = if compact {
                let name_w = display_name.len() as f32 * cs.width;
                (
                    content_x + (content_w - name_w) / 2.0,
                    item_rect.y + (item_rect.height - cs.height) / 2.0,
                )
            } else {
                (
                    content_x + WS_SIDEBAR_ITEM_PAD_H,
                    item_rect.y + WS_SIDEBAR_ITEM_PAD_V,
                )
            };
            renderer.draw_chrome_text(
                &display_name,
                Vec2::new(name_text_x, name_text_y),
                TextStyle {
                    foreground: name_color,
                    background: None,
                    bold: is_active,
                    dim: false, italic: false, underline: false,
                },
                inset,
            );

            // CWD text (second line) -- hide in compact mode
            if !compact {
                let cwd_text = if is_active {
                    // Use live cwd from the focused terminal
                    app.focused_terminal_cwd()
                        .map(|p| crate::state::abbreviate_path(&p))
                        .unwrap_or_default()
                } else {
                    String::new()
                };
                if !cwd_text.is_empty() {
                    // Truncate cwd to fit
                    let max_chars = (text_avail_w / cs.width).floor() as usize;
                    let display_cwd = if cwd_text.chars().count() > max_chars && max_chars > 1 {
                        let truncated: String = cwd_text.chars().take(max_chars.saturating_sub(1)).collect();
                        format!("{}…", truncated)
                    } else {
                        cwd_text
                    };
                    renderer.draw_chrome_text(
                        &display_cwd,
                        Vec2::new(content_x + WS_SIDEBAR_ITEM_PAD_H, item_rect.y + WS_SIDEBAR_ITEM_PAD_V + name_h + WS_SIDEBAR_LINE_GAP),
                        TextStyle {
                            foreground: p.tab_text,
                            background: None,
                            bold: false, dim: false, italic: false, underline: false,
                        },
                        inset,
                    );
                }
            }

            // Draw drag drop indicator line before this item (gap == i)
            if let Some((src, press_y, gap)) = app.ws.drag {
                let dragging = (app.window.last_cursor_pos.y - press_y).abs() > crate::theme::DRAG_THRESHOLD;
                if dragging && gap == i && gap != src && gap != src + 1 {
                    let line_y = item_rect.y - item_gap / 2.0;
                    let line_rect = Rect::new(content_x + 4.0, line_y - 1.0, content_w - 8.0, 2.0);
                    renderer.draw_chrome_rounded_rect(line_rect, p.border_focused, 1.0);
                }
            }
        }

        // Draw drop indicator after the last item (gap == len)
        if let Some((src, press_y, gap)) = app.ws.drag {
            let dragging = (app.window.last_cursor_pos.y - press_y).abs() > crate::theme::DRAG_THRESHOLD;
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

        if matches!(app.interaction.hover_target, Some(HoverTarget::WorkspaceSidebarNewBtn)) {
            renderer.draw_chrome_rounded_rect(btn_rect, p.badge_bg, PANE_CORNER_RADIUS);
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
                bold: false, dim: false, italic: false, underline: false,
            },
            inset,
        );
    }
}
