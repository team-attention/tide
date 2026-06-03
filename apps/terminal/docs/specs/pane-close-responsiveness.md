# Spec: Pane Close Responsiveness

## Overview

### As-Is

- Stage Terminal Pane close runs on the app thread from the close-button / `ClosePane` input path.
- The Stage Terminal Pane close path performs synchronous git worktree discovery before deciding whether to show the branch cleanup bar.
- The git worktree helpers are implemented with blocking `git` subprocess calls and are explicitly documented as background-thread-only code.
- When that synchronous work runs during input handling, the whole Workspace window stops processing clicks and redraws until the close path returns.

### To-Be

- Stage Terminal Pane close must not synchronously query git worktrees on the app thread.
- Background git polling must pre-compute the current `WorktreeInfo` for each Terminal Pane and cache it in `TerminalContext`.
- Branch cleanup decisions must use the cached current `WorktreeInfo`.
- If no cached current `WorktreeInfo` is available yet, the Stage Terminal Pane close proceeds without blocking on git discovery.

### Approach

1. Extend the background git poll result with cached current `WorktreeInfo`.
2. Store that cached current `WorktreeInfo` in `TerminalContext`.
3. Remove synchronous `GitPort::list_worktrees()` usage from the Stage Terminal Pane close path.
4. Add behavior tests for cache propagation, cached branch cleanup prompting, and the no-sync-git close path.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | Orchestrates Pane close, background poll consumption, and branch cleanup modal state |
| `tide-terminal` | Produces git worktree metadata off the app thread |
| `adapter/outward/git_adapter` | Provides git subprocess access through `GitPort` for background polling only |

## Use Cases

### UC-1: CacheCurrentWorktreeForTerminalPane

- **Actor**: App
- **Trigger**: Background git poll results are consumed
- **Precondition**: A Terminal Pane has a cached CWD that was polled
- **Flow**:
  1. The background git poller computes the current `WorktreeInfo` for the Terminal Pane CWD
  2. `consume_git_poll_results()` updates the Terminal Pane `TerminalContext`
- **Postcondition**: The Terminal Pane has cached current worktree metadata available for later UI decisions
- **Business Rules**:
  - BR-1: `consume_git_poll_results()` copies the current `WorktreeInfo` from the poll result into `TerminalContext`

### UC-2: CloseStageTerminalPane

- **Actor**: User
- **Trigger**: Header close button or `GlobalAction::ClosePane` targets a Stage Terminal Pane
- **Precondition**: The targeted Pane is a Stage Terminal Pane
- **Flow**:
  1. Read the cached `TerminalContext`
  2. If the Terminal Pane is on a non-main branch and the cached current `WorktreeInfo` is a non-main worktree, show the branch cleanup bar
  3. Otherwise, continue the close path immediately
- **Postcondition**: The Stage Terminal Pane close request completes without synchronous git worktree discovery on the app thread
- **Business Rules**:
  - BR-2: Stage Terminal Pane close must not synchronously call `GitPort::list_worktrees()`
  - BR-3: Cached non-main current `WorktreeInfo` still opens the branch cleanup bar
  - BR-4: Missing cached current `WorktreeInfo` skips the branch cleanup bar instead of blocking the close path
  - BR-5: Stale cached current `WorktreeInfo` whose `path` no longer contains the current CWD skips the branch cleanup bar instead of using mismatched cleanup data

## Invariants

1. Pane close preserves PaneId sync between `SplitLayout` and `App.panes`.
2. Branch cleanup prompting never depends on synchronous git subprocesses on the app thread.
3. Background git polling remains the single place that performs git worktree discovery.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1: CacheCurrentWorktreeForTerminalPane | BR-1 | `consume_git_poll_results_updates_terminal_current_worktree_context` |
| UC-2: CloseStageTerminalPane | BR-2 | `closing_stage_terminal_uses_cached_branch_cleanup_without_sync_git_query` |
| UC-2: CloseStageTerminalPane | BR-4 | `closing_stage_terminal_without_cached_worktree_info_skips_sync_git_query` |
| UC-2: CloseStageTerminalPane | BR-5 | `closing_stage_terminal_with_stale_cached_worktree_info_skips_branch_cleanup_prompt` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Application services | `tide-app` | `crates/tide-app/src/application/services/file_tree_service/mod.rs`, `crates/tide-app/src/application/services/pane_create_service/mod.rs` |
| Domain | `tide-app` | `crates/tide-app/src/domain/pane/mod.rs`, `crates/tide-app/src/domain/terminal/git.rs`, `crates/tide-app/src/domain/state/background.rs` |
| Tests | `tide-app` | `crates/tide-app/src/application/behavior_tests/pane_close_responsiveness.rs` |
