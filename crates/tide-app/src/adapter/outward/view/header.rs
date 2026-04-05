// Per-pane header rendering: title + close button + kind-specific badges.

use std::collections::HashMap;

use crate::tide_core::{PaneId, Rect, Renderer, TextStyle, Vec2};
use crate::tide_renderer::WgpuRenderer;

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
    DockTab(crate::tide_core::PaneId),
    /// Click on a Stage tab in stacked mode — switch zoomed pane.
    StageTab(crate::tide_core::PaneId),
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
pub(crate) fn editor_header_badges(ep: &crate::pane::editor::EditorPane) -> Vec<EditorBadge> {
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

/// Compute badges for the active tab in a tab bar (works for all pane kinds).
fn active_tab_badges(panes: &HashMap<PaneId, PaneKind>, id: &PaneId) -> Vec<EditorBadge> {
    match panes.get(id) {
        Some(PaneKind::Editor(ep)) => editor_header_badges(ep),
        Some(PaneKind::Terminal(tp)) => {
            let mut badges = Vec::new();
            if let Some(ref git) = tp.context.git_info {
                badges.push(EditorBadge {
                    text: format!("\u{e0a0} {}", git.branch),
                    action: Some(HeaderHitAction::GitBranch),
                });
                if git.status.changed_files > 0 {
                    badges.push(EditorBadge {
                        text: format!("{} +{} -{}", git.status.changed_files, git.status.additions, git.status.deletions),
                        action: Some(HeaderHitAction::GitStatus),
                    });
                }
            }
            if tp.context.child_dead {
                badges.push(EditorBadge {
                    text: "exited".to_string(),
                    action: None,
                });
            }
            badges
        }
        _ => Vec::new(),
    }
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
    render_pane_header_inner(id, rect, panes, focused, _is_zoomed, has_dock_tab_bar, p, renderer, None, None)
}

pub fn render_pane_header_inner(
    id: PaneId,
    rect: Rect,
    panes: &HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    _is_zoomed: bool,
    has_dock_tab_bar: bool,
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
    agent_status: Option<crate::state::gateway_status::AgentStatus>,
    blink_time: Option<f64>,
) -> Vec<HeaderHitZone> {
    let mut zones = Vec::new();
    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let cell_w = cell_size.width;
    let is_focused = focused == Some(id);

    let text_y = rect.y + (TAB_BAR_HEIGHT - cell_height) / 2.0;

    // When a dock tab bar is present, skip pane-specific title and badges
    if has_dock_tab_bar {
        return zones;
    }

    let available_w = rect.width;
    if available_w < 20.0 {
        return zones;
    }

    // Badge colors based on focus state
    let badge_bg = if is_focused { p.badge_bg } else { p.badge_bg_unfocused };

    // Active tab bg + accent line drawn AFTER computing tab width (see below)

    // --- Build content: [pad 6] [dot?] [icon 14x14] [gap 6] [title...] [spacer] [badges...] [close 16x16 (9px icon)] [pad 6] ---
    let mut cx = rect.x + TAB_H_PAD;

    // Agent status dot
    if let Some(status) = agent_status {
        use crate::state::gateway_status::AgentStatus;
        let mut dot_color = match status {
            AgentStatus::Running => crate::tide_core::Color::new(0.3, 0.8, 0.4, 1.0),
            AgentStatus::Idle => crate::tide_core::Color::new(0.3, 0.8, 0.4, 0.6),
            AgentStatus::NeedsInput => crate::tide_core::Color::new(0.95, 0.65, 0.2, 1.0),
        };
        if matches!(status, AgentStatus::NeedsInput) && !is_focused {
            if let Some(t) = blink_time {
                let opacity = 0.65 + 0.35 * (t * crate::theme::AGENT_BLINK_FREQUENCY).sin() as f32;
                dot_color.a = opacity;
            }
        }
        let dot_size = 6.0_f32;
        let dot_y = rect.y + (TAB_BAR_HEIGHT - dot_size) / 2.0;
        renderer.draw_chrome_rounded_rect(
            Rect::new(cx, dot_y, dot_size, dot_size),
            dot_color, dot_size / 2.0,
        );
        if matches!(status, AgentStatus::NeedsInput) {
            let glow = crate::tide_core::Color::new(dot_color.r, dot_color.g, dot_color.b, 0.3 * dot_color.a);
            renderer.draw_chrome_rounded_rect(
                Rect::new(cx - 2.0, dot_y - 2.0, dot_size + 4.0, dot_size + 4.0),
                glow, (dot_size + 4.0) / 2.0,
            );
        }
        cx += dot_size + TAB_CONTENT_SPACING;
    }

    // Collect inline badges
    let mut inline_badges: Vec<(String, crate::tide_core::Color, crate::tide_core::Color, Option<HeaderHitAction>)> = Vec::new();

    // Determine title and collect badges based on pane kind
    let (title, title_color) = match panes.get(&id) {
        Some(PaneKind::Terminal(pane)) => {
            let t = if let Some(ref cwd) = pane.context.cwd {
                cwd.file_name().map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| cwd.display().to_string())
            } else {
                format!("Terminal {}", id)
            };
            let c = if !pane.context.shell_idle {
                p.badge_text_dimmed
            } else if is_focused { p.tab_text_focused } else { p.tab_text };

            if let Some(ref git) = pane.context.git_info {
                let branch_display = format!("\u{e0a0} {}", git.branch);
                let branch_color = if is_focused { p.badge_git_branch } else { p.tab_text };
                inline_badges.push((branch_display, branch_color, badge_bg, Some(HeaderHitAction::GitBranch)));

                if git.status.changed_files > 0 {
                    let stat_text = format!("{} +{} -{}", git.status.changed_files, git.status.additions, git.status.deletions);
                    let stat_bg = crate::tide_core::Color::new(p.git_added.r, p.git_added.g, p.git_added.b, 0.094);
                    inline_badges.push((stat_text, p.git_added, stat_bg, Some(HeaderHitAction::GitStatus)));
                }
            }
            if pane.context.child_dead {
                inline_badges.push(("exited".to_string(), p.badge_deleted, badge_bg, None));
            }
            (t, c)
        }
        Some(PaneKind::Editor(ep)) => {
            let file_name = ep.title();
            let icon = crate::ui::file_icon(&file_name, false, false);
            let t = format!("{} {}", icon, file_name);
            let c = if is_focused { p.badge_text } else { p.tab_text };
            for badge in editor_header_badges(ep) {
                let (text_color, bg) = match badge.action {
                    Some(HeaderHitAction::EditorBack) | Some(HeaderHitAction::EditorCompare) =>
                        (p.badge_text, p.conflict_bar_btn),
                    None if badge.text == "deleted" => (p.badge_deleted, badge_bg),
                    None if badge.text == "conflict" => (p.badge_conflict, badge_bg),
                    _ => {
                        let cc = if is_focused { p.badge_text } else { p.tab_text };
                        (cc, badge_bg)
                    }
                };
                inline_badges.push((badge.text.clone(), text_color, bg, badge.action.clone()));
            }
            (t, c)
        }
        Some(PaneKind::Browser(_bp)) => {
            let t = _bp.title();
            let c = if is_focused { p.tab_text_focused } else { p.tab_text };
            (t, c)
        }
        Some(PaneKind::Diff(dp)) => {
            let c = if is_focused { p.badge_text } else { p.tab_text };
            let (add, del) = dp.total_stats();
            if add > 0 || del > 0 {
                inline_badges.push((format!("+{} -{}", add, del), c, badge_bg, None));
            }
            if !dp.files.is_empty() {
                inline_badges.push((format!("{} files", dp.files.len()), c, badge_bg, None));
            }
            inline_badges.push(("\u{f021}".to_string(), c, badge_bg, Some(HeaderHitAction::DiffRefresh)));
            ("Git Changes".to_string(), c)
        }
        Some(PaneKind::Launcher(_)) => {
            let c = if is_focused { p.tab_text_focused } else { p.tab_text };
            ("New Tab".to_string(), c)
        }
        None => { return zones; }
    };

    // Close icon config
    let close_icon_w = TAB_CLOSE_ICON_SIZE;
    let close_hit_size = 16.0_f32;
    let is_modified = match panes.get(&id) {
        Some(PaneKind::Editor(ep)) => ep.editor.is_modified(),
        _ => false,
    };
    let (close_icon_str, close_color) = if is_modified {
        ("\u{f111}", p.editor_modified)
    } else {
        ("\u{f00d}", p.close_icon)
    };

    // Compute badge total width
    let badge_gap = 4.0_f32;
    let mut total_badge_w = 0.0_f32;
    for (text, _, _, _) in &inline_badges {
        total_badge_w += text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0 + badge_gap;
    }

    // Compute COMPACT tab width: [pad] [dot?] [title] [gap] [badges] [close 16] [pad]
    let dot_w = if agent_status.is_some() { 6.0 + TAB_CONTENT_SPACING } else { 0.0 };
    let title_w_raw = title.chars().count() as f32 * cell_w;
    let compact_tab_w = (TAB_H_PAD + dot_w + title_w_raw + badge_gap + total_badge_w + close_hit_size + TAB_H_PAD)
        .clamp(TAB_MIN_WIDTH, TAB_MAX_WIDTH);

    // Draw compact active tab bg + bottom accent line (VS Code style)
    renderer.draw_chrome_rect(
        Rect::new(rect.x, rect.y, compact_tab_w, TAB_BAR_HEIGHT),
        p.active_tab_bg,
    );
    // Reset area beyond compact tab to unfocused tab bar bg
    // (render_pane_chrome draws tab_bar_bg_focused across the full width)
    if compact_tab_w < available_w {
        renderer.draw_chrome_rect(
            Rect::new(rect.x + compact_tab_w, rect.y, available_w - compact_tab_w, TAB_BAR_HEIGHT),
            p.tab_bar_bg,
        );
    }
    renderer.draw_chrome_rect(
        Rect::new(rect.x, rect.y + TAB_BAR_HEIGHT - TAB_ACTIVE_INDICATOR_HEIGHT, compact_tab_w, TAB_ACTIVE_INDICATOR_HEIGHT),
        p.border_focused,
    );

    // Position close icon relative to compact tab width
    let close_hit_x = rect.x + compact_tab_w - TAB_H_PAD - close_hit_size;
    let close_icon_x = close_hit_x + (close_hit_size - close_icon_w) / 2.0;
    let close_icon_y = rect.y + (TAB_BAR_HEIGHT - close_icon_w) / 2.0;

    // Title: fill space between cx and close
    let title_max_w = (close_hit_x - badge_gap - total_badge_w - cx).max(20.0);
    let title_w = title_w_raw.min(title_max_w);

    // Draw title text
    let title_style = TextStyle {
        foreground: title_color,
        background: None,
        bold: false, dim: false, italic: false, underline: false,
    };
    renderer.draw_chrome_text(
        &title,
        Vec2::new(cx, text_y),
        title_style,
        Rect::new(cx, text_y, title_w, cell_height),
    );
    // Editor file name hit zone
    if matches!(panes.get(&id), Some(PaneKind::Editor(_))) {
        zones.push(HeaderHitZone {
            pane_id: id,
            rect: Rect::new(cx, rect.y, title_w, TAB_BAR_HEIGHT),
            action: HeaderHitAction::EditorFileName,
        });
    }
    cx += title_w + badge_gap;

    // Draw inline badges
    for (text, text_color, bg, action) in &inline_badges {
        let bw = text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0;
        if cx + bw > close_hit_x - badge_gap { break; }
        render_badge_colored(renderer, cx, text_y, bw, cell_height, text, *text_color, *bg, 3.0);
        if let Some(act) = action {
            zones.push(HeaderHitZone {
                pane_id: id,
                rect: Rect::new(cx, rect.y, bw, TAB_BAR_HEIGHT),
                action: act.clone(),
            });
        }
        cx += bw + badge_gap;
    }

    // Draw close icon centered in hit area
    let close_text_x = close_hit_x + (close_hit_size - cell_w) / 2.0;
    let close_text_y = rect.y + (TAB_BAR_HEIGHT - cell_height) / 2.0;
    let close_style = TextStyle {
        foreground: close_color,
        background: None,
        bold: false, dim: false, italic: false, underline: false,
    };
    renderer.draw_chrome_text(
        close_icon_str,
        Vec2::new(close_text_x, close_text_y),
        close_style,
        Rect::new(close_hit_x, rect.y, close_hit_size, TAB_BAR_HEIGHT),
    );
    zones.push(HeaderHitZone {
        pane_id: id,
        rect: Rect::new(close_hit_x, rect.y, close_hit_size, TAB_BAR_HEIGHT),
        action: HeaderHitAction::Close,
    });

    zones
}

