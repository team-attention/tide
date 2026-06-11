// Spec: docs/specs/pane-chrome.md

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use crate::adapter::inward::event_loop_adapter::terminal_badge_check_delay;
use crate::adapter::inward::scroll_adapter::{
    clamp_shared_tab_scroll_offset, handle_scroll, shared_tab_scroll_delta,
    shared_tab_scroll_is_new_gesture, shared_tab_scroll_step,
};
use crate::adapter::outward::view::header::{
    active_tab_badges, active_tab_width_cap, dock_stacked_uses_shared_tab_bar,
    dock_tab_group_uses_shared_tab_bar, overflowed_stage_alert_tab_edges,
    reserve_title_before_badges, resolve_tab_scroll_offset, shared_tab_active_width_cap,
    shared_tab_target_width, stage_terminal_dot_color, stage_terminal_dot_status,
    stage_terminal_dot_visual_state, tab_status_dot_width, terminal_chrome_agent_status,
    terminal_chrome_visual_state, terminal_header_title_color, AgentChromeState, HeaderHitAction,
};
use crate::adapter::outward::view::{
    integration_toggle_notification_indicator_color, pane_surface_attention_status,
    workspace_item_indicator_color, workspace_item_indicator_status, wrapped_agent_blink_time,
};
use crate::application::services::file_tree_service::sync_terminal_badge_runtime_context;
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalContext, TerminalPane};
use crate::state::FocusArea;
use crate::theme::{
    ACTIVE_TAB_MAX_WIDTH, AGENT_BLINK_FREQUENCY, BADGE_GAP, BADGE_PADDING_H, DARK, LIGHT,
    TAB_BAR_HEIGHT, TAB_CONTENT_SPACING, TAB_H_PAD, TAB_MAX_WIDTH, TAB_MIN_TITLE_WIDTH,
};
use crate::tide_core::{DropZone, LayoutEngine, Rect, SplitDirection, Vec2};
use crate::tide_terminal::git::{GitInfo, GitStatus, WorktreeInfo};
use crate::ui::pane_title;
use crate::{App, AppCorePort, DockPort};

fn terminal_with_git_info(id: u64) -> (HashMap<u64, PaneKind>, String) {
    let pid = std::process::id();
    let cwd = PathBuf::from(format!("/tmp/tc{}", pid));
    std::fs::create_dir_all(&cwd).unwrap();

    let mut terminal = TerminalPane::with_cwd(id, 80, 24, Some(cwd), true).unwrap();
    terminal.context.git_info = Some(GitInfo {
        branch: "main".to_string(),
        status: GitStatus::default(),
    });

    let expected_title = format!("tmp/tc{}", pid);
    let mut panes = HashMap::new();
    panes.insert(id, PaneKind::Terminal(terminal));
    (panes, expected_title)
}

fn app_with_single_preview_editor(line_count: usize) -> (App, u64, Rect) {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app.ft.visible = false;
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;

    let mut pane = EditorPane::new_empty(id);
    pane.preview_mode = true;
    pane.editor.buffer.lines = (0..line_count).map(|idx| format!("line {}", idx)).collect();
    let pane_rect = Rect::new(0.0, 0.0, 420.0, 320.0);
    let content_rect = pane.content_rect(pane_rect, TAB_BAR_HEIGHT, app.window.cached_cell_size);
    pane.prepare_inline_caches(content_rect, app.window.cached_cell_size, true);

    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.stage_focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    app.pane_rects = vec![(id, pane_rect)];
    app.visual_pane_rects = vec![(id, pane_rect)];

    (app, id, pane_rect)
}

fn color_tuple(color: crate::tide_core::Color) -> (u32, u32, u32, u32) {
    (
        color.r.to_bits(),
        color.g.to_bits(),
        color.b.to_bits(),
        color.a.to_bits(),
    )
}

fn color_brightness(color: crate::tide_core::Color) -> f32 {
    color.r + color.g + color.b
}

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn wrapped_agent_info(
    status: crate::state::gateway_status::AgentStatus,
) -> crate::state::gateway_status::AgentInfo {
    crate::state::gateway_status::AgentInfo {
        name: "Codex",
        pid: 42,
        wrapper_managed: true,
        gateway_connected: true,
        status: Some(status),
    }
}

fn connected_idle_wrapped_agent_info() -> crate::state::gateway_status::AgentInfo {
    crate::state::gateway_status::AgentInfo {
        name: "Codex",
        pid: 42,
        wrapper_managed: true,
        gateway_connected: true,
        status: None,
    }
}

fn quarter_phase_blink_time() -> f64 {
    std::f64::consts::FRAC_PI_2 / AGENT_BLINK_FREQUENCY
}

fn color_distance(a: crate::tide_core::Color, b: crate::tide_core::Color) -> f32 {
    (a.r - b.r).abs() + (a.g - b.g).abs() + (a.b - b.b).abs() + (a.a - b.a).abs()
}

#[test]
fn integration_toggle_notification_indicator_uses_success_for_authorized_states() {
    // UC-7 BR-1: Authorized notification states use the success indicator on the integration toggle.
    for status in [
        crate::state::NotificationAuthorizationStatus::Authorized,
        crate::state::NotificationAuthorizationStatus::Provisional,
        crate::state::NotificationAuthorizationStatus::Ephemeral,
    ] {
        let color = integration_toggle_notification_indicator_color(true, status)
            .expect("authorized notification status should render an indicator");
        assert!(
            color_distance(color, crate::tide_core::Color::new(0.3, 0.8, 0.4, 1.0)) < 0.001,
            "expected success indicator color for {status:?}, got {color:?}"
        );
    }
}

