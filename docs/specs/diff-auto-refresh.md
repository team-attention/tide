# Spec: Diff Pane Auto-Refresh

## Overview

### As-Is
DiffPane only refreshes on manual button click or when re-opened via `open_diff_pane()`. The git poller background thread already runs `git status --porcelain` every ~2s for terminal badges, but this signal is not used to update open DiffPanes. Users see stale diff content until they manually refresh.

### To-Be
When the git poller detects a change in git status, open DiffPanes whose `cwd` matches the changed repo are automatically refreshed. The heavy git commands (`git diff --numstat`, `git diff -- <file>`) run in the background thread, so the main thread only receives and applies the results — zero blocking.

### Approach
1. Add `diff_data` field to `GitPollCwdResult` containing parsed diff info (file entries + diff lines per file)
2. In the git poller background thread, when `status_entries` is non-empty, also run `git diff --numstat` and `git diff -- <file>` for each changed file
3. In `consume_git_poll_results()`, find open DiffPanes matching the CWD and apply the pre-computed diff data
4. Add `apply_poll_data()` method to `DiffPane` that accepts pre-computed diff results (no git CLI calls)

## Bounded Contexts
- **terminal** (`domain/terminal/git.rs`): Add `diff_numstat()` function to run `git diff --numstat` and return parsed results
- **pane** (`domain/pane/diff.rs`): Add `apply_poll_data()` method to DiffPane
- **file_tree_service** (`application/services/file_tree_service/`): Extend poller thread and `consume_git_poll_results()`
- **background** (`domain/state/background.rs`): Extend `GitPollCwdResult` with diff data

## Use Cases

### UC-1: Auto-refresh DiffPane on git status change
- **Actor**: System (git poller)
- **Trigger**: Git poller detects changed `status_entries` for a CWD that has an open DiffPane
- **Precondition**: At least one DiffPane is open
- **Flow**:
  1. Git poller background thread queries `git status --porcelain` (already done)
  2. Poller also runs `git diff --numstat` and `git diff -- <file>` for each status entry
  3. Results sent to main thread via existing channel
  4. `consume_git_poll_results()` iterates panes, finds DiffPanes with matching `cwd`
  5. Calls `diff_pane.apply_poll_data(files, diff_cache)` which replaces files/cache and bumps generation
- **Postcondition**: DiffPane shows current git diff without user interaction
- **Business Rules**:
  - BR-1: Diff data is computed entirely in the background thread (no blocking main thread with git commands)
  - BR-2: DiffPane generation is bumped on apply so the renderer invalidates cache
  - BR-3: Only DiffPanes whose `cwd` repo root matches the poller result's repo root are refreshed
  - BR-4: If no DiffPane is open, the poller still collects diff data (negligible cost since it already runs git status)

## Invariants
- Generation monotonicity (Architecture Invariant #5) is preserved — `apply_poll_data` only increments generation
- Hexagonal dependency direction (Architecture Invariant #7) is preserved — background state flows through the existing channel, consumed by a service method

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `apply_poll_data_does_not_call_git_commands()` |
| UC-1 | BR-2 | `apply_poll_data_bumps_generation()` |
| UC-1 | BR-3 | `consume_git_poll_refreshes_matching_diff_panes()` |

## Location
- `domain/terminal/git.rs` — new `diff_numstat()` function
- `domain/pane/diff.rs` — new `apply_poll_data()` method
- `domain/state/background.rs` — extend `GitPollCwdResult`
- `application/services/file_tree_service/mod.rs` — extend poller thread + `consume_git_poll_results()`
