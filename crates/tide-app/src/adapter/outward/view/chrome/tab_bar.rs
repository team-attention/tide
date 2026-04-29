use crate::tide_core::{Rect, Renderer, TextStyle, Vec2};

use crate::header;
use crate::state::FocusArea;
use crate::theme::*;
use crate::App;
use crate::AppCorePort;
use crate::DockPort;

pub(crate) fn pane_surface_attention_status(
    status: Option<crate::state::gateway_status::AgentStatus>,
    _is_focused: bool,
) -> Option<crate::state::gateway_status::AgentStatus> {
    let _ = status;
    None
}

/// Render dock background, pane borders/backgrounds, pane headers (tab bars),
/// and browser navigation bars. Returns the computed header hit zones.
pub(super) fn render_pane_chrome(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    logical: crate::tide_core::Size,
    focused: Option<u64>,
    visual_pane_rects: &[(u64, Rect)],
) -> Vec<header::HeaderHitZone> {
    // Draw Dock background (subtle visual separation from Stage)
    if app.dock.dock_open {
        if let (Some(pa_rect), Some(dock_rect)) = (app.pane_area_rect, app.dock_area_rect) {
            // Dock area starts right after the Stage pane area, before the outer FileTree View.
            let dock_x = dock_rect.x;

            // Draw the Stage<->Dock boundary with a single hairline.
            let sep_x = pa_rect.x + pa_rect.width + PANE_GAP / 2.0;
            let sep_h = logical.height - app.window.top_inset;
            let sep_y = app.window.top_inset;
            renderer.draw_chrome_rect(Rect::new(sep_x, sep_y, 1.0, sep_h), p.border_subtle);

            // Check if the Terminal Context Surface is empty.
            let dock_has_panes = app
                .focused_terminal_id()
                .and_then(|tid| app.panes.get(&tid))
                .map(|pk| {
                    if let crate::pane::PaneKind::Terminal(tp) = pk {
                        !tp.dock_layout.all_pane_ids().is_empty()
                    } else {
                        false
                    }
                })
                .unwrap_or(false);
            if !dock_has_panes {
                // Empty dock placeholder
                let cs = renderer.cell_size();
                let dock_w = dock_rect.width;
                let edge_inset = PANE_CORNER_RADIUS;

                // Draw a rounded pane background for the empty dock area
                let placeholder_rect = Rect::new(
                    dock_x + edge_inset,
                    app.window.top_inset + edge_inset,
                    dock_w - edge_inset * 2.0,
                    logical.height - app.window.top_inset - edge_inset * 2.0,
                );
                renderer.draw_chrome_rounded_rect(
                    placeholder_rect,
                    p.border_subtle,
                    PANE_CORNER_RADIUS,
                );
                let inner = Rect::new(
                    placeholder_rect.x + 1.0,
                    placeholder_rect.y + 1.0,
                    placeholder_rect.width - 2.0,
                    placeholder_rect.height - 2.0,
                );
                renderer.draw_chrome_rounded_rect(
                    inner,
                    p.pane_bg,
                    (PANE_CORNER_RADIUS - 1.0).max(0.0),
                );

                // Centered hint text
                let hint = "Cmd+\\";
                let hint_w = hint.len() as f32 * cs.width;
                let hint_x = dock_x + (dock_w - hint_w) / 2.0;
                let hint_y = app.window.top_inset + (logical.height - app.window.top_inset) / 2.0
                    - cs.height / 2.0;
                renderer.draw_chrome_text(
                    hint,
                    Vec2::new(hint_x, hint_y),
                    TextStyle {
                        foreground: p.badge_text_dimmed,
                        background: None,
                        bold: false,
                        dim: false,
                        italic: false,
                        underline: false,
                    },
                    inner,
                );
            }
        }
    }

    // Draw pane backgrounds + borders with rounded corners
    for &(id, rect) in visual_pane_rects {
        if !app.panes.contains_key(&id) {
            continue;
        }
        // Only show pane focus highlight when focus is in the pane area
        let is_focused = focused == Some(id)
            && matches!(app.focus.focus_area, FocusArea::Stage | FocusArea::Dock);

        {
            // Normal: no border, pane_bg fills whole area, tab_bar_bg on top
            renderer.draw_chrome_rect(rect, p.pane_bg);
            let tab_bar_bg_color = if is_focused {
                p.tab_bar_bg_focused
            } else {
                p.tab_bar_bg
            };
            renderer.draw_chrome_rect(
                Rect::new(rect.x, rect.y, rect.width, TAB_BAR_HEIGHT),
                tab_bar_bg_color,
            );
            renderer.draw_chrome_rect(
                Rect::new(rect.x, rect.y + TAB_BAR_HEIGHT, rect.width, 1.0),
                p.border_subtle,
            );
        }
    }

    // Render per-pane headers. Dock uses Terminal Context Surface chrome; Stage
    // only gets a flat tab bar in stacked mode.
    let mut all_hit_zones = Vec::new();

    // Collect Dock TabGroup info only when the group has multiple tabs.
    let mut dock_tab_groups: std::collections::HashMap<u64, crate::tide_layout::TabGroup> =
        std::collections::HashMap::new();
    let dock_stacked = app.active_terminal_context_is_stacked();
    if !dock_stacked {
        for &(pid, _) in visual_pane_rects {
            let Some(terminal_id) = app.terminal_owning(pid) else {
                continue;
            };
            let Some(crate::pane::PaneKind::Terminal(tp)) = app.panes.get(&terminal_id) else {
                continue;
            };
            if let Some(tg) = tp.dock_layout.tab_group_containing(pid) {
                if !header::dock_tab_group_uses_shared_tab_bar(&tg) {
                    continue;
                }
                dock_tab_groups.insert(pid, tg.clone());
            }
        }
    }
    let dock_stacked_tabs: Vec<u64> = if dock_stacked {
        app.focused_terminal_id()
            .and_then(|tid| app.panes.get(&tid))
            .and_then(|pane| match pane {
                crate::pane::PaneKind::Terminal(tp) => Some(tp.dock_layout.all_tabs_flat()),
                _ => None,
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let dock_stacked_active = app.dock_zoomed_pane();
    // Collect Stage pane IDs for stacked tab bar (zoomed mode)
    let stage_pane_ids = app.layout.pane_ids();
    let show_stage_tabs = app.focus.zoomed_pane.is_some() && stage_pane_ids.len() > 1;

    // Compute blink time for wrapped-agent alert animation across Stage terminals
    // and inactive Workspace indicators.
    let has_blinking = app.has_any_stage_wrapped_agent_alert();
    let blink_time = crate::adapter::outward::view::wrapped_agent_blink_time(
        app.ports.clock.now(),
        app.timing.wrapped_agent_blink_at,
        has_blinking,
    );

    for &(id, rect) in visual_pane_rects {
        // Skip stale pane rects (pane was removed but layout not yet recomputed)
        if !app.panes.contains_key(&id) {
            continue;
        }
        let is_zoomed = app.focus.zoomed_pane == Some(id);
        let is_dock_stacked = dock_stacked && dock_stacked_active == Some(id);
        let has_dock_tab_bar = dock_tab_groups.contains_key(&id);
        let has_stage_tab_bar = is_zoomed && show_stage_tabs;

        let scroll_off = app
            .interaction
            .tab_scroll_offset
            .get(&id)
            .copied()
            .unwrap_or(0.0);
        let auto_fit_active_tab = !app.interaction.tab_manual_scroll.contains(&id);

        if is_dock_stacked && header::dock_stacked_uses_shared_tab_bar(&dock_stacked_tabs) {
            let tab_zones = header::render_dock_stacked_tab_bar(
                id,
                rect,
                &dock_stacked_tabs,
                &app.panes,
                focused,
                p,
                renderer,
                app.can_show_context_comment_badge(id),
                &app.gateway.detected_agents,
                blink_time,
                scroll_off,
                auto_fit_active_tab,
            );
            all_hit_zones.extend(tab_zones);
        } else if has_dock_tab_bar {
            // Dock pane: render ONLY the tab bar (includes close/maximize)
            let tg = dock_tab_groups.get(&id).unwrap();
            let tab_zones = header::render_dock_tab_bar(
                id,
                rect,
                tg,
                &app.panes,
                focused,
                &[],
                p,
                renderer,
                app.can_show_context_comment_badge(tg.active_pane()),
                &app.gateway.detected_agents,
                blink_time,
                scroll_off,
                auto_fit_active_tab,
            );
            all_hit_zones.extend(tab_zones);
        } else if has_stage_tab_bar {
            // Stage stacked/zoomed: render flat tab bar of ALL Stage panes (takes priority over per-group)
            let tab_zones = header::render_stage_tab_bar(
                id,
                rect,
                &stage_pane_ids,
                &app.panes,
                focused,
                p,
                renderer,
                false,
                &app.gateway.detected_agents,
                blink_time,
                scroll_off,
                auto_fit_active_tab,
            );
            all_hit_zones.extend(tab_zones);
        } else {
            // Normal pane: render per-pane header (with agent status dot)
            let agent_chrome_state = crate::header::pane_agent_chrome_visual_state(
                &app.panes,
                &app.gateway.detected_agents,
                id,
            );
            let zones = header::render_pane_header_inner(
                id,
                rect,
                &app.panes,
                focused,
                is_zoomed,
                false,
                app.can_show_context_comment_badge(id),
                p,
                renderer,
                agent_chrome_state,
                blink_time,
                agent_chrome_state.is_some(),
                if app.is_pane_in_dock(id) {
                    header::HeaderSurfaceKind::TerminalContextSurface
                } else {
                    header::HeaderSurfaceKind::Stage
                },
            );
            all_hit_zones.extend(zones);
        }
    }
    // Render browser navigation bar for browser panes (skip render-mode panes — BR-26)
    for &(id, rect) in visual_pane_rects {
        if let Some(crate::pane::PaneKind::Browser(bp)) = app.panes.get(&id) {
            if !bp.render_mode {
                render_browser_nav_bar(bp, rect, app, renderer, p);
            }
        }
    }

    all_hit_zones
}

/// Render browser navigation bar (back/forward/refresh + URL bar) inside a browser pane.
fn render_browser_nav_bar(
    bp: &crate::pane::browser::BrowserPane,
    pane_rect: Rect,
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    use unicode_width::UnicodeWidthChar;

    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let cell_w = cell_size.width;
    let nav_h = (cell_height * 1.5).round();
    let nav_y = pane_rect.y + TAB_BAR_HEIGHT + 2.0;
    let nav_x = pane_rect.x + PANE_PADDING;
    let nav_w = pane_rect.width - PANE_PADDING * 2.0;

    // Nav bar background
    renderer.draw_chrome_rounded_rect(
        Rect::new(nav_x, nav_y, nav_w, nav_h),
        p.panel_tab_bg_active,
        4.0,
    );

    let text_y = nav_y + (nav_h - cell_height) / 2.0;
    let mut cx = nav_x + 8.0;

    let hovered = |target: crate::state::drag_types::HoverTarget| {
        app.interaction.hover_target.as_ref() == Some(&target)
    };
    let draw_icon_button = |renderer: &mut crate::tide_renderer::WgpuRenderer,
                            x: f32,
                            icon: &str,
                            is_hovered: bool,
                            color: crate::tide_core::Color| {
        let rect = Rect::new(x, nav_y, cell_w * 2.0, nav_h);
        if is_hovered {
            renderer.draw_chrome_rounded_rect(
                Rect::new(rect.x, rect.y + 1.0, rect.width, rect.height - 2.0),
                p.hover_tab,
                3.0,
            );
        }
        renderer.draw_chrome_text(
            icon,
            Vec2::new(x, text_y),
            TextStyle {
                foreground: color,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
            rect,
        );
    };

    // Back button
    let back_color = if bp.can_go_back {
        p.tab_text_focused
    } else {
        p.tab_text
    };
    draw_icon_button(
        renderer,
        cx,
        "\u{2190}",
        hovered(crate::state::drag_types::HoverTarget::BrowserBack),
        back_color,
    );
    cx += cell_w * 2.0;

    // Forward button
    let fwd_color = if bp.can_go_forward {
        p.tab_text_focused
    } else {
        p.tab_text
    };
    draw_icon_button(
        renderer,
        cx,
        "\u{2192}",
        hovered(crate::state::drag_types::HoverTarget::BrowserForward),
        fwd_color,
    );
    cx += cell_w * 2.0;

    // Refresh button
    let refresh_icon = if bp.loading { "\u{00d7}" } else { "\u{21bb}" };
    draw_icon_button(
        renderer,
        cx,
        refresh_icon,
        hovered(crate::state::drag_types::HoverTarget::BrowserRefresh),
        p.tab_text_focused,
    );
    cx += cell_w * 2.0 + 4.0;

    // Copy URL button
    draw_icon_button(
        renderer,
        cx,
        "\u{2398}",
        hovered(crate::state::drag_types::HoverTarget::BrowserCopyUrl),
        p.tab_text_focused,
    );
    cx += cell_w * 2.0;

    // Open externally button
    draw_icon_button(
        renderer,
        cx,
        "\u{2197}",
        hovered(crate::state::drag_types::HoverTarget::BrowserOpenExternal),
        p.tab_text_focused,
    );
    cx += cell_w * 2.0 + 4.0;

    // Loading progress bar (thin line below nav bar)
    if bp.loading {
        let progress_h = 2.0;
        let progress_y = nav_y + nav_h - progress_h;
        // Indeterminate: animate a sliding bar using generation as pseudo-time
        let phase = (bp.generation % 60) as f32 / 60.0;
        let bar_w = nav_w * 0.3;
        let bar_x = nav_x + (nav_w - bar_w) * phase;
        renderer.draw_chrome_rect(
            Rect::new(bar_x, progress_y, bar_w, progress_h),
            p.cursor_accent,
        );
    }

    // URL bar
    let url_w = nav_x + nav_w - cx - 8.0;
    if url_w > 40.0 {
        let url_rect = Rect::new(cx, nav_y + 2.0, url_w, nav_h - 4.0);
        if bp.url_input_focused {
            // Draw focus border (1px accent outline)
            let border_rect = Rect::new(
                url_rect.x - 1.0,
                url_rect.y - 1.0,
                url_rect.width + 2.0,
                url_rect.height + 2.0,
            );
            renderer.draw_chrome_rounded_rect(border_rect, p.cursor_accent, 4.0);
            renderer.draw_chrome_rounded_rect(url_rect, p.file_tree_bg, 3.0);
        } else {
            renderer.draw_chrome_rounded_rect(url_rect, p.badge_bg, 3.0);
        }

        let str_display_width = |s: &str| -> usize {
            s.chars()
                .map(|c| UnicodeWidthChar::width(c).unwrap_or(1))
                .sum()
        };

        let max_cols = (url_w / cell_w).floor() as usize;
        if bp.url_input_focused {
            let preedit = &app.ime.preedit;
            let before: String = bp.url_input.chars().take(bp.url_input_cursor).collect();
            let after: String = bp.url_input.chars().skip(bp.url_input_cursor).collect();
            let display = format!("{}{}{}", before, preedit, after);

            let mut truncated = String::new();
            let mut cols = 0;
            for ch in display.chars() {
                let w = UnicodeWidthChar::width(ch).unwrap_or(1);
                if cols + w > max_cols.saturating_sub(1) {
                    break;
                }
                truncated.push(ch);
                cols += w;
            }

            renderer.draw_chrome_text(
                &truncated,
                Vec2::new(cx + 4.0, text_y),
                TextStyle {
                    foreground: p.tab_text_focused,
                    background: None,
                    bold: false,
                    dim: false,
                    italic: false,
                    underline: false,
                },
                url_rect,
            );

            if !preedit.is_empty() {
                let before_cols = str_display_width(&before) as f32;
                let preedit_cols = str_display_width(preedit) as f32;
                let underline_x = cx + 4.0 + before_cols * cell_w;
                let underline_w = preedit_cols * cell_w;
                renderer.draw_chrome_rect(
                    Rect::new(underline_x, nav_y + nav_h - 4.0, underline_w, 1.0),
                    p.cursor_accent,
                );
            }

            // Selection highlight
            if let Some((sel_lo, sel_hi)) = bp.url_selection_ordered() {
                let sel_start_cols: usize = bp
                    .url_input
                    .chars()
                    .take(sel_lo)
                    .map(|c| UnicodeWidthChar::width(c).unwrap_or(1))
                    .sum();
                let sel_end_cols: usize = bp
                    .url_input
                    .chars()
                    .take(sel_hi)
                    .map(|c| UnicodeWidthChar::width(c).unwrap_or(1))
                    .sum();
                let sel_x = cx + 4.0 + sel_start_cols as f32 * cell_w;
                let sel_w = (sel_end_cols - sel_start_cols) as f32 * cell_w;
                renderer.draw_chrome_rect(
                    Rect::new(sel_x, nav_y + 4.0, sel_w, nav_h - 8.0),
                    p.selection,
                );
            }

            let cursor_cols = str_display_width(&before) + str_display_width(preedit);
            let cursor_x = cx + 4.0 + cursor_cols as f32 * cell_w;
            renderer.draw_chrome_rect(
                Rect::new(cursor_x, nav_y + 4.0, 2.0, nav_h - 8.0),
                p.cursor_accent,
            );
        } else {
            let mut truncated = String::new();
            let mut cols = 0;
            for ch in bp.url.chars() {
                let w = UnicodeWidthChar::width(ch).unwrap_or(1);
                if cols + w > max_cols.saturating_sub(1) {
                    break;
                }
                truncated.push(ch);
                cols += w;
            }
            renderer.draw_chrome_text(
                &truncated,
                Vec2::new(cx + 4.0, text_y),
                TextStyle {
                    foreground: p.tab_text_focused,
                    background: None,
                    bold: false,
                    dim: false,
                    italic: false,
                    underline: false,
                },
                url_rect,
            );
        }
    }
}