#[test]
fn integration_toggle_notification_indicator_uses_warning_for_unknown_and_not_determined() {
    // UC-7 BR-2: Unknown and not-determined notification states use the warning indicator.
    for status in [
        crate::state::NotificationAuthorizationStatus::Unknown,
        crate::state::NotificationAuthorizationStatus::NotDetermined,
    ] {
        let color = integration_toggle_notification_indicator_color(true, status)
            .expect("warning notification status should render an indicator");
        assert!(
            color_distance(color, crate::tide_core::Color::new(0.95, 0.65, 0.2, 1.0)) < 0.001,
            "expected warning indicator color for {status:?}, got {color:?}"
        );
    }
}

#[test]
fn integration_toggle_notification_indicator_uses_error_for_denied_status() {
    // UC-7 BR-3: Denied notification status uses the error indicator.
    let color = integration_toggle_notification_indicator_color(
        true,
        crate::state::NotificationAuthorizationStatus::Denied,
    )
    .expect("denied notification status should render an indicator");
    assert!(
        color_distance(color, DARK.diff_removed_gutter) < 0.001,
        "expected denied indicator color, got {color:?}"
    );
}

#[test]
fn integration_toggle_notification_indicator_hides_when_auto_integration_is_disabled() {
    // UC-7 BR-4: Disabled auto-integration hides the notification-authorization indicator.
    assert!(integration_toggle_notification_indicator_color(
        false,
        crate::state::NotificationAuthorizationStatus::Authorized
    )
    .is_none());
}

// --- UC-1: RenderFocusedPaneChrome ---

#[test]
fn focused_header_accent_is_visually_distinct_from_unfocused_chrome() {
    // UC-1 BR-1: Focused Stage and Dock Panes use a dedicated active header/tab cue.
    assert_ne!(
        color_tuple(DARK.border_focused),
        color_tuple(DARK.border_subtle)
    );
    assert_ne!(
        color_tuple(LIGHT.border_focused),
        color_tuple(LIGHT.border_subtle)
    );
}

#[test]
fn focused_header_accent_renders_without_agent_status() {
    // UC-1 BR-2: Focus chrome remains visible without wrapper-managed AgentStatus.
    assert!(DARK.border_focused.a > 0.0);
    assert!(LIGHT.border_focused.a > 0.0);
}

// --- UC-2: RenderNeedsInputAttentionChrome ---

#[test]
fn stage_terminal_attention_does_not_use_pane_surface_fill_or_underline() {
    // UC-2 BR-3: Wrapper-managed attention is dot-only and does not add pane-surface fill or underline.
    assert_eq!(
        pane_surface_attention_status(Some(crate::state::gateway_status::AgentStatus::Idle), true),
        None
    );
    assert_eq!(
        pane_surface_attention_status(
            Some(crate::state::gateway_status::AgentStatus::NeedsInput),
            false,
        ),
        None
    );
    assert_eq!(
        pane_surface_attention_status(
            Some(crate::state::gateway_status::AgentStatus::Running),
            false,
        ),
        None
    );
}

#[test]
fn idle_and_needs_input_share_the_same_stage_terminal_alert_family() {
    // UC-2 BR-4: Idle and NeedsInput share the same orange alert dot family on Stage Terminal chrome.
    let idle_color =
        stage_terminal_dot_color(crate::state::gateway_status::AgentStatus::Idle, Some(0.0));
    let needs_input_color = stage_terminal_dot_color(
        crate::state::gateway_status::AgentStatus::NeedsInput,
        Some(0.0),
    );

    assert_eq!(idle_color.r.to_bits(), needs_input_color.r.to_bits());
    assert_eq!(idle_color.g.to_bits(), needs_input_color.g.to_bits());
    assert_eq!(idle_color.b.to_bits(), needs_input_color.b.to_bits());
    assert!(idle_color.r > idle_color.g);
    assert!(idle_color.g > idle_color.b);
}

#[test]
fn focused_stage_terminal_keeps_its_alert_dot_until_acknowledged() {
    // UC-2 BR-6: A focused direct wrapped-agent Stage Terminal keeps its alert dot until acknowledgment clears the status.
    let terminal_id = 10;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    let mut panes = HashMap::new();
    panes.insert(terminal_id, PaneKind::Terminal(terminal));
    let mut detected_agents = HashMap::new();
    detected_agents.insert(
        terminal_id,
        wrapped_agent_info(crate::state::gateway_status::AgentStatus::NeedsInput),
    );

    assert_eq!(
        stage_terminal_dot_status(&panes, &detected_agents, terminal_id, true),
        Some(crate::state::gateway_status::AgentStatus::NeedsInput)
    );
}

// --- UC-4: RenderWorkspaceIndicatorChrome ---

#[test]
fn inactive_workspace_alert_renders_an_orange_blinking_dot() {
    // UC-4 BR-11: An inactive Workspace item with unresolved Stage-terminal Idle or NeedsInput renders an orange blinking dot.
    let status = workspace_item_indicator_status(false, false, true, false);
    let start = workspace_item_indicator_color(status.expect("inactive alert status"), Some(0.0));
    let later = workspace_item_indicator_color(
        status.expect("inactive alert status"),
        Some(quarter_phase_blink_time()),
    );

    assert!(start.r > start.g && start.g > start.b);
    assert_ne!(start.a.to_bits(), later.a.to_bits());
}

