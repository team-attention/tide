use crate::tide_core::{Rect, Renderer};

use crate::pane::PaneKind;
use crate::state::drag_types::HoverTarget;
use crate::theme::*;
use crate::App;

use super::bar_offset_for;
use super::launcher::{
    launcher_choice_rects, launcher_choice_visual_state, launcher_content_rect,
    launcher_icon_raster_icon_asset, LauncherIcon, LAUNCHER_CHOICES,
};
use super::svg_icons::{svg_icon_palette, SVG_ICON_FOLDER, SVG_ICON_TERMINAL};

fn with_alpha(color: crate::tide_core::Color, alpha: f32) -> crate::tide_core::Color {
    crate::tide_core::Color::new(color.r, color.g, color.b, alpha)
}

fn launcher_icon_svg(icon: LauncherIcon) -> &'static str {
    match icon {
        LauncherIcon::Terminal => SVG_ICON_TERMINAL,
        LauncherIcon::OpenFile => SVG_ICON_FOLDER,
        LauncherIcon::NewFile | LauncherIcon::Browser => SVG_ICON_FOLDER,
    }
}

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
                        p.active_indent_guide,
                        app.window.dark_mode,
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
                    let inner = launcher_content_rect(rect);
                    let cs = renderer.cell_size();
                    let hover_choice = match app.interaction.hover_target {
                        Some(HoverTarget::LauncherChoice(pane_id, choice)) if pane_id == id => {
                            Some(choice)
                        }
                        _ => None,
                    };

                    for (spec, (choice, row_rect)) in LAUNCHER_CHOICES
                        .iter()
                        .zip(launcher_choice_rects(inner, cs).into_iter())
                    {
                        let visual = launcher_choice_visual_state(choice, hover_choice);
                        let bg = if visual.hovered {
                            with_alpha(p.dock_tab_underline, 0.18)
                        } else {
                            with_alpha(p.badge_bg, 0.14)
                        };
                        renderer.draw_rect(row_rect, bg);

                        let icon_size = 16.0_f32;
                        let icon_rect = Rect::new(
                            row_rect.x + 12.0,
                            row_rect.y + (row_rect.height - icon_size) / 2.0,
                            icon_size,
                            icon_size,
                        );
                        let icon_color = if visual.emphasized {
                            p.tab_text_focused
                        } else {
                            p.tab_text
                        };
                        if let Some(asset) = launcher_icon_raster_icon_asset(spec.icon) {
                            renderer.draw_top_raster_icon(asset, icon_rect, icon_color);
                        } else {
                            renderer.draw_top_svg_icon(
                                launcher_icon_svg(spec.icon),
                                icon_rect,
                                svg_icon_palette(
                                    icon_color,
                                    with_alpha(icon_color, icon_color.a * 0.55),
                                ),
                            );
                        }

                        let x = icon_rect.x + icon_size + 12.0;
                        let y = row_rect.y + (row_rect.height - cs.height) / 2.0;
                        let hotkey_text = format!("[{}]", spec.hotkey);
                        let hotkey_color = if visual.emphasized {
                            p.badge_text
                        } else {
                            p.badge_text_dimmed
                        };
                        renderer.draw_text(
                            &hotkey_text,
                            crate::tide_core::Vec2::new(x, y),
                            crate::tide_core::TextStyle {
                                foreground: hotkey_color,
                                background: None,
                                bold: visual.emphasized,
                                dim: false,
                                italic: false,
                                underline: false,
                            },
                            row_rect,
                        );
                        let label_x = x + (hotkey_text.chars().count() as f32 + 2.0) * cs.width;
                        let label_color = if visual.emphasized {
                            p.tab_text_focused
                        } else {
                            p.tree_text
                        };
                        renderer.draw_text(
                            spec.label,
                            crate::tide_core::Vec2::new(label_x, y),
                            crate::tide_core::TextStyle {
                                foreground: label_color,
                                background: None,
                                bold: visual.emphasized,
                                dim: false,
                                italic: false,
                                underline: false,
                            },
                            row_rect,
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
