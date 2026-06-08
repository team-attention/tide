// Spec: docs/specs/editor-polish.md

use std::collections::HashMap;
use std::path::PathBuf;

use crate::header::{
    active_tab_badges, header_action_strip_start_x, reserve_title_before_badges,
    single_pane_header_layout, HeaderHitAction,
};
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::theme::{BADGE_GAP, BADGE_PADDING_H, DARK, LIGHT, TAB_H_PAD, TAB_MIN_TITLE_WIDTH};
use crate::tide_editor::EditorActionKind;

fn color_brightness(color: crate::tide_core::Color) -> f32 {
    color.r + color.g + color.b
}

fn markdown_panes(id: u64) -> HashMap<u64, PaneKind> {
    let mut ep = EditorPane::new_empty(id);
    ep.editor.buffer.file_path = Some(PathBuf::from("README.md"));

    let mut panes = HashMap::new();
    panes.insert(id, PaneKind::Editor(ep));
    panes
}

// --- UC-1: SurfaceActivePaneAndModeInEditorChrome ---

#[test]
fn active_editor_pane_chrome_is_stronger_than_inactive_pane_chrome() {
    // UC-1 BR-1: Focused editor chrome is visually stronger than unfocused chrome.
    assert!(
        color_brightness(DARK.tab_bar_bg_focused) > color_brightness(DARK.tab_bar_bg),
        "focused dark editor chrome should be brighter than unfocused chrome"
    );
    assert!(
        color_brightness(LIGHT.tab_bar_bg_focused) > color_brightness(LIGHT.tab_bar_bg),
        "focused light editor chrome should be brighter than unfocused chrome"
    );
}

#[test]
fn active_markdown_pane_shows_explicit_mode_badge() {
    // UC-1 BR-2: Active Markdown panes expose explicit mode information through EditorBadge chrome.
    let panes = markdown_panes(1);
    let badges = active_tab_badges(&panes, &1, true, false);

    assert!(
        badges.iter().any(|badge| badge.text == "read"
            && badge.action == Some(HeaderHitAction::MarkdownPreview)),
        "focused Markdown panes should surface an explicit mode badge"
    );
}

#[test]
fn focused_single_pane_editor_header_uses_full_width_active_surface() {
    // UC-1 BR-4: A focused single-pane Editor header uses the full header width as the active surface.
    let layout = single_pane_header_layout(320.0, 0.0, 96.0, &[48.0], false, 0.0);

    assert_eq!(layout.surface_w, 320.0);
}

// --- UC-2: PreserveCriticalChromeAtNarrowWidths ---

#[test]
fn focused_markdown_pane_keeps_mode_badge_visible_ahead_of_add_comment_when_width_is_tight() {
    // UC-2 BR-6: Tight headers preserve the Markdown mode badge before contextual add-comment chrome.
    let panes = markdown_panes(1);
    let badges = active_tab_badges(&panes, &1, true, true);
    let badge_widths: Vec<f32> = badges
        .iter()
        .map(|badge| badge.text.chars().count() as f32 * 8.0 + BADGE_PADDING_H * 2.0)
        .collect();
    let layout = reserve_title_before_badges(
        24.0 * 8.0,
        &badge_widths,
        TAB_MIN_TITLE_WIDTH + BADGE_GAP + badge_widths[0],
        TAB_MIN_TITLE_WIDTH,
        BADGE_GAP,
    );

    assert_eq!(layout.visible_badges, 1);
    assert!(layout.title_w >= TAB_MIN_TITLE_WIDTH);
    assert_eq!(
        badges[0].action,
        Some(HeaderHitAction::MarkdownPreview),
        "the first badge kept under tight width should remain the read/edit mode affordance"
    );
}

#[test]
fn single_pane_editor_header_places_close_next_to_visible_title_cluster() {
    // UC-2 BR-7: A single-pane Editor header places the close affordance immediately after the visible title/badge cluster while keeping header actions in the trailing strip.
    let header_action_width = 3.0 * 18.0 + 2.0 * BADGE_GAP;
    let badge_widths = [48.0];
    let layout =
        single_pane_header_layout(320.0, header_action_width, 120.0, &badge_widths, false, 0.0);
    let action_strip_start_x = header_action_strip_start_x(320.0, header_action_width);
    let visible_badge_width = if layout.title_layout.visible_badges > 0 {
        BADGE_GAP
            + badge_widths
                .iter()
                .take(layout.title_layout.visible_badges)
                .sum::<f32>()
    } else {
        0.0
    };
    let title_cluster_end = TAB_H_PAD + layout.title_layout.title_w + visible_badge_width;

    assert!(layout.close_hit_x >= title_cluster_end);
    assert!(layout.close_hit_x <= title_cluster_end + BADGE_GAP + 1.0);
    assert!(layout.close_hit_x + 16.0 <= action_strip_start_x - 8.0);
}

// --- UC-4: ImproveReadabilityWithoutChangingEditorSemantics ---

#[test]
fn active_indent_guides_are_stronger_on_current_line_than_surrounding_guides() {
    // UC-4 BR-13: Current-line indent guides step forward slightly from surrounding guides.
    assert!(
        DARK.active_indent_guide.a > DARK.indent_guide.a,
        "dark active indent guides should be more visible than surrounding guides"
    );
    assert!(
        color_brightness(LIGHT.active_indent_guide) < color_brightness(LIGHT.indent_guide),
        "light active indent guides should be more visible than surrounding guides"
    );
}

#[test]
fn cursor_row_movement_invalidates_current_line_chrome() {
    // UC-4 BR-14: Cursor-row-dependent editor chrome must invalidate when the cursor moves to another logical line.
    let mut pane = EditorPane::new_empty(1);
    pane.editor.buffer.lines = vec!["first".to_string(), "second".to_string()];

    let before = pane.generation();
    pane.handle_action_with_size(EditorActionKind::MoveDown, 20, 80);

    assert_ne!(
        pane.generation(),
        before,
        "moving the cursor to another row should refresh current-line chrome"
    );
}