#[test]
fn workspace_running_renders_a_green_dot() {
    // UC-4 BR-12: A Workspace item with Stage-terminal Running renders a green dot.
    let status = workspace_item_indicator_status(false, true, false, false)
        .expect("running workspace indicator");
    let color = workspace_item_indicator_color(status, Some(0.0));

    assert!(color.g > color.r);
    assert!(color.g > color.b);
    assert_eq!(color.a, 1.0);
}

#[test]
fn active_workspace_running_uses_the_live_stage_terminal_state() {
    // UC-4 BR-12: The active Workspace item reads Running from the live Stage Terminal state.
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    app.focus.focused = Some(terminal_id);
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.gateway.detected_agents.insert(
        terminal_id,
        wrapped_agent_info(crate::state::gateway_status::AgentStatus::Running),
    );

    let (has_running, has_alert, has_connected_idle) =
        app.workspace_stage_agent_flags(app.ws.active);

    assert!(has_running);
    assert!(!has_alert);
    assert!(!has_connected_idle);
    assert_eq!(
        workspace_item_indicator_status(true, has_running, has_alert, has_connected_idle),
        Some(AgentChromeState::Running)
    );
}

#[test]
fn active_workspace_alert_renders_an_orange_blinking_dot() {
    // UC-4 BR-11: An active Workspace item with unresolved Stage-terminal attention still renders the orange blinking dot.
    let status = workspace_item_indicator_status(true, false, true, false)
        .expect("active workspace alert status");
    let start = workspace_item_indicator_color(status, Some(0.0));
    let later = workspace_item_indicator_color(status, Some(quarter_phase_blink_time()));

    assert_eq!(status, AgentChromeState::Attention);
    assert!(start.r > start.g && start.g > start.b);
    assert_ne!(start.a.to_bits(), later.a.to_bits());
}

#[test]
fn workspace_alert_takes_precedence_over_running() {
    // UC-4 BR-13: A Workspace item with both running and alerting Stage terminals shows the alert state.
    assert_eq!(
        workspace_item_indicator_status(true, true, true, false),
        Some(AgentChromeState::Attention)
    );
    assert_eq!(
        workspace_item_indicator_status(false, true, true, false),
        Some(AgentChromeState::Attention)
    );
}

#[test]
fn connected_wrapped_agent_without_active_status_renders_idle_presence_dot() {
    // UC-8 BR-32: Wrapped Agent Presence without an active AgentStatus renders the idle-presence dot.
    let terminal_id = 13;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    let mut panes = HashMap::new();
    panes.insert(terminal_id, PaneKind::Terminal(terminal));
    let mut detected_agents = HashMap::new();
    detected_agents.insert(terminal_id, connected_idle_wrapped_agent_info());

    assert_eq!(
        terminal_chrome_agent_status(&panes, &detected_agents, terminal_id),
        None
    );
    assert_eq!(
        terminal_chrome_visual_state(&panes, &detected_agents, terminal_id),
        Some(AgentChromeState::ConnectedIdle)
    );
    assert_eq!(
        stage_terminal_dot_visual_state(&panes, &detected_agents, terminal_id, true),
        Some(AgentChromeState::ConnectedIdle)
    );

    let color = stage_terminal_dot_color(AgentChromeState::ConnectedIdle, Some(0.0));
    assert!(color.b > color.g);
    assert!(color.g > color.r);
    assert_eq!(color.a, 1.0);
}

#[test]
fn workspace_connected_idle_renders_an_idle_presence_dot() {
    // UC-8 BR-33: A Workspace item with only connected-idle Wrapped Agent Presence renders the idle-presence dot.
    let status =
        workspace_item_indicator_status(false, false, false, true).expect("idle presence state");
    assert_eq!(status, AgentChromeState::ConnectedIdle);

    let color = workspace_item_indicator_color(status, Some(0.0));
    assert!(color.b > color.g);
    assert!(color.g > color.r);
    assert_eq!(color.a, 1.0);
}

#[test]
fn editor_does_not_inherit_wrapped_agent_chrome_from_associated_terminal() {
    // UC-2 BR-5: A non-terminal Pane never inherits wrapped-agent pane chrome from its Associated Terminal.
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));

    let editor_id = app.layout.alloc_id();
    app.panes.insert(
        editor_id,
        PaneKind::Editor(EditorPane::new_empty(editor_id)),
    );
    app.add_pane_to_dock(editor_id, Some(terminal_id));
    app.assoc.associated_terminal.insert(editor_id, terminal_id);
    app.focus.focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.gateway.detected_agents.insert(
        terminal_id,
        wrapped_agent_info(crate::state::gateway_status::AgentStatus::NeedsInput),
    );

    assert_eq!(app.pane_agent_attention_status(editor_id), None);
}

// --- UC-3: RenderStageTerminalDot ---

