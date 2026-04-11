use crate::tide_core::{Rect, Renderer};

use crate::pane::PaneKind;
use crate::theme::*;
use crate::App;

use super::bar_offset_for;

/// Perform per-pane dirty checking and rebuild grid caches for panes whose content changed.
/// Returns (pane_id, generation) pairs for caller to update pane_generations.
/// Pre-computation (side_by_side, preview cache, wrap map) must be done before calling this.
pub(crate) fn render_grid(
    app: &App,
    renderer: &mut crate::tide_renderer::WgpuRenderer,
    p: &ThemePalette,
    visual_pane_rects: &[(u64, Rect)],
) -> Vec<(u64, u64)> {
    let ime_target_id = app.focus.focused;

    let mut gen_updates = Vec::new();
    for &(id, rect) in visual_pane_rects {
        let gen = match app.panes.get(&id) {
            Some(PaneKind::Terminal(pane)) => pane.backend.grid_generation(),
            Some(PaneKind::Editor(pane)) => pane.generation(),
            Some(PaneKind::Diff(dp)) => dp.generation(),
            Some(PaneKind::Browser(_)) => continue, // webview renders natively
            Some(PaneKind::Launcher(_)) => 0,       // static content, always render on first check
            None => continue,
        };
        let prev = app
            .cache
            .pane_generations
            .get(&id)
            .copied()
            .unwrap_or(u64::MAX);
        if gen != prev {
            let pane_bar = bar_offset_for(id, &app.panes, &app.modal.save_confirm);
            renderer.begin_pane_grid(id);
            match app.panes.get(&id) {
                Some(PaneKind::Terminal(pane)) => {
                    let inner = crate::pane::pane_content_rect(
                        rect,
                        terminal_content_top(renderer.cell_size().height) + pane_bar,
                    );
                    pane.render_grid(inner, renderer);
                    // Overlay message for dead terminals
                    if pane.context.child_dead {
                        let cs = renderer.cell_size();
                        let msg = "Process exited. Press any key to restart.";
                        let msg_w = msg.chars().count() as f32 * cs.width;
                        let x = inner.x + (inner.width - msg_w) / 2.0;
                        let y = inner.y + inner.height - cs.height * 2.0;
                        // Semi-transparent background strip
                        let strip = crate::tide_core::Rect::new(
                            inner.x,
                            y - 4.0,
                            inner.width,
                            cs.height + 8.0,
                        );
                        renderer.draw_rect(strip, crate::tide_core::Color::new(0.0, 0.0, 0.0, 0.6));
                        renderer.draw_text(
                            msg,
                            crate::tide_core::Vec2::new(x, y),
                            crate::tide_core::TextStyle {
                                foreground: p.tab_text_focused,
                                background: None,
                                bold: false,
                                dim: false,
                                italic: false,
                                underline: false,
                            },
                            strip,
                        );
                    }
                    gen_updates.push((id, pane.backend.grid_generation()));
                }
                Some(PaneKind::Editor(pane)) => {
                    let inner =
                        pane.content_rect(rect, TAB_BAR_HEIGHT + pane_bar, renderer.cell_size());
                    let preedit = if ime_target_id == Some(id) {
                        &app.ime.preedit
                    } else {
                        ""
                    };
                    pane.render_grid_full(
                        inner,
                        renderer,
                        p.gutter_text,
                        p.gutter_active_text,
                        Some(p.diff_added_bg),
                        Some(p.diff_removed_bg),
                        Some(p.diff_added_gutter),
                        Some(p.diff_removed_gutter),
                        preedit,
                        p.current_line_bg,
                        p.indent_guide,
                    );
                    gen_updates.push((id, pane.generation()));
                }
                Some(PaneKind::Diff(dp)) => {
                    let inner = crate::pane::pane_content_rect(rect, TAB_BAR_HEIGHT + pane_bar);
                    dp.render_grid(
                        inner,
                        renderer,
                        p.tab_text_focused,
                        p.tab_text,
                        p.diff_added_bg,
                        p.diff_removed_bg,
                        p.diff_added_gutter,
                        p.diff_removed_gutter,
                        p.border_subtle,
                    );
                    gen_updates.push((id, dp.generation()));
                }
                Some(PaneKind::Browser(_)) => {} // webview renders natively
                Some(PaneKind::Launcher(_launcher_id)) => {
                    let inner = crate::pane::pane_content_rect(rect, TAB_BAR_HEIGHT + pane_bar);
                    // Render launcher type-selection UI
                    let cs = renderer.cell_size();
                    let lines: [(&str, crate::tide_core::Color); 4] = [
                        ("\u{f120}  [T]  Terminal", p.tab_text_focused),
                        ("\u{f15c}  [E]  New File", p.tab_text),
                        ("\u{f07c}  [O]  Open File", p.tab_text),
                        ("\u{f268}  [B]  Browser", p.tab_text),
                    ];
                    let line_h = cs.height * 1.8;
                    let block_h = lines.len() as f32 * line_h;
                    let start_y = inner.y + (inner.height - block_h) / 2.0;
                    for (i, (text, color)) in lines.iter().enumerate() {
                        let text_w = text.chars().count() as f32 * cs.width;
                        let x = inner.x + (inner.width - text_w) / 2.0;
                        let y = start_y + i as f32 * line_h;
                        renderer.draw_text(
                            text,
                            crate::tide_core::Vec2::new(x, y),
                            crate::tide_core::TextStyle {
                                foreground: *color,
                                background: None,
                                bold: i == 0,
                                dim: false,
                                italic: false,
                                underline: false,
                            },
                            inner,
                        );
                    }
                    // Don't cache generation — Launcher is static/cheap, always
                    // re-render to avoid stale-cache issues after atlas resets.
                }
                None => {}
            }
            renderer.end_pane_grid();
        }
    }

    gen_updates
}
