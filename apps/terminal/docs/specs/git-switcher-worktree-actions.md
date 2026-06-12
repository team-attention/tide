# Spec: GitSwitcher Worktree Actions

## Overview

### As-Is

`GitSwitcher` opens from the Terminal Pane header badge and renders worktree rows in `crates/tide-app/src/adapter/outward/view/overlays/git_switcher.rs`.

Two gaps exist in the current flow:

1. In `crates/tide-app/src/adapter/inward/mouse_adapter/mod.rs`, clicking a GitSwitcher row only updates `GitSwitcherState.selected`. The row does not run the default switch action, so mouse users have no obvious way to activate a worktree unless they discover the keyboard hints or the small action buttons.
2. In `crates/tide-app/src/adapter/inward/click_adapter/header.rs`, GitSwitcher worktree deletion runs `git_remove_worktree` and `git_delete_branch` from the focused Terminal Pane's current `cwd`. The branch-cleanup flow in `crates/tide-app/src/application/services/pane_create_service/mod.rs` already resolves the main worktree before mutating worktrees, so GitSwitcher and branch cleanup use inconsistent repo roots.

### To-Be

1. Clicking a GitSwitcher row outside its action buttons activates the row's default action immediately.
2. GitSwitcher worktree deletion resolves the main worktree first, then runs worktree-removal and branch-deletion commands from that main worktree path.

### Approach

1. Add behavior tests for mouse row activation and main-worktree deletion resolution.
2. Route GitSwitcher row clicks through the same `SwitcherButton::Switch` action used by keyboard `Enter`.
3. Resolve the main worktree path inside GitSwitcher delete handling before calling outward git ports.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/modal` | Owns `GitSwitcher` state, filtered rows, and delete confirmation state. |
| `adapter/inward/mouse_adapter` | Translates row clicks into `GitSwitcher` actions. |
| `adapter/inward/click_adapter` | Executes `GitSwitcher` worktree actions through inward and outward ports. |
| `application/ports/outward/git_port` | Removes worktrees and deletes branches using the resolved repo root. |

## Use Cases

### UC-1: ActivateWorktreeFromGitSwitcherRow

- **Actor**: User
- **Trigger**: Left-click on a GitSwitcher worktree row outside the action buttons
- **Precondition**: `GitSwitcher` is open for a Terminal Pane
- **Flow**:
  1. Hit-test the click against GitSwitcher action buttons
  2. If no button was clicked, resolve the clicked row
  3. Run the row's default `SwitcherButton::Switch` action
  4. Close the popup after activating the row
- **Postcondition**: The clicked row is activated instead of only being highlighted
- **Business Rules**:
  - BR-1: Clicking a GitSwitcher row outside its action buttons activates the row's default switch action

### UC-2: DeleteWorktreeFromGitSwitcher

- **Actor**: User
- **Trigger**: Confirm worktree deletion in GitSwitcher
- **Precondition**: The selected `WorktreeInfo` is neither the current worktree nor the main worktree
- **Flow**:
  1. Resolve the Terminal Pane `cwd`
  2. List repo worktrees from that `cwd`
  3. Find the main worktree path
  4. Run `remove_worktree` and `delete_branch` from the main worktree path
  5. Refresh the open GitSwitcher popup
- **Postcondition**: GitSwitcher removes the linked worktree using the repo's main worktree as the mutation root
- **Business Rules**:
  - BR-2: GitSwitcher resolves the main worktree path before removing a worktree and deleting its branch

### UC-5: OpenGitSwitcherFromPollerCache (P-5)

- **Actor**: User
- **Trigger**: Click the git badge to open the GitSwitcher
- **Precondition**: none
- **Flow**:
  1. The switcher reads the repo's worktree list from the background git poller cache (keyed by repo root).
  2. On a cold miss it lists worktrees synchronously once and asks the poller to warm the cache for next time.
- **Postcondition**: Opening the switcher does not spawn git on the app thread when the poller cache is warm.
- **Business Rules**:
  - BR-20: A warm poller cache serves the switcher worktree list with no git on the app thread.
  - BR-21: A cold cache lists once synchronously and warms the cache.

> **Deferred (tracked follow-up):** the worktree *mutations* — `git worktree add` (UC-1 create rows),
> `git worktree remove` + `git branch -d` (UC-2), and the branch-cleanup confirm in
> `pane_create_service` — still run synchronously on the app thread. They are infrequent, explicit,
> destructive-adjacent actions, so they were not moved to a background job in this slice. The intended
> design (a `WorktreeOp` worker with an `in_flight` modal state, completion follow-ups applied in
> `poll_background_events`, and failures surfaced via the notification path) is specified in
> `docs/research/structural-cleanup-blueprint.md` §P-5 and remains the plan.

## Invariants

1. `GitSwitcher` button hit-testing keeps priority over row activation.
2. Main worktree rows and current worktree rows are still protected from GitSwitcher deletion.
3. `GitSwitcher` continues to refresh in-place after a successful delete attempt.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1: ActivateWorktreeFromGitSwitcherRow | BR-1 | `clicking_git_switcher_row_runs_the_default_switch_action()` |
| UC-2: DeleteWorktreeFromGitSwitcher | BR-2 | `deleting_git_switcher_worktree_uses_the_main_worktree_as_git_root()` |
| UC-5: OpenGitSwitcherFromPollerCache | BR-20 | `git_switcher_open_reads_worktrees_from_poller_cache_without_spawning_git()` |
| UC-5: OpenGitSwitcherFromPollerCache | BR-21 | `git_switcher_open_falls_back_to_sync_list_on_cold_cache()` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Mouse activation | `tide-app` | `crates/tide-app/src/adapter/inward/mouse_adapter/mod.rs` |
| Delete execution | `tide-app` | `crates/tide-app/src/adapter/inward/click_adapter/header.rs` |
| Behavior tests | `tide-app` | `crates/tide-app/src/application/behavior_tests/git_switcher_worktree_actions.rs` |
