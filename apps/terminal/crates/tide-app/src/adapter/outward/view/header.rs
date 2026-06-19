// Per-pane header rendering: title + close button + kind-specific badges.

// Agent-status chrome helpers live in `header_status`; re-export them so the
// `crate::header::…` call sites are unchanged.
pub(crate) use super::header_status::*;

use std::collections::HashMap;

use crate::tide_core::{PaneId, Rect, Renderer, TextStyle, Vec2};
use crate::tide_renderer::WgpuRenderer;

use crate::pane::PaneKind;
use crate::theme::*;

use super::raster_icons::{
    FLATICON_BROWSER, FLATICON_CLOSE, FLATICON_ENTER_SPLIT_MODE, FLATICON_ENTER_STACK_MODE,
    FLATICON_SPLIT_HORIZONTAL, FLATICON_SPLIT_VERTICAL,
};
use super::svg_icons::{svg_icon_palette, SVG_ICON_ADD_PANE};

/// Clickable zone within a pane header.
#[derive(Debug, Clone)]
pub struct HeaderHitZone {
    pub pane_id: PaneId,
    pub rect: Rect,
    pub action: HeaderHitAction,
}

/// Action triggered by clicking a header hit zone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HeaderHitAction {
    Close,
    GitBranch,
    GitStatus,
    AddComment,
    EditorCompare,
    EditorBack,
    EditorFileName,
    MarkdownPreview,
    DiffRefresh,
    Maximize,
    AddPane,
    NewFile,
    OpenBrowser,
    SplitHorizontal,
    SplitVertical,
    ToggleStageViewMode(bool),
    ToggleDockViewMode(bool),
    /// Click on a Dock tab-bar item — switch to this pane.
    DockTab(crate::tide_core::PaneId),
    /// Click on a Stage tab in stacked mode — switch zoomed pane.
    StageTab(crate::tide_core::PaneId),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HeaderActionSpec {
    pub action: HeaderHitAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HeaderSurfaceKind {
    Stage,
    TerminalContextSurface,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HeaderActionIcon {
    Browser,
    SplitHorizontal,
    SplitVertical,
    AddPane,
    EnterStackMode,
    EnterSplitMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SinglePaneHeaderChrome {
    pub draw_active_background: bool,
    pub draw_active_indicator: bool,
    pub show_header_action_strip: bool,
}

const HEADER_ACTION_TILE_SIZE: f32 = 18.0;
const HEADER_ACTION_TILE_RADIUS: f32 = 4.0;
const SURFACE_IDENTITY_OWNER_MAX_CHARS: usize = 24;

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

    // Markdown mode toggle: Reading (read-only Preview) ↔ Source (Plain). The
    // label names the action the click performs. Mode is secondary to attention
    // state, so it comes after file-state badges.
    // Spec: docs/specs/markdown-reading-edit-modes.md UC-2.
    if ep.is_markdown() {
        let text = if ep.preview_mode { "edit" } else { "read" };
        badges.push(EditorBadge {
            text: text.to_string(),
            action: Some(HeaderHitAction::MarkdownPreview),
        });
    }

    badges
}

/// Compute which right-side badges a Browser Pane should display.
/// Browser operation badges intentionally collapse to one state so the pane
/// header stays scannable while still surfacing user-actionable work.
pub(crate) fn browser_header_badges(bp: &crate::pane::browser::BrowserPane) -> Vec<EditorBadge> {
    let text = if bp.pending_permission.is_some() {
        "permission"
    } else if bp.pending_certificate_error.is_some() {
        "certificate"
    } else if let Some(download) = bp.download_state.as_ref() {
        if download.completed {
            "downloaded"
        } else {
            "downloading"
        }
    } else if bp.streaming {
        "streaming"
    } else if bp.loading {
        "loading"
    } else if bp.latest_review().is_some() {
        "reviewed"
    } else {
        return Vec::new();
    };

    vec![EditorBadge {
        text: text.to_string(),
        action: None,
    }]
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct TitleBadgeLayout {
    pub title_w: f32,
    pub visible_badges: usize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SinglePaneHeaderLayout {
    pub surface_w: f32,
    pub close_hit_x: f32,
    pub title_layout: TitleBadgeLayout,
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

pub(crate) fn single_pane_header_layout(
    available_w: f32,
    header_action_width: f32,
    title_w_raw: f32,
    badge_widths: &[f32],
    has_status_dot: bool,
    leading_view_mode_width: f32,
) -> SinglePaneHeaderLayout {
    let action_strip_start_x = header_action_strip_start_x(available_w, header_action_width);
    let action_gap = if header_action_width > 0.0 {
        TAB_H_PAD
    } else {
        0.0
    };
    let content_right = if header_action_width > 0.0 {
        action_strip_start_x - action_gap
    } else {
        available_w - TAB_H_PAD
    };
    let dot_w = tab_status_dot_width(has_status_dot);
    let content_left = TAB_H_PAD + leading_view_mode_width + dot_w;
    let close_gap = BADGE_GAP;
    let title_and_badges_budget = (content_right - content_left - close_gap - 16.0).max(0.0);
    let title_layout = reserve_title_before_badges(
        title_w_raw,
        badge_widths,
        title_and_badges_budget,
        TAB_MIN_TITLE_WIDTH,
        BADGE_GAP,
    );
    let visible_badge_width = if title_layout.visible_badges > 0 {
        BADGE_GAP
            + badge_widths
                .iter()
                .take(title_layout.visible_badges)
                .sum::<f32>()
            + BADGE_GAP * title_layout.visible_badges.saturating_sub(1) as f32
    } else {
        0.0
    };
    let title_cluster_end = content_left + title_layout.title_w + visible_badge_width;
    let close_hit_x = (title_cluster_end + close_gap)
        .min(content_right - 16.0)
        .max(content_left);

    SinglePaneHeaderLayout {
        surface_w: available_w.max(0.0),
        close_hit_x,
        title_layout,
    }
}

fn terminal_context_header_action_specs() -> Vec<HeaderActionSpec> {
    vec![
        HeaderActionSpec {
            action: HeaderHitAction::SplitHorizontal,
        },
        HeaderActionSpec {
            action: HeaderHitAction::SplitVertical,
        },
    ]
}

pub(crate) fn single_pane_header_action_specs() -> Vec<HeaderActionSpec> {
    terminal_context_header_action_specs()
}

fn stage_single_pane_header_action_specs() -> Vec<HeaderActionSpec> {
    vec![
        HeaderActionSpec {
            action: HeaderHitAction::SplitHorizontal,
        },
        HeaderActionSpec {
            action: HeaderHitAction::SplitVertical,
        },
    ]
}

pub(crate) fn single_pane_header_action_specs_for_surface(
    surface: HeaderSurfaceKind,
) -> Vec<HeaderActionSpec> {
    match surface {
        HeaderSurfaceKind::Stage => stage_single_pane_header_action_specs(),
        HeaderSurfaceKind::TerminalContextSurface => single_pane_header_action_specs(),
    }
}

pub(crate) fn single_pane_header_chrome(
    surface: HeaderSurfaceKind,
    is_focused: bool,
) -> SinglePaneHeaderChrome {
    match surface {
        HeaderSurfaceKind::Stage => SinglePaneHeaderChrome {
            draw_active_background: false,
            draw_active_indicator: false,
            show_header_action_strip: true,
        },
        HeaderSurfaceKind::TerminalContextSurface => SinglePaneHeaderChrome {
            draw_active_background: is_focused,
            draw_active_indicator: is_focused,
            show_header_action_strip: true,
        },
    }
}

pub(crate) fn stacked_tab_bar_header_action_specs() -> Vec<HeaderActionSpec> {
    vec![HeaderActionSpec {
        action: HeaderHitAction::AddPane,
    }]
}

pub(crate) fn stacked_tab_bar_header_action_specs_for_surface(
    surface: HeaderSurfaceKind,
) -> Vec<HeaderActionSpec> {
    match surface {
        HeaderSurfaceKind::Stage => stacked_tab_bar_header_action_specs(),
        HeaderSurfaceKind::TerminalContextSurface => stacked_tab_bar_header_action_specs(),
    }
}

pub(crate) fn surface_view_mode_header_action(
    surface: HeaderSurfaceKind,
    is_stacked: bool,
) -> HeaderActionSpec {
    HeaderActionSpec {
        action: match surface {
            HeaderSurfaceKind::Stage => HeaderHitAction::ToggleStageViewMode(is_stacked),
            HeaderSurfaceKind::TerminalContextSurface => {
                HeaderHitAction::ToggleDockViewMode(is_stacked)
            }
        },
    }
}

pub(crate) fn header_action_hover_label(
    action: &HeaderHitAction,
    surface: HeaderSurfaceKind,
) -> Option<&'static str> {
    match (surface, action) {
        (HeaderSurfaceKind::TerminalContextSurface, HeaderHitAction::AddPane) => {
            Some("Add context pane")
        }
        (HeaderSurfaceKind::Stage, HeaderHitAction::AddPane) => Some("Add stage terminal"),
        (HeaderSurfaceKind::TerminalContextSurface, HeaderHitAction::SplitHorizontal) => {
            Some("Split context horizontally")
        }
        (HeaderSurfaceKind::TerminalContextSurface, HeaderHitAction::SplitVertical) => {
            Some("Split context vertically")
        }
        (HeaderSurfaceKind::Stage, HeaderHitAction::SplitHorizontal) => {
            Some("Split terminal horizontally")
        }
        (HeaderSurfaceKind::Stage, HeaderHitAction::SplitVertical) => {
            Some("Split terminal vertically")
        }
        (HeaderSurfaceKind::TerminalContextSurface, HeaderHitAction::ToggleDockViewMode(true)) => {
            Some("Show context as split")
        }
        (HeaderSurfaceKind::TerminalContextSurface, HeaderHitAction::ToggleDockViewMode(false)) => {
            Some("Stack context panes")
        }
        (HeaderSurfaceKind::Stage, HeaderHitAction::ToggleStageViewMode(true)) => {
            Some("Show Stage as split")
        }
        (HeaderSurfaceKind::Stage, HeaderHitAction::ToggleStageViewMode(false)) => {
            Some("Stack Stage terminals")
        }
        (_, HeaderHitAction::OpenBrowser) => Some("Open browser pane"),
        (_, HeaderHitAction::NewFile) => Some("New file pane"),
        _ => None,
    }
}

pub(crate) fn header_leading_view_mode_width(action: Option<&HeaderHitAction>) -> f32 {
    if action.is_some() {
        HEADER_ACTION_TILE_SIZE + TAB_CONTENT_SPACING
    } else {
        0.0
    }
}

fn compact_surface_owner_label(owner_label: &str) -> String {
    let owner_label = owner_label.trim();
    let owner_label = if owner_label.is_empty() {
        "Terminal"
    } else {
        owner_label
    };
    let char_count = owner_label.chars().count();
    if char_count <= SURFACE_IDENTITY_OWNER_MAX_CHARS {
        owner_label.to_string()
    } else {
        let take = SURFACE_IDENTITY_OWNER_MAX_CHARS.saturating_sub(3);
        let compacted = owner_label
            .chars()
            .take(take)
            .collect::<String>()
            .trim_end_matches([' ', '-', '_'])
            .to_string();
        format!("{}...", compacted)
    }
}

pub(crate) fn terminal_context_surface_identity_label(
    owner_label: &str,
    pane_count: usize,
    is_stacked: bool,
) -> String {
    let mode = if is_stacked { "stacked" } else { "split" };
    let pane_word = if pane_count == 1 { "pane" } else { "panes" };
    format!(
        "Context: {} / {} / {} {}",
        compact_surface_owner_label(owner_label),
        mode,
        pane_count,
        pane_word
    )
}

fn header_surface_identity_badge_width(cell_w: f32, label: &str) -> f32 {
    if label.trim().is_empty() {
        0.0
    } else {
        label.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0
    }
}

pub(crate) fn header_surface_identity_width(cell_w: f32, label: Option<&str>) -> f32 {
    label
        .map(|label| header_surface_identity_badge_width(cell_w, label))
        .filter(|width| *width > 0.0)
        .map(|width| width + TAB_CONTENT_SPACING)
        .unwrap_or(0.0)
}

pub(crate) fn header_surface_identity_fits(
    available_w: f32,
    cell_w: f32,
    label: &str,
    leading_view_mode_width: f32,
    header_action_width: f32,
) -> bool {
    let identity_w = header_surface_identity_width(cell_w, Some(label));
    if identity_w <= 0.0 {
        return false;
    }
    let action_reserve = if header_action_width > 0.0 {
        header_action_width + TAB_H_PAD
    } else {
        0.0
    };
    let minimum_title_reserve = TAB_MIN_TITLE_WIDTH + BADGE_GAP + 16.0 + TAB_H_PAD;

    available_w
        >= TAB_H_PAD + leading_view_mode_width + identity_w + minimum_title_reserve + action_reserve
}

pub(crate) fn dock_tab_group_uses_shared_tab_bar(tab_group: &crate::tide_layout::TabGroup) -> bool {
    tab_group.len() >= 2
}

pub(crate) fn dock_stacked_uses_shared_tab_bar(dock_pane_ids: &[PaneId]) -> bool {
    dock_pane_ids.len() >= 2
}

pub(crate) fn header_action_strip_width(_cell_w: f32, specs: &[HeaderActionSpec]) -> f32 {
    if specs.is_empty() {
        return 0.0;
    }

    specs.iter().map(|_| HEADER_ACTION_TILE_SIZE).sum::<f32>()
        + BADGE_GAP * specs.len().saturating_sub(1) as f32
}

pub(crate) fn header_action_strip_start_x(right_edge: f32, strip_width: f32) -> f32 {
    if strip_width <= 0.0 {
        right_edge
    } else {
        right_edge - TAB_H_PAD - strip_width
    }
}

pub(crate) fn is_header_action_strip_action(action: &HeaderHitAction) -> bool {
    matches!(
        action,
        HeaderHitAction::AddPane
            | HeaderHitAction::NewFile
            | HeaderHitAction::OpenBrowser
            | HeaderHitAction::SplitHorizontal
            | HeaderHitAction::SplitVertical
            | HeaderHitAction::ToggleStageViewMode(_)
            | HeaderHitAction::ToggleDockViewMode(_)
    )
}

pub(crate) fn header_action_icon(action: &HeaderHitAction) -> Option<HeaderActionIcon> {
    match action {
        HeaderHitAction::AddPane => Some(HeaderActionIcon::AddPane),
        HeaderHitAction::OpenBrowser => Some(HeaderActionIcon::Browser),
        HeaderHitAction::SplitHorizontal => Some(HeaderActionIcon::SplitHorizontal),
        HeaderHitAction::SplitVertical => Some(HeaderActionIcon::SplitVertical),
        HeaderHitAction::ToggleStageViewMode(false)
        | HeaderHitAction::ToggleDockViewMode(false) => Some(HeaderActionIcon::EnterStackMode),
        HeaderHitAction::ToggleStageViewMode(true) | HeaderHitAction::ToggleDockViewMode(true) => {
            Some(HeaderActionIcon::EnterSplitMode)
        }
        _ => None,
    }
}

pub(crate) fn header_action_icon_text_glyph(_icon: HeaderActionIcon) -> Option<&'static str> {
    None
}

pub(crate) fn header_close_icon_text_glyph() -> Option<&'static str> {
    None
}

pub(crate) fn header_action_raster_icon_asset(
    icon: HeaderActionIcon,
) -> Option<&'static crate::tide_renderer::RasterIconAsset> {
    match icon {
        HeaderActionIcon::Browser => Some(&FLATICON_BROWSER),
        HeaderActionIcon::SplitHorizontal => Some(&FLATICON_SPLIT_HORIZONTAL),
        HeaderActionIcon::SplitVertical => Some(&FLATICON_SPLIT_VERTICAL),
        HeaderActionIcon::AddPane => None,
        HeaderActionIcon::EnterStackMode => Some(&FLATICON_ENTER_STACK_MODE),
        HeaderActionIcon::EnterSplitMode => Some(&FLATICON_ENTER_SPLIT_MODE),
    }
}

pub(crate) fn header_close_raster_icon_asset() -> &'static crate::tide_renderer::RasterIconAsset {
    &FLATICON_CLOSE
}

