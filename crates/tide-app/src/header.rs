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
#[derive(Debug, Clone, PartialEq)]
pub enum HeaderHitAction {
    Close,
    GitBranch,
    GitStatus,
    EditorCompare,
    EditorBack,
    EditorFileName,
    MarkdownPreview,
    DiffRefresh,
    Maximize,
    /// Click on a Dock TabGroup tab — switch to this pane.
    DockTab(tide_core::PaneId),
    /// Click on a Stage tab in stacked mode — switch zoomed pane.
    StageTab(tide_core::PaneId),
}

/// Badge specification for editor pane headers.
/// Computed by `editor_header_badges()` and consumed by both single-pane
/// and tab-bar rendering paths to ensure badge consistency.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct EditorBadge {
    pub text: String,
    pub action: Option<HeaderHitAction>,
}

/// Compute which right-side badges an editor pane should display.
/// This is the single source of truth — both `render_pane_header` and
/// `render_tab_bar` use this, preventing badge divergence between paths.
pub(crate) fn editor_header_badges(ep: &crate::editor_pane::EditorPane) -> Vec<EditorBadge> {
    let mut badges = Vec::new();

    // Markdown preview toggle
    if ep.is_markdown() && !ep.diff_mode {
        let text = if ep.preview_mode { "edit" } else { "preview" };
        badges.push(EditorBadge {
            text: text.to_string(),
            action: Some(HeaderHitAction::MarkdownPreview),
        });
    }

    // Diff mode back button
    if ep.diff_mode {
        badges.push(EditorBadge {
            text: "back".to_string(),
            action: Some(HeaderHitAction::EditorBack),
        });
    } else if ep.disk_changed && ep.editor.is_modified() && !ep.file_deleted {
        // Conflict: compare button + label
        badges.push(EditorBadge {
            text: "compare".to_string(),
            action: Some(HeaderHitAction::EditorCompare),
        });
        badges.push(EditorBadge {
            text: "conflict".to_string(),
            action: None,
        });
    }

    // Deleted badge
    if ep.file_deleted {
        badges.push(EditorBadge {
            text: "deleted".to_string(),
            action: None,
        });
    }

    badges
}

