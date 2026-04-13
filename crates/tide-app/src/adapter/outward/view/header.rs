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
    AddComment,
    EditorCompare,
    EditorBack,
    EditorFileName,
    MarkdownPreview,
    ToggleLivePreview,
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

    // Diff mode back button
    if ep.diff_mode {
        badges.push(EditorBadge {
            text: "back".to_string(),
            action: Some(HeaderHitAction::EditorBack),
        });
        return badges;
    }

    if ep.disk_changed && ep.editor.is_modified() && !ep.file_deleted {
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

    if ep.file_deleted {
        badges.push(EditorBadge {
            text: "deleted".to_string(),
            action: None,
        });
    }

    // Markdown mode toggle: plain ↔ live preview.
    // Mode is secondary to attention state, so it comes after file-state badges.
    if ep.is_markdown() {
        let text = if ep.live_preview { "plain" } else { "live" };
        badges.push(EditorBadge {
            text: text.to_string(),
            action: Some(HeaderHitAction::ToggleLivePreview),
        });
    }

    badges
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TitleBadgeLayout {
    pub title_w: f32,
    pub visible_badges: usize,
}

pub(crate) fn reserve_title_before_badges(
    title_w_raw: f32,
    badge_widths: &[f32],
    content_budget: f32,
    min_title_w: f32,
    badge_gap: f32,
) -> TitleBadgeLayout {
    let budget = content_budget.max(0.0);
    let required_title_w = title_w_raw.min(min_title_w).min(budget);
    let mut badge_w = 0.0_f32;
    let mut visible_badges = 0_usize;

    for width in badge_widths {
        let addition = badge_gap + *width;
        if budget - (badge_w + addition) < required_title_w {
            break;
        }
        badge_w += addition;
        visible_badges += 1;
    }

    TitleBadgeLayout {
        title_w: title_w_raw.min((budget - badge_w).max(0.0)),
        visible_badges,
    }
}

pub(crate) fn active_tab_width_cap(available_w: f32) -> f32 {
    (available_w - TAB_MIN_WIDTH)
        .min(ACTIVE_TAB_SOFT_MAX_WIDTH)
        .max(ACTIVE_TAB_MAX_WIDTH)
}

pub(crate) fn shared_tab_active_width_cap(available_w: f32, tab_count: usize) -> f32 {
    let sibling_min_width = tab_count.saturating_sub(1) as f32 * TAB_MIN_WIDTH;
    let row_limited = (available_w - sibling_min_width).max(TAB_MIN_WIDTH);
    let soft_cap = ACTIVE_TAB_SOFT_MAX_WIDTH.max(available_w * 0.5);

    row_limited.min(soft_cap).max(ACTIVE_TAB_MAX_WIDTH)
}

pub(crate) fn tab_status_dot_width(has_agent_status: bool) -> f32 {
    if has_agent_status {
        8.0 + TAB_CONTENT_SPACING
    } else {
        0.0
    }
}

pub(crate) fn shared_tab_target_width(
    label_w: f32,
    badge_widths: &[f32],
    has_agent_status: bool,
    is_active: bool,
    active_tab_cap: f32,
) -> f32 {
    let mut width = label_w
        + TAB_H_PAD * 2.0
        + 16.0
        + TAB_CONTENT_SPACING
        + tab_status_dot_width(has_agent_status);
    if is_active {
        for badge_w in badge_widths {
            width += *badge_w + BADGE_GAP;
        }
    }

    let max_w = if is_active {
        active_tab_cap
    } else {
        TAB_MAX_WIDTH
    };
    width.clamp(TAB_MIN_WIDTH, max_w)
}

pub(crate) fn fit_active_tab_scroll_offset(
    tab_widths: &[f32],
    active_index: usize,
    visible_w: f32,
    requested_scroll: f32,
) -> f32 {
    if tab_widths.is_empty() || visible_w <= 0.0 || active_index >= tab_widths.len() {
        return 0.0;
    }

    let total_tabs_w: f32 = tab_widths.iter().sum();
    let max_scroll = (total_tabs_w - visible_w).max(0.0);
    let mut scroll = requested_scroll.clamp(0.0, max_scroll);

    let active_start: f32 = tab_widths.iter().take(active_index).sum();
    let active_end = active_start + tab_widths[active_index];

    if active_end - scroll > visible_w {
        scroll = (active_end - visible_w).clamp(0.0, max_scroll);
    }
    if active_start - scroll < 0.0 {
        scroll = active_start.clamp(0.0, max_scroll);
    }

    scroll
}

pub(crate) fn resolve_tab_scroll_offset(
    tab_widths: &[f32],
    active_index: usize,
    visible_w: f32,
    requested_scroll: f32,
    auto_fit_active: bool,
) -> f32 {
    if tab_widths.is_empty() || visible_w <= 0.0 {
        return 0.0;
    }

    let total_tabs_w: f32 = tab_widths.iter().sum();
    let max_scroll = (total_tabs_w - visible_w).max(0.0);
    let scroll = requested_scroll.clamp(0.0, max_scroll);
    if !auto_fit_active {
        return scroll;
    }

    fit_active_tab_scroll_offset(tab_widths, active_index, visible_w, scroll)
}

pub(crate) fn overflowed_stage_alert_tab_edges(
    tab_widths: &[f32],
    alert_indices: &[usize],
    visible_w: f32,
    scroll_offset: f32,
) -> (bool, bool) {
    if tab_widths.is_empty() || alert_indices.is_empty() || visible_w <= 0.0 {
        return (false, false);
    }

    let total_tabs_w: f32 = tab_widths.iter().sum();
    let max_scroll = (total_tabs_w - visible_w).max(0.0);
    let scroll = scroll_offset.clamp(0.0, max_scroll);
    let visible_start = scroll;
    let visible_end = scroll + visible_w;
    let mut left = false;
    let mut right = false;
    let mut tab_start = 0.0_f32;

    for (index, width) in tab_widths.iter().enumerate() {
        let tab_end = tab_start + *width;
        if alert_indices.contains(&index) {
            if tab_start < visible_start {
                left = true;
            }
            if tab_end > visible_end {
                right = true;
            }
            if left && right {
                break;
            }
        }
        tab_start = tab_end;
    }

    (left, right)
}

fn selection_comment_badge(
    panes: &HashMap<PaneId, PaneKind>,
    id: PaneId,
    is_focused: bool,
    show_comment_badge: bool,
) -> Option<EditorBadge> {
    if !is_focused || !show_comment_badge {
        return None;
    }
    match panes.get(&id) {
        Some(PaneKind::Terminal(_)) => Some(EditorBadge {
            text: "comment".to_string(),
            action: Some(HeaderHitAction::AddComment),
        }),
        Some(PaneKind::Editor(_)) => Some(EditorBadge {
            text: "comment".to_string(),
            action: Some(HeaderHitAction::AddComment),
        }),
        Some(PaneKind::Diff(_)) => Some(EditorBadge {
            text: "comment".to_string(),
            action: Some(HeaderHitAction::AddComment),
        }),
        Some(PaneKind::Browser(_)) => Some(EditorBadge {
            text: "comment".to_string(),
            action: Some(HeaderHitAction::AddComment),
        }),
        _ => None,
    }
}

fn badge_tint(color: crate::tide_core::Color, alpha: f32) -> crate::tide_core::Color {
    crate::tide_core::Color::new(color.r, color.g, color.b, alpha)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AgentChromeState {
    ConnectedIdle,
    Running,
    Attention,
}

impl From<crate::state::gateway_status::AgentStatus> for AgentChromeState {
    fn from(status: crate::state::gateway_status::AgentStatus) -> Self {
        match status {
            crate::state::gateway_status::AgentStatus::Running => Self::Running,
            crate::state::gateway_status::AgentStatus::Idle => Self::Attention,
            crate::state::gateway_status::AgentStatus::NeedsInput => Self::Attention,
        }
    }
}

pub(crate) fn stage_terminal_dot_color(
    state: impl Into<AgentChromeState>,
    blink_time: Option<f64>,
) -> crate::tide_core::Color {
    match state.into() {
        AgentChromeState::Running => crate::tide_core::Color::new(0.3, 0.8, 0.4, 1.0),
        AgentChromeState::Attention => {
            let opacity = blink_time
                .map(|t| 0.72 + 0.28 * (t * crate::theme::AGENT_BLINK_FREQUENCY).sin() as f32)
                .unwrap_or(0.9);
            crate::tide_core::Color::new(0.95, 0.65, 0.2, opacity)
        }
        AgentChromeState::ConnectedIdle => crate::tide_core::Color::new(0.36, 0.56, 0.82, 1.0),
    }
}

pub(crate) fn terminal_chrome_agent_status(
    panes: &HashMap<PaneId, PaneKind>,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    pane_id: PaneId,
) -> Option<crate::state::gateway_status::AgentStatus> {
    match panes.get(&pane_id) {
        Some(PaneKind::Terminal(_)) => detected_agents
            .get(&pane_id)
            .filter(|agent| agent.wrapper_managed)
            .and_then(|agent| agent.status),
        _ => None,
    }
}

pub(crate) fn terminal_chrome_visual_state(
    panes: &HashMap<PaneId, PaneKind>,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    pane_id: PaneId,
) -> Option<AgentChromeState> {
    match panes.get(&pane_id) {
        Some(PaneKind::Terminal(_)) => detected_agents
            .get(&pane_id)
            .filter(|agent| agent.wrapper_managed)
            .and_then(|agent| match agent.status {
                Some(status) => Some(AgentChromeState::from(status)),
                None if agent.gateway_connected => Some(AgentChromeState::ConnectedIdle),
                None => None,
            }),
        _ => None,
    }
}

pub(crate) fn stage_terminal_dot_status(
    panes: &HashMap<PaneId, PaneKind>,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    pane_id: PaneId,
    is_stage_surface: bool,
) -> Option<crate::state::gateway_status::AgentStatus> {
    if !is_stage_surface {
        return None;
    }

    terminal_chrome_agent_status(panes, detected_agents, pane_id)
}

pub(crate) fn stage_terminal_dot_visual_state(
    panes: &HashMap<PaneId, PaneKind>,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    pane_id: PaneId,
    is_stage_surface: bool,
) -> Option<AgentChromeState> {
    if !is_stage_surface {
        return None;
    }

    terminal_chrome_visual_state(panes, detected_agents, pane_id)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SinglePaneHeaderPaintStep {
    Background,
    Dot,
}

fn single_pane_header_paint_steps(has_visible_dot: bool) -> Vec<SinglePaneHeaderPaintStep> {
    let mut steps = vec![SinglePaneHeaderPaintStep::Background];
    if has_visible_dot {
        steps.push(SinglePaneHeaderPaintStep::Dot);
    }
    steps
}

fn editor_badge_colors(
    badge: &EditorBadge,
    p: &ThemePalette,
    is_focused: bool,
) -> (crate::tide_core::Color, crate::tide_core::Color) {
    let base_bg = if is_focused {
        p.badge_bg
    } else {
        p.badge_bg_unfocused
    };

    match badge.action {
        Some(HeaderHitAction::ToggleLivePreview) => (
            if is_focused {
                p.tab_text_focused
            } else {
                p.tab_text_active
            },
            badge_tint(p.border_focused, if is_focused { 0.22 } else { 0.14 }),
        ),
        Some(HeaderHitAction::EditorBack) | Some(HeaderHitAction::EditorCompare) => {
            (p.badge_text, p.conflict_bar_btn)
        }
        Some(HeaderHitAction::GitBranch) => (
            if is_focused {
                p.badge_git_branch
            } else {
                p.tab_text
            },
            base_bg,
        ),
        Some(HeaderHitAction::GitStatus) => (
            p.git_added,
            badge_tint(p.git_added, if is_focused { 0.16 } else { 0.10 }),
        ),
        Some(HeaderHitAction::AddComment) => {
            (if is_focused { p.badge_text } else { p.tab_text }, base_bg)
        }
        None if badge.text == "deleted" || badge.text == "exited" => (
            p.badge_deleted,
            badge_tint(p.badge_deleted, if is_focused { 0.16 } else { 0.10 }),
        ),
        None if badge.text == "conflict" => (
            p.badge_conflict,
            badge_tint(p.badge_conflict, if is_focused { 0.16 } else { 0.10 }),
        ),
        _ => (if is_focused { p.badge_text } else { p.tab_text }, base_bg),
    }
}

pub(crate) fn terminal_header_title_color(
    p: &ThemePalette,
    is_focused: bool,
    shell_idle: bool,
) -> crate::tide_core::Color {
    if !shell_idle {
        if is_focused {
            p.tab_text_focused
        } else {
            p.tab_text
        }
    } else if is_focused {
        p.tab_text_focused
    } else {
        p.tab_text
    }
}

/// Compute badges for the active tab in a tab bar (works for all pane kinds).
pub(crate) fn active_tab_badges(
    panes: &HashMap<PaneId, PaneKind>,
    id: &PaneId,
    is_focused: bool,
    show_comment_badge: bool,
) -> Vec<EditorBadge> {
    let mut badges = match panes.get(id) {
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
                        text: format!(
                            "{} +{} -{}",
                            git.status.changed_files, git.status.additions, git.status.deletions
                        ),
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
    };
    if let Some(comment_badge) = selection_comment_badge(panes, *id, is_focused, show_comment_badge)
    {
        badges.push(comment_badge);
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
    show_comment_badge: bool,
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
) -> Vec<HeaderHitZone> {
    render_pane_header_inner(
        id,
        rect,
        panes,
        focused,
        _is_zoomed,
        has_dock_tab_bar,
        show_comment_badge,
        p,
        renderer,
        None,
        None,
        false,
    )
}

pub fn render_pane_header_inner(
    id: PaneId,
    rect: Rect,
    panes: &HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    _is_zoomed: bool,
    has_dock_tab_bar: bool,
    show_comment_badge: bool,
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
    agent_chrome_state: Option<AgentChromeState>,
    blink_time: Option<f64>,
    show_stage_terminal_dot: bool,
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
    let badge_bg = if is_focused {
        p.badge_bg
    } else {
        p.badge_bg_unfocused
    };

    // Active tab bg + accent line drawn AFTER computing tab width (see below)

    // --- Build content: [pad 6] [dot?] [icon 14x14] [gap 6] [title...] [spacer] [badges...] [close 16x16 (9px icon)] [pad 6] ---
    let mut cx = rect.x + TAB_H_PAD;

    let visible_dot_state = if show_stage_terminal_dot {
        agent_chrome_state
    } else {
        None
    };

    let dot_x = cx;
    if visible_dot_state.is_some() {
        cx += 8.0_f32 + TAB_CONTENT_SPACING;
    }

    // Collect inline badges
    let mut inline_badges: Vec<(
        String,
        crate::tide_core::Color,
        crate::tide_core::Color,
        Option<HeaderHitAction>,
    )> = Vec::new();

    // Determine title and collect badges based on pane kind
    let (title, title_color) = match panes.get(&id) {
        Some(PaneKind::Terminal(pane)) => {
            let t = if let Some(ref cwd) = pane.context.cwd {
                cwd.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| cwd.display().to_string())
            } else {
                format!("Terminal {}", id)
            };
            let c = terminal_header_title_color(p, is_focused, pane.context.shell_idle);

            if let Some(ref git) = pane.context.git_info {
                let branch_display = format!("\u{e0a0} {}", git.branch);
                let branch_color = if is_focused {
                    p.badge_git_branch
                } else {
                    p.tab_text
                };
                inline_badges.push((
                    branch_display,
                    branch_color,
                    badge_bg,
                    Some(HeaderHitAction::GitBranch),
                ));

                if git.status.changed_files > 0 {
                    let stat_text = format!(
                        "{} +{} -{}",
                        git.status.changed_files, git.status.additions, git.status.deletions
                    );
                    let stat_bg = crate::tide_core::Color::new(
                        p.git_added.r,
                        p.git_added.g,
                        p.git_added.b,
                        0.094,
                    );
                    inline_badges.push((
                        stat_text,
                        p.git_added,
                        stat_bg,
                        Some(HeaderHitAction::GitStatus),
                    ));
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
                let (text_color, bg) = editor_badge_colors(&badge, p, is_focused);
                inline_badges.push((badge.text.clone(), text_color, bg, badge.action.clone()));
            }
            (t, c)
        }
        Some(PaneKind::Browser(_bp)) => {
            let t = _bp.title();
            let c = if is_focused {
                p.tab_text_focused
            } else {
                p.tab_text
            };
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
            inline_badges.push((
                "\u{f021}".to_string(),
                c,
                badge_bg,
                Some(HeaderHitAction::DiffRefresh),
            ));
            ("Git Changes".to_string(), c)
        }
        Some(PaneKind::Launcher(_)) => {
            let c = if is_focused {
                p.tab_text_focused
            } else {
                p.tab_text
            };
            ("New Tab".to_string(), c)
        }
        None => {
            return zones;
        }
    };

    if let Some(comment_badge) = selection_comment_badge(panes, id, is_focused, show_comment_badge)
    {
        inline_badges.push((
            comment_badge.text,
            p.badge_text,
            badge_bg,
            comment_badge.action,
        ));
    }

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
    let dot_w = tab_status_dot_width(visible_dot_state.is_some());
    let title_w_raw = title.chars().count() as f32 * cell_w;
    let compact_tab_cap = active_tab_width_cap(available_w).min(available_w.max(TAB_MIN_WIDTH));
    let compact_tab_w =
        (TAB_H_PAD + dot_w + title_w_raw + badge_gap + total_badge_w + close_hit_size + TAB_H_PAD)
            .clamp(TAB_MIN_WIDTH, compact_tab_cap);

    // Draw compact active tab bg + top accent line
    for step in single_pane_header_paint_steps(visible_dot_state.is_some()) {
        match step {
            SinglePaneHeaderPaintStep::Background => {
                renderer.draw_chrome_rect(
                    Rect::new(rect.x, rect.y, compact_tab_w, TAB_BAR_HEIGHT),
                    p.active_tab_bg,
                );
                // Reset area beyond compact tab to unfocused tab bar bg
                // (render_pane_chrome draws tab_bar_bg_focused across the full width)
                if compact_tab_w < available_w {
                    renderer.draw_chrome_rect(
                        Rect::new(
                            rect.x + compact_tab_w,
                            rect.y,
                            available_w - compact_tab_w,
                            TAB_BAR_HEIGHT,
                        ),
                        p.tab_bar_bg,
                    );
                }
                renderer.draw_chrome_rect(
                    Rect::new(rect.x, rect.y, compact_tab_w, TAB_ACTIVE_INDICATOR_HEIGHT),
                    p.border_focused,
                );
            }
            SinglePaneHeaderPaintStep::Dot => {
                if let Some(state) = visible_dot_state {
                    let dot_color = stage_terminal_dot_color(state, blink_time);
                    let dot_size = 8.0_f32;
                    let dot_y = rect.y + (TAB_BAR_HEIGHT - dot_size) / 2.0;
                    renderer.draw_chrome_rounded_rect(
                        Rect::new(dot_x, dot_y, dot_size, dot_size),
                        dot_color,
                        dot_size / 2.0,
                    );
                }
            }
        }
    }

    // Position close icon relative to compact tab width
    let close_hit_x = rect.x + compact_tab_w - TAB_H_PAD - close_hit_size;
    let _close_icon_x = close_hit_x + (close_hit_size - close_icon_w) / 2.0;
    let _close_icon_y = rect.y + (TAB_BAR_HEIGHT - close_icon_w) / 2.0;

    let badge_widths: Vec<f32> = inline_badges
        .iter()
        .map(|(text, _, _, _)| text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0)
        .collect();
    let title_layout = reserve_title_before_badges(
        title_w_raw,
        &badge_widths,
        (close_hit_x - cx).max(0.0),
        TAB_MIN_TITLE_WIDTH,
        badge_gap,
    );
    let title_w = title_layout.title_w;

    // Draw title text
    let title_style = TextStyle {
        foreground: title_color,
        background: None,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
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
    for (text, text_color, bg, action) in inline_badges.iter().take(title_layout.visible_badges) {
        let bw = text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0;
        render_badge_colored(
            renderer,
            cx,
            text_y,
            bw,
            cell_height,
            text,
            *text_color,
            *bg,
            4.0,
        );
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
        bold: false,
        dim: false,
        italic: false,
        underline: false,
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
    show_comment_badge: bool,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
    auto_fit_active_tab: bool,
) -> Vec<HeaderHitZone> {
    render_tab_bar_impl(
        pane_id,
        rect,
        &tab_group.tabs,
        tab_group.active_pane(),
        panes,
        focused,
        pinned_ids,
        p,
        renderer,
        true,
        false,
        show_comment_badge,
        detected_agents,
        blink_time,
        tab_scroll_offset,
        auto_fit_active_tab,
    )
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
    show_comment_badge: bool,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
    auto_fit_active_tab: bool,
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
            TextStyle {
                foreground: icon_color,
                background: None,
                bold: false,
                dim: false,
                italic: false,
                underline: false,
            },
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
    let active_tab_cap = shared_tab_active_width_cap(max_tabs_w, tab_ids.len());

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
        let has_agent_status =
            stage_terminal_dot_visual_state(panes, detected_agents, tid, !is_dock).is_some();
        let badge_widths: Vec<f32> = if tid == active_pane {
            active_tab_badges(panes, &tid, is_focused, show_comment_badge)
                .iter()
                .map(|badge| badge.text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0)
                .collect()
        } else {
            Vec::new()
        };
        let w = shared_tab_target_width(
            label.chars().count() as f32 * cell_w,
            &badge_widths,
            has_agent_status,
            tid == active_pane,
            active_tab_cap,
        );
        tabs_info.push((tid, label, w));
    }

    // Clipping rect for the tab content area
    let tab_clip = Rect::new(content_left, tab_y, tabs_right - content_left, tab_h);

    // Compute total tabs width for scroll clamping
    let tab_widths: Vec<f32> = tabs_info.iter().map(|(_, _, w)| *w).collect();
    let visible_w = tabs_right - content_left;
    let active_index = tab_ids
        .iter()
        .position(|tid| *tid == active_pane)
        .unwrap_or(0);
    let effective_scroll = resolve_tab_scroll_offset(
        &tab_widths,
        active_index,
        visible_w,
        tab_scroll_offset,
        auto_fit_active_tab,
    );

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
        // Active tab: subtle lighter background + 2px accent line at top
        if is_active {
            let bg_rect = Rect::new(cx, tab_y, tw, TAB_BAR_HEIGHT).clip_to(&tab_clip);
            if bg_rect.width > 0.0 {
                renderer.draw_chrome_rect(bg_rect, p.active_tab_bg);
            }
            let accent_rect =
                Rect::new(cx, tab_y, tw, TAB_ACTIVE_INDICATOR_HEIGHT).clip_to(&tab_clip);
            if accent_rect.width > 0.0 {
                let accent_color = if is_focused {
                    p.border_focused
                } else {
                    crate::tide_core::Color::new(
                        p.border_focused.r,
                        p.border_focused.g,
                        p.border_focused.b,
                        p.border_focused.a * 0.3,
                    )
                };
                renderer.draw_chrome_rect(accent_rect, accent_color);
            }
        }

        // Agent status dot
        let mut dot_offset = 0.0_f32;
        if let Some(state) = stage_terminal_dot_visual_state(panes, detected_agents, *tid, !is_dock)
        {
            let dot_color = stage_terminal_dot_color(state, blink_time);
            let dot_size = 8.0_f32;
            let dot_x = cx + TAB_H_PAD;
            let dot_y = tab_y + (tab_h - dot_size) / 2.0;
            let dot_rect = Rect::new(dot_x, dot_y, dot_size, dot_size).clip_to(&tab_clip);
            if dot_rect.width > 0.0 && dot_rect.height > 0.0 {
                renderer.draw_chrome_rounded_rect(dot_rect, dot_color, dot_size / 2.0);
            }
            dot_offset = tab_status_dot_width(true);
        }

        let text_color = if is_focused_tab || (is_active && is_focused) {
            p.tab_text_focused
        } else if is_active {
            p.tab_text_active
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
        if is_active {
            active_badges = active_tab_badges(panes, tid, is_focused_tab, show_comment_badge);
        }
        let badge_widths: Vec<f32> = active_badges
            .iter()
            .map(|badge| badge.text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0)
            .collect();
        let title_layout = reserve_title_before_badges(
            label.chars().count() as f32 * cell_w,
            &badge_widths,
            (tab_close_hit_x - cx - TAB_H_PAD - dot_offset).max(0.0),
            TAB_MIN_TITLE_WIDTH,
            badge_gap,
        );

        let label_max_w = title_layout.title_w.max(0.0);
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
                dim: false,
                italic: false,
                underline: false,
            },
            text_clip,
        );

        // Draw all badges for active tab (between label and close button)
        if is_active && !active_badges.is_empty() {
            let mut bx = cx + TAB_H_PAD + dot_offset + label_drawn_w + badge_gap;
            for badge in active_badges.iter().take(title_layout.visible_badges) {
                let bw = badge.text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0;
                let (b_text_color, b_bg) = editor_badge_colors(badge, p, is_focused_tab);
                // Clip badge to tab_clip for edge clipping
                let badge_rect =
                    Rect::new(bx, label_y - 1.0, bw, cell_height + 2.0).clip_to(&tab_clip);
                if badge_rect.width > 0.0 {
                    render_badge_colored(
                        renderer,
                        badge_rect.x,
                        badge_rect.y + 1.0,
                        badge_rect.width,
                        cell_height,
                        &badge.text,
                        b_text_color,
                        b_bg,
                        4.0,
                    );
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
        let close_clip =
            Rect::new(tab_close_hit_x, rect.y, close_hit_size, TAB_BAR_HEIGHT).clip_to(&tab_clip);
        if close_clip.width > 0.0 {
            renderer.draw_chrome_text(
                tab_close_icon,
                Vec2::new(tab_close_text_x, tab_close_text_y),
                TextStyle {
                    foreground: tab_close_color,
                    background: None,
                    bold: false,
                    dim: false,
                    italic: false,
                    underline: false,
                },
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
        let tab_hit_rect = Rect::new(cx, rect.y, tw - close_hit_size - TAB_H_PAD, TAB_BAR_HEIGHT)
            .clip_to(&tab_clip);
        if tab_hit_rect.width > 0.0 {
            zones.push(HeaderHitZone {
                pane_id: pane_id,
                rect: tab_hit_rect,
                action,
            });
        }

        cx += tw; // no gap between tabs (spacing = 0)
    }

    if !is_dock {
        let alert_indices: Vec<usize> = tab_ids
            .iter()
            .enumerate()
            .filter_map(|(index, tid)| {
                stage_terminal_dot_status(panes, detected_agents, *tid, true).and_then(|status| {
                    if matches!(
                        status,
                        crate::state::gateway_status::AgentStatus::Idle
                            | crate::state::gateway_status::AgentStatus::NeedsInput
                    ) {
                        Some(index)
                    } else {
                        None
                    }
                })
            })
            .collect();
        let (show_left_edge, show_right_edge) = overflowed_stage_alert_tab_edges(
            &tab_widths,
            &alert_indices,
            visible_w,
            effective_scroll,
        );
        let edge_color = stage_terminal_dot_color(AgentChromeState::Attention, blink_time);
        let dot_size = 8.0_f32;
        let dot_y = tab_y + (tab_h - dot_size) / 2.0;

        if show_left_edge {
            let dot_x = content_left + 4.0;
            renderer.draw_chrome_rounded_rect(
                Rect::new(dot_x, dot_y, dot_size, dot_size),
                edge_color,
                dot_size / 2.0,
            );
        }
        if show_right_edge {
            let dot_x = tabs_right - dot_size - 4.0;
            renderer.draw_chrome_rounded_rect(
                Rect::new(dot_x, dot_y, dot_size, dot_size),
                edge_color,
                dot_size / 2.0,
            );
        }
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
    show_comment_badge: bool,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
    auto_fit_active_tab: bool,
) -> Vec<HeaderHitZone> {
    render_tab_bar_impl(
        pane_id,
        rect,
        &tab_group.tabs,
        tab_group.active_pane(),
        panes,
        focused,
        &[],
        p,
        renderer,
        false,
        false,
        show_comment_badge,
        detected_agents,
        blink_time,
        tab_scroll_offset,
        auto_fit_active_tab,
    )
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
    show_comment_badge: bool,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
    auto_fit_active_tab: bool,
) -> Vec<HeaderHitZone> {
    if stage_pane_ids.len() < 2 {
        return Vec::new();
    }
    render_tab_bar_impl(
        zoomed_pane,
        rect,
        stage_pane_ids,
        zoomed_pane,
        panes,
        focused,
        &[],
        p,
        renderer,
        false,
        true,
        show_comment_badge,
        detected_agents,
        blink_time,
        tab_scroll_offset,
        auto_fit_active_tab,
    )
}

/// Get a short label for a pane in a dock tab bar.
pub(crate) fn dock_tab_label(panes: &HashMap<PaneId, PaneKind>, id: PaneId) -> String {
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
    renderer.draw_chrome_rounded_rect(Rect::new(x, badge_y, width, badge_h), bg_color, radius);
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
    use crate::pane::editor::EditorPane;
    use crate::pane::TerminalPane;
    use crate::tide_core::PaneId;
    use std::collections::HashMap;
    use std::path::PathBuf;

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
    fn markdown_shows_live_badge() {
        let ep = make_markdown_editor(1);
        let badges = editor_header_badges(&ep);
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "live");
        assert_eq!(badges[0].action, Some(HeaderHitAction::ToggleLivePreview));
    }

    #[test]
    fn markdown_live_preview_shows_plain_badge() {
        let mut ep = make_markdown_editor(1);
        ep.live_preview = true;
        let badges = editor_header_badges(&ep);
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "plain");
        assert_eq!(badges[0].action, Some(HeaderHitAction::ToggleLivePreview));
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
        ep.editor
            .handle_action(crate::tide_editor::EditorActionKind::InsertChar('x'));
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
    fn focused_terminal_shows_add_comment_badge_when_enabled() {
        let terminal = TerminalPane::with_cwd(1, 80, 24, None, true).unwrap();

        let mut panes = HashMap::new();
        panes.insert(1, PaneKind::Terminal(terminal));

        let focused_badges = active_tab_badges(&panes, &1, true, true);
        assert!(focused_badges
            .iter()
            .any(|badge| badge.action == Some(HeaderHitAction::AddComment)));

        let unfocused_badges = active_tab_badges(&panes, &1, false, true);
        assert!(!unfocused_badges
            .iter()
            .any(|badge| badge.action == Some(HeaderHitAction::AddComment)));
    }

    #[test]
    fn focused_selection_hides_add_comment_badge_when_disabled() {
        let mut terminal = TerminalPane::with_cwd(1, 80, 24, None, true).unwrap();
        terminal.selection = Some(crate::pane::Selection {
            anchor: (0, 0),
            end: (0, 4),
        });

        let mut panes = HashMap::new();
        panes.insert(1, PaneKind::Terminal(terminal));

        let badges = active_tab_badges(&panes, &1, true, false);
        assert!(!badges
            .iter()
            .any(|badge| badge.action == Some(HeaderHitAction::AddComment)));
    }

    #[test]
    fn deleted_and_conflict_skips_conflict_when_deleted() {
        let mut ep = make_editor(1);
        ep.disk_changed = true;
        ep.file_deleted = true;
        ep.editor
            .handle_action(crate::tide_editor::EditorActionKind::InsertChar('x'));
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
        ep.editor
            .handle_action(crate::tide_editor::EditorActionKind::InsertChar('x'));
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
            assert_eq!(badges[0].text, "live");
        }
    }

    #[test]
    fn attention_badges_precede_mode_badge_for_conflicted_markdown_panes() {
        let mut ep = make_markdown_editor(1);
        ep.disk_changed = true;
        ep.editor
            .handle_action(crate::tide_editor::EditorActionKind::InsertChar('x'));

        let badges = editor_header_badges(&ep);
        let badge_texts: Vec<&str> = badges.iter().map(|badge| badge.text.as_str()).collect();

        assert_eq!(
            badge_texts,
            vec!["compare", "conflict", "live"],
            "attention state should outrank mode state in the shared badge order"
        );
    }

    #[test]
    fn mode_badge_precedes_comment_badge_for_markdown_panes() {
        let ep = make_markdown_editor(1);
        let mut panes = HashMap::new();
        panes.insert(1, PaneKind::Editor(ep));

        let badges = active_tab_badges(&panes, &1, true, true);
        let badge_texts: Vec<&str> = badges.iter().map(|badge| badge.text.as_str()).collect();

        assert_eq!(
            badge_texts,
            vec!["live", "comment"],
            "active markdown chrome should keep the live/plain switch ahead of add-comment affordances"
        );
    }

    #[test]
    fn narrow_editor_header_preserves_title_before_optional_badges() {
        let layout = reserve_title_before_badges(180.0, &[48.0, 56.0], 96.0, 64.0, 8.0);

        assert_eq!(layout.visible_badges, 0);
        assert!(layout.title_w >= 64.0);
    }

    #[test]
    fn single_pane_header_paints_status_dot_after_background() {
        assert_eq!(
            single_pane_header_paint_steps(true),
            vec![
                SinglePaneHeaderPaintStep::Background,
                SinglePaneHeaderPaintStep::Dot,
            ]
        );
        assert_eq!(
            single_pane_header_paint_steps(false),
            vec![SinglePaneHeaderPaintStep::Background]
        );
    }
}
