// Spec: docs/specs/pane-chrome.md

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use crate::adapter::inward::scroll_adapter::{
    clamp_shared_tab_scroll_offset, handle_scroll, shared_tab_scroll_delta,
    shared_tab_scroll_is_new_gesture, shared_tab_scroll_step,
};
use crate::adapter::inward::event_loop_adapter::terminal_badge_check_delay;
use crate::application::services::file_tree_service::sync_terminal_badge_runtime_context;
use crate::adapter::outward::view::header::{
    active_tab_badges, active_tab_width_cap, reserve_title_before_badges,
    resolve_tab_scroll_offset, shared_tab_active_width_cap,
    shared_tab_target_width, tab_status_dot_width, terminal_header_title_color, HeaderHitAction,
};
use crate::pane::editor::EditorPane;
use crate::pane::{PaneKind, TerminalContext, TerminalPane};
use crate::state::FocusArea;
use crate::tide_core::Rect;
use crate::theme::{
    ACTIVE_TAB_MAX_WIDTH, BADGE_GAP, BADGE_PADDING_H, DARK, LIGHT, TAB_BAR_HEIGHT,
    TAB_CONTENT_SPACING, TAB_H_PAD, TAB_MAX_WIDTH, TAB_MIN_TITLE_WIDTH,
};
use crate::tide_terminal::git::{GitInfo, GitStatus, WorktreeInfo};
use crate::ui::pane_title;
use crate::{App, DockPort};

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
fn needs_input_attention_is_stronger_than_focus_chrome() {
    // UC-2 BR-3: Wrapper-managed NeedsInput chrome remains stronger than ordinary focus chrome.
    let needs_input = crate::tide_core::Color::new(0.95, 0.65, 0.2, 1.0);

    assert!(needs_input.a > DARK.border_focused.a);
    assert!(needs_input.a > LIGHT.border_focused.a);
}

#[test]
fn needs_input_attention_is_visually_distinct_from_focus_chrome() {
    // UC-2 BR-4: Focus chrome and wrapper-managed NeedsInput chrome are distinct signals.
    let needs_input = crate::tide_core::Color::new(0.95, 0.65, 0.2, 1.0);

    assert_ne!(color_tuple(needs_input), color_tuple(DARK.border_focused));
    assert_ne!(color_tuple(needs_input), color_tuple(LIGHT.border_focused));
}

#[test]
fn dock_editor_inherits_needs_input_attention_from_paired_terminal() {
    // UC-2 BR-5: A non-terminal Pane with an Associated Terminal inherits wrapper-managed NeedsInput chrome from the paired Wrapped Agent.
    let mut app = test_app();
    let (layout, terminal_id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let terminal = TerminalPane::with_cwd(terminal_id, 80, 24, None, true).unwrap();
    app.panes.insert(terminal_id, PaneKind::Terminal(terminal));

    let editor_id = app.layout.alloc_id();
    app.panes
        .insert(editor_id, PaneKind::Editor(EditorPane::new_empty(editor_id)));
    app.add_pane_to_dock(editor_id, Some(terminal_id));
    app.assoc.associated_terminal.insert(editor_id, terminal_id);
    app.focus.focused = Some(terminal_id);
    app.focus.focus_area = FocusArea::Stage;
    app.gateway.detected_agents.insert(
        terminal_id,
        crate::state::gateway_status::AgentInfo {
            name: "Codex",
            pid: 42,
            wrapper_managed: true,
            gateway_connected: true,
            status: Some(crate::state::gateway_status::AgentStatus::NeedsInput),
        },
    );

    assert!(app.pane_agent_needs_input_attention(editor_id));
}

// --- UC-3: PreserveHeaderTitleBesideGitBadges ---

#[test]
fn active_terminal_header_preserves_title_when_git_badges_are_present() {
    // UC-3 BR-6: Active single-pane headers keep a readable title when git branch or git status badges are present.
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
    // UC-3 BR-7: Active Stage tabs keep a readable title when git badges are present.
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
        "active Stage tabs should reserve title width before optional badges consume the row"
    );
}

