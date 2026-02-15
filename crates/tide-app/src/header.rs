// Per-pane header rendering: title + close button + kind-specific badges.

use std::collections::HashMap;

use tide_core::{PaneId, Rect, Renderer, TextStyle, Vec2};
use tide_renderer::WgpuRenderer;

use crate::pane::PaneKind;
use crate::theme::*;

/// Clickable zone within a pane header.
#[derive(Debug, Clone)]
pub struct HeaderHitZone {
    pub pane_id: PaneId,
    pub rect: Rect,
    pub action: HeaderHitAction,
}

/// Action triggered by clicking a header hit zone.
#[derive(Debug, Clone)]
pub enum HeaderHitAction {
    Close,
    Directory,
    GitBranch,
    GitStatus,
    EditorCompare,
    EditorOverwrite,
    DiffRefresh,
}

/// Render the header for a single pane (split tree pane).
/// Returns hit zones for click handling.
pub fn render_pane_header(
    id: PaneId,
    rect: Rect,
    panes: &HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
) -> Vec<HeaderHitZone> {
    let mut zones = Vec::new();
    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let is_focused = focused == Some(id);

    let text_y = rect.y + (TAB_BAR_HEIGHT - cell_height) / 2.0;

    // Close button (rightmost)
    let close_x = rect.x + rect.width - PANE_CLOSE_SIZE - PANE_PADDING;
    let close_y = text_y;
    let is_modified = match panes.get(&id) {
        Some(PaneKind::Editor(ep)) => ep.editor.is_modified(),
        _ => false,
    };
    // Close icon (defer hover to rendering.rs — here we just draw the icon)
    let (close_icon, close_color) = if is_modified {
        ("\u{f111}", p.editor_modified) // filled circle
    } else {
        ("\u{f00d}", p.tab_text) // x icon
    };
    let close_style = TextStyle {
        foreground: close_color,
        background: None,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
    };
    renderer.draw_chrome_text(
        close_icon,
        Vec2::new(close_x, close_y),
        close_style,
        Rect::new(close_x, rect.y, PANE_CLOSE_SIZE + PANE_PADDING, TAB_BAR_HEIGHT),
    );
    zones.push(HeaderHitZone {
        pane_id: id,
        rect: Rect::new(close_x - 4.0, rect.y, PANE_CLOSE_SIZE + PANE_PADDING + 4.0, TAB_BAR_HEIGHT),
        action: HeaderHitAction::Close,
    });

    // Available width for title + badges (excluding close button)
    let content_left = rect.x + PANE_PADDING + 4.0;
    let content_right = close_x - 8.0;
    let available_w = content_right - content_left;
    if available_w < 20.0 {
        return zones;
    }

    // Determine title and badges based on pane kind
    match panes.get(&id) {
        Some(PaneKind::Terminal(pane)) => {
            // Render badges right-to-left from content_right
            let mut badge_right = content_right;

            // Git status badge
            if let Some(ref git) = pane.git_info {
                if git.status.changed_files > 0 {
                    let stat_text = format!(
                        "{} +{} -{}",
                        git.status.changed_files, git.status.additions, git.status.deletions
                    );
                    let badge_w = stat_text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                    let badge_x = badge_right - badge_w;
                    if badge_x > content_left + 60.0 {
                        render_badge(renderer, badge_x, text_y, badge_w, cell_height, &stat_text, p.badge_text, p, rect);
                        zones.push(HeaderHitZone {
                            pane_id: id,
                            rect: Rect::new(badge_x, rect.y, badge_w, TAB_BAR_HEIGHT),
                            action: HeaderHitAction::GitStatus,
                        });
                        badge_right = badge_x - BADGE_GAP;
                    }
                }
            }

            // Git branch badge
            if let Some(ref git) = pane.git_info {
                let branch_display = format!("\u{e725} {}", git.branch); // git branch icon
                let badge_w = branch_display.chars().count() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let badge_x = badge_right - badge_w;
                if badge_x > content_left + 60.0 {
                    render_badge(renderer, badge_x, text_y, badge_w, cell_height, &branch_display, p.badge_git_branch, p, rect);
                    zones.push(HeaderHitZone {
                        pane_id: id,
                        rect: Rect::new(badge_x, rect.y, badge_w, TAB_BAR_HEIGHT),
                        action: HeaderHitAction::GitBranch,
                    });
                    badge_right = badge_x - BADGE_GAP;
                }
            }

            // Directory badge
            if let Some(ref cwd) = pane.cwd {
                let dir_text = shorten_path(cwd);
                let icon = "\u{f07b} "; // folder icon
                let full_text = format!("{}{}", icon, dir_text);
                let badge_w = full_text.chars().count() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let badge_x = badge_right - badge_w;
                if badge_x > content_left + 40.0 {
                    let text_color = if pane.shell_idle { p.badge_text } else { p.badge_text_dimmed };
                    render_badge(renderer, badge_x, text_y, badge_w, cell_height, &full_text, text_color, p, rect);
                    zones.push(HeaderHitZone {
                        pane_id: id,
                        rect: Rect::new(badge_x, rect.y, badge_w, TAB_BAR_HEIGHT),
                        action: HeaderHitAction::Directory,
                    });
                    badge_right = badge_x - BADGE_GAP;
                }
            }

            // Title (terminal: use CWD last component or "Terminal N")
            let title = terminal_title(pane, id);
            let title_clip_w = (badge_right - content_left).max(0.0);
            let title_color = if is_focused { p.tab_text_focused } else { p.tab_text };
            let title_style = TextStyle {
                foreground: title_color,
                background: None,
                bold: is_focused,
                dim: false,
                italic: false,
                underline: false,
            };
            renderer.draw_chrome_text(
                &title,
                Vec2::new(content_left, text_y),
                title_style,
                Rect::new(content_left, rect.y, title_clip_w, TAB_BAR_HEIGHT),
            );
        }
        Some(PaneKind::Editor(ep)) => {
            // Editor pane: title + state badges (right-to-left)
            let mut badge_right = content_right;

            // Conflict badge with [compare] [overwrite] action buttons
            if ep.disk_changed && ep.editor.is_modified() && !ep.file_deleted {
                // [overwrite] button
                let ow_text = "overwrite";
                let ow_w = ow_text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let ow_x = badge_right - ow_w;
                if ow_x > content_left + 60.0 {
                    render_badge_colored(renderer, ow_x, text_y, ow_w, cell_height, ow_text, p.badge_text, p.conflict_bar_btn, BADGE_RADIUS);
                    zones.push(HeaderHitZone {
                        pane_id: id,
                        rect: Rect::new(ow_x, rect.y, ow_w, TAB_BAR_HEIGHT),
                        action: HeaderHitAction::EditorOverwrite,
                    });
                    badge_right = ow_x - BADGE_GAP;
                }

                // [compare] button
                let cmp_text = "compare";
                let cmp_w = cmp_text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let cmp_x = badge_right - cmp_w;
                if cmp_x > content_left + 60.0 {
                    render_badge_colored(renderer, cmp_x, text_y, cmp_w, cell_height, cmp_text, p.badge_text, p.conflict_bar_btn, BADGE_RADIUS);
                    zones.push(HeaderHitZone {
                        pane_id: id,
                        rect: Rect::new(cmp_x, rect.y, cmp_w, TAB_BAR_HEIGHT),
                        action: HeaderHitAction::EditorCompare,
                    });
                    badge_right = cmp_x - BADGE_GAP;
                }

                // "conflict" label
                let conf_text = "conflict";
                let conf_w = conf_text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let conf_x = badge_right - conf_w;
                if conf_x > content_left + 40.0 {
                    render_badge_colored(renderer, conf_x, text_y, conf_w, cell_height, conf_text, p.badge_conflict, p.badge_bg, BADGE_RADIUS);
                    badge_right = conf_x - BADGE_GAP;
                }
            }

            // Deleted badge
            if ep.file_deleted {
                let del_text = "deleted";
                let del_w = del_text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let del_x = badge_right - del_w;
                if del_x > content_left + 40.0 {
                    render_badge_colored(renderer, del_x, text_y, del_w, cell_height, del_text, p.badge_deleted, p.badge_bg, BADGE_RADIUS);
                    badge_right = del_x - BADGE_GAP;
                }
            }

            let title = crate::ui::pane_title(panes, id);
            let title_clip_w = (badge_right - content_left).max(0.0);
            let title_color = if is_focused { p.tab_text_focused } else { p.tab_text };
            let title_style = TextStyle {
                foreground: title_color,
                background: None,
                bold: is_focused,
                dim: false,
                italic: false,
                underline: false,
            };
            renderer.draw_chrome_text(
                &title,
                Vec2::new(content_left, text_y),
                title_style,
                Rect::new(content_left, rect.y, title_clip_w, TAB_BAR_HEIGHT),
            );
        }
        Some(PaneKind::Diff(dp)) => {
            // Diff pane: title + file count + stats + refresh badges
            let mut badge_right = content_right;

            // Refresh badge
            let refresh_text = "\u{f021}"; // refresh icon
            let refresh_w = refresh_text.chars().count() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
            let refresh_x = badge_right - refresh_w;
            if refresh_x > content_left + 60.0 {
                render_badge(renderer, refresh_x, text_y, refresh_w, cell_height, refresh_text, p.badge_text, p, rect);
                zones.push(HeaderHitZone {
                    pane_id: id,
                    rect: Rect::new(refresh_x, rect.y, refresh_w, TAB_BAR_HEIGHT),
                    action: HeaderHitAction::DiffRefresh,
                });
                badge_right = refresh_x - BADGE_GAP;
            }

            // Stats badge
            let (add, del) = dp.total_stats();
            if add > 0 || del > 0 {
                let stats_text = format!("+{} -{}", add, del);
                let stats_w = stats_text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let stats_x = badge_right - stats_w;
                if stats_x > content_left + 60.0 {
                    render_badge(renderer, stats_x, text_y, stats_w, cell_height, &stats_text, p.badge_text, p, rect);
                    badge_right = stats_x - BADGE_GAP;
                }
            }

            // File count badge
            if !dp.files.is_empty() {
                let count_text = format!("{} files", dp.files.len());
                let count_w = count_text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let count_x = badge_right - count_w;
                if count_x > content_left + 40.0 {
                    render_badge(renderer, count_x, text_y, count_w, cell_height, &count_text, p.badge_text, p, rect);
                    badge_right = count_x - BADGE_GAP;
                }
            }

            // Title
            let title = "Git Changes";
            let title_clip_w = (badge_right - content_left).max(0.0);
            let title_color = if is_focused { p.tab_text_focused } else { p.tab_text };
            let title_style = TextStyle {
                foreground: title_color,
                background: None,
                bold: is_focused,
                dim: false,
                italic: false,
                underline: false,
            };
            renderer.draw_chrome_text(
                title,
                Vec2::new(content_left, text_y),
                title_style,
                Rect::new(content_left, rect.y, title_clip_w, TAB_BAR_HEIGHT),
            );
        }
        None => {}
    }

    zones
}