/// Render the header for a single pane.
/// Returns hit zones for click handling.
/// When `has_dock_tab_bar` is true, skips the title badge and pane-specific badges
/// because the dock tab bar already shows tab labels in the same header area.
pub fn render_pane_header(
    id: PaneId,
    rect: Rect,
    panes: &HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    _is_zoomed: bool,
    has_dock_tab_bar: bool,
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
) -> Vec<HeaderHitZone> {
    let mut zones = Vec::new();
    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let is_focused = focused == Some(id);

    let text_y = rect.y + (TAB_BAR_HEIGHT - cell_height) / 2.0;

    // Align content to header padding (matches Tide.pen padding: [0, 12])
    let content_left = rect.x + PANE_PADDING;
    let grid_cols = ((rect.width - 2.0 * PANE_PADDING) / cell_size.width).floor();
    let content_right = rect.x + PANE_PADDING + grid_cols * cell_size.width;

    // Badge colors based on focus state
    let badge_bg = if is_focused { p.badge_bg } else { p.badge_bg_unfocused };

    // Close button as bare icon (no badge background)
    let is_modified = match panes.get(&id) {
        Some(PaneKind::Editor(ep)) => ep.editor.is_modified(),
        _ => false,
    };
    let (close_icon_str, close_color) = if is_modified {
        ("\u{f111}", p.editor_modified) // filled circle
    } else {
        ("\u{f00d}", p.close_icon) // x icon with close_icon color
    };
    let close_w = cell_size.width + BADGE_PADDING_H * 2.0;
    let close_x = content_right - close_w;
    {
        let close_style = TextStyle {
            foreground: close_color,
            background: None,
            bold: false, dim: false, italic: false, underline: false,
        };
        renderer.draw_chrome_text(
            close_icon_str,
            Vec2::new(close_x + BADGE_PADDING_H, text_y),
            close_style,
            Rect::new(close_x, text_y - 1.0, close_w, cell_height + 2.0),
        );
    }
    zones.push(HeaderHitZone {
        pane_id: id,
        rect: Rect::new(close_x, rect.y, close_w, TAB_BAR_HEIGHT),
        action: HeaderHitAction::Close,
    });

    // Maximize button (expand icon, left of close)
    let max_w = cell_size.width + BADGE_PADDING_H * 2.0;
    let max_x = close_x - BADGE_GAP - max_w;
    {
        let max_style = TextStyle {
            foreground: p.close_icon,
            background: None,
            bold: false, dim: false, italic: false, underline: false,
        };
        renderer.draw_chrome_text(
            "\u{f065}", // expand icon
            Vec2::new(max_x + BADGE_PADDING_H, text_y),
            max_style,
            Rect::new(max_x, text_y - 1.0, max_w, cell_height + 2.0),
        );
    }
    zones.push(HeaderHitZone {
        pane_id: id,
        rect: Rect::new(max_x, rect.y, max_w, TAB_BAR_HEIGHT),
        action: HeaderHitAction::Maximize,
    });
    let mut badge_right = max_x - BADGE_GAP;
    let available_w = content_right - content_left;
    if available_w < 20.0 {
        return zones;
    }

    // When a dock tab bar is present, skip pane-specific title and badges
    // to avoid overlapping with the tab labels rendered below.
    if has_dock_tab_bar {
        return zones;
    }

    // Determine title and badges based on pane kind
    match panes.get(&id) {
        Some(PaneKind::Terminal(pane)) => {
            // Dead process badge
            if pane.context.child_dead {
                let dead_text = "exited";
                let dead_w = dead_text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let dead_x = badge_right - dead_w;
                if dead_x > content_left + 40.0 {
                    render_badge_colored(renderer, dead_x, text_y, dead_w, cell_height, dead_text, p.badge_deleted, badge_bg, BADGE_RADIUS);
                    badge_right = dead_x - BADGE_GAP;
                }
            }

            // Git status badge — green tinted, focused pane only (per Tide.pen)
            if is_focused {
                if let Some(ref git) = pane.context.git_info {
                    if git.status.changed_files > 0 {
                        let stat_text = format!(
                            "{} +{} -{}",
                            git.status.changed_files, git.status.additions, git.status.deletions
                        );
                        let stat_color = p.git_added;
                        let stat_bg = tide_core::Color::new(p.git_added.r, p.git_added.g, p.git_added.b, 0.094);
                        let badge_w = stat_text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                        let badge_x = badge_right - badge_w;
                        if badge_x > content_left + 60.0 {
                            render_badge_colored(renderer, badge_x, text_y, badge_w, cell_height, &stat_text, stat_color, stat_bg, BADGE_RADIUS);
                            zones.push(HeaderHitZone {
                                pane_id: id,
                                rect: Rect::new(badge_x, rect.y, badge_w, TAB_BAR_HEIGHT),
                                action: HeaderHitAction::GitStatus,
                            });
                            badge_right = badge_x - BADGE_GAP;
                        }
                    }
                }
            }

            // Combined git branch + worktree badge (single badge, popup handles switching)
            if let Some(ref git) = pane.context.git_info {
                let branch_display = if pane.context.worktree_count >= 2 {
                    format!("\u{e0a0} {}", git.branch)
                } else {
                    format!("\u{e0a0} {}", git.branch)
                };
                let branch_color = if is_focused { p.badge_git_branch } else { p.tab_text };
                let badge_w = branch_display.chars().count() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let badge_x = badge_right - badge_w;
                if badge_x > content_left + 60.0 {
                    render_badge_colored(renderer, badge_x, text_y, badge_w, cell_height, &branch_display, branch_color, badge_bg, BADGE_RADIUS);
                    zones.push(HeaderHitZone {
                        pane_id: id,
                        rect: Rect::new(badge_x, rect.y, badge_w, TAB_BAR_HEIGHT),
                        action: HeaderHitAction::GitBranch,
                    });
                    badge_right = badge_x - BADGE_GAP;
                }
            }

            // Title: plain text label (not a badge)
            let title = if let Some(ref cwd) = pane.context.cwd {
                let dir_name = cwd.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| cwd.display().to_string());
                dir_name
            } else {
                format!("Terminal {}", id)
            };
            let title_text_color = if !pane.context.shell_idle {
                p.badge_text_dimmed
            } else if is_focused {
                p.tab_text_focused
            } else {
                p.tab_text
            };
            let title_style = TextStyle {
                foreground: title_text_color,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            };
            let title_w = ((title.chars().count() as f32 + 1.0) * cell_size.width)
                .min(badge_right - content_left);
            if title_w > 20.0 {
                renderer.draw_chrome_text(
                    &title,
                    Vec2::new(content_left, text_y),
                    title_style,
                    Rect::new(content_left, rect.y, title_w, TAB_BAR_HEIGHT),
                );
            }
        }
        Some(PaneKind::Editor(ep)) => {
            // Right-side badges from shared logic
            for badge in editor_header_badges(ep) {
                let badge_w = badge.text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let badge_x = badge_right - badge_w;
                let min_x = if badge.text == "compare" { content_left + 60.0 } else { content_left + 40.0 };
                if badge_x > min_x {
                    let (text_color, bg) = match badge.action {
                        Some(HeaderHitAction::EditorBack) | Some(HeaderHitAction::EditorCompare) => {
                            (p.badge_text, p.conflict_bar_btn)
                        }
                        None if badge.text == "deleted" => (p.badge_deleted, badge_bg),
                        None if badge.text == "conflict" => (p.badge_conflict, badge_bg),
                        _ => {
                            let c = if is_focused { p.badge_text } else { p.tab_text };
                            (c, badge_bg)
                        }
                    };
                    render_badge_colored(renderer, badge_x, text_y, badge_w, cell_height, &badge.text, text_color, bg, BADGE_RADIUS);
                    if let Some(action) = badge.action {
                        zones.push(HeaderHitZone {
                            pane_id: id,
                            rect: Rect::new(badge_x, rect.y, badge_w, TAB_BAR_HEIGHT),
                            action,
                        });
                    }
                    badge_right = badge_x - BADGE_GAP;
                }
            }

            // Title badge: file icon + name (clickable for save-as on untitled)
            let file_name = ep.title();
            let icon = crate::ui::file_icon(&file_name, false, false);
            let title = format!("{} {}", icon, file_name);
            let title_color = if is_focused { p.badge_text } else { p.tab_text };
            let title_w = (title.chars().count() as f32 * cell_size.width + BADGE_PADDING_H * 2.0)
                .min(badge_right - content_left);
            if title_w > 20.0 {
                render_badge_colored(renderer, content_left, text_y, title_w, cell_height, &title, title_color, badge_bg, BADGE_RADIUS);
                zones.push(HeaderHitZone {
                    pane_id: id,
                    rect: Rect::new(content_left, rect.y, title_w, TAB_BAR_HEIGHT),
                    action: HeaderHitAction::EditorFileName,
                });
            }
        }
        Some(PaneKind::Browser(_bp)) => {
            // Browser panes render their own header via the nav bar; no header badges needed.
            let title = "Browser";
            let title_color = if is_focused { p.tab_text_focused } else { p.tab_text };
            let title_w = (title.chars().count() as f32 * cell_size.width + BADGE_PADDING_H * 2.0)
                .min(badge_right - content_left);
            if title_w > 20.0 {
                render_badge_colored(renderer, content_left, text_y, title_w, cell_height, title, title_color, badge_bg, BADGE_RADIUS);
            }
        }
        Some(PaneKind::Diff(dp)) => {
            let diff_text_color = if is_focused { p.badge_text } else { p.tab_text };
            // Refresh badge
            let refresh_text = "\u{f021}"; // refresh icon
            let refresh_w = refresh_text.chars().count() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
            let refresh_x = badge_right - refresh_w;
            if refresh_x > content_left + 60.0 {
                render_badge_colored(renderer, refresh_x, text_y, refresh_w, cell_height, refresh_text, diff_text_color, badge_bg, BADGE_RADIUS);
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
                    render_badge_colored(renderer, stats_x, text_y, stats_w, cell_height, &stats_text, diff_text_color, badge_bg, BADGE_RADIUS);
                    badge_right = stats_x - BADGE_GAP;
                }
            }

            // File count badge
            if !dp.files.is_empty() {
                let count_text = format!("{} files", dp.files.len());
                let count_w = count_text.len() as f32 * cell_size.width + BADGE_PADDING_H * 2.0;
                let count_x = badge_right - count_w;
                if count_x > content_left + 40.0 {
                    render_badge_colored(renderer, count_x, text_y, count_w, cell_height, &count_text, diff_text_color, badge_bg, BADGE_RADIUS);
                    badge_right = count_x - BADGE_GAP;
                }
            }

            // Title badge
            let title = "Git Changes";
            let title_w = (title.chars().count() as f32 * cell_size.width + BADGE_PADDING_H * 2.0)
                .min(badge_right - content_left);
            if title_w > 20.0 {
                render_badge_colored(renderer, content_left, text_y, title_w, cell_height, title, diff_text_color, badge_bg, BADGE_RADIUS);
            }
        }
        Some(PaneKind::Launcher(_)) => {
            let title = "New Tab";
            let title_color = if is_focused { p.tab_text_focused } else { p.tab_text };
            let title_w = (title.chars().count() as f32 * cell_size.width + BADGE_PADDING_H * 2.0)
                .min(badge_right - content_left);
            if title_w > 20.0 {
                render_badge_colored(renderer, content_left, text_y, title_w, cell_height, title, title_color, badge_bg, BADGE_RADIUS);
            }
        }
        None => {}
    }

    zones
}