pub(crate) fn active_tab_width_cap(available_w: f32) -> f32 {
    available_w
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

#[derive(Debug, Clone, Copy, PartialEq)]
struct HeaderActionTileStyle {
    icon_color: crate::tide_core::Color,
    bg_color: crate::tide_core::Color,
    draw_outline: bool,
}

fn header_action_tile_style(is_emphasized: bool, p: &ThemePalette) -> HeaderActionTileStyle {
    if is_emphasized {
        HeaderActionTileStyle {
            icon_color: p.tab_text_focused,
            bg_color: badge_tint(p.tab_text_focused, 0.08),
            draw_outline: false,
        }
    } else {
        HeaderActionTileStyle {
            icon_color: p.tab_text,
            bg_color: badge_tint(p.tab_text, 0.05),
            draw_outline: false,
        }
    }
}

fn render_header_action_icon(
    renderer: &mut WgpuRenderer,
    action: &HeaderHitAction,
    tile_rect: Rect,
    color: crate::tide_core::Color,
) {
    let Some(icon) = header_action_icon(action) else {
        return;
    };

    let icon_size = 13.0_f32;
    let icon_rect = Rect::new(
        (tile_rect.x + (tile_rect.width - icon_size) / 2.0).round(),
        (tile_rect.y + (tile_rect.height - icon_size) / 2.0).round(),
        icon_size,
        icon_size,
    );
    if let Some(asset) = header_action_raster_icon_asset(icon) {
        renderer.draw_chrome_raster_icon(asset, icon_rect, color);
    } else {
        renderer.draw_chrome_svg_icon(SVG_ICON_ADD_PANE, icon_rect, svg_icon_palette(color, color));
    }
}

fn render_header_action_strip(
    renderer: &mut WgpuRenderer,
    start_x: f32,
    rect: Rect,
    is_emphasized: bool,
    pane_id: PaneId,
    specs: &[HeaderActionSpec],
    p: &ThemePalette,
    zones: &mut Vec<HeaderHitZone>,
) {
    let mut x = start_x;

    for spec in specs {
        render_header_action_tile(renderer, rect, x, is_emphasized, &spec.action, p);
        zones.push(HeaderHitZone {
            pane_id,
            rect: Rect::new(x, rect.y, HEADER_ACTION_TILE_SIZE, TAB_BAR_HEIGHT),
            action: spec.action.clone(),
        });
        x += HEADER_ACTION_TILE_SIZE + BADGE_GAP;
    }
}

fn render_header_surface_identity(
    renderer: &mut WgpuRenderer,
    x: f32,
    text_y: f32,
    cell_w: f32,
    cell_height: f32,
    label: &str,
    is_focused: bool,
    p: &ThemePalette,
) {
    let width = header_surface_identity_badge_width(cell_w, label);
    if width <= 0.0 {
        return;
    }
    let bg = if is_focused {
        badge_tint(p.tab_text_focused, 0.07)
    } else {
        badge_tint(p.tab_text, 0.045)
    };
    let text_color = if is_focused {
        p.tab_text_focused
    } else {
        p.tab_text
    };
    render_badge_colored(
        renderer,
        x,
        text_y,
        width,
        cell_height,
        label,
        text_color,
        bg,
        4.0,
    );
}

fn render_header_action_tile(
    renderer: &mut WgpuRenderer,
    rect: Rect,
    x: f32,
    is_emphasized: bool,
    action: &HeaderHitAction,
    p: &ThemePalette,
) {
    let tile_rect = Rect::new(
        x,
        rect.y + (TAB_BAR_HEIGHT - HEADER_ACTION_TILE_SIZE) / 2.0,
        HEADER_ACTION_TILE_SIZE,
        HEADER_ACTION_TILE_SIZE,
    );
    let style = header_action_tile_style(is_emphasized, p);
    renderer.draw_chrome_rounded_rect(tile_rect, style.bg_color, HEADER_ACTION_TILE_RADIUS);
    if style.draw_outline {
        renderer.draw_chrome_rounded_rect(tile_rect, p.border_subtle, HEADER_ACTION_TILE_RADIUS);
    }
    render_header_action_icon(renderer, action, tile_rect, style.icon_color);
}

fn render_header_close_icon(
    renderer: &mut WgpuRenderer,
    hit_rect: Rect,
    color: crate::tide_core::Color,
    is_modified: bool,
) {
    if is_modified {
        let dot_size = 6.0_f32;
        renderer.draw_chrome_rounded_rect(
            Rect::new(
                hit_rect.x + (hit_rect.width - dot_size) / 2.0,
                hit_rect.y + (hit_rect.height - dot_size) / 2.0,
                dot_size,
                dot_size,
            ),
            color,
            dot_size / 2.0,
        );
    } else {
        let icon_size = 12.0_f32;
        let icon_rect = Rect::new(
            (hit_rect.x + (hit_rect.width - icon_size) / 2.0).round(),
            (hit_rect.y + (hit_rect.height - icon_size) / 2.0).round(),
            icon_size,
            icon_size,
        );
        renderer.draw_chrome_raster_icon(header_close_raster_icon_asset(), icon_rect, color);
    }
}

fn render_header_leading_view_mode_action(
    renderer: &mut WgpuRenderer,
    rect: Rect,
    x: f32,
    is_emphasized: bool,
    pane_id: PaneId,
    action: Option<&HeaderHitAction>,
    p: &ThemePalette,
    zones: &mut Vec<HeaderHitZone>,
) -> f32 {
    let Some(action) = action else {
        return 0.0;
    };

    render_header_action_tile(renderer, rect, x, is_emphasized, action, p);
    zones.push(HeaderHitZone {
        pane_id,
        rect: Rect::new(x, rect.y, HEADER_ACTION_TILE_SIZE, TAB_BAR_HEIGHT),
        action: action.clone(),
    });
    header_leading_view_mode_width(Some(action))
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
            crate::state::gateway_status::AgentStatus::Idle
            | crate::state::gateway_status::AgentStatus::NeedsInput => Self::Attention,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SinglePaneHeaderPaintStep {
    Background,
    Dot,
    LeadingViewModeAction,
}

pub(crate) fn single_pane_header_paint_steps(
    has_visible_dot: bool,
    has_leading_view_mode_action: bool,
) -> Vec<SinglePaneHeaderPaintStep> {
    let mut steps = vec![SinglePaneHeaderPaintStep::Background];
    if has_visible_dot {
        steps.push(SinglePaneHeaderPaintStep::Dot);
    }
    if has_leading_view_mode_action {
        steps.push(SinglePaneHeaderPaintStep::LeadingViewModeAction);
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
        Some(HeaderHitAction::MarkdownPreview) => (
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
        None if badge.text == "permission" || badge.text == "certificate" => (
            p.badge_conflict,
            badge_tint(p.badge_conflict, if is_focused { 0.16 } else { 0.10 }),
        ),
        None if badge.text == "downloaded" => (
            p.git_added,
            badge_tint(p.git_added, if is_focused { 0.16 } else { 0.10 }),
        ),
        None if badge.text == "downloading"
            || badge.text == "streaming"
            || badge.text == "loading" =>
        {
            (
                if is_focused {
                    p.tab_text_focused
                } else {
                    p.tab_text_active
                },
                badge_tint(p.border_focused, if is_focused { 0.16 } else { 0.10 }),
            )
        }
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
        Some(PaneKind::Browser(bp)) => browser_header_badges(bp),
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
        HeaderSurfaceKind::TerminalContextSurface,
        None,
        None,
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
    surface_kind: HeaderSurfaceKind,
    surface_identity_label: Option<&str>,
    surface_view_mode_action: Option<HeaderHitAction>,
) -> Vec<HeaderHitZone> {
    let mut zones = Vec::new();
    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let cell_w = cell_size.width;
    let is_focused = focused == Some(id);
    let header_chrome = single_pane_header_chrome(surface_kind, is_focused);
    let header_actions = single_pane_header_action_specs_for_surface(surface_kind);
    let header_action_width = header_action_strip_width(cell_w, &header_actions);
    let leading_view_mode_width = header_leading_view_mode_width(surface_view_mode_action.as_ref());
    let surface_identity_label = surface_identity_label.filter(|label| {
        header_surface_identity_fits(
            rect.width,
            cell_w,
            label,
            leading_view_mode_width,
            header_action_width,
        )
    });
    let surface_identity_width = header_surface_identity_width(cell_w, surface_identity_label);
    let text_y = rect.y + (TAB_BAR_HEIGHT - cell_height) / 2.0;
    let action_strip_start_x =
        header_action_strip_start_x(rect.x + rect.width, header_action_width);

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
    let view_mode_action_x = rect.x + TAB_H_PAD;
    let mut cx = view_mode_action_x + leading_view_mode_width;
    let surface_identity_x = cx;
    cx += surface_identity_width;

    let visible_dot_state = if show_stage_terminal_dot || agent_chrome_state.is_some() {
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
        Some(PaneKind::Browser(bp)) => {
            let t = bp.title();
            let c = if is_focused {
                p.tab_text_focused
            } else {
                p.tab_text
            };
            for badge in browser_header_badges(bp) {
                let (text_color, bg) = editor_badge_colors(&badge, p, is_focused);
                inline_badges.push((badge.text.clone(), text_color, bg, badge.action.clone()));
            }
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
    let close_hit_size = 16.0_f32;
    let is_modified = match panes.get(&id) {
        Some(PaneKind::Editor(ep)) => ep.editor.is_modified(),
        _ => false,
    };
    let close_color = if is_modified {
        p.editor_modified
    } else {
        p.close_icon
    };

    let badge_gap = 4.0_f32;
    let title_w_raw = title.chars().count() as f32 * cell_w;
    let badge_widths: Vec<f32> = inline_badges
        .iter()
        .map(|(text, _, _, _)| text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0)
        .collect();
    let header_layout = single_pane_header_layout(
        available_w,
        header_action_width,
        title_w_raw,
        &badge_widths,
        visible_dot_state.is_some(),
        leading_view_mode_width + surface_identity_width,
    );

    // Draw full-width focused single-pane header surface.
    for step in single_pane_header_paint_steps(
        visible_dot_state.is_some(),
        surface_view_mode_action.is_some(),
    ) {
        match step {
            SinglePaneHeaderPaintStep::Background => {
                if header_chrome.draw_active_background {
                    renderer.draw_chrome_rect(
                        Rect::new(rect.x, rect.y, header_layout.surface_w, TAB_BAR_HEIGHT),
                        p.active_tab_bg,
                    );
                }
                if header_chrome.draw_active_indicator {
                    renderer.draw_chrome_rect(
                        Rect::new(
                            rect.x,
                            rect.y,
                            header_layout.surface_w,
                            TAB_ACTIVE_INDICATOR_HEIGHT,
                        ),
                        p.border_focused,
                    );
                }
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
            SinglePaneHeaderPaintStep::LeadingViewModeAction => {
                render_header_leading_view_mode_action(
                    renderer,
                    rect,
                    view_mode_action_x,
                    is_focused,
                    id,
                    surface_view_mode_action.as_ref(),
                    p,
                    &mut zones,
                );
            }
        }
    }

    // Position close icon relative to the full-width header lane.
    let close_hit_x = rect.x + header_layout.close_hit_x;
    let title_layout = header_layout.title_layout;
    let title_w = title_layout.title_w;

    if let Some(label) = surface_identity_label {
        render_header_surface_identity(
            renderer,
            surface_identity_x,
            text_y,
            cell_w,
            cell_height,
            label,
            is_focused,
            p,
        );
    }

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

    if !header_actions.is_empty() {
        if header_chrome.show_header_action_strip {
            render_header_action_strip(
                renderer,
                action_strip_start_x,
                rect,
                is_focused,
                id,
                &header_actions,
                p,
                &mut zones,
            );
        }
    }

    // Draw close icon centered in hit area.
    let close_hit_rect = Rect::new(close_hit_x, rect.y, close_hit_size, TAB_BAR_HEIGHT);
    render_header_close_icon(renderer, close_hit_rect, close_color, is_modified);
    zones.push(HeaderHitZone {
        pane_id: id,
        rect: close_hit_rect,
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
    surface_identity_label: Option<&str>,
    surface_view_mode_action: Option<HeaderHitAction>,
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
        surface_identity_label,
        surface_view_mode_action,
    )
}

/// Shared tab bar rendering for both Dock and Stage stacked mode.
/// `is_dock` determines the hit action type (DockTab vs StageTab).
/// `_is_stacked` true = zoomed/stacked mode; false = tab group within split.
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
    _is_stacked: bool,
    show_comment_badge: bool,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
    auto_fit_active_tab: bool,
    surface_identity_label: Option<&str>,
    surface_view_mode_action: Option<HeaderHitAction>,
) -> Vec<HeaderHitZone> {
    let mut zones = Vec::new();
    let cell_size = renderer.cell_size();
    let cell_height = cell_size.height;
    let cell_w = cell_size.width;
    let is_focused = focused == Some(pane_id);
    let header_surface = if is_dock {
        HeaderSurfaceKind::TerminalContextSurface
    } else {
        HeaderSurfaceKind::Stage
    };
    let header_actions = stacked_tab_bar_header_action_specs_for_surface(header_surface);
    let header_action_width = header_action_strip_width(cell_w, &header_actions);
    let header_action_gap = if header_action_width > 0.0 {
        TAB_H_PAD
    } else {
        0.0
    };

    // Tab height = TAB_BAR_HEIGHT (fills entire bar)
    let tab_h = TAB_BAR_HEIGHT;
    let tab_y = rect.y;
    let mut content_left = rect.x;
    let content_right = rect.x + rect.width;

    // Region ViewMode controls live in the leading slot. In stacked mode this
    // reuses the existing stack icon position instead of adding a trailing tile.
    if surface_view_mode_action.is_some() {
        content_left += TAB_H_PAD;
        content_left += render_header_leading_view_mode_action(
            renderer,
            rect,
            content_left,
            is_focused,
            pane_id,
            surface_view_mode_action.as_ref(),
            p,
            &mut zones,
        );
    }

    let surface_identity_label = surface_identity_label.filter(|label| {
        header_surface_identity_fits(
            rect.width,
            cell_w,
            label,
            header_leading_view_mode_width(surface_view_mode_action.as_ref()),
            header_action_width,
        )
    });
    if let Some(label) = surface_identity_label {
        render_header_surface_identity(
            renderer,
            content_left,
            rect.y + (TAB_BAR_HEIGHT - cell_height) / 2.0,
            cell_w,
            cell_height,
            label,
            is_focused,
            p,
        );
        content_left += header_surface_identity_width(cell_w, Some(label));
    }

    if content_right - content_left < 40.0 {
        return zones;
    }

    // Badges are shown on the active tab only (editor badges like edit/preview)

    let action_strip_start_x = header_action_strip_start_x(content_right, header_action_width);
    let tabs_right = if header_action_width > 0.0 {
        action_strip_start_x - header_action_gap
    } else {
        content_right
    };
    let max_tabs_w = tabs_right - content_left;
    if max_tabs_w < 40.0 {
        return zones;
    }
    let active_tab_cap = shared_tab_active_width_cap(max_tabs_w, tab_ids.len());

    // Compute tab labels and widths
    // Layout per tab: [pad 6] [dot?] [icon?] [gap 6] [title...] [spacer] [badges?] [close 16x16 (9px)] [pad 6]
    let close_hit_size = 16.0_f32;
    let badge_gap = 4.0_f32;
    let mut tabs_info: Vec<(PaneId, String, f32)> = Vec::new();
    for &tid in tab_ids {
        let mut label = dock_tab_label(panes, tid);
        if pinned_ids.contains(&tid) {
            label = format!("\u{f08d} {}", label);
        }
        let has_agent_status = pane_agent_chrome_visual_state(panes, detected_agents, tid)
            .filter(|_| !is_dock || matches!(panes.get(&tid), Some(PaneKind::Browser(_))))
            .is_some();
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
        if let Some(state) = pane_agent_chrome_visual_state(panes, detected_agents, *tid)
            .filter(|_| !is_dock || matches!(panes.get(tid), Some(PaneKind::Browser(_))))
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
        let tab_close_color = if is_tab_modified {
            p.editor_modified
        } else {
            p.close_icon
        };
        let close_clip =
            Rect::new(tab_close_hit_x, rect.y, close_hit_size, TAB_BAR_HEIGHT).clip_to(&tab_clip);
        if close_clip.width > 0.0 {
            render_header_close_icon(renderer, close_clip, tab_close_color, is_tab_modified);
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

    if !header_actions.is_empty() {
        render_header_action_strip(
            renderer,
            action_strip_start_x,
            rect,
            is_focused,
            active_pane,
            &header_actions,
            p,
            &mut zones,
        );
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
    show_comment_badge: bool,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
    auto_fit_active_tab: bool,
    surface_view_mode_action: Option<HeaderHitAction>,
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
        None,
        surface_view_mode_action,
    )
}

/// Render a Dock stacked-mode tab bar showing all Terminal Context Surface panes.
pub fn render_dock_stacked_tab_bar(
    active_pane: PaneId,
    rect: Rect,
    dock_pane_ids: &[PaneId],
    panes: &HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    p: &ThemePalette,
    renderer: &mut WgpuRenderer,
    show_comment_badge: bool,
    detected_agents: &HashMap<u64, crate::state::gateway_status::AgentInfo>,
    blink_time: Option<f64>,
    tab_scroll_offset: f32,
    auto_fit_active_tab: bool,
    surface_identity_label: Option<&str>,
    surface_view_mode_action: Option<HeaderHitAction>,
) -> Vec<HeaderHitZone> {
    if dock_pane_ids.len() < 2 {
        return Vec::new();
    }
    render_tab_bar_impl(
        active_pane,
        rect,
        dock_pane_ids,
        active_pane,
        panes,
        focused,
        &[],
        p,
        renderer,
        true,
        true,
        show_comment_badge,
        detected_agents,
        blink_time,
        tab_scroll_offset,
        auto_fit_active_tab,
        surface_identity_label,
        surface_view_mode_action,
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
    use crate::pane::browser::{
        BrowserCertificateError, BrowserPane, BrowserPermissionKind, BrowserPermissionRequest,
    };
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
    fn source_mode_badge_offers_read() {
        // Spec: docs/specs/markdown-reading-edit-modes.md UC-2 BR-5
        let ep = make_markdown_editor(1); // new_empty → Source (preview_mode=false)
        let badges = editor_header_badges(&ep);
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "read");
        assert_eq!(badges[0].action, Some(HeaderHitAction::MarkdownPreview));
    }

    #[test]
    fn reading_mode_badge_offers_edit() {
        // Spec: docs/specs/markdown-reading-edit-modes.md UC-2 BR-4
        let mut ep = make_markdown_editor(1);
        ep.preview_mode = true;
        let badges = editor_header_badges(&ep);
        assert_eq!(badges.len(), 1);
        assert_eq!(badges[0].text, "edit");
        assert_eq!(badges[0].action, Some(HeaderHitAction::MarkdownPreview));
    }

    #[test]
    fn markdown_badge_never_offers_live_preview() {
        // Spec: docs/specs/markdown-reading-edit-modes.md UC-2 BR-6
        let ep = make_markdown_editor(1);
        let badges = editor_header_badges(&ep);
        assert!(badges
            .iter()
            .all(|b| b.action == Some(HeaderHitAction::MarkdownPreview)));
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
            assert_eq!(badges[0].text, "read");
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
            vec!["compare", "conflict", "read"],
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
            vec!["read", "comment"],
            "active markdown chrome should keep the read/edit switch ahead of add-comment affordances"
        );
    }

    #[test]
    fn browser_header_badges_prioritize_actionable_operation_state() {
        let mut browser = BrowserPane::with_url(7, "https://example.com".into());
        browser.loading = true;
        browser.streaming = true;
        browser.begin_download("https://example.com/report.pdf", "/tmp/tide-report.pdf");
        browser.set_certificate_error(BrowserCertificateError {
            host: "example.com".to_string(),
            reason: "expired".to_string(),
        });
        browser.request_permission(BrowserPermissionRequest {
            kind: BrowserPermissionKind::Camera,
            origin: "https://example.com".to_string(),
        });

        assert_eq!(browser_header_badges(&browser)[0].text, "permission");

        browser.pending_permission = None;
        assert_eq!(browser_header_badges(&browser)[0].text, "certificate");

        browser.pending_certificate_error = None;
        assert_eq!(browser_header_badges(&browser)[0].text, "downloading");

        browser.complete_download();
        assert_eq!(browser_header_badges(&browser)[0].text, "downloaded");

        browser.download_state = None;
        assert_eq!(browser_header_badges(&browser)[0].text, "streaming");

        browser.streaming = false;
        browser.loading = true;
        assert_eq!(browser_header_badges(&browser)[0].text, "loading");

        browser.loading = false;
        browser.record_review_artifact(
            9,
            "review this".to_string(),
            "https://example.com".to_string(),
            1,
        );
        assert_eq!(browser_header_badges(&browser)[0].text, "reviewed");
    }

    #[test]
    fn browser_operation_badge_precedes_comment_badge() {
        let mut browser = BrowserPane::with_url(1, "https://example.com".into());
        browser.loading = true;

        let mut panes = HashMap::new();
        panes.insert(1, PaneKind::Browser(browser));

        let badges = active_tab_badges(&panes, &1, true, true);
        let badge_texts: Vec<&str> = badges.iter().map(|badge| badge.text.as_str()).collect();

        assert_eq!(
            badge_texts,
            vec!["loading", "comment"],
            "active Browser chrome should keep operation state ahead of comment affordances"
        );
        assert_eq!(badges[1].action, Some(HeaderHitAction::AddComment));
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
            single_pane_header_paint_steps(true, false),
            vec![
                SinglePaneHeaderPaintStep::Background,
                SinglePaneHeaderPaintStep::Dot,
            ]
        );
        assert_eq!(
            single_pane_header_paint_steps(false, false),
            vec![SinglePaneHeaderPaintStep::Background]
        );
    }

    #[test]
    fn browser_agent_control_mode_projects_agent_chrome_state() {
        let browser_id = 7;
        let browser =
            crate::pane::browser::BrowserPane::with_url(browser_id, "https://example.com".into());
        let mut panes = HashMap::new();
        panes.insert(browser_id, PaneKind::Browser(browser));
        let agents = HashMap::new();

        assert_eq!(
            pane_agent_chrome_visual_state(&panes, &agents, browser_id),
            None
        );

        let Some(PaneKind::Browser(browser)) = panes.get_mut(&browser_id) else {
            panic!("browser should exist");
        };
        browser.enter_agent_browser_control_mode(1, 1);

        assert_eq!(
            pane_agent_chrome_visual_state(&panes, &agents, browser_id),
            Some(AgentChromeState::Running)
        );
    }

    #[test]
    fn terminal_context_single_pane_header_action_specs_use_split_icons_without_add_pane() {
        let specs =
            single_pane_header_action_specs_for_surface(HeaderSurfaceKind::TerminalContextSurface);
        let actions: Vec<HeaderHitAction> = specs.iter().map(|spec| spec.action.clone()).collect();

        assert_eq!(
            actions,
            vec![
                HeaderHitAction::SplitHorizontal,
                HeaderHitAction::SplitVertical,
            ]
        );
        assert!(!actions.contains(&HeaderHitAction::AddPane));
    }

    #[test]
    fn terminal_context_surface_identity_label_names_owner_mode_and_count() {
        assert_eq!(
            terminal_context_surface_identity_label("Terminal 1", 1, true),
            "Context: Terminal 1 / stacked / 1 pane"
        );
        assert_eq!(
            terminal_context_surface_identity_label("workspace-shell", 3, false),
            "Context: workspace-shell / split / 3 panes"
        );
    }

    #[test]
    fn terminal_context_surface_header_actions_use_context_hover_labels() {
        assert_eq!(
            header_action_hover_label(
                &HeaderHitAction::AddPane,
                HeaderSurfaceKind::TerminalContextSurface,
            ),
            Some("Add context pane")
        );
        assert_eq!(
            header_action_hover_label(
                &HeaderHitAction::SplitHorizontal,
                HeaderSurfaceKind::TerminalContextSurface,
            ),
            Some("Split context horizontally")
        );
        assert_eq!(
            header_action_hover_label(
                &HeaderHitAction::SplitVertical,
                HeaderSurfaceKind::TerminalContextSurface,
            ),
            Some("Split context vertically")
        );
        assert_eq!(
            header_action_hover_label(
                &HeaderHitAction::ToggleDockViewMode(true),
                HeaderSurfaceKind::TerminalContextSurface,
            ),
            Some("Show context as split")
        );
        assert_eq!(
            header_action_hover_label(
                &HeaderHitAction::ToggleDockViewMode(false),
                HeaderSurfaceKind::TerminalContextSurface,
            ),
            Some("Stack context panes")
        );
    }

    #[test]
    fn stage_header_actions_keep_stage_specific_hover_labels() {
        assert_eq!(
            header_action_hover_label(&HeaderHitAction::AddPane, HeaderSurfaceKind::Stage),
            Some("Add stage terminal")
        );
        assert_eq!(
            header_action_hover_label(&HeaderHitAction::SplitHorizontal, HeaderSurfaceKind::Stage,),
            Some("Split terminal horizontally")
        );
        assert_eq!(
            header_action_hover_label(
                &HeaderHitAction::ToggleStageViewMode(false),
                HeaderSurfaceKind::Stage,
            ),
            Some("Stack Stage terminals")
        );
    }

    #[test]
    fn terminal_context_surface_identity_compacts_long_owner_labels() {
        assert_eq!(
            terminal_context_surface_identity_label(
                "a-very-long-terminal-working-directory",
                2,
                true
            ),
            "Context: a-very-long-terminal... / stacked / 2 panes"
        );
    }

    #[test]
    fn surface_identity_width_is_reserved_only_when_header_has_room() {
        let label = terminal_context_surface_identity_label("Terminal 1", 1, true);
        let cell_w = 8.0;
        let leading_w =
            header_leading_view_mode_width(Some(&HeaderHitAction::ToggleDockViewMode(true)));
        let action_w = header_action_strip_width(
            cell_w,
            &single_pane_header_action_specs_for_surface(HeaderSurfaceKind::TerminalContextSurface),
        );

        assert!(header_surface_identity_width(cell_w, Some(&label)) > 0.0);
        assert!(header_surface_identity_fits(
            520.0, cell_w, &label, leading_w, action_w
        ));
        assert!(!header_surface_identity_fits(
            220.0, cell_w, &label, leading_w, action_w
        ));
    }

    #[test]
    fn stage_single_pane_header_action_specs_omit_add_pane() {
        let specs = single_pane_header_action_specs_for_surface(HeaderSurfaceKind::Stage);
        let actions: Vec<HeaderHitAction> = specs.iter().map(|spec| spec.action.clone()).collect();

        assert_eq!(
            actions,
            vec![
                HeaderHitAction::SplitHorizontal,
                HeaderHitAction::SplitVertical,
            ]
        );
        assert!(!actions.contains(&HeaderHitAction::AddPane));
    }

    #[test]
    fn browser_header_action_uses_browser_window_icon_role() {
        assert_eq!(
            header_action_icon(&HeaderHitAction::OpenBrowser),
            Some(HeaderActionIcon::Browser)
        );
        assert_eq!(header_action_icon(&HeaderHitAction::Close), None);
    }

    #[test]
    fn add_pane_header_action_uses_plus_icon_role() {
        assert_eq!(
            header_action_icon(&HeaderHitAction::AddPane),
            Some(HeaderActionIcon::AddPane)
        );
    }

    #[test]
    fn split_header_action_icons_use_requested_direction_roles() {
        assert_eq!(
            header_action_icon(&HeaderHitAction::SplitHorizontal),
            Some(HeaderActionIcon::SplitHorizontal)
        );
        assert_eq!(
            header_action_icon(&HeaderHitAction::SplitVertical),
            Some(HeaderActionIcon::SplitVertical)
        );
        assert_ne!(
            header_action_icon(&HeaderHitAction::SplitHorizontal),
            header_action_icon(&HeaderHitAction::SplitVertical)
        );
    }

    #[test]
    fn dock_shared_tab_bar_requires_multiple_tabs() {
        let single = crate::tide_layout::TabGroup::single(1);
        assert!(!dock_tab_group_uses_shared_tab_bar(&single));

        let mut multi = crate::tide_layout::TabGroup::single(1);
        multi.add_tab(2);
        assert!(dock_tab_group_uses_shared_tab_bar(&multi));
    }

    #[test]
    fn header_action_tile_style_uses_ghost_chrome_without_outline() {
        let emphasized = header_action_tile_style(true, &crate::theme::DARK);
        assert!(!emphasized.draw_outline);
        assert!(emphasized.bg_color.a > 0.0);
        assert!(emphasized.bg_color.a < 0.2);

        let unfocused = header_action_tile_style(false, &crate::theme::DARK);
        assert!(!unfocused.draw_outline);
        assert!(unfocused.bg_color.a > 0.0);
        assert!(unfocused.bg_color.a < emphasized.bg_color.a);
    }

    #[test]
    fn stacked_tab_bar_header_action_specs_use_plus_instead_of_split_icons() {
        for surface in [
            HeaderSurfaceKind::Stage,
            HeaderSurfaceKind::TerminalContextSurface,
        ] {
            let actions: Vec<HeaderHitAction> =
                stacked_tab_bar_header_action_specs_for_surface(surface)
                    .iter()
                    .map(|spec| spec.action.clone())
                    .collect();

            assert_eq!(actions, vec![HeaderHitAction::AddPane]);
            assert!(!actions.contains(&HeaderHitAction::SplitHorizontal));
            assert!(!actions.contains(&HeaderHitAction::SplitVertical));
        }
    }

    #[test]
    fn stage_stacked_tab_bar_header_action_specs_use_add_pane() {
        let actions: Vec<HeaderHitAction> =
            stacked_tab_bar_header_action_specs_for_surface(HeaderSurfaceKind::Stage)
                .iter()
                .map(|spec| spec.action.clone())
                .collect();

        assert_eq!(actions, vec![HeaderHitAction::AddPane]);
    }

    #[test]
    fn unfocused_terminal_context_stacked_tab_bar_header_action_specs_remain_visible() {
        let actions: Vec<HeaderHitAction> = stacked_tab_bar_header_action_specs_for_surface(
            HeaderSurfaceKind::TerminalContextSurface,
        )
        .iter()
        .map(|spec| spec.action.clone())
        .collect();

        assert_eq!(actions, vec![HeaderHitAction::AddPane]);
    }

    #[test]
    fn header_action_strip_start_x_anchors_to_the_header_edge() {
        assert_eq!(header_action_strip_start_x(320.0, 0.0), 320.0);
        assert_eq!(
            header_action_strip_start_x(320.0, 42.0),
            320.0 - TAB_H_PAD - 42.0
        );
    }

    #[test]
    fn focused_header_action_strip_reserves_right_controls_width() {
        let specs = single_pane_header_action_specs();
        let strip_width = header_action_strip_width(8.0, &specs);

        assert!(strip_width > 0.0);
        assert!(
            strip_width > HEADER_ACTION_TILE_SIZE,
            "focused header action strip should reserve more than a single icon tile"
        );
    }
}
