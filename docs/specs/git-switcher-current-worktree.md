# Spec: GitSwitcher Current Worktree Badge

## Overview

### As-Is
`GitSwitcher` renders the current worktree row in `crates/tide-app/src/adapter/outward/view/overlays/git_switcher.rs`. That row draws the full branch name first and then places the `"current"` badge at `name_x + (name.len() + 1) * cell_size.width` inside a fixed-width popup (`GIT_SWITCHER_POPUP_W = 320.0`). Long branch names can push the badge beyond the popup edge, so the current-worktree badge disappears even though the row is still current.

### To-Be
The current worktree row always leaves visible space for the `"current"` badge. The badge is anchored to the right side of the popup, and the branch label is clipped to the remaining width.

### Approach
1. Extract current-row layout into a pure helper so badge placement is testable without renderer state.
2. Anchor the current-worktree badge to the popup's trailing edge.
3. Clip the branch label width so it never overlaps or pushes out the badge.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| `domain/modal` | Owns `GitSwitcher` state and filtered worktree rows. |
| `adapter/outward/view/overlays` | Computes row layout and renders the current-worktree badge. |

## Use Cases

### UC-1: RenderCurrentWorktreeBadge
- **Actor**: System
- **Trigger**: The GitSwitcher popup renders a current worktree row
- **Precondition**: At least one filtered worktree row has `is_current = true`
- **Flow**:
  1. The renderer computes the current row layout.
  2. The badge is placed inside the popup's trailing edge.
  3. The branch label is clipped to the remaining width.
- **Postcondition**: The current-worktree badge stays visible regardless of branch-name length.
- **Business Rules**:
  - BR-1: The `"current"` badge always fits within the popup width.
  - BR-2: Current-row branch text is clipped before it can overlap the badge.

## Invariants

1. The current-worktree badge remains visible inside the popup.
2. Current-row text and badge layout stay deterministic for a given popup width and cell size.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1 | `git_switcher_behavior` | `current_worktree_badge_stays_visible_for_long_branch_names` |
| UC-1 | BR-2 | `git_switcher_behavior` | `current_worktree_badge_preserves_full_label_when_space_allows` |

## Location

| What | Location |
|------|----------|
| GitSwitcher rendering | `crates/tide-app/src/adapter/outward/view/overlays/git_switcher.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/git_switcher_behavior.rs` |
