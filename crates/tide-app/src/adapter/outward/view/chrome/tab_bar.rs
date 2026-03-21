use crate::tide_core::{Rect, Renderer, TextStyle, Vec2};

use crate::header;
use crate::theme::*;
use crate::state::FocusArea;
use crate::App;
use crate::DockPort;
use crate::AppCorePort;

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
        if let Some(pa_rect) = app.pane_area_rect {
            // Dock area starts right after the Stage pane area
            let dock_x = pa_rect.x + pa_rect.width + PANE_GAP;

            // Draw separator line at the Stage<->Dock boundary
            let sep_x = pa_rect.x + pa_rect.width + PANE_GAP / 2.0;
            let sep_rect = Rect::new(sep_x, app.window.top_inset, 1.0, logical.height - app.window.top_inset);
            renderer.draw_chrome_rect(sep_rect, p.border_subtle);

            // Draw separator between pinned group and terminal dock
            let has_pinned = app.has_pinned_panes();
            let has_term_dock = app.focused_terminal_id()
                .and_then(|tid| app.panes.get(&tid))
                .map(|pk| {
                    if let crate::pane::PaneKind::Terminal(tp) = pk {
                        !tp.dock_layout.pane_ids().is_empty()
                    } else { false }
                })
                .unwrap_or(false);
            if has_pinned && has_term_dock {
                let pinned_w = (app.dock.dock_width * app.dock.pinned_dock_ratio).max(60.0).min(app.dock.dock_width - 60.0);
                let pin_sep_x = dock_x + pinned_w + PANE_GAP / 2.0;
                let pin_sep_rect = Rect::new(pin_sep_x, app.window.top_inset, 1.0, logical.height - app.window.top_inset);
                renderer.draw_chrome_rect(pin_sep_rect, p.border_subtle);
            }

            // Check if the dock is empty (no dock panes and no pinned panes)
            let dock_has_panes = app.focused_terminal_id()
                .and_then(|tid| app.panes.get(&tid))
                .map(|pk| {
                    if let crate::pane::PaneKind::Terminal(tp) = pk {
                        !tp.dock_layout.all_pane_ids().is_empty()
                    } else { false }
                })
                .unwrap_or(false);
            if !dock_has_panes && !has_pinned {
                // Empty dock placeholder
                let cs = renderer.cell_size();
                let dock_w = app.dock.dock_width;
                let edge_inset = PANE_CORNER_RADIUS;

                // Draw a rounded pane background for the empty dock area
                let placeholder_rect = Rect::new(
                    dock_x + edge_inset,
                    app.window.top_inset + edge_inset,
                    dock_w - edge_inset * 2.0,
                    logical.height - app.window.top_inset - edge_inset * 2.0,
                );
                renderer.draw_chrome_rounded_rect(placeholder_rect, p.border_subtle, PANE_CORNER_RADIUS);
                let inner = Rect::new(
                    placeholder_rect.x + 1.0,
                    placeholder_rect.y + 1.0,
                    placeholder_rect.width - 2.0,
                    placeholder_rect.height - 2.0,
                );
                renderer.draw_chrome_rounded_rect(inner, p.pane_bg, (PANE_CORNER_RADIUS - 1.0).max(0.0));

                // Centered hint text
                let hint = "Cmd+4";
                let hint_w = hint.len() as f32 * cs.width;
                let hint_x = dock_x + (dock_w - hint_w) / 2.0;
                let hint_y = app.window.top_inset + (logical.height - app.window.top_inset) / 2.0 - cs.height / 2.0;
                renderer.draw_chrome_text(
                    hint,
                    Vec2::new(hint_x, hint_y),
                    TextStyle {
                        foreground: p.badge_text_dimmed,
                        background: None,
                        bold: false, dim: false, italic: false, underline: false,
                    },
                    inner,
                );
            }
        }
    }

    // Cross-region highlight: show which Stage terminal owns the Dock (or vice versa)
    let companion_id = match app.focus.focus_area {
        FocusArea::Dock => app.focused_terminal_id(), // highlight owner terminal in Stage
        FocusArea::Stage if app.dock.dock_open => {
            // highlight dock's active pane
            app.focused_terminal_id().and_then(|tid| {
                if let Some(crate::pane::PaneKind::Terminal(tp)) = app.panes.get(&tid) {
                    tp.dock_focused
                } else { None }
            })
        }
        _ => None,
    };

    // Draw pane backgrounds + borders with rounded corners
    for &(id, rect) in visual_pane_rects {
        if !app.panes.contains_key(&id) { continue; }
        // Only show pane focus highlight when focus is in the pane area
        let is_focused = focused == Some(id) && matches!(app.focus.focus_area, FocusArea::Stage | FocusArea::Dock);
        let is_companion = companion_id == Some(id);
        let border_color = if is_focused {
            p.border_focused
        } else if is_companion {
            // Dimmed version of border_focused -- same hue, lower alpha, no glow
            crate::tide_core::Color::new(p.border_focused.r, p.border_focused.g, p.border_focused.b, p.border_focused.a * 0.6)
        } else {
            p.border_subtle
        };
        let top_border = if is_focused { 2.0 } else { 1.0 };
        let side_border = if is_focused { 2.0_f32 } else { 1.0_f32 };

        // Focused pane: draw outer glow shadow
        if is_focused {
            let shadow_color = crate::tide_core::Color::new(0.769, 0.722, 0.651, 0.25);
            renderer.draw_chrome_shadow(rect, shadow_color, PANE_CORNER_RADIUS, 16.0, -4.0);
        }

        // Outer rounded rect (border color)
        renderer.draw_chrome_rounded_rect(rect, border_color, PANE_CORNER_RADIUS);
        // Inner rounded rect (pane fill, inset by border widths)
        let inset = Rect::new(
            rect.x + side_border,
            rect.y + top_border,
            rect.width - 2.0 * side_border,
            rect.height - top_border - side_border,
        );
        renderer.draw_chrome_rounded_rect(inset, p.pane_bg, (PANE_CORNER_RADIUS - side_border).max(0.0));
    }

    // Render per-pane headers (title + badges + close, or tab bar for multi-tab groups)
    let mut all_hit_zones = Vec::new();

    // Collect dock TabGroup info for ALL dock panes (always show tab bar in Dock)
    let mut dock_tab_groups: std::collections::HashMap<u64, crate::tide_layout::TabGroup> = std::collections::HashMap::new();
    for (_, pk) in &app.panes {
        if let crate::pane::PaneKind::Terminal(tp) = pk {
            for &(pid, _) in visual_pane_rects {
                if let Some(tg) = tp.dock_layout.tab_group_containing(pid) {
                    dock_tab_groups.insert(pid, tg.clone());
                }
            }
        }
    }
    // Add TabGroup info for pinned dock panes
    for &(pid, _) in visual_pane_rects {
        if let Some(tg) = app.dock.pinned_dock_layout.tab_group_containing(pid) {
            dock_tab_groups.insert(pid, tg.clone());
        }
    }

    // Dock zoomed: collect all dock tabs (pinned + terminal) for the tab bar
    let dock_zoomed_pane = app.dock_zoomed_pane();
    let dock_zoomed_tabs: Option<Vec<u64>> = if dock_zoomed_pane.is_some() {
        let mut tabs = app.dock.pinned_dock_layout.all_tabs_flat();
        if let Some(tid) = app.focused_terminal_id() {
            if let Some(crate::pane::PaneKind::Terminal(tp)) = app.panes.get(&tid) {
                tabs.extend(tp.dock_layout.all_tabs_flat());
            }
        }
        if tabs.len() > 1 { Some(tabs) } else { None }
    } else { None };

    // Collect Stage pane IDs for stacked tab bar
    let stage_pane_ids = app.layout.pane_ids();
    let show_stage_tabs = app.focus.zoomed_pane.is_some() && stage_pane_ids.len() > 1;

    for &(id, rect) in visual_pane_rects {
        // Skip stale pane rects (pane was removed but layout not yet recomputed)
        if !app.panes.contains_key(&id) {
            continue;
        }
        let is_zoomed = app.focus.zoomed_pane == Some(id);
        let is_dock_zoomed = dock_zoomed_pane == Some(id);
        let has_dock_tab_bar = dock_tab_groups.contains_key(&id);
        let has_stage_tab_bar = is_zoomed && show_stage_tabs;

        if is_dock_zoomed {
            // Dock zoomed: show flat tab bar of all dock tabs (like stage stacked)
            if let Some(ref tabs) = dock_zoomed_tabs {
                let tab_zones = header::render_stage_tab_bar(
                    id, rect, tabs, &app.panes, focused, p, renderer,
                );
                // Remap StageTab actions to DockTab for dock panes
                for mut z in tab_zones {
                    if let header::HeaderHitAction::StageTab(pid) = z.action {
                        z.action = header::HeaderHitAction::DockTab(pid);
                    }
                    all_hit_zones.push(z);
                }
            } else {
                // Single dock pane zoomed -- render normal header
                let agent_status = app.gateway.detected_agents.get(&id).and_then(|a| a.status);
                let zones = header::render_pane_header_inner(
                    id, rect, &app.panes, focused, false, false, p, renderer, agent_status,
                );
                all_hit_zones.extend(zones);
            }
        } else if has_dock_tab_bar {
            // Dock pane: render ONLY the tab bar (includes close/maximize)
            let tg = dock_tab_groups.get(&id).unwrap();
            let tab_zones = header::render_dock_tab_bar(
                id, rect, tg, &app.panes, focused, &app.dock.pinned_dock_layout.all_pane_ids(), p, renderer,
            );
            all_hit_zones.extend(tab_zones);
        } else if has_stage_tab_bar {
            // Stage stacked: render ONLY the tab bar (includes close/maximize)
            let tab_zones = header::render_stage_tab_bar(
                id, rect, &stage_pane_ids, &app.panes, focused, p, renderer,
            );
            all_hit_zones.extend(tab_zones);
        } else {
            // Normal pane: render per-pane header (with agent status dot)
            let agent_status = app.gateway.detected_agents.get(&id).and_then(|a| a.status);
            let zones = header::render_pane_header_inner(
                id, rect, &app.panes, focused, is_zoomed, false, p, renderer, agent_status,
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

    // Back button
    let back_color = if bp.can_go_back { p.tab_text_focused } else { p.tab_text };
    renderer.draw_chrome_text(
        "\u{2190}",
        Vec2::new(cx, text_y),
        TextStyle { foreground: back_color, background: None, bold: false, dim: false, italic: false, underline: false },
        Rect::new(cx, nav_y, cell_w * 2.0, nav_h),
    );
    cx += cell_w * 2.0;

    // Forward button
    let fwd_color = if bp.can_go_forward { p.tab_text_focused } else { p.tab_text };
    renderer.draw_chrome_text(
        "\u{2192}",
        Vec2::new(cx, text_y),
        TextStyle { foreground: fwd_color, background: None, bold: false, dim: false, italic: false, underline: false },
        Rect::new(cx, nav_y, cell_w * 2.0, nav_h),
    );
    cx += cell_w * 2.0;

    // Refresh button
    let refresh_icon = if bp.loading { "\u{00d7}" } else { "\u{21bb}" };
    renderer.draw_chrome_text(
        refresh_icon,
        Vec2::new(cx, text_y),
        TextStyle { foreground: p.tab_text_focused, background: None, bold: false, dim: false, italic: false, underline: false },
        Rect::new(cx, nav_y, cell_w * 2.0, nav_h),
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
        let url_bg = if bp.url_input_focused { p.file_tree_bg } else { p.badge_bg };
        renderer.draw_chrome_rounded_rect(url_rect, url_bg, 3.0);

        let str_display_width = |s: &str| -> usize {
            s.chars().map(|c| UnicodeWidthChar::width(c).unwrap_or(1)).sum()
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
                if cols + w > max_cols.saturating_sub(1) { break; }
                truncated.push(ch);
                cols += w;
            }

            renderer.draw_chrome_text(
                &truncated,
                Vec2::new(cx + 4.0, text_y),
                TextStyle { foreground: p.tab_text_focused, background: None, bold: false, dim: false, italic: false, underline: false },
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
                let sel_start_cols: usize = bp.url_input.chars().take(sel_lo)
                    .map(|c| UnicodeWidthChar::width(c).unwrap_or(1)).sum();
                let sel_end_cols: usize = bp.url_input.chars().take(sel_hi)
                    .map(|c| UnicodeWidthChar::width(c).unwrap_or(1)).sum();
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
                if cols + w > max_cols.saturating_sub(1) { break; }
                truncated.push(ch);
                cols += w;
            }
            renderer.draw_chrome_text(
                &truncated,
                Vec2::new(cx + 4.0, text_y),
                TextStyle { foreground: p.tab_text_focused, background: None, bold: false, dim: false, italic: false, underline: false },
                url_rect,
            );
        }
    }
}