/// Render a dock TabGroup tab bar inside a pane's header.
/// Shows tab labels for all tabs in the group; the active tab is highlighted.
/// Includes close/maximize buttons on the right side.
/// Returns hit zones for tab clicks.
pub fn render_dock_tab_bar(
    pane_id: PaneId,
    rect: Rect,
    tab_group: &crate::tide_layout::TabGroup,
    panes: &HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    pinned_ids: &[PaneId],
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
) -> Vec<HeaderHitZone> {
    render_tab_bar_impl(pane_id, rect, &tab_group.tabs, tab_group.active_pane(), panes, focused, pinned_ids, p, renderer, true, false, detected_agents, blink_time, tab_scroll_offset)
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
    pinned_ids: &[PaneId],
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
    is_dock: bool,
    is_stacked: bool,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
) -> Vec<HeaderHitZone> {
    let mut zones = Vec::new();
    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let cell_w = cell_size.width;
    let is_focused = focused == Some(pane_id);

    // Tab height = TAB_BAR_HEIGHT (fills entire bar)
    let tab_h = TAB_BAR_HEIGHT;
    let tab_y = rect.y;
    let mut content_left = rect.x;
    let content_right = rect.x + rect.width;

    // Stacked mode: render layers icon with left padding
    if is_stacked {
        content_left += TAB_H_PAD; // breathing room before icon
        let icon = "\u{f24d}"; // fa-clone (stacked layers)
        let icon_y = rect.y + (TAB_BAR_HEIGHT - cell_height) / 2.0;
        let icon_color = p.tab_text;

        renderer.draw_chrome_text(
            icon,
            Vec2::new(content_left, icon_y),
            TextStyle { foreground: icon_color, background: None, bold: false, dim: false, italic: false, underline: false },
            Rect::new(content_left, rect.y, cell_w + 4.0, TAB_BAR_HEIGHT),
        );
        content_left += cell_w + 6.0;
    }

    if content_right - content_left < 40.0 {
        return zones;
    }

    // Badges are shown on the active tab only (editor badges like edit/preview)

    let tabs_right = content_right;
    let max_tabs_w = tabs_right - content_left;
    if max_tabs_w < 40.0 {
        return zones;
    }

    // Compute tab labels and widths
    // Layout per tab: [pad 6] [dot?] [icon?] [gap 6] [title...] [spacer] [badges?] [close 16x16 (9px)] [pad 6]
    let close_hit_size = 16.0_f32;
    let close_icon_width = TAB_CLOSE_ICON_SIZE;
    let badge_gap = 4.0_f32;
    let mut tabs_info: Vec<(PaneId, String, f32)> = Vec::new();
    for &tid in tab_ids {
        let mut label = dock_tab_label(panes, tid);
        if pinned_ids.contains(&tid) {
            label = format!("\u{f08d} {}", label);
        }
        let mut w = label.chars().count() as f32 * cell_w + TAB_H_PAD * 2.0 + close_hit_size + TAB_CONTENT_SPACING;
        // Add badge width for the active tab only
        if tid == active_pane {
            let badges = active_tab_badges(panes, &tid);
            for badge in &badges {
                w += badge.text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0 + badge_gap;
            }
        }
        // Active tab: no max clamp so title + badges fit; right-edge clipping handles overflow
        if tid == active_pane {
            w = w.max(TAB_MIN_WIDTH);
        } else {
            w = w.clamp(TAB_MIN_WIDTH, TAB_MAX_WIDTH);
        }
        tabs_info.push((tid, label, w));
    }

    // Clipping rect for the tab content area
    let tab_clip = Rect::new(content_left, tab_y, tabs_right - content_left, tab_h);

    // Compute total tabs width for scroll clamping
    let total_tabs_w: f32 = tabs_info.iter().map(|(_, _, w)| *w).sum();
    let visible_w = tabs_right - content_left;
    let max_scroll = (total_tabs_w - visible_w).max(0.0);

    // Clamp scroll offset to valid range (no auto-scroll — user controls scroll position)
    let effective_scroll = tab_scroll_offset.clamp(0.0, max_scroll);

    let mut cx = content_left - effective_scroll;
    for (tid, label, w) in &tabs_info {
        let tw = *w;

        // Skip tabs entirely off-screen to the left
        if cx + tw <= content_left {
            cx += tw;
            continue;
        }
        // Stop if tab starts entirely past the right edge
        if cx >= tabs_right {
            break;
        }

        let is_active = *tid == active_pane;
        let is_focused_tab = focused == Some(*tid);

        // Active tab: subtle lighter background + 2px accent line at bottom (VS Code style)
        if is_active {
            let bg_rect = Rect::new(cx, tab_y, tw, TAB_BAR_HEIGHT).clip_to(&tab_clip);
            if bg_rect.width > 0.0 {
                renderer.draw_chrome_rect(bg_rect, p.active_tab_bg);
            }
            let accent_rect = Rect::new(cx, tab_y + TAB_BAR_HEIGHT - TAB_ACTIVE_INDICATOR_HEIGHT, tw, TAB_ACTIVE_INDICATOR_HEIGHT)
                .clip_to(&tab_clip);
            if accent_rect.width > 0.0 {
                renderer.draw_chrome_rect(accent_rect, p.border_focused);
            }
        }

        // Agent status dot
        let mut dot_offset = 0.0_f32;
        if let Some(agent) = detected_agents.get(tid) {
            if let Some(status) = agent.status {
                use crate::state::gateway_status::AgentStatus;
                let mut dot_color = match status {
                    AgentStatus::Running => crate::tide_core::Color::new(0.3, 0.8, 0.4, 1.0),
                    AgentStatus::Idle => crate::tide_core::Color::new(0.3, 0.8, 0.4, 0.6),
                    AgentStatus::NeedsInput => crate::tide_core::Color::new(0.95, 0.65, 0.2, 1.0),
                };
                if matches!(status, AgentStatus::NeedsInput) && !is_focused_tab {
                    if let Some(t) = blink_time {
                        dot_color.a = 0.65 + 0.35 * (t * crate::theme::AGENT_BLINK_FREQUENCY).sin() as f32;
                    }
                }
                let dot_size = 6.0_f32;
                let dot_x = cx + TAB_H_PAD;
                let dot_y = tab_y + (tab_h - dot_size) / 2.0;
                let dot_rect = Rect::new(dot_x, dot_y, dot_size, dot_size).clip_to(&tab_clip);
                if dot_rect.width > 0.0 && dot_rect.height > 0.0 {
                    renderer.draw_chrome_rounded_rect(dot_rect, dot_color, dot_size / 2.0);
                }
                dot_offset = dot_size + TAB_CONTENT_SPACING;
            }
        }

        let text_color = if is_focused_tab || is_active {
            p.tab_text_focused
        } else {
            p.tab_text
        };
        let label_y = tab_y + (tab_h - cell_height) / 2.0;

        // Close icon at right: [close 16x16] [pad 6]
        let tab_close_hit_x = cx + tw - TAB_H_PAD - close_hit_size;
        let _tab_close_icon_x = tab_close_hit_x + (close_hit_size - close_icon_width) / 2.0;
        let _tab_close_icon_y = tab_y + (tab_h - close_icon_width) / 2.0;

        // Compute badges for active tab
        let mut active_badges: Vec<EditorBadge> = Vec::new();
        let mut active_badge_total_w = 0.0_f32;
        if is_active {
            active_badges = active_tab_badges(panes, tid);
            for badge in &active_badges {
                active_badge_total_w += badge.text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0 + badge_gap;
            }
        }

        // Title takes all space not used by badges
        let label_max_w = (tab_close_hit_x - TAB_CONTENT_SPACING - active_badge_total_w - cx - TAB_H_PAD - dot_offset).max(0.0);
        let max_chars = (label_max_w / cell_w).floor().max(0.0) as usize;
        let display: String = label.chars().take(max_chars).collect();
        let label_drawn_w = display.chars().count() as f32 * cell_w;
        // Use tab_clip for text clipping so partially visible tabs are clipped at edges
        let text_clip = Rect::new(cx, tab_y, tw, tab_h).clip_to(&tab_clip);
        renderer.draw_chrome_text(
            &display,
            Vec2::new(cx + TAB_H_PAD + dot_offset, label_y),
            TextStyle {
                foreground: text_color,
                background: None,
                bold: is_active,
                dim: false, italic: false, underline: false,
            },
            text_clip,
        );

        // Draw all badges for active tab (between label and close button)
        if is_active && !active_badges.is_empty() {
            let badge_bg = if is_focused { p.badge_bg } else { p.badge_bg_unfocused };
            let mut bx = cx + TAB_H_PAD + dot_offset + label_drawn_w + badge_gap;
            for badge in &active_badges {
                let bw = badge.text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0;
                let (b_text_color, b_bg) = match badge.action {
                    Some(HeaderHitAction::EditorBack) | Some(HeaderHitAction::EditorCompare) =>
                        (p.badge_text, p.conflict_bar_btn),
                    Some(HeaderHitAction::GitBranch) => {
                        let cc = if is_focused_tab { p.badge_git_branch } else { p.tab_text };
                        (cc, badge_bg)
                    }
                    Some(HeaderHitAction::GitStatus) => {
                        let stat_bg = crate::tide_core::Color::new(p.git_added.r, p.git_added.g, p.git_added.b, 0.094);
                        (p.git_added, stat_bg)
                    }
                    None if badge.text == "deleted" || badge.text == "exited" => (p.badge_deleted, badge_bg),
                    None if badge.text == "conflict" => (p.badge_conflict, badge_bg),
                    _ => {
                        let cc = if is_focused { p.badge_text } else { p.tab_text };
                        (cc, badge_bg)
                    }
                };
                // Clip badge to tab_clip for edge clipping
                let badge_rect = Rect::new(bx, label_y - 1.0, bw, cell_height + 2.0).clip_to(&tab_clip);
                if badge_rect.width > 0.0 {
                    render_badge_colored(renderer, badge_rect.x, badge_rect.y + 1.0, badge_rect.width, cell_height, &badge.text, b_text_color, b_bg, 3.0);
                }
                if let Some(ref act) = badge.action {
                    let hit_rect = Rect::new(bx, rect.y, bw, TAB_BAR_HEIGHT).clip_to(&tab_clip);
                    if hit_rect.width > 0.0 {
                        zones.push(HeaderHitZone {
                            pane_id: *tid,
                            rect: hit_rect,
                            action: act.clone(),
                        });
                    }
                }
                bx += bw + badge_gap;
            }
        }

        // Per-tab close button (9px icon inside 16x16 hit area)
        let is_tab_modified = match panes.get(tid) {
            Some(PaneKind::Editor(ep)) => ep.editor.is_modified(),
            _ => false,
        };
        let (tab_close_icon, tab_close_color) = if is_tab_modified {
            ("\u{f111}", p.editor_modified)
        } else {
            ("\u{f00d}", p.close_icon)
        };
        let tab_close_text_x = tab_close_hit_x + (close_hit_size - cell_w) / 2.0;
        let tab_close_text_y = tab_y + (TAB_BAR_HEIGHT - cell_height) / 2.0;
        let close_clip = Rect::new(tab_close_hit_x, rect.y, close_hit_size, TAB_BAR_HEIGHT).clip_to(&tab_clip);
        if close_clip.width > 0.0 {
            renderer.draw_chrome_text(
                tab_close_icon,
                Vec2::new(tab_close_text_x, tab_close_text_y),
                TextStyle { foreground: tab_close_color, background: None, bold: false, dim: false, italic: false, underline: false },
                close_clip,
            );
            zones.push(HeaderHitZone {
                pane_id: *tid,
                rect: close_clip,
                action: HeaderHitAction::Close,
            });
        }

        // Tab click zone (excluding close button area) — clipped to visible area
        let action = if is_dock {
            HeaderHitAction::DockTab(*tid)
        } else {
            HeaderHitAction::StageTab(*tid)
        };
        let tab_hit_rect = Rect::new(cx, rect.y, tw - close_hit_size - TAB_H_PAD, TAB_BAR_HEIGHT).clip_to(&tab_clip);
        if tab_hit_rect.width > 0.0 {
            zones.push(HeaderHitZone {
                pane_id: pane_id,
                rect: tab_hit_rect,
                action,
            });
        }

        cx += tw; // no gap between tabs (spacing = 0)
    }

    zones
}

