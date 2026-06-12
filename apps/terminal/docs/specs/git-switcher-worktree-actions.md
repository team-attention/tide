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

### UC-6: WorktreeMutationsRunOffTheAppThread (P-5 Part B)

- **Actor**: User
- **Trigger**: Create a worktree (GitSwitcher create rows), delete a worktree (UC-2), or confirm branch cleanup on pane close
- **Precondition**: none
- **Flow**:
  1. The handler computes the paths (fast git metadata) and dispatches a `WorktreeJob` (`Add`/`Remove`) to the background worktree worker — no `git worktree add/remove` or `git branch -d` on the app thread.
  2. For delete, the GitSwitcher row is removed **optimistically** so the click stays instant and can't be re-targeted.
  3. On completion the app thread applies the follow-up: for `Add`, copy configured files into the worktree and `cd` the terminal (if idle) or split a new pane; failures are logged.
- **Postcondition**: worktree create/remove/branch-delete never freeze the app thread; the multi-second git work runs in the background.
- **Business Rules**:
  - BR-22: A worktree mutation is handed to the background worker, not run synchronously on the app thread.
  - BR-23: GitSwitcher delete resolves the main worktree path (from the in-memory snapshot) as the mutation root before dispatching.
  - BR-24: Delete removes the row optimistically (instant UI; prevents double-submit on the same row).

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
| UC-6: WorktreeMutationsRunOffTheAppThread | BR-22 | `dispatch_worktree_add_sends_job_without_blocking()` |
| UC-6: WorktreeMutationsRunOffTheAppThread | BR-23/BR-24 | `deleting_git_switcher_worktree_uses_the_main_worktree_as_git_root()` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Mouse activation | `tide-app` | `crates/tide-app/src/adapter/inward/mouse_adapter/mod.rs` |
| Delete execution | `tide-app` | `crates/tide-app/src/adapter/inward/click_adapter/header.rs` |
| Behavior tests | `tide-app` | `crates/tide-app/src/application/behavior_tests/git_switcher_worktree_actions.rs` |