/// Render a dock TabGroup tab bar inside a pane's header.
/// Shows tab labels for all tabs in the group; the active tab is highlighted.
/// Includes close/maximize buttons on the right side.
/// Returns hit zones for tab clicks.
pub fn render_dock_tab_bar(
    pane_id: PaneId,
    rect: Rect,
    tab_group: &tide_layout::TabGroup,
    panes: &HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
) -> Vec<HeaderHitZone> {
    render_tab_bar_impl(pane_id, rect, &tab_group.tabs, tab_group.active_pane(), panes, focused, p, renderer, true, false)
}

/// Shared tab bar rendering for both Dock and Stage stacked mode.
/// `is_dock` determines the hit action type (DockTab vs StageTab).
/// `is_stacked` true = zoomed/stacked mode (layers icon + bottom border),
///              false = tab group within split (per-tab underline).
fn render_tab_bar_impl(
    pane_id: PaneId,
    rect: Rect,
    tab_ids: &[PaneId],
    active_pane: PaneId,
    panes: &HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
    is_dock: bool,
    is_stacked: bool,
) -> Vec<HeaderHitZone> {
    let mut zones = Vec::new();
    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let cell_w = cell_size.width;
    let is_focused = focused == Some(pane_id);

    // Tab bar vertically centered in header (same position as title text)
    let tab_h = cell_height + 4.0;
    let tab_y = rect.y + (TAB_BAR_HEIGHT - tab_h) / 2.0;
    let mut content_left = rect.x + PANE_PADDING;
    let grid_cols = ((rect.width - 2.0 * PANE_PADDING) / cell_w).floor();
    let content_right = rect.x + PANE_PADDING + grid_cols * cell_w;

    // Stacked mode: render layers icon and bottom border line
    if is_stacked {
        let icon = "\u{f24d}"; // fa-clone (stacked layers)
        let icon_y = rect.y + (TAB_BAR_HEIGHT - cell_height) / 2.0;
        let icon_color = p.tab_text; // subtle gray, no background

        renderer.draw_chrome_text(
            icon,
            Vec2::new(content_left, icon_y),
            TextStyle { foreground: icon_color, background: None, bold: false, dim: false, italic: false, underline: false },
            Rect::new(content_left, rect.y, cell_w + 4.0, TAB_BAR_HEIGHT),
        );
        content_left += cell_w + 6.0;

        // Full-width bottom border
        let line_color = if is_focused { p.dock_tab_underline } else { p.border_color };
        renderer.draw_chrome_rect(
            Rect::new(rect.x + PANE_PADDING, rect.y + TAB_BAR_HEIGHT - 1.0, rect.width - PANE_PADDING * 2.0, 1.0),
            line_color,
        );
    }

    if content_right - content_left < 40.0 {
        return zones;
    }

    // Close button (rightmost)
    let text_y = rect.y + (TAB_BAR_HEIGHT - cell_height) / 2.0;
    let is_modified = match panes.get(&active_pane) {
        Some(PaneKind::Editor(ep)) => ep.editor.is_modified(),
        _ => false,
    };
    let (close_icon, close_color) = if is_modified {
        ("\u{f111}", p.editor_modified)
    } else {
        ("\u{f00d}", p.close_icon)
    };
    let btn_w = cell_w + BADGE_PADDING_H * 2.0;
    let close_x = content_right - btn_w;
    renderer.draw_chrome_text(
        close_icon,
        Vec2::new(close_x + BADGE_PADDING_H, text_y),
        TextStyle { foreground: close_color, background: None, bold: false, dim: false, italic: false, underline: false },
        Rect::new(close_x, text_y - 1.0, btn_w, cell_height + 2.0),
    );
    zones.push(HeaderHitZone {
        pane_id: active_pane,
        rect: Rect::new(close_x, rect.y, btn_w, TAB_BAR_HEIGHT),
        action: HeaderHitAction::Close,
    });

    // Maximize button (left of close)
    let max_x = close_x - BADGE_GAP - btn_w;
    renderer.draw_chrome_text(
        "\u{f065}",
        Vec2::new(max_x + BADGE_PADDING_H, text_y),
        TextStyle { foreground: p.close_icon, background: None, bold: false, dim: false, italic: false, underline: false },
        Rect::new(max_x, text_y - 1.0, btn_w, cell_height + 2.0),
    );
    zones.push(HeaderHitZone {
        pane_id: active_pane,
        rect: Rect::new(max_x, rect.y, btn_w, TAB_BAR_HEIGHT),
        action: HeaderHitAction::Maximize,
    });

    // Editor badges for the active pane (e.g., markdown preview toggle)
    let mut badge_right = max_x - BADGE_GAP;
    if is_dock {
        if let Some(PaneKind::Editor(ep)) = panes.get(&active_pane) {
            let badge_bg = if is_focused { p.badge_bg } else { p.badge_bg_unfocused };
            for badge in editor_header_badges(ep) {
                let badge_w = badge.text.len() as f32 * cell_w + BADGE_PADDING_H * 2.0;
                let badge_x = badge_right - badge_w;
                if badge_x < content_left + 40.0 {
                    break;
                }
                let (text_color, bg) = match badge.action {
                    Some(HeaderHitAction::EditorBack) | Some(HeaderHitAction::EditorCompare) => {
                        (p.badge_text, p.conflict_bar_btn)
                    }
                    None if badge.text == "deleted" => (p.badge_deleted, badge_bg),
                    None if badge.text == "conflict" => (p.badge_conflict, badge_bg),
                    _ => {
                        let c = if is_focused { p.badge_text } else { p.tab_text };
                        (c, badge_bg)
                    }
                };
                render_badge_colored(renderer, badge_x, text_y, badge_w, cell_height, &badge.text, text_color, bg, BADGE_RADIUS);
                if let Some(action) = badge.action {
                    zones.push(HeaderHitZone {
                        pane_id: active_pane,
                        rect: Rect::new(badge_x, rect.y, badge_w, TAB_BAR_HEIGHT),
                        action,
                    });
                }
                badge_right = badge_x - BADGE_GAP;
            }
        }
    }

    let tabs_right = badge_right;
    let max_tabs_w = tabs_right - content_left;
    if max_tabs_w < 40.0 {
        return zones;
    }

    // Compute tab labels and widths
    let tab_gap = 2.0_f32;
    let tab_pad = 8.0_f32;
    let mut tabs_info: Vec<(PaneId, String, f32)> = Vec::new();
    for &tid in tab_ids {
        let label = dock_tab_label(panes, tid);
        let w = label.chars().count() as f32 * cell_w + tab_pad * 2.0;
        tabs_info.push((tid, label, w));
    }

    let total_w: f32 = tabs_info.iter().map(|(_, _, w)| *w + tab_gap).sum::<f32>() - tab_gap;
    let scale = if total_w > max_tabs_w { max_tabs_w / total_w } else { 1.0 };

    let mut cx = content_left;
    for (tid, label, w) in &tabs_info {
        let tw = (*w * scale).max(cell_w * 2.0);
        if cx + tw > tabs_right + 1.0 {
            break;
        }

        let is_active = *tid == active_pane;
        let is_focused_tab = focused == Some(*tid);
        let tab_rect = Rect::new(cx, tab_y, tw, tab_h);

        if is_active {
            let bg = if is_focused { p.badge_bg } else { p.badge_bg_unfocused };
            renderer.draw_chrome_rounded_rect(tab_rect, bg, 3.0);
            if !is_stacked {
                // Per-tab underline for tab groups only (stacked uses full-width line)
                renderer.draw_chrome_rect(
                    Rect::new(cx + 2.0, tab_y + tab_h - 2.0, tw - 4.0, 2.0),
                    p.dock_tab_underline,
                );
            }
        }

        let text_color = if is_focused_tab || is_active {
            p.tab_text_focused
        } else {
            p.tab_text
        };
        let label_y = tab_y + (tab_h - cell_height) / 2.0;
        let max_chars = ((tw - tab_pad * 2.0) / cell_w).floor() as usize;
        let display: String = label.chars().take(max_chars).collect();
        renderer.draw_chrome_text(
            &display,
            Vec2::new(cx + tab_pad, label_y),
            TextStyle {
                foreground: text_color,
                background: None,
                bold: is_active,
                dim: false, italic: false, underline: false,
            },
            tab_rect,
        );

        let action = if is_dock {
            HeaderHitAction::DockTab(*tid)
        } else {
            HeaderHitAction::StageTab(*tid)
        };
        zones.push(HeaderHitZone {
            pane_id: pane_id,
            rect: Rect::new(cx, rect.y, tw, TAB_BAR_HEIGHT),
            action,
        });

        cx += tw + tab_gap;
    }

    zones
}