#[test]
fn running_stage_terminal_renders_the_wrapped_agent_dot() {
    // UC-3 BR-7: Only a direct wrapped-agent owner Terminal in Stage may render the wrapped-agent status dot.
    let terminal_id = 11;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    let mut panes = HashMap::new();
    panes.insert(terminal_id, PaneKind::Terminal(terminal));
    let mut detected_agents = HashMap::new();
    detected_agents.insert(
        terminal_id,
        wrapped_agent_info(crate::state::gateway_status::AgentStatus::Running),
    );

    assert_eq!(
        terminal_chrome_agent_status(&panes, &detected_agents, terminal_id),
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
    assert_eq!(
        stage_terminal_dot_status(&panes, &detected_agents, terminal_id, true),
        Some(crate::state::gateway_status::AgentStatus::Running)
    );
    assert_eq!(tab_status_dot_width(true), 8.0 + TAB_CONTENT_SPACING);
}

#[test]
fn running_stage_terminal_uses_a_green_dot_signal() {
    // UC-3 BR-8: Running renders a solid green Stage-terminal dot.
    let color = stage_terminal_dot_color(
        crate::state::gateway_status::AgentStatus::Running,
        Some(0.0),
    );

    assert!(color.g > color.r);
    assert!(color.g > color.b);
    assert_eq!(color.a, 1.0);
}

#[test]
fn attention_stage_terminal_renders_an_orange_blinking_dot() {
    // UC-3 BR-10: Unresolved Idle and NeedsInput render an orange blinking Stage-terminal dot.
    let terminal_id = 12;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    let mut panes = HashMap::new();
    panes.insert(terminal_id, PaneKind::Terminal(terminal));

    for status in [
        crate::state::gateway_status::AgentStatus::Idle,
        crate::state::gateway_status::AgentStatus::NeedsInput,
    ] {
        let mut detected_agents = HashMap::new();
        detected_agents.insert(terminal_id, wrapped_agent_info(status));

        assert_eq!(
            terminal_chrome_agent_status(&panes, &detected_agents, terminal_id),
            Some(status)
        );
        assert_eq!(
            stage_terminal_dot_status(&panes, &detected_agents, terminal_id, true),
            Some(status)
        );
        let start = stage_terminal_dot_color(status, Some(0.0));
        let later = stage_terminal_dot_color(status, Some(quarter_phase_blink_time()));
        assert!(start.r > start.g && start.g > start.b);
        assert_ne!(start.a.to_bits(), later.a.to_bits());
    }
}

#[test]
fn wrapped_agent_alert_blink_uses_a_stable_timebase() {
    // UC-3 BR-10: Wrapped-agent alert blink uses a stable origin rather than per-frame elapsed time.
    let origin = std::time::Instant::now();
    let later = origin
        .checked_add(Duration::from_secs_f64(quarter_phase_blink_time()))
        .expect("blink sample instant");

    let start = wrapped_agent_blink_time(origin, origin, true).expect("start blink time");
    let progressed = wrapped_agent_blink_time(later, origin, true).expect("later blink time");

    assert_eq!(start.to_bits(), 0.0f64.to_bits());
    assert!(progressed > start);

    let stage_start =
        stage_terminal_dot_color(crate::state::gateway_status::AgentStatus::Idle, Some(start));
    let stage_later = stage_terminal_dot_color(
        crate::state::gateway_status::AgentStatus::Idle,
        Some(progressed),
    );
    let workspace_start = workspace_item_indicator_color(
        crate::state::gateway_status::AgentStatus::Idle,
        Some(start),
    );
    let workspace_later = workspace_item_indicator_color(
        crate::state::gateway_status::AgentStatus::Idle,
        Some(progressed),
    );

    assert_ne!(stage_start.a.to_bits(), stage_later.a.to_bits());
    assert_ne!(workspace_start.a.to_bits(), workspace_later.a.to_bits());
}

#[test]
fn dock_terminal_does_not_render_the_wrapped_agent_dot() {
    // UC-3 BR-9: Dock chrome does not render the wrapped-agent status dot, even when the docked Pane is a Terminal.
    let terminal_id = 13;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    let mut panes = HashMap::new();
    panes.insert(terminal_id, PaneKind::Terminal(terminal));
    let mut detected_agents = HashMap::new();
    detected_agents.insert(
        terminal_id,
        wrapped_agent_info(crate::state::gateway_status::AgentStatus::Running),
    );

    assert_eq!(
        stage_terminal_dot_status(&panes, &detected_agents, terminal_id, false),
        None
    );
}

// --- UC-5: RenderOverflowedAlertEdgeIndicator ---

#[test]
fn overflowed_alert_stage_tab_sets_the_left_edge_indicator() {
    // UC-5 BR-14: A hidden alert tab left of the visible range renders an orange blinking left-edge indicator.
    let (left, right) = overflowed_stage_alert_tab_edges(&[96.0, 96.0, 96.0], &[0], 140.0, 120.0);

    assert!(left);
    assert!(!right);
}

#[test]
fn overflowed_alert_stage_tab_sets_the_right_edge_indicator() {
    // UC-5 BR-15: A hidden alert tab right of the visible range renders an orange blinking right-edge indicator.
    let (left, right) = overflowed_stage_alert_tab_edges(&[96.0, 96.0, 96.0], &[2], 140.0, 0.0);

    assert!(!left);
    assert!(right);
}

// --- UC-6: PreserveHeaderTitleBesideGitBadges ---

#[test]
fn active_terminal_header_preserves_title_when_git_badges_are_present() {
    // UC-6 BR-16: Active single-pane headers keep a readable title when git branch or git status badges are present.
    let (panes, expected_title) = terminal_with_git_info(1);
    let title = pane_title(&panes, 1);
    assert_eq!(title, expected_title);

    let terminal = match panes.get(&1) {
        Some(PaneKind::Terminal(tp)) => tp,
        _ => panic!("expected a terminal pane"),
    };
    let git = terminal
        .context
        .git_info
        .as_ref()
        .expect("expected git info");
    assert_eq!(git.branch, "main");

    let cell_w = 8.0_f32;
    let close_hit_w = 16.0_f32;
    let branch_badge_w =
        format!("\u{e0a0} {}", git.branch).chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0;
    let reserved_title_w =
        TAB_MAX_WIDTH - (TAB_H_PAD * 2.0 + close_hit_w + BADGE_GAP + branch_badge_w);
    let title_w = title.chars().count() as f32 * cell_w;

    assert!(
        reserved_title_w >= title_w.min(TAB_MIN_TITLE_WIDTH),
        "header layout should preserve enough width for the title before badges consume the row"
    );
}

#[test]
fn active_stage_tab_preserves_title_when_git_badges_are_present() {
    // UC-6 BR-17: Active stacked Stage tabs keep a readable title when git badges are present.
    let (panes, expected_title) = terminal_with_git_info(2);
    let title_w = expected_title.chars().count() as f32 * 8.0;
    let branch_badge_w =
        format!("\u{e0a0} {}", "main").chars().count() as f32 * 8.0 + BADGE_PADDING_H * 2.0;
    let content_budget = TAB_MAX_WIDTH - (TAB_H_PAD * 2.0 + 16.0 + TAB_CONTENT_SPACING);
    let layout = reserve_title_before_badges(
        title_w,
        &[branch_badge_w],
        content_budget,
        TAB_MIN_TITLE_WIDTH,
        BADGE_GAP,
    );

    assert_eq!(pane_title(&panes, 2), expected_title);
    assert!(
        layout.title_w >= title_w.min(TAB_MIN_TITLE_WIDTH),
        "active stacked Stage tabs should reserve title width before optional badges consume the row"
    );
}

#[test]
fn git_badges_yield_space_before_title_disappears() {
    // UC-6 BR-18: Header layout constants keep a readable title budget beside a git badge.
    let cell_w = 8.0_f32;
    let close_hit_w = 16.0_f32;
    let branch_badge_w = 4.0 * cell_w + BADGE_PADDING_H * 2.0;
    let reserved_title_w =
        TAB_MAX_WIDTH - (TAB_H_PAD * 2.0 + close_hit_w + BADGE_GAP + branch_badge_w);

    assert!(
        reserved_title_w >= TAB_MIN_TITLE_WIDTH.min(6.0 * cell_w),
        "header layout should reserve at least six cells for the title before badges consume the row"
    );
}

// --- UC-4: RenderSharedTabSizingAndReadableTerminalLabels ---

#[test]
fn focused_tabs_use_a_brighter_tint_than_unfocused_tabs() {
    // UC-7 BR-20: Focused tabs use a brighter tint than unfocused tabs in the shared header and tab-bar rendering paths.
    assert!(
        color_brightness(DARK.tab_bar_bg_focused) >= color_brightness(DARK.tab_bar_bg) + 0.03,
        "focused dark tab chrome should be visibly brighter than unfocused tab chrome"
    );
    assert!(
        color_brightness(LIGHT.tab_bar_bg_focused) >= color_brightness(LIGHT.tab_bar_bg) + 0.03,
        "focused light tab chrome should be visibly brighter than unfocused tab chrome"
    );
}

#[test]
fn shared_tab_chrome_is_slightly_larger_across_all_surfaces() {
    // UC-7 BR-19: Shared tab chrome uses a slightly larger height and padding budget across stacked Stage tabs, Dock tabs, and single-Pane headers.
    assert!(
        TAB_BAR_HEIGHT >= 35.0,
        "shared tab chrome should gain at least one pixel of height"
    );
    assert!(
        TAB_H_PAD >= 11.0,
        "shared tab chrome should gain a little more horizontal breathing room"
    );
    assert!(
        active_tab_width_cap(240.0) >= ACTIVE_TAB_MAX_WIDTH,
        "active shared tabs should keep the wider base width cap in narrow rows"
    );
    assert!(
        shared_tab_active_width_cap(900.0, 3) > active_tab_width_cap(540.0),
        "shared active tabs should stretch past the single-header cap when a wider row still has sibling tabs to preserve"
    );
    assert!(
        shared_tab_active_width_cap(900.0, 3) <= 900.0 * 0.5,
        "shared active tabs should still stop well before filling the whole row"
    );
}

#[test]
fn busy_terminal_labels_use_a_readable_color_path() {
    // UC-7 BR-21: Busy Terminal Pane headers use a readable label color instead of the dimmed badge color path.
    assert!(
        terminal_header_title_color(&DARK, false, false) == DARK.tab_text,
        "busy terminal labels should use the shared tab text color when unfocused"
    );
    assert!(
        terminal_header_title_color(&DARK, true, false) == DARK.tab_text_focused,
        "busy terminal labels should use the focused shared tab text color when focused"
    );
    assert!(
        terminal_header_title_color(&LIGHT, false, false) == LIGHT.tab_text,
        "busy terminal labels should use the shared tab text color when unfocused"
    );
    assert!(
        terminal_header_title_color(&LIGHT, true, false) == LIGHT.tab_text_focused,
        "busy terminal labels should use the focused shared tab text color when focused"
    );
}

#[test]
fn active_markdown_live_preview_chrome_keeps_plain_and_comment_badges_visible() {
    // UC-7 BR-22: The shared active-tab width budget stretches with the available row width enough to keep both live-preview critical badges visible without collapsing the title below its minimum.
    let mut editor = EditorPane::new_empty(1);
    editor.editor.buffer.file_path = Some(PathBuf::from("README.md"));
    editor.preview_mode = true;

    let mut panes = HashMap::new();
    panes.insert(1, PaneKind::Editor(editor));

    let badges = active_tab_badges(&panes, &1, true, true);
    let badge_widths: Vec<f32> = badges
        .iter()
        .map(|badge| badge.text.chars().count() as f32 * 8.0 + BADGE_PADDING_H * 2.0)
        .collect();
    let layout = reserve_title_before_badges(
        320.0,
        &badge_widths,
        shared_tab_active_width_cap(540.0, 2) - (TAB_H_PAD * 2.0 + 16.0),
        TAB_MIN_TITLE_WIDTH,
        4.0,
    );

    assert_eq!(layout.visible_badges, 2);
    assert!(layout.title_w >= TAB_MIN_TITLE_WIDTH);
    assert_eq!(badges[0].action, Some(HeaderHitAction::MarkdownPreview));
    assert_eq!(badges[1].action, Some(HeaderHitAction::AddComment));
}

#[test]
fn single_pane_markdown_reading_header_keeps_mode_and_comment_badges_visible() {
    // UC-7 BR-19, BR-22: Single-pane headers must not waste the available width
    // budget for the markdown mode badge + add-comment badge.
    let mut editor = EditorPane::new_empty(1);
    editor.editor.buffer.file_path = Some(PathBuf::from("a.md"));
    editor.preview_mode = true;

    let mut panes = HashMap::new();
    panes.insert(1, PaneKind::Editor(editor));

    let cell_w = 9.0_f32;
    let badges = active_tab_badges(&panes, &1, true, true);
    let badge_widths: Vec<f32> = badges
        .iter()
        .map(|badge| badge.text.chars().count() as f32 * cell_w + BADGE_PADDING_H * 2.0)
        .collect();
    let layout = reserve_title_before_badges(
        6.0 * cell_w,
        &badge_widths,
        active_tab_width_cap(240.0) - (TAB_H_PAD * 2.0 + 16.0),
        TAB_MIN_TITLE_WIDTH,
        4.0,
    );

    assert_eq!(layout.visible_badges, 2);
    assert!(layout.title_w >= TAB_MIN_TITLE_WIDTH);
    assert_eq!(badges[0].action, Some(HeaderHitAction::MarkdownPreview));
    assert_eq!(badges[1].action, Some(HeaderHitAction::AddComment));
}

#[test]
fn stacked_stage_active_terminal_tab_keeps_git_status_badges_when_agent_dot_is_present() {
    // UC-7 BR-23: A stacked Stage active Terminal Pane keeps both git badges visible even when a connected-agent status dot shares the same tab-width budget.
    let mut terminal = TerminalPane::with_cwd(7, 80, 24, None, true).unwrap();
    terminal.context.git_info = Some(GitInfo {
        branch: "main".to_string(),
        status: GitStatus {
            changed_files: 31,
            additions: 647,
            deletions: 290,
            ..GitStatus::default()
        },
    });

    let mut panes = HashMap::new();
    panes.insert(7, PaneKind::Terminal(terminal));

    let badges = active_tab_badges(&panes, &7, true, false);
    let badge_widths: Vec<f32> = badges
        .iter()
        .map(|badge| badge.text.chars().count() as f32 * 8.0 + BADGE_PADDING_H * 2.0)
        .collect();
    let active_tab_w = shared_tab_target_width(
        16.0 * 8.0,
        &badge_widths,
        true,
        true,
        shared_tab_active_width_cap(900.0, 3),
    );
    let layout = reserve_title_before_badges(
        16.0 * 8.0,
        &badge_widths,
        active_tab_w - (TAB_H_PAD * 2.0 + 16.0 + tab_status_dot_width(true)),
        TAB_MIN_TITLE_WIDTH,
        BADGE_GAP,
    );

    assert_eq!(layout.visible_badges, 2);
    assert_eq!(badges[0].action, Some(HeaderHitAction::GitBranch));
    assert_eq!(badges[1].action, Some(HeaderHitAction::GitStatus));
}

#[test]
fn overflowed_shared_tab_bar_keeps_the_active_tab_visible() {
    // UC-7 BR-24: Overflowed shared tab bars auto-fit the active tab into view when a stale scroll offset would otherwise hide it.
    let tab_widths = [120.0, 120.0, 120.0, 220.0];
    let visible_w = 260.0;
    let adjusted_scroll = resolve_tab_scroll_offset(&tab_widths, 3, visible_w, 0.0, true);
    let active_start = tab_widths[..3].iter().sum::<f32>() - adjusted_scroll;
    let active_end = active_start + tab_widths[3];

    assert!(adjusted_scroll > 0.0);
    assert!(active_start >= 0.0);
    assert!(active_end <= visible_w);
}

#[test]
fn manual_shared_tab_scroll_does_not_snap_back_to_the_active_tab() {
    // UC-7 BR-24: Manual shared-tab scrolling remains stable instead of being auto-fit back toward the active tab every render.
    let tab_widths = [120.0, 120.0, 120.0, 220.0];
    let visible_w = 260.0;
    let requested_scroll = 80.0;
    let adjusted_scroll =
        resolve_tab_scroll_offset(&tab_widths, 3, visible_w, requested_scroll, false);
    let active_start = tab_widths[..3].iter().sum::<f32>() - adjusted_scroll;
    let active_end = active_start + tab_widths[3];

    assert_eq!(adjusted_scroll, requested_scroll);
    assert!(active_end > visible_w);
}

#[test]
fn shared_tab_scroll_prioritizes_horizontal_delta_before_vertical_fallback() {
    // UC-7 BR-25: A precise shared-tab gesture follows horizontal intent before vertical fallback.
    assert_eq!(shared_tab_scroll_delta(0.2, -0.6), -0.2);
    assert_eq!(shared_tab_scroll_delta(-0.2, 0.6), 0.2);
    assert_eq!(shared_tab_scroll_delta(0.0, -0.6), 0.6);
    assert_eq!(shared_tab_scroll_delta(0.0, 0.6), -0.6);
}

#[test]
fn shared_tab_scroll_uses_a_modest_starter_step_only_for_fresh_gestures() {
    // UC-7 BR-26: A fresh shared-tab stroke gets a modest visible starter step, but continuous motion stays lighter.
    let fresh_step = shared_tab_scroll_step(0.1, 8.0, true);
    let continuous_step = shared_tab_scroll_step(0.1, 8.0, false);

    assert_eq!(fresh_step, 4.0);
    assert_eq!(continuous_step, 1.2);
    assert_eq!(shared_tab_scroll_step(-0.1, 8.0, true), -4.0);
    assert_eq!(shared_tab_scroll_step(1.0, 8.0, false), 12.0);
}

#[test]
fn shared_tab_scroll_treats_direction_change_as_a_fresh_gesture() {
    // UC-7 BR-26: A direction change or idle gap restarts the starter-step rule.
    assert!(shared_tab_scroll_is_new_gesture(None, None, 0.1));
    assert!(!shared_tab_scroll_is_new_gesture(
        Some(Duration::from_millis(40)),
        Some(1.0),
        0.1,
    ));
    assert!(shared_tab_scroll_is_new_gesture(
        Some(Duration::from_millis(40)),
        Some(1.0),
        -0.1,
    ));
    assert!(shared_tab_scroll_is_new_gesture(
        Some(Duration::from_millis(160)),
        Some(1.0),
        0.1,
    ));
}

#[test]
fn shared_tab_scroll_matches_editor_horizontal_direction() {
    // UC-7 BR-27: Shared tab bars use the same horizontal sign convention as editor and diff panes.
    assert!(shared_tab_scroll_delta(0.2, 0.0) < 0.0);
    assert!(shared_tab_scroll_delta(-0.2, 0.0) > 0.0);
}

#[test]
fn shared_tab_scroll_offset_clamps_at_visible_bounds() {
    // UC-7 BR-28: Shared tab scroll offset is clamped at input time so reverse motion starts immediately from the visible edge.
    assert_eq!(clamp_shared_tab_scroll_offset(96.0, 80.0), 80.0);
    assert_eq!(clamp_shared_tab_scroll_offset(-12.0, 80.0), 0.0);
    assert_eq!(clamp_shared_tab_scroll_offset(24.0, 80.0), 24.0);
}

#[test]
fn terminal_badge_refresh_delay_matches_a_single_frame_scale_budget() {
    // UC-7 BR-29: PTY-driven terminal badge refresh uses a near-immediate frame-scale delay.
    assert_eq!(terminal_badge_check_delay(), Duration::from_millis(16));
}

#[test]
fn single_pane_header_scroll_falls_through_to_preview_content() {
    // UC-7 BR-30: A non-overflow single-pane header must not swallow scroll that should reach pane content.
    let (mut app, pane_id, pane_rect) = app_with_single_preview_editor(200);
    app.window.last_cursor_pos = crate::tide_core::Vec2::new(pane_rect.x + 24.0, pane_rect.y + 8.0);

    handle_scroll(&mut app, 0.0, -3.0);

    let preview_scroll = match app.panes.get(&pane_id) {
        Some(PaneKind::Editor(pane)) => pane.preview_scroll,
        _ => 0,
    };
    assert!(
        preview_scroll > 0,
        "scroll over a single-pane header should still reach the preview content when no shared tab bar can scroll"
    );
}

#[test]
fn stacked_stage_tab_bar_scroll_uses_rendered_tab_bounds() {
    // UC-7 BR-37: Stacked Stage shared-tab scroll bounds match the rendered leading ViewMode and trailing action reservations.
    let mut app = test_app();
    let (layout, first_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    app.panes
        .insert(first_id, PaneKind::Editor(EditorPane::new_empty(first_id)));
    let second_id = app.layout.split(first_id, SplitDirection::Vertical);
    app.panes.insert(
        second_id,
        PaneKind::Editor(EditorPane::new_empty(second_id)),
    );
    let third_id = app.layout.split(second_id, SplitDirection::Vertical);
    app.panes
        .insert(third_id, PaneKind::Editor(EditorPane::new_empty(third_id)));
    app.focus.focused = Some(first_id);
    app.focus.stage_focused = Some(first_id);
    app.focus.focus_area = FocusArea::Stage;
    app.focus.zoomed_pane = Some(first_id);
    app.router.set_focused(first_id);
    let pane_rect = Rect::new(0.0, 0.0, 360.0, 320.0);
    app.pane_rects = vec![(first_id, pane_rect)];
    app.visual_pane_rects = vec![(first_id, pane_rect)];
    app.window.last_cursor_pos = Vec2::new(pane_rect.x + 80.0, pane_rect.y + 8.0);

    assert!(
        AppCorePort::shared_tab_max_scroll(&app, first_id).unwrap_or(0.0) > 0.0,
        "visually clipped stacked Stage tabs should expose shared-tab scroll capacity"
    );

    handle_scroll(&mut app, -1.0, 0.0);

    assert!(
        app.interaction
            .tab_scroll_offset
            .get(&first_id)
            .copied()
            .unwrap_or(0.0)
            > 0.0,
        "horizontal scroll over a stacked Stage tab bar should update the shared-tab scroll offset"
    );
}

#[test]
fn dock_tab_bar_scroll_uses_rendered_view_mode_bounds() {
    // UC-7 BR-38: Dock shared-tab scroll bounds include the rendered leading ViewMode control.
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;

    let first_id = app.layout.alloc_id();
    let second_id = app.layout.alloc_id();
    let third_id = app.layout.alloc_id();
    let mut terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    terminal.dock_view_mode = crate::state::ViewMode::Split;
    terminal
        .dock_layout
        .insert_at_root(first_id, DropZone::Right);
    assert!(terminal.dock_layout.add_tab(first_id, second_id));
    assert!(terminal.dock_layout.add_tab(second_id, third_id));
    assert!(terminal.dock_layout.set_active_tab(third_id));
    terminal.dock_focused = Some(third_id);

    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));
    for pane_id in [first_id, second_id, third_id] {
        app.panes
            .insert(pane_id, PaneKind::Editor(EditorPane::new_empty(pane_id)));
        app.assoc.associated_terminal.insert(pane_id, terminal_id);
    }
    app.dock.dock_open = true;
    app.dock.dock_zoomed = false;
    app.focus.stage_focused = Some(terminal_id);
    app.focus.focused = Some(third_id);
    app.focus.focus_area = FocusArea::Dock;
    app.router.set_focused(third_id);
    let pane_rect = Rect::new(0.0, 0.0, 360.0, 320.0);
    app.pane_rects = vec![(third_id, pane_rect)];
    app.visual_pane_rects = vec![(third_id, pane_rect)];
    app.window.last_cursor_pos = Vec2::new(pane_rect.x + 80.0, pane_rect.y + 8.0);

    assert!(
        AppCorePort::shared_tab_max_scroll(&app, third_id).unwrap_or(0.0) > 24.0,
        "Dock shared tabs should expose scroll capacity for tabs hidden behind the ViewMode control"
    );

    handle_scroll(&mut app, -4.0, 0.0);

    assert!(
        app.interaction
            .tab_scroll_offset
            .get(&third_id)
            .copied()
            .unwrap_or(0.0)
            > 24.0,
        "Dock shared-tab scroll should continue past the short pre-ViewMode bound"
    );
}