/// Render a tab bar for a Stage LeafGroup (per-TabGroup tab bar).
/// Shows tabs for all panes in the group; the active tab is highlighted.
/// Uses `is_dock=false` so hit actions are `StageTab`.
pub fn render_stage_tab_group_bar(
    pane_id: PaneId,
    rect: Rect,
    tab_group: &crate::tide_layout::TabGroup,
    panes: &HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
) -> Vec<HeaderHitZone> {
    render_tab_bar_impl(pane_id, rect, &tab_group.tabs, tab_group.active_pane(), panes, focused, &[], p, renderer, false, false, detected_agents, blink_time, tab_scroll_offset)
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
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
) -> Vec<HeaderHitZone> {
    if stage_pane_ids.len() < 2 {
        return Vec::new();
    }
    render_tab_bar_impl(zoomed_pane, rect, stage_pane_ids, zoomed_pane, panes, focused, &[], p, renderer, false, true, detected_agents, blink_time, tab_scroll_offset)
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
        Some(PaneKind::Browser(bp)) => bp.title(),
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
    text_color: crate::tide_core::Color,
    bg_color: crate::tide_core::Color,
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
    use crate::tide_core::PaneId;
    use crate::pane::editor::EditorPane;

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
        ep.editor.handle_action(crate::tide_editor::EditorActionKind::InsertChar('x'));
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
        ep.editor.handle_action(crate::tide_editor::EditorActionKind::InsertChar('x'));
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
        ep.editor.handle_action(crate::tide_editor::EditorActionKind::InsertChar('x'));
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

