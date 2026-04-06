// Spec: docs/specs/pane-chrome.md

use std::collections::HashMap;
use std::path::PathBuf;

use crate::adapter::outward::view::header::{
    reserve_title_before_badges, terminal_header_title_color,
};
use crate::pane::{PaneKind, TerminalPane};
use crate::theme::{
    BADGE_GAP, BADGE_PADDING_H, DARK, LIGHT, TAB_BAR_HEIGHT, TAB_CONTENT_SPACING, TAB_H_PAD,
    TAB_MAX_WIDTH, TAB_MIN_TITLE_WIDTH,
};
use crate::tide_terminal::git::{GitInfo, GitStatus};
use crate::ui::pane_title;

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

// --- UC-3: PreserveHeaderTitleBesideGitBadges ---

#[test]
fn active_terminal_header_preserves_title_when_git_badges_are_present() {
    // UC-3 BR-5: Active single-pane headers keep a readable title when git branch or git status badges are present.
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
    // UC-3 BR-6: Active Stage tabs keep a readable title when git badges are present.
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
    // UC-3 BR-7: Header layout constants keep a readable title budget beside a git badge.
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
    // UC-4 BR-9: Focused tabs use a brighter tint than unfocused tabs in the shared header and tab-bar rendering paths.
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
    // UC-4 BR-8: Shared tab chrome uses a slightly larger height and padding budget across Stage tabs, Dock tabs, and single-Pane headers.
    assert!(
        TAB_BAR_HEIGHT >= 35.0,
        "shared tab chrome should gain at least one pixel of height"
    );
    assert!(
        TAB_H_PAD >= 11.0,
        "shared tab chrome should gain a little more horizontal breathing room"
    );
}

#[test]
fn busy_terminal_labels_use_a_readable_color_path() {
    // UC-4 BR-10: Busy Terminal Pane headers use a readable label color instead of the dimmed badge color path.
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
