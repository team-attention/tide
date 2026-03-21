// Gateway status modal (UC-11).
// Renders a centered popup with per-terminal agent status + one-click Enable.
//
// Sections:
// 1. Active Agents — per-terminal: agent name, connection status, Enable button
// 2. Render Panes — active render-mode browser panes
// 3. Socket — socket path, connected PIDs

use crate::tide_core::{Rect, Renderer, Vec2};
use crate::theme::*;
use crate::App;
use crate::AppCorePort;

use super::{draw_popup_rounded_bg, draw_popup_scrim, text_style, bold_style};

pub(super) fn render_gateway_modal(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
) {
    if app.modal.gateway_modal.is_none() {
        return;
    }

    let logical = app.logical_size();
    let cs = renderer.cell_size();

    draw_popup_scrim(renderer, logical, p.popup_scrim);

    let modal_w = (logical.width * 0.6).min(500.0).max(300.0);
    let modal_h = (logical.height * 0.7).min(450.0).max(200.0);
    let modal_x = (logical.width - modal_w) / 2.0;
    let modal_y = (logical.height - modal_h) / 2.0;
    let modal_rect = Rect::new(modal_x, modal_y, modal_w, modal_h);

    let shadow_color = crate::tide_core::Color::new(0.0, 0.0, 0.0, 0.25);
    renderer.draw_top_shadow(modal_rect, shadow_color, 8.0, 40.0, 0.0);
    draw_popup_rounded_bg(renderer, modal_rect, p.popup_bg, p.popup_border, POPUP_CORNER_RADIUS);

    let pad = 16.0;
    let mut y = modal_y + pad;
    let text_x = modal_x + pad;
    let content_w = modal_w - pad * 2.0;
    let clip = |y: f32| Rect::new(text_x, y, content_w, cs.height);
    let title_color = p.tab_text_focused;
    let text_color = p.tab_text;
    let dim_color = p.badge_text_dimmed;
    let sep_color = p.popup_border;
    let bottom_limit = modal_y + modal_h - pad;

    // Title
    renderer.draw_top_text("Agent Gateway", Vec2::new(text_x, y), bold_style(title_color), clip(y));
    y += cs.height + 4.0;
    renderer.draw_top_rect(Rect::new(modal_x + pad, y, content_w, 1.0), sep_color);
    y += 8.0;

    // Section 1: Active Agents (per-terminal)
    if y < bottom_limit {
        renderer.draw_top_text("Active Agents", Vec2::new(text_x, y), bold_style(text_color), clip(y));
        y += cs.height * 1.3;

        let mut terminal_panes: Vec<_> = app.panes.iter()
            .filter(|(_, pk)| matches!(pk, crate::pane::PaneKind::Terminal(_)))
            .map(|(&id, _)| id)
            .collect();
        terminal_panes.sort();

        if terminal_panes.is_empty() {
            renderer.draw_top_text("  No terminals", Vec2::new(text_x, y), text_style(dim_color), clip(y));
            y += cs.height * 1.2;
        } else {
            for id in &terminal_panes {
                if y >= bottom_limit { break; }
                let agent_info = app.gateway.detected_agents.get(id);

                match agent_info {
                    Some(agent) if agent.gateway_connected => {
                        // Connected — green
                        let line = format!("  %{} \u{2500} {} \u{2500} Connected", id, agent.name);
                        renderer.draw_top_text(&line, Vec2::new(text_x, y), text_style(p.git_added), clip(y));
                    }
                    Some(agent) => {
                        // Agent detected but not connected — show Enable button
                        let line = format!("  %{} \u{2500} {} \u{2500} Not connected", id, agent.name);
                        renderer.draw_top_text(&line, Vec2::new(text_x, y), text_style(text_color), clip(y));

                        // Enable button at right edge
                        if crate::state::gateway_status::agent_tool_name(agent.name).is_some() {
                            let btn_text = "Enable";
                            let btn_pad = 6.0;
                            let btn_w = btn_text.len() as f32 * cs.width + btn_pad * 2.0;
                            let btn_x = text_x + content_w - btn_w;
                            let btn_h = cs.height + 4.0;
                            let btn_y = y - 2.0;
                            let btn_bg = crate::tide_core::Color::new(
                                title_color.r, title_color.g, title_color.b, 0.15
                            );
                            renderer.draw_top_rounded_rect(
                                Rect::new(btn_x, btn_y, btn_w, btn_h), btn_bg, 3.0
                            );
                            renderer.draw_top_text(
                                btn_text,
                                Vec2::new(btn_x + btn_pad, y),
                                text_style(title_color),
                                Rect::new(btn_x, btn_y, btn_w, btn_h),
                            );
                        }
                    }
                    None => {
                        // No agent detected
                        let line = format!("  %{} \u{2500} (no agent)", id);
                        renderer.draw_top_text(&line, Vec2::new(text_x, y), text_style(dim_color), clip(y));
                    }
                }

                y += cs.height * 1.4;
            }
        }
        y += 4.0;
    }

    // Section 2: Render Panes
    let render_panes: Vec<_> = app.panes.iter()
        .filter_map(|(&id, pk)| {
            if let crate::pane::PaneKind::Browser(bp) = pk {
                if bp.render_mode { return Some((id, bp)); }
            }
            None
        })
        .collect();

    if !render_panes.is_empty() && y < bottom_limit {
        renderer.draw_top_text("Render Panes", Vec2::new(text_x, y), bold_style(text_color), clip(y));
        y += cs.height * 1.3;
        for (id, bp) in &render_panes {
            if y >= bottom_limit { break; }
            let title = bp.render_title.as_deref().unwrap_or("Untitled");
            let status = if bp.streaming { "streaming" } else { "static" };
            let line = format!("  %{} \u{2500} {} ({})", id, title, status);
            renderer.draw_top_text(&line, Vec2::new(text_x, y), text_style(text_color), clip(y));
            y += cs.height * 1.2;
        }
        y += 4.0;
    }

    // Section 3: Socket Info
    if y < bottom_limit {
        renderer.draw_top_text("Socket", Vec2::new(text_x, y), bold_style(text_color), clip(y));
        y += cs.height * 1.3;

        let socket_path = app.gateway.socket_path.as_deref().unwrap_or("(not running)");
        renderer.draw_top_text(&format!("  {}", socket_path), Vec2::new(text_x, y), text_style(dim_color), clip(y));
        y += cs.height * 1.2;

        if y < bottom_limit {
            let info = format!(
                "  Connected PIDs: {}  Streams: {}",
                app.gateway.connected_pids.len(),
                app.gateway.active_streams
            );
            renderer.draw_top_text(&info, Vec2::new(text_x, y), text_style(dim_color), clip(y));
        }
    }
}