// --- UC-9: CollapseSingleDockTabGroupChrome ---

#[test]
fn dock_single_tab_group_uses_single_pane_header_chrome() {
    // UC-9 BR-35: A single-tab Dock TabGroup falls back to single-Pane header chrome instead of the shared Dock tab bar.
    let single = crate::tide_layout::TabGroup::single(7);
    assert!(
        !dock_tab_group_uses_shared_tab_bar(&single),
        "single-tab Dock TabGroups should not render the shared Dock tab bar"
    );

    let mut multi = crate::tide_layout::TabGroup::single(7);
    multi.add_tab(8);
    assert!(
        dock_tab_group_uses_shared_tab_bar(&multi),
        "multi-tab Dock TabGroups should keep the shared Dock tab bar"
    );
}

#[test]
fn dock_stacked_single_pane_uses_single_pane_header_chrome() {
    // UC-9 BR-36: A Stacked Terminal Context Surface with one Pane falls back to single-Pane header chrome.
    assert!(
        !dock_stacked_uses_shared_tab_bar(&[7]),
        "single-pane stacked Terminal Context Surface should not render the shared Dock stacked tab bar"
    );
    assert!(
        dock_stacked_uses_shared_tab_bar(&[7, 8]),
        "multi-pane stacked Terminal Context Surface should keep the shared Dock stacked tab bar"
    );
}