#[test]
fn git_badges_yield_space_before_title_disappears() {
    // UC-3 BR-8: Header layout constants keep a readable title budget beside a git badge.
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
    // UC-4 BR-10: Focused tabs use a brighter tint than unfocused tabs in the shared header and tab-bar rendering paths.
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
    // UC-4 BR-9: Shared tab chrome uses a slightly larger height and padding budget across Stage tabs, Dock tabs, and single-Pane headers.
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
    // UC-4 BR-11: Busy Terminal Pane headers use a readable label color instead of the dimmed badge color path.
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
    // UC-4 BR-12: The shared active-tab width budget stretches with the available row width enough to keep both live-preview critical badges visible without collapsing the title below its minimum.
    let mut editor = EditorPane::new_empty(1);
    editor.editor.buffer.file_path = Some(PathBuf::from("README.md"));
    editor.live_preview = true;

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
    assert_eq!(badges[0].action, Some(HeaderHitAction::ToggleLivePreview));
    assert_eq!(badges[1].action, Some(HeaderHitAction::AddComment));
}

#[test]
fn stacked_stage_active_terminal_tab_keeps_git_status_badges_when_agent_dot_is_present() {
    // UC-4 BR-13: A stacked Stage active Terminal Pane keeps both git badges visible even when a connected-agent status dot shares the same tab-width budget.
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
    // UC-4 BR-14: Overflowed shared tab bars auto-fit the active tab into view when a stale scroll offset would otherwise hide it.
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
    // UC-4 BR-14: Manual shared-tab scrolling remains stable instead of being auto-fit back toward the active tab every render.
    let tab_widths = [120.0, 120.0, 120.0, 220.0];
    let visible_w = 260.0;
    let requested_scroll = 80.0;
    let adjusted_scroll = resolve_tab_scroll_offset(&tab_widths, 3, visible_w, requested_scroll, false);
    let active_start = tab_widths[..3].iter().sum::<f32>() - adjusted_scroll;
    let active_end = active_start + tab_widths[3];

    assert_eq!(adjusted_scroll, requested_scroll);
    assert!(active_end > visible_w);
}

#[test]
fn shared_tab_scroll_prioritizes_horizontal_delta_before_vertical_fallback() {
    // UC-4 BR-15: A precise shared-tab gesture follows horizontal intent before vertical fallback.
    assert_eq!(shared_tab_scroll_delta(0.2, -0.6), -0.2);
    assert_eq!(shared_tab_scroll_delta(-0.2, 0.6), 0.2);
    assert_eq!(shared_tab_scroll_delta(0.0, -0.6), 0.6);
    assert_eq!(shared_tab_scroll_delta(0.0, 0.6), -0.6);
}

#[test]
fn shared_tab_scroll_uses_a_modest_starter_step_only_for_fresh_gestures() {
    // UC-4 BR-16: A fresh shared-tab stroke gets a modest visible starter step, but continuous motion stays lighter.
    let fresh_step = shared_tab_scroll_step(0.1, 8.0, true);
    let continuous_step = shared_tab_scroll_step(0.1, 8.0, false);

    assert_eq!(fresh_step, 4.0);
    assert_eq!(continuous_step, 1.2);
    assert_eq!(shared_tab_scroll_step(-0.1, 8.0, true), -4.0);
    assert_eq!(shared_tab_scroll_step(1.0, 8.0, false), 12.0);
}

#[test]
fn shared_tab_scroll_treats_direction_change_as_a_fresh_gesture() {
    // UC-4 BR-16: A direction change or idle gap restarts the starter-step rule.
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
    // UC-4 BR-17: Shared tab bars use the same horizontal sign convention as editor and diff panes.
    assert!(shared_tab_scroll_delta(0.2, 0.0) < 0.0);
    assert!(shared_tab_scroll_delta(-0.2, 0.0) > 0.0);
}

#[test]
fn shared_tab_scroll_offset_clamps_at_visible_bounds() {
    // UC-4 BR-18: Shared tab scroll offset is clamped at input time so reverse motion starts immediately from the visible edge.
    assert_eq!(clamp_shared_tab_scroll_offset(96.0, 80.0), 80.0);
    assert_eq!(clamp_shared_tab_scroll_offset(-12.0, 80.0), 0.0);
    assert_eq!(clamp_shared_tab_scroll_offset(24.0, 80.0), 24.0);
}

#[test]
fn terminal_badge_refresh_delay_matches_a_single_frame_scale_budget() {
    // UC-4 BR-19: PTY-driven terminal badge refresh uses a near-immediate frame-scale delay.
    assert_eq!(terminal_badge_check_delay(), Duration::from_millis(16));
}

#[test]
fn single_pane_header_scroll_falls_through_to_preview_content() {
    // UC-4 BR-20: A non-overflow single-pane header must not swallow scroll that should reach pane content.
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
fn terminal_cwd_change_clears_stale_git_badges_before_poll_results_arrive() {
    // UC-4 BR-21: A Terminal Pane cwd change clears stale git branch, git status, and worktree chrome before fresh poll results arrive.
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
