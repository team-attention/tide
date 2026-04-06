// Spec: docs/specs/git-switcher-current-worktree.md

// --- UC-1: RenderCurrentWorktreeBadge ---

#[test]
fn current_worktree_badge_stays_visible_for_long_branch_names() {
    // UC-1 BR-1: The current-worktree badge remains inside the popup for long branch names
    let layout = crate::adapter::outward::view::overlays::git_switcher::current_worktree_row_layout(
        "feature/very-long-branch-name-that-used-to-hide-the-badge",
        24.0,
        320.0,
        12.0,
        42.0,
        8.0,
    );

    assert!(layout.badge_x >= 24.0);
    assert!(layout.badge_x + layout.badge_w <= 24.0 + 320.0 - 12.0);
    assert!(
        layout.display_name.chars().count()
            < "feature/very-long-branch-name-that-used-to-hide-the-badge"
                .chars()
                .count()
    );
}

#[test]
fn current_worktree_badge_preserves_full_label_when_space_allows() {
    // UC-1 BR-2: Current-row branch text keeps its full label when the popup has enough width
    let layout = crate::adapter::outward::view::overlays::git_switcher::current_worktree_row_layout(
        "short-name",
        24.0,
        320.0,
        12.0,
        42.0,
        8.0,
    );

    assert_eq!(layout.display_name, "short-name");
    assert!(layout.text_clip_w >= "short-name".chars().count() as f32 * 8.0);
}