#[test]
fn terminal_cwd_change_clears_stale_git_badges_before_poll_results_arrive() {
    // UC-7 BR-31: A Terminal Pane cwd change clears stale git branch, git status, and worktree chrome before fresh poll results arrive.
    let mut context = TerminalContext {
        cwd: Some(PathBuf::from("/tmp/tide-old-repo")),
        git_info: Some(GitInfo {
            branch: "main".to_string(),
            status: GitStatus {
                changed_files: 24,
                additions: 1146,
                deletions: 86,
            },
        }),
        shell_idle: true,
        worktree_count: 3,
        current_worktree: Some(WorktreeInfo {
            path: PathBuf::from("/tmp/tide-old-repo"),
            branch: Some("main".to_string()),
            commit: "abc123".to_string(),
            is_main: true,
            is_current: true,
        }),
        child_dead: false,
    };

    let changed = sync_terminal_badge_runtime_context(
        &mut context,
        Some(PathBuf::from("/tmp/tide-new-dir")),
        true,
    );

    assert!(changed);
    assert_eq!(context.cwd, Some(PathBuf::from("/tmp/tide-new-dir")));
    assert!(context.git_info.is_none());
    assert_eq!(context.worktree_count, 0);
    assert!(context.current_worktree.is_none());
}

#[test]
fn git_poller_prefers_the_latest_cwd_request_after_quick_repo_switches() {
    // UC-7 BR-32: The background git poller must prefer the latest queued cwd refresh request before publishing repo chrome results.
    use crate::state::background::GitPollRequest;
    let req = |p: &str| GitPollRequest {
        cwd: PathBuf::from(p),
        wants_diff: false,
    };
    let older = vec![req("/tmp/tide-life")];
    let latest = vec![req("/tmp/tide-minder")];
    let newest = vec![req("/tmp/tide-timetable")];
    let (tx, rx) = std::sync::mpsc::channel::<Vec<GitPollRequest>>();
    tx.send(latest.clone()).unwrap();
    tx.send(newest.clone()).unwrap();

    let coalesced =
        crate::application::services::file_tree_service::latest_git_poll_requests(&rx, older);

    assert_eq!(coalesced, newest);
}
