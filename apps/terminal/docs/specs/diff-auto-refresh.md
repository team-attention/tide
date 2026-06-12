# Spec: Diff Pane Auto-Refresh

## Overview

### As-Is
DiffPane only refreshes on manual button click or when re-opened via `open_diff_pane()`. The git poller background thread already runs `git status --porcelain` every ~2s for terminal badges, but this signal is not used to update open DiffPanes. Users see stale diff content until they manually refresh.

### To-Be
The git poller is the **only** source of DiffPane content. When the poller detects a change in
git status, open DiffPanes whose `cwd` matches the changed repo are automatically refreshed. The
heavy git commands (`git diff --numstat`, `git diff -- <file>`) run in the background thread, so
the main thread only receives and applies the results — zero blocking. Opening a DiffPane no
longer spawns git on the app thread: it creates an empty pane that renders a loading state until
the first poll result arrives, then settles on the diff (or a clean tree).

Per-file diff collection is **gated on demand** (`wants_diff`): the poller computes per-file
diffs only for cwds that have an open DiffPane, so background ticks stay cheap when no DiffPane
is open.

### Approach
1. Add `diff_data` field to `GitPollCwdResult` containing parsed diff info (file entries + diff lines per file)
2. In the git poller background thread, for cwds that `wants_diff` (an open DiffPane matches), run `git diff --numstat` and `git diff -- <file>` for each changed file
3. In `consume_git_poll_results()`, find open DiffPanes matching the CWD and apply the pre-computed diff data
4. Add `apply_poll_data()` method to `DiffPane` that accepts pre-computed diff results (no git CLI calls)
5. `open_diff_pane()` / the DiffRefresh button create-or-`trigger_git_poll()` instead of calling a synchronous `refresh()`; `DiffPane` carries a `loaded` flag driven by `apply_poll_data`

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
  - BR-4: Per-file diff collection runs only for cwds with an open DiffPane (`wants_diff`); a wants-diff result always carries diff data, possibly empty, so a loading DiffPane can settle on a clean tree

### UC-2: Open a DiffPane without blocking the app thread
- **Actor**: User (or agent via MCP)
- **Trigger**: `open_diff_pane(cwd)` or the DiffRefresh header button
- **Precondition**: none
- **Flow**:
  1. `open_diff_pane` creates an empty DiffPane (`DiffPane::new_empty`, `loaded = false`) and calls `trigger_git_poll()`
  2. The pane renders a "Loading changes…" state until the first matching poll result
  3. `apply_poll_data` sets `loaded = true`; an empty changed-file list now renders the clean-tree state instead of staying on "Loading"
- **Postcondition**: DiffPane shows current changes (or clean state) without any git subprocess on the app thread
- **Business Rules**:
  - BR-5: Opening a DiffPane performs no git subprocess on the app thread
  - BR-6: A not-yet-`loaded` DiffPane renders the loading state, not a (misleading) clean tree
  - BR-7: A `wants_diff` poll result with an empty changed-file list clears `loaded`'s loading view (settles on clean tree)

## Invariants
- Generation monotonicity (Architecture Invariant #5) is preserved — `apply_poll_data` only increments generation
- Hexagonal dependency direction (Architecture Invariant #7) is preserved — background state flows through the existing channel, consumed by a service method

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `apply_poll_data_does_not_call_git_commands()` |
| UC-1 | BR-2 | `apply_poll_data_bumps_generation()` |
| UC-1 | BR-3 | `consume_git_poll_refreshes_matching_diff_panes()` |
| UC-1 | BR-4 | `git_poll_collects_per_file_diffs_only_when_wants_diff()` |
| UC-2 | BR-5 | `open_diff_pane_spawns_no_git_subprocess()` |
| UC-2 | BR-6 | `unloaded_diff_pane_renders_loading_state()` |
| UC-2 | BR-7 | `empty_wants_diff_result_settles_diff_pane_on_clean_tree()` |

## Location
- `domain/pane/diff.rs` — `apply_poll_data()`, `new_empty()`, `loaded` flag, cached `max_line_len`
- `domain/state/background.rs` — `GitPollCwdResult` (full `Vec<WorktreeInfo>`), `GitPollRequest { cwd, wants_diff }`
- `application/services/file_tree_service/mod.rs` — single-spawn poller, `wants_diff` gating, `consume_git_poll_results()`
- `application/services/file_ops_service/mod.rs` — `open_diff_pane` uses `new_empty` + `trigger_git_poll`