/// Render a badge pill: rounded rect background + text.
fn render_badge(
    renderer: &mut WgpuRenderer,
    x: f32,
    text_y: f32,
    width: f32,
    cell_height: f32,
    text: &str,
    text_color: tide_core::Color,
    p: &ThemePalette,
    _parent_rect: Rect,
) {
    render_badge_colored(renderer, x, text_y, width, cell_height, text, text_color, p.badge_bg, BADGE_RADIUS);
}

/// Render a badge pill with custom background color.
fn render_badge_colored(
    renderer: &mut WgpuRenderer,
    x: f32,
    text_y: f32,
    width: f32,
    cell_height: f32,
    text: &str,
    text_color: tide_core::Color,
    bg_color: tide_core::Color,
    radius: f32,
) {
    let badge_y = text_y - 1.0;
    let badge_h = cell_height + 2.0;
    renderer.draw_chrome_rounded_rect(
        Rect::new(x, badge_y, width, badge_h),
        bg_color,
        radius,
    );
    let style = TextStyle {
        foreground: text_color,
        background: None,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
    };
    renderer.draw_chrome_text(
        text,
        Vec2::new(x + BADGE_PADDING_H, text_y),
        style,
        Rect::new(x, badge_y, width, badge_h),
    );
}

/// Generate title for a terminal pane from cached CWD.
fn terminal_title(pane: &crate::pane::TerminalPane, id: PaneId) -> String {
    if let Some(ref cwd) = pane.cwd {
        let components: Vec<_> = cwd.components().collect();
        if components.len() <= 2 {
            cwd.display().to_string()
        } else {
            let last_two: std::path::PathBuf =
                components[components.len() - 2..].iter().collect();
            last_two.display().to_string()
        }
    } else {
        format!("Terminal {}", id)
    }
}

/// Shorten a path for badge display: ~/foo/bar → ~/f/bar
fn shorten_path(path: &std::path::Path) -> String {
    let home = dirs::home_dir();
    let display = if let Some(ref home) = home {
        if let Ok(rel) = path.strip_prefix(home) {
            format!("~/{}", rel.display())
        } else {
            path.display().to_string()
        }
    } else {
        path.display().to_string()
    };

    // If too long, abbreviate middle components
    let parts: Vec<&str> = display.split('/').collect();
    if parts.len() <= 3 || display.len() <= 25 {
        return display;
    }
    // Keep first + last, abbreviate middle to first char
    let mut result = String::new();
    for (i, part) in parts.iter().enumerate() {
        if i > 0 {
            result.push('/');
        }
        if i == 0 || i == parts.len() - 1 {
            result.push_str(part);
        } else {
            // First char only
            if let Some(c) = part.chars().next() {
                result.push(c);
            }
        }
    }
    result
}