/// Render a Stage stacked-mode tab bar showing all Stage terminals.
pub fn render_stage_tab_bar(
    zoomed_pane: PaneId,
    rect: Rect,
    stage_pane_ids: &[PaneId],
    panes: &HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
) -> Vec<HeaderHitZone> {
    if stage_pane_ids.len() < 2 {
        return Vec::new();
    }
    render_tab_bar_impl(zoomed_pane, rect, stage_pane_ids, zoomed_pane, panes, focused, p, renderer, false, true)
}

/// Get a short label for a pane in a dock tab bar.
fn dock_tab_label(panes: &HashMap<PaneId, PaneKind>, id: PaneId) -> String {
    match panes.get(&id) {
        Some(PaneKind::Terminal(tp)) => {
            // Use CWD directory name (matches the per-pane header title)
            if let Some(ref cwd) = tp.context.cwd {
                cwd.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| cwd.display().to_string())
            } else {
                format!("Terminal {}", id)
            }
        }
        Some(PaneKind::Editor(ep)) => ep.title(),
        Some(PaneKind::Browser(_)) => "Browser".to_string(),
        Some(PaneKind::Diff(_)) => "Changes".to_string(),
        Some(PaneKind::Launcher(_)) => "New Tab".to_string(),
        None => format!("Pane {}", id),
    }
}

/// Render a badge pill with custom background color.
pub(crate) fn render_badge_colored(
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use tide_core::PaneId;
    use crate::editor_pane::EditorPane;

    fn make_editor(id: PaneId) -> EditorPane {
        EditorPane::new_empty(id)
    }

    fn make_markdown_editor(id: PaneId) -> EditorPane {
        let mut ep = make_editor(id);
        ep.editor.buffer.file_path = Some(PathBuf::from("README.md"));
        ep
    }

    #[test]
    fn plain_file_no_badges() {
        let ep = make_editor(1);
        let badges = editor_header_badges(&ep);
        assert!(badges.is_empty());
    }

    #[test]
    fn markdown_shows_preview_badge() {
        let ep = make_markdown_editor(1);
        let badges = editor_header_badges(&ep);
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "preview");
        assert_eq!(badges[0].action, Some(HeaderHitAction::MarkdownPreview));
    }

    #[test]
    fn markdown_preview_mode_shows_edit_badge() {
        let mut ep = make_markdown_editor(1);
        ep.preview_mode = true;
        let badges = editor_header_badges(&ep);
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "edit");
        assert_eq!(badges[0].action, Some(HeaderHitAction::MarkdownPreview));
    }

    #[test]
    fn markdown_diff_mode_shows_back_not_preview() {
        let mut ep = make_markdown_editor(1);
        ep.diff_mode = true;
        let badges = editor_header_badges(&ep);
        // diff_mode suppresses preview badge, shows back instead
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "back");
        assert_eq!(badges[0].action, Some(HeaderHitAction::EditorBack));
    }

    #[test]
    fn diff_mode_shows_back_badge() {
        let mut ep = make_editor(1);
        ep.diff_mode = true;
        let badges = editor_header_badges(&ep);
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "back");
        assert_eq!(badges[0].action, Some(HeaderHitAction::EditorBack));
    }

    #[test]
    fn conflict_shows_compare_and_label() {
        let mut ep = make_editor(1);
        ep.disk_changed = true;
        // Make the editor modified by inserting text
        ep.editor.handle_action(tide_editor::EditorActionKind::InsertChar('x'));
        assert!(ep.editor.is_modified());
        let badges = editor_header_badges(&ep);
        assert_eq!(badges.len(), 2);
        assert_eq!(badges[0].text, "compare");
        assert_eq!(badges[0].action, Some(HeaderHitAction::EditorCompare));
        assert_eq!(badges[1].text, "conflict");
        assert_eq!(badges[1].action, None);
    }

    #[test]
    fn file_deleted_shows_deleted_badge() {
        let mut ep = make_editor(1);
        ep.file_deleted = true;
        let badges = editor_header_badges(&ep);
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "deleted");
        assert_eq!(badges[0].action, None);
    }

    #[test]
    fn deleted_and_conflict_skips_conflict_when_deleted() {
        let mut ep = make_editor(1);
        ep.disk_changed = true;
        ep.file_deleted = true;
        ep.editor.handle_action(tide_editor::EditorActionKind::InsertChar('x'));
        let badges = editor_header_badges(&ep);
        // file_deleted suppresses the compare/conflict badges (condition: !ep.file_deleted)
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "deleted");
    }

    #[test]
    fn diff_mode_suppresses_conflict() {
        let mut ep = make_editor(1);
        ep.diff_mode = true;
        ep.disk_changed = true;
        ep.editor.handle_action(tide_editor::EditorActionKind::InsertChar('x'));
        let badges = editor_header_badges(&ep);
        // diff_mode takes priority over conflict
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "back");
    }

    #[test]
    fn markdown_extensions_all_recognized() {
        for ext in &["md", "markdown", "mdown", "mkd"] {
            let mut ep = make_editor(1);
            ep.editor.buffer.file_path = Some(PathBuf::from(format!("file.{}", ext)));
            let badges = editor_header_badges(&ep);
            assert!(!badges.is_empty(), "expected badge for .{} file", ext);
            assert_eq!(badges[0].text, "preview");
        }
    }
}

