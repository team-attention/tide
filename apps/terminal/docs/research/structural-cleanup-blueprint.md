# Structural Cleanup & Testability Blueprint

**Date:** 2026-06-11 · **Basis:** branch `terminal-rev` @ `5e595b7b` · **Status:** design only — no code changed.

This document is the master plan for three requests:

1. Fix makeshift / workaround structures.
2. Fix performance issues and code smells.
3. Split oversized modules — **and** make the app E2E-testable as a first-class design concern.

Every finding cites evidence read during the survey. Each fix is designed to land as its own
slice following the repo process (spec → behavior test → code), with `cargo test` and
`scripts/lint-arch.sh` green after every slice.

**Verified baseline (2026-06-11):** `cargo test -p tide-app` → **1458 passed, 0 failed, 2 ignored**;
`tide-e2e-tests` → 8 passed; `scripts/lint-arch.sh` → PASS. Total source ≈ 106k LOC.

---

## 1. Product grounding — what the cleanup must serve

From `docs/vision.md` and `docs/roadmap.md`: Tide is an **Integrated Task Environment** —
the Terminal stays the primary live surface while Editor, Browser, Diff, and Render Panes plus
the Agent Gateway carry the task around it. The roadmap's near-term priorities are
(2) **Editor Pane maturity** — explicitly including *"search files, symbols, references, and
text without UI stalls"* — and (5) **Diff Pane as a first-class review surface**.

The cleanup priorities below are ordered to serve exactly those: the worst findings are
synchronous filesystem/git work on the app thread in the FileFinder (the roadmap's main
navigation palette) and in the Diff/worktree flows (the review loop).

Threading model (verified in `main.rs:168-339`, `event_loop_adapter/mod.rs:828-1011`):

- **Main thread** — macOS run loop; platform events forwarded via channel; window commands drained here.
- **App thread (per Tide Window)** — `app_thread_run` owns all `App` state; processes platform
  events, **all Gateway CLI commands**, background-source polling, and frame building.
- **Render thread** — GPU submission; renderer handed back and forth (`view/mod.rs:114-138`).
- **Worker threads** — git poller, PTY readers/grid-sync, LSP, file watcher, gateway socket server.

Consequence used throughout this doc: *anything slow on the app thread freezes input, rendering,
and the entire MCP tool surface at once* (CLI commands queue behind the stalled loop).

---

## 2. Findings index

| ID | Title | Class | Severity | Effort |
|----|-------|-------|----------|--------|
| P-1 | FileFinder `/` search re-reads the whole workspace per keystroke | Perf (app-thread stall) | **Critical** | M |
| P-2 | FileFinder open + `#` symbols scan workspace synchronously | Perf (app-thread stall) | **High** | M |
| P-3 | Diff Pane open/refresh spawns N+2 git processes synchronously | Perf + arch | **High** | S |
| P-4 | Git poller runs duplicate git commands and unconditional per-file diffs | Perf (background churn) | Medium | S |
| P-5 | Worktree add/remove/list run synchronously on click | Perf (multi-second freeze) | **High** | M |
| P-6 | `DiffPane::max_line_len` is O(all diff text) per scroll tick | Perf (micro) | Low | XS |
| M-1 | `side_by_side` force-written every frame from the render path | Makeshift | Medium | XS |
| M-2 | `pending_subscribe_tx` / `pending_cli_caller_pane` ambient dispatch state | Makeshift | Medium | S |
| M-3 | Process-global mutable statics for agent-integration config in `domain/terminal` | Smell (globals in domain) | Medium | M |
| M-4 | Git CLI I/O lives in `domain/`, with parse logic duplicated | Arch misplacement + duplication | Medium | S (with P-3) |
| M-5 | Blanket `unsafe impl Send for App` | Smell (safety review surface) | Low | S |
| S-1 | `cli_adapter/commands.rs` — 4,039 lines, 5+ concerns | Oversized module | **High** | M |
| S-2 | `view/header.rs` — 2,298 lines | Oversized module | Medium | S |
| S-3 | `platform_adapter/macos/webview.rs` — 2,386 lines | Oversized module | Medium | S |
| S-4 | `domain/modal/mod.rs` — 1,304 lines, 6 modal types | Oversized module | Medium | S |
| S-5 | `domain/terminal/mod.rs` — 1,548 lines, 4 concerns | Oversized module | Medium | S |
| S-6 | `domain/pane/browser.rs` — 1,944 lines; JS builders inline | Oversized module | Medium | S |
| S-7 | Browser page-map JSON parsing lives in the event loop adapter | Misplacement | Low | XS (with S-6) |
| S-8 | `behavior_tests/agent_gateway.rs` — 4,268 lines | Oversized test module | Low | S |
| D-1 | `CLAUDE.md` bounded-context table & test paths are stale | Doc drift | Medium | XS |
| D-2 | `diff-auto-refresh.md` BR-4 cost assumption is wrong | Spec drift | Medium | XS |
| E-1…E-5 | E2E testability program | Testability | **High** | L (phased) |

Severity is judged by user-visible impact × how directly it blocks the roadmap.

---

## 3. Performance findings

### P-1 — FileFinder workspace text search reads every file per keystroke ⚠ worst finding

**Evidence.** `domain/modal/mod.rs:461-477` — every `insert_char`/`backspace`/`delete_char`
calls `filter()`. In `/` (WorkspaceSearch) mode, `filter_workspace_search`
(`modal/mod.rs:520-569`) does, **per keystroke, on the app thread**:

- iterates *all* finder entries (the full workspace file list),
- `std::fs::read_to_string(&full_path)` for each file (`:546`) — the 256 KB cap at `:549` is
  checked **after** the unbounded read,
- allocates a lowercased `String` for **every line of every file** (`:553`).

Typing a 5-character query = 5 full-workspace read+scan passes. On a real repo this is hundreds
of MB of transient allocation and tens-to-hundreds of ms (cold cache: seconds) per keystroke —
freezing input, rendering, and all MCP commands (§1). This is precisely the roadmap's
*"without UI stalls"* gap.

**Fix design — background search worker with cancellation (the pattern LSP already uses).**

The async precedent exists in this exact modal: workspace symbols arrive later via
`set_workspace_symbols` + `workspace_symbols_loaded` flag (`modal/mod.rs:240-245`). Apply the
same shape to text search:

1. New background worker in `state::BackgroundServices` (alongside `git_poll_*`,
   `state/background.rs`): channel of `WorkspaceSearchRequest { query_id: u64, base_dir, entries: Arc<Vec<PathBuf>>, query }`,
   results channel of `WorkspaceSearchResult { query_id, hits: Vec<WorkspaceSearchHit> }`.
2. `filter_workspace_search` (non-`external_hits` branch) no longer touches the filesystem:
   it bumps `query_id`, sends a request, and sets a `searching: bool` flag on `FileFinderState`
   (render shows a subtle "searching…" row — same visual slot as the existing empty state).
3. Worker drains to the **latest** request before running (the
   `latest_git_poll_cwds` drain idiom, `file_tree_service/mod.rs:42-50`), checks
   `fs::metadata` length *before* reading, scans with a case-folded matcher without per-line
   `String` allocs, caps hits at `FILE_FINDER_MAX_WORKSPACE_SEARCH_HITS`, and posts results +
   event-loop waker (same waker pattern as the git poller, `file_tree_service/mod.rs:559-561`).
4. `poll_background_events` consumes results; stale `query_id`s are dropped; matching results
   populate `workspace_search_hits` and clear `searching`.
5. Drop the per-keystroke debounce question entirely — latest-request draining *is* the
   debounce, with zero added latency for slow typers.

**Spec/test impact.** Update `docs/specs/file-finder.md`: new UC "Workspace text search runs in
the background" with BRs: (a) no filesystem reads on the input path, (b) results for stale
queries are discarded, (c) hits capped, (d) oversized files skipped *without* being read.
Behavior tests drive `FileFinderState` + a fake worker channel; one test asserts
`filter_workspace_search` performs zero `read_to_string` (inject counting `FileSystemPort` —
note: today it calls `std::fs` directly, the fix should route through the worker, not the port,
since the worker thread owns the I/O).

**Risk.** Low-medium. UI gains one transient "searching" state; selection/scroll reset rules
stay as-is (`filter()` already resets, `:475-476`).

### P-2 — FileFinder open and `#` symbols mode scan the workspace synchronously

**Evidence.**
- Open: `file_ops_service/mod.rs:46-68` — `gather_finder_entries(&base_dir, 8)` (`:272-310`,
  full `ignore::WalkBuilder` walk) plus a sort, synchronously, on every Cmd+P.
- `#` mode: `build_workspace_file_finder_symbols` (`file_ops_service/mod.rs:245-266`) reads
  **every entry** with `read_to_string` (again size-checked after the read), allocating a
  `Vec<String>` of all lines per file, until 3,000 symbols.

**Fix design.** Same worker as P-1 (one "workspace scan worker", two request kinds):

1. `open_file_finder_with_replace` opens the modal **immediately** with `entries: Vec::new()` +
   `entries_loading: true`, and requests a walk. Results stream in (single batch is fine —
   walks are fast relative to reads) → `set_entries(...)` re-runs `filter()`.
2. `ensure_file_finder_workspace_symbols_loaded` (`file_ops_service/mod.rs:188-214`) becomes a
   request instead of an inline scan; `workspace_symbols_loaded` already models the async arrival —
   today's code just fills it synchronously. Reuse P-1's metadata-first, no-per-line-alloc scanning.
3. Optional warm cache: keep the last walk result keyed by `(base_dir, generation-of-fs-events)`
   in `BackgroundServices` so reopening the finder is instant; invalidate from the existing
   file-watcher dirty signal (`update_service/mod.rs:131-146`).

**Spec/test impact.** `file-finder.md` UC "Finder opens instantly and populates asynchronously";
BRs for loading flags and late-arrival filtering. Existing finder tests construct
`FileFinderState::new(dir, entries)` directly (`state/tests.rs:131`) and keep working.

**Risk.** Low. The modal already renders an empty-entries state.

### P-3 — Diff Pane open/refresh spawns git synchronously though an async pipeline already exists

**Evidence.** `DiffPane::new` calls `refresh()` (`domain/pane/diff.rs:112`), which runs
`git status` + `git diff --numstat` + **one `git diff` per changed file** synchronously
(`diff.rs:181-209`). Call sites on the app thread: pane open + already-open refresh
(`file_ops_service/mod.rs:135,149`) and the header refresh button
(`click_adapter/header.rs:180-183`). A repo with 50 changed files = 52 subprocess spawns while
input/render/MCP are frozen.

Meanwhile the **async path is complete**: the poller pre-computes diff data off-thread
(`file_tree_service/mod.rs:68-90`), `consume_git_poll_results` applies it
(`:471-492`), `DiffPane::apply_poll_data` preserves expansion/scroll/selection state
(`diff.rs:137-178`), and `DiffPane::new_empty` already exists *"for tests and deferred
population"* (`diff.rs:117`) — but has **zero** production callers.

**Fix design — the poller becomes the only source of diff content.**

1. `open_diff_pane` uses `new_empty` + `trigger_git_poll()`; add `loaded: bool` to `DiffPane`
   (set by `apply_poll_data`) so the empty-but-loading pane renders "Loading changes…" instead
   of lying with a clean-tree view.
2. `DiffRefresh` click and the already-open branch call `trigger_git_poll()` instead of `refresh()`.
3. Delete `DiffPane::refresh`, `load_numstat`, `load_diff_lines` (see M-4: this also removes
   the git I/O from `domain/pane/` and the duplicated parsers).
4. Edge case that must be specced: today the poller sends `diff_files: None` when
   `status_entries` is empty (`file_tree_service/mod.rs:88-89`), and `apply_poll_data` is only
   called for `Some` — a clean repo would leave the pane stuck on "Loading". New BR: when a
   polled cwd *wants diff data* (P-4), the result always carries `Some` diff data, possibly empty.

**Spec/test impact.** Amend `docs/specs/diff-auto-refresh.md` (see D-2) with UC "Diff Pane opens
without blocking": BR-a open performs no git subprocess; BR-b loading state until first poll
result; BR-c clean-repo result clears loading. Behavior tests: counting `GitPort`-style fake at
the poller seam; assert `open_diff_pane` spawns nothing and a poll result with empty entries
renders the clean state.

**Risk.** Low. Latency to first content equals one poller round (the same git work, off-thread);
the refresh button becomes "request" semantics, which BR-2 of the existing spec already
anticipated (generation bump on apply).

### P-4 — Git poller: duplicated commands and unconditional per-file diffs

**Evidence.** `collect_git_poll_results_for_cwds` (`file_tree_service/mod.rs:52-106`) per cwd
per tick runs: `detect_git_info` → `rev-parse` + `status --porcelain` + `diff --numstat`
(`domain/terminal/git.rs:41-58,385-403`); then `list_worktrees` (2 more spawns incl.
`rev-parse --git-common-dir`, `git.rs:191-211`); `repo_root` (`:65`); **`status_files` — a second
`git status --porcelain`** (`:66`); and when anything changed, **a second `git diff --numstat`**
(`:69`) plus **one `git diff` per changed file** (`:84`) — *even when no Diff Pane exists*.
Triggers fire on every PTY-output badge check and file-watch event
(`event_loop_adapter/mod.rs:1295-1302`, `update_service/mod.rs:123-128,290`), i.e. continuously
while an agent is streaming. With 20 changed files that's ~28 subprocess spawns per tick of
background churn (CPU + battery), and `git status` on large repos is 50-300 ms each.

The existing spec encoded the wrong assumption: `diff-auto-refresh.md` BR-4 says the cost is
*"negligible since it already runs git status"*.

**Fix design.**

1. **Single-spawn data flow** inside the poller: run `status --porcelain` once → derive both
   `status_entries` and `GitStatus.changed_files`; run `diff --numstat` once → derive both
   `GitStatus.additions/deletions` and the per-file numstat map; derive `repo_root` from
   `list_worktrees`' `is_current` entry (it already canonicalizes and prefix-matches the cwd,
   `git.rs:218-238`) instead of a separate `rev-parse --show-toplevel`. Restructure
   `detect_git_info` into composable pieces so nothing is fetched twice.
   Result: 8+N spawns → 4 fixed spawns.
2. **Gate per-file diffs on demand**: change the poller request channel payload from
   `Vec<PathBuf>` to `Vec<GitPollRequest { cwd, wants_diff: bool }>`; `trigger_git_poll`
   (`file_tree_service/mod.rs:286-293`) sets `wants_diff` iff an open Diff Pane matches that
   cwd/repo (the matching rule already exists at `:477-484`). N diff spawns happen only while a
   Diff Pane is actually open.
3. Keep the full `Vec<WorktreeInfo>` in `GitPollCwdResult` instead of discarding it after
   computing `count`/`current` (`:62-64`) — P-5 consumes it.

**Spec/test impact.** D-2 amends BR-4. Poller unit tests already exist around
`latest_git_poll_cwds`; add coverage for request-shape and wants-diff gating via the channel types.

**Risk.** Low. Pure producer-side restructuring; consumer contract (`GitPollCwdResult`) only gains a field.

### P-5 — Worktree operations freeze the app for seconds

**Evidence.** All synchronous, on the app thread, from click handlers:
- `git worktree add` on switcher confirm — `click_adapter/header.rs:334-338` and `:438-442`
  (`git_add_worktree` → `AppCorePort` → `ports.git`, `app.rs:699-706`). A worktree add checks
  out the entire tree — multi-second on real repos.
- `git worktree remove --force` — `click_adapter/header.rs:409`; plus branch cleanup confirm
  running `list_worktrees` + `remove_worktree` + `delete_branch` back-to-back
  (`pane_create_service/mod.rs:1124-1151`).
- Switcher **open** lists worktrees synchronously — `click_adapter/header.rs:278`.

During these, rendering, typing, and every MCP tool call are stalled (§1).

**Fix design.**

1. **Switcher open becomes free:** read the worktree list from poller-cached data. P-4 step 3
   already puts `Vec<WorktreeInfo>` in `GitPollCwdResult`; store the latest per-repo list in
   `BackgroundServices` (next to `cached_repo_roots`, `state/background.rs`) and have
   `open_git_switcher` consume the cache (staleness ≤ one poll round, and the switcher already
   tolerates that by construction — it shows poll-derived current-worktree badges today).
2. **Mutations become jobs:** a `WorktreeOp` worker (same thread+channel+waker idiom as the git
   poller): `Add { cwd, path, branch, new_branch }`,
   `Remove { main_cwd, path, also_delete_branch: Option<String> }`. The Git Switcher modal and
   branch-cleanup modal gain an `in_flight: Option<WorktreeOpKind>` state: confirm dispatches the
   job, the modal shows a spinner row and rejects double-submit; completion arrives in
   `poll_background_events`, which applies the follow-up that today runs inline (open terminal in
   the new worktree / close pane / error toast via the existing notification path).
3. Failure surface: reuse the agent-notification snippet/chrome path for "worktree add failed: …"
   (the modal may already be closed when the result lands).

**Spec/test impact.** Update `docs/specs/git-switcher-worktree-actions.md`: new BRs — UI stays
interactive during worktree ops; double-submit prevented; results applied on completion; failures
notify. Behavior tests with a blocking fake `GitPort` proving the dispatch path doesn't block and
the state machine settles on completion.

**Risk.** Medium — this is a real UX state machine change (pending states where none exist).
That's why it's a spec-first slice, not a refactor.

### P-6 — `max_line_len` walks all expanded diff text per horizontal-scroll tick

**Evidence.** `scroll_adapter/mod.rs:296` calls `dp.max_line_len()` on every h-scroll event;
the method `chars().count()`s every line of every expanded file (`diff.rs:284-303`).

**Fix design.** Cache `max_line_len` on `DiffPane`, recomputed when content or expansion
changes. All mutation points already bump `generation` (`apply_poll_data`, expand toggles,
scroll handler `:305`), so a `cached_max_line_len: (u64, usize)` keyed by generation is enough —
or simply recompute in `apply_poll_data`/expand-toggle and store a plain field. Pick the latter:
fewer moving parts. Fold into the P-3 slice.

### Micro-smells noted, fix opportunistically (no dedicated slice)

- `AppCorePort::header_hit_zones` clones the whole `Vec` on every call (`app.rs:664-666`);
  return `&[HeaderHitZone]`.
- `view/mod.rs:148` clones `visual_pane_rects` every frame; a borrow split would avoid it
  (only worth it if profiling ever shows it).
- `filter_files` allocates a `String` per entry per keystroke for sort tie-breaking
  (`modal/mod.rs:498-517`); rank by `&Path` with a lazy lossy-compare instead. Cheap win inside P-1's slice.

---

## 4. Makeshift / workaround findings

### M-1 — `side_by_side` is force-written from the render path every frame

**Evidence.** The only write anywhere is `view/mod.rs:190-192`: every frame, for every Diff
Pane, `dp.side_by_side = true`. The field (`diff.rs:40`) and the entire unified-mode branch
(`total_lines`, `diff.rs:272-276`; `pair_diff_lines`) are otherwise dead configuration. It also
breaks the file's own contract declared 16 lines later: *"all sub-functions take `&self`"*
(`view/mod.rs:207`).

**Fix design.** Default `side_by_side: true` in both constructors; delete the render-path
mutation. Keep the field and unified rendering as the future user toggle the roadmap implies
(Diff Pane as first-class review surface) — but the *toggle* is a separate feature spec when
wanted; this slice just removes the per-frame domain write. One behavior test: a freshly
created Diff Pane is side-by-side without a render pass.

### M-2 — Ambient CLI dispatch state smuggled through `App` fields

**Evidence.** `app.rs:191-195` — two fields explicitly commented "Temporary":
`pending_subscribe_tx` (set by the event loop before dispatch, `event_loop_adapter/mod.rs:856-863`,
taken inside `cli_subscribe` via `take_subscribe_tx`, `app.rs:1195-1197`) and
`pending_cli_caller_pane` (set/cleared in `handle_cli_command`, `commands.rs:79,120`; read at
distance by `cli_subscribe`/`caller_terminal_id` (`commands.rs:3086,3095`) and even by a service,
`pane_create_service/mod.rs:231`). This is parameter-passing via mutable global-ish state: any
code can read a value that is only meaningful during a dispatch, with set/clear discipline spread
across two files.

**Fix design.** One cohesive, self-describing context:

```rust
pub(crate) struct CliDispatch {
    pub caller_pane: Option<PaneId>,
    pub subscribe_tx: Option<mpsc::Sender<String>>,
}
// App field: cli_dispatch: Option<CliDispatch>
```

- Set/cleared in exactly one place: `handle_cli_command` (the event loop hands `notification_tx`
  to it as a parameter instead of pre-poking an App field — `CliCommand` already carries it).
- Accessors `cli_caller_pane()` / `take_subscribe_tx()` keep their signatures (ports unchanged),
  but read through `cli_dispatch`, and debug-assert they're called only during a dispatch.
- Clearing happens via a drop-guard or `finally`-style structure inside `handle_cli_command` so
  an early `?` can never leak dispatch state (today's flow has no early return, but the
  invariant should be structural, not incidental).

**Spec/test impact.** No user-visible change → refactor slice; the existing
`cli-workspace-routing` behavior tests (BR-5 strips `_caller_pane`, `commands.rs:73-77`) are the
safety net. Add one test: dispatch context is absent outside a dispatch.

### M-3 — Process-global mutable statics configure terminal spawning from `domain/`

**Evidence.** `domain/terminal/mod.rs:45-68`: `AUTO_INTEGRATION_ENABLED` (AtomicBool),
`GATEWAY_SOCKET_PATH`, `AGENT_WRAPPER_DIR`, `SHELL_INTEGRATION_DIR` (OnceLocks), written from
`main()` (`main.rs:308-310`), from settings load inside `App::new` (`app.rs:252-256` — a
constructor with a process-wide side effect), and from the settings toggle (`app.rs:1203-1205`).
Read invisibly inside terminal spawn logic. Consequences: hidden coupling (a constructor mutates
process state), order-dependent tests (behavior tests share one process), and a blind spot for
multi-window semantics (it works today *because* the gateway socket is genuinely per-process,
but nothing says so).

**Fix design.** Make spawn configuration explicit data:

1. `TerminalSpawnConfig { gateway_socket: Option<String>, agent_wrapper_dir: Option<String>, shell_integration_dir: Option<String>, auto_integration: bool }`
   constructed in `main()` (socket/wrapper discovery) and owned by `RealTerminalFactory`
   (`adapter/outward/terminal_factory_adapter/`) — the component that actually spawns PTYs.
   `auto_integration` updates flow through a factory method when settings change.
2. `domain/terminal` spawn functions take `&TerminalSpawnConfig` (or the factory pre-computes the
   env map) instead of reading statics. `URL_RE` (`:70`) stays — a compiled regex is a true constant.
3. `App::new` loses its global side effect; the settings toggle calls the factory.

**Spec/test impact.** Refactor slice (no behavior change); the agent-integration behavior tests
(`agent-auto-integration.md`, `agent-integration-toggle.md` specs) are the net. Tests gain the
ability to construct two Apps with different configs in one process — a prerequisite for honest
multi-window tests later.

**Risk.** Medium-low: touches every terminal spawn site; mechanical but wide.

### M-4 — Git CLI I/O inside `domain/`, with parsing duplicated

**Evidence.** `domain/terminal/git.rs` is 404 lines of `Command::new("git")` I/O living in the
domain layer, consumed *through* the outward `GitPort` (`adapter/outward/git_adapter/mod.rs:12-46`
delegates back into domain — an inside-out dependency). `domain/pane/diff.rs` spawns git
directly (`:213-218`) and duplicates `git.rs` parsers nearly line-for-line:
`load_numstat` ≈ `diff_numstat` (`diff.rs:211-233` vs `git.rs:116-129`),
`load_diff_lines` ≈ `file_diff_lines` (`diff.rs:235-259` vs `git.rs:133-158`).
CLAUDE.md's own layer table says domain may use *"only other domain types"*.

**Fix design** (mostly falls out of P-3/P-4):

1. P-3 deletes the duplicated `DiffPane` loaders — the domain pane becomes pure state + apply.
2. Move `git.rs` to `adapter/outward/git_adapter/git_cli.rs`; the `GitPort` trait keeps the
   shapes (`GitInfo`, `StatusEntry`, `WorktreeInfo`…) — move those **types** into the port
   module (`application/ports/outward/git_port.rs`) so domain/services depend on types, adapters
   on the CLI. The poller (an application service) then calls `ports.git` (it currently calls
   the domain module directly, `file_tree_service/mod.rs:61-66` — this is also what makes the
   poller untestable without real git).
3. Scope note: **do not** attempt a full "no I/O in domain" purge — `tree`, `settings`,
   `editor/buffer` also touch `std::fs` and are stable, cohesive, and tested; churn there buys
   nothing now. Record the boundary decision in `docs/context-map.md` instead: *git I/O is
   port-owned; file I/O in tree/editor/settings is accepted legacy until a feature forces it.*

**Spec/test impact.** Refactor + the P-4 poller tests gain a fake `GitPort` seam (today
impossible). `lint-arch.sh` could grow a check: no `Command::new` under `domain/` except
allowlisted legacy files.

### M-5 — Blanket `unsafe impl Send for App`

**Evidence.** `app.rs:210-214`: one `unsafe impl` whose safety argument ("raw pointers… only
used for webview management… dispatched back to the main thread") must hold for *every current
and future field* of a 40-field struct. Any new non-Send field silently inherits the claim.

**Fix design.** Localize the unsafety: wrap each genuinely non-Send member in a small
`MainThreadCell<T>` newtype (in `core_types` or `platform_adapter`) carrying its own
`unsafe impl Send` + documented invariant ("created and dereferenced only on the main thread via
WindowCommand dispatch"), then delete the blanket impl so `App: Send` holds structurally.
Compile-time effect only; zero behavior change. Low priority, pairs naturally with S-3.

---

## 5. Oversized-module splits

Ground rule for all splits: **mechanical extraction, no signature changes**, one commit per
module, `cargo test` + `lint-arch.sh` green between each. Order them *after* the perf/makeshift
slices that touch the same files (e.g. S-1 after P-3/M-2 so moved code is final-shape).

### S-1 — `adapter/inward/cli_adapter/commands.rs` (4,039 lines)

The MCP/CLI dispatch plus five distinguishable concerns (verified by function inventory):

| New module under `cli_adapter/commands/` | Contents (today's lines) |
|---|---|
| `mod.rs` | `CliPorts` alias, `handle_cli_command`, `dispatch_cli_command` (38-175) |
| `params.rs` | param/JSON helpers: `pane_id_param`, `param_bool`, `bounded_json_string`, truncation, `expand_home`… (190-373, 551-557, 698-733) |
| `observe.rs` | observe-workspace/list-panes/capture-pane/-selection/get-layout + their JSON builders (1258-1530, 2395-2472, 3505-3550) |
| `browser.rs` | the whole browser tool family: authorization, visual-fit, snapshot JSON, actions/eval/operation (272-549, 557-697, 727-1202, 1607-2279) |
| `panes.rs` | split/close/focus/open-terminal/-editor/-browser/resize/layout-action/rename/send-keys (2473-2918, 2290-2394) |
| `render.rs` | render-html/stream-chunk/stream-end + fragment validation (2919-3070) |
| `artifacts.rs` | context-artifact family (3090-3284) |
| `integrations.rs` | enable/remove/list integrations + binary detection (3285-3504) |
| `notify.rs` | `cli_subscribe`, `cli_notify` intake (3071-3089, 3551-3721) |

Two pieces should leave the adapter entirely:

- **Provider notification/transcript interpretation** (3722-4018:
  `wrapped_agent_notification_snippet_from_payload`, `codex_*`, `claude_*`, `gemini_*`,
  `resolve_codex_stop_payload`, transcript readers): this is Wrapped-Agent domain knowledge,
  not transport. Move next to its consumer state: `domain/state/gateway_status/` (or a new
  `domain/agent/notification.rs`). Pure functions → direct unit tests, and the gateway adapter
  stops owning provider semantics.
- **`translate_key`** (4019+): key-name → byte-sequence mapping belongs with input/terminal
  domain (`domain/input/` next to `Key`), shared rather than CLI-private.

**Gotcha:** `scripts/lint-arch.sh` whitelists `impl App` blocks **by file path**
(`ALLOWED_IMPL_APP=("cli_adapter/commands.rs" …)`) — update the allowlist to
`cli_adapter/commands/mod.rs` in the same commit, or the lint goes red.

Bonus from the split: per-family files make each handler's true port needs visible (handlers
already take `&impl LayoutPort`-style narrow bounds; the fat `CliPorts` stays only in `mod.rs`).

### S-2 — `adapter/outward/view/header.rs` (2,298 lines)

Cohesive seams already visible in the inventory: `header/layout.rs` (width budgeting, tab width
caps, scroll-offset fitting — `:153-533`), `header/actions.rs` (HeaderActionSpec/strip/icons —
`:232-420`, `:565-708`), `header/status.rs` (agent-status → chrome-state mapping, dot colors —
`:720-850`), `header/badges.rs` (editor + selection-comment badges — `:94-152`, `:534-564`),
`header/paint.rs` (render/paint-steps — `:587-` onward). `HeaderHitZone` stays in `header/mod.rs`
(it's the public surface other modules import via `crate::header::`).

### S-3 — `platform_adapter/macos/webview.rs` (2,386 lines)

Four seams, all verified: `registry.rs` (the six `LazyLock<Mutex<…>>` registries + waker + drain
fns, `:33-247`), `delegates/` (`ui.rs`, `navigation.rs`, `download.rs`, `script_handler.rs` —
the objc2 ivar/class blocks at `:256`, `:537`, `:968`, `:1276`), `auth_popup.rs` (`:84-`, `:501-`),
`handle.rs` (`WebViewHandle` + the per-operation `*Ctx` main-thread dispatch structs, `:1329-`).
Keep the Ctx-struct pattern (objc2 block boundaries make a generic dispatcher riskier than the
boilerplate) — grouping it is the win. Pairs with M-5's `MainThreadCell`.

### S-4 — `domain/modal/mod.rs` (1,304 lines)

One file per modal type: `file_finder.rs` (~550 incl. scoring fns), `git_switcher.rs`,
`context_menu.rs`, `config_page.rs`, `comment_composer.rs`, `save_confirm.rs`/inputs, and
`stack.rs` for `ModalStack` (`:1244-`). Pure code motion; P-1/P-2 should land first (they
rewrite `filter_workspace_search`).

### S-5 — `domain/terminal/mod.rs` (1,548 lines)

`integration_env.rs` (the statics → M-3's config + `discover_agent_resources`, `:45-102`),
`grid_sync.rs` (`TermDimensions`, `SharedSnapshot`, `TermEventListener`, `GridSyncer`,
`grid_sync_thread_main`, `:104-690`), `urls.rs` (`terminal_url_regex`, `trim_url_trailing`,
`:596-632`), leaving the `Terminal` facade + `TerminalBackend` impl (~700 lines) in `mod.rs`.
Sequence after M-3 (which rewrites the statics this split would otherwise move twice).

### S-6 + S-7 — `domain/pane/browser.rs` (1,944) and the misplaced page-map parser

- Extract `bridge_scripts.rs`: the JS-string builders (`build_render_document`,
  `browser_selection_bridge_script`, `escape_js_string_literal`, `:1474-1559+`) — pure
  functions, directly unit-testable, and the JS payloads stop being buried in a state file.
- Extract `page_map.rs`: `BrowserPageMap`/`BrowserPageElement` types **plus** the parsing
  currently in the wrong layer — `event_loop_adapter/mod.rs:45-206`
  (`parse_browser_page_map`/`_elements`/`_element`/`_rect`) parses bridge JSON into these domain
  types inside an inward adapter. Move as `BrowserPageMap::from_bridge_json(...)`; the event
  loop keeps only "drain message → hand to domain".
- `permissions.rs` for the permission/cert request types (`:9-50`).

### S-8 — `behavior_tests/agent_gateway.rs` (4,268 lines)

Split by spec family to match the documented UC↔test mapping convention
(`cli-server`, `cli-workspace-routing`, `agent-notification-routing`, artifact suites…).
Test-only motion; do it last, it conflicts with nothing.

---

## 6. Doc / spec drift

### D-1 — CLAUDE.md is out of date where it matters most (it's the per-session contract)

Verified drift in `apps/terminal/CLAUDE.md`:

| CLAUDE.md says | Reality |
|---|---|
| `adapter/outward/platform_native/` | `adapter/outward/platform_adapter/` (macos/) |
| `adapter/outward/renderer/` | `adapter/outward/renderer_adapter/` |
| `adapter/outward/lsp_client/` | `adapter/outward/lsp_adapter/` |
| tests at `crates/tide-app/src/behavior_tests.rs` (and `…/src/behavior_tests/`) | `crates/tide-app/src/application/behavior_tests/` |
| "537+ tests" | 1,458 passing (2026-06-11) |

Also missing from the bounded-context table entirely: `domain/pane/` (the five PaneKind state
modules), `domain/modal/`, `domain/state/`, `application/services/*`, and the `cli_adapter`
(Agent Gateway) — the modules where most work now happens. Fix: correct the paths, add the
missing rows, and replace the hardcoded test count with "see CI". Cheapest, highest-leverage
doc fix; do it first.

### D-2 — `diff-auto-refresh.md` BR-4

Replace *"If no DiffPane is open, the poller still collects diff data (negligible cost)"* with:
*"Per-file diff collection runs only for cwds with an open Diff Pane (`wants_diff`); a
wants-diff result always carries diff data, possibly empty, so a loading Diff Pane can settle on
a clean tree."* Update the Tests table accordingly (P-3/P-4 BRs).

---

## 7. E2E testability program

### Where testability stands (verified)

| Tier | What exists | Limits |
|---|---|---|
| Behavior tests | 1,458 in-process tests against `App` + `Ports::noop()` (`app.rs:72-88`) | No real GPU/PTY/window; by design |
| E2E | `crates/tide-e2e-tests`: spawns the **real binary** in an isolated HOME/TMPDIR, drives it over the Gateway socket (JSON-RPC), 8 tests (`harness.rs`, `assertions.rs`) | See gaps |
| Visual | nothing | — |

The E2E foundation choice is *right* — the Gateway is a production API, so tests exercise real
wiring. The gaps are what keep it at 8 tests:

- **G1 — no input injection.** Everything goes through CLI methods, so the entire
  keyboard/mouse/IME stack (Architecture Invariants #4 and #6 — historically the buggiest area:
  `ime.md`, `input-routing.md`, `modifier-keybinding-redesign.md` specs all exist because of it)
  has **zero** end-to-end coverage.
- **G2 — no synchronization primitive.** `send_keys` → `capture_pane` races the PTY round-trip;
  the harness has no wait/poll helper (`assertions.rs` asserts immediately). More tests = flakes.
- **G3 — no visual oracle.** The renderer's output is unobservable; chrome/layout regressions
  (a large share of this app's surface) are untestable E2E.
- **G4 — ungated.** The 8 tests are plain `#[test]`s in the workspace: every `cargo test` at the
  root **spawns real windows** on the dev machine and would fail on display-less CI. They also
  steal focus mid-suite.
- **G5 — no Wrapped-Agent fixture.** Nothing E2E-tests the agent loop (subscribe → notify →
  status chrome → notification routing), the product's core differentiator.

### E-1 — Test Driver surface on the Gateway (foundation)

A small set of gateway methods compiled behind `#[cfg(feature = "test-driver")]` **and** gated at
runtime by `TIDE_TEST_DRIVER=1` (the harness sets both; release builds ship without the feature):

- `test-inject-event { event }` — deserializes into a `PlatformEvent` (Key/Modifiers/Mouse/
  Scroll/IME preedit+commit) and sends it through the **same** `event_tx` the macOS callback
  uses (`main.rs:234`). One serde derive on `PlatformEvent` (test-feature-gated) is the only
  production-code touch. This closes G1 *through the real routing stack* — Modal → FocusArea →
  Router → TextInput — without macOS accessibility permissions or synthetic NSEvents.
- `test-await-idle { quiet_ms, timeout_ms }` — responds when the app thread has: drained its
  event queue, `!cache.needs_redraw`, no active layout/split animation, and no PTY grid
  generation change for `quiet_ms`. Implementation note: CLI commands already execute *on* the
  app thread in arrival order, so the handler can't block the loop waiting for the loop — reuse
  the deferred-response channel that `subscribe` already proved out (`notification_tx`,
  `event_loop_adapter/mod.rs:854-868`): register the wait, fulfill it from the loop tick when
  the condition holds. This closes G2 and de-flakes everything else.
- `test-screenshot { path }` — render-thread WGPU readback (copy surface texture → buffer → PNG).
  Closes G3; golden-image comparison with per-pixel tolerance comes later — the first win is
  simply *having* artifacts on failure.
- `test-quit` — graceful shutdown so CI never leaks processes (Drop-kill stays as the fallback).

### E-2 — Lane gating & CI

- Mark every e2e test `#[ignore]` (or move behind a `TIDE_E2E=1` env check in the harness):
  default `cargo test` becomes window-free again; `scripts/e2e.sh` runs
  `cargo test -p tide-e2e-tests -- --ignored --test-threads=1`.
- CI job on a macOS runner: build once, run e2e serially, retry-once policy (the v2 release
  pipeline already learned real-PTY tests flake under parallel load — same lesson applies),
  upload `test-screenshot` artifacts on failure.

### E-3 — Harness v2

`wait_until(|| pred, timeout)` polling observe methods; `capture_contains(pane, needle)` built
on it; fixture builders (temp git repo with N changed files; settings file presets); and a
**fake Wrapped Agent** fixture — a script/Rust helper that connects to the socket, `subscribe`s,
and emits `notify` payloads (claude/codex/gemini shapes are now pure functions per S-1's
extraction, so fixtures and unit tests share the same payload builders). G5 closes: assert
status dots, notification snippets, and attention routing end-to-end.

### E-4 — Determinism seams (already half-built, finish them)

`Ports` already has `FixedClock`/`Noop*` (`app.rs:72-88`) for Tier-1. For Tier-2, prefer
**condition-based waiting** (`test-await-idle`) over any global fake clock — animations and
cursor blink are real but bounded, and awaiting quiescence is more honest than freezing time.
Document this as the testing doctrine in `docs/testing/behavior-tests.md`'s new sibling:
`docs/testing/e2e-tests.md` (how to run, when to write E2E vs behavior test, flake policy).

### E-5 — First E2E targets (in order, each maps to an invariant or chronic-bug spec)

1. Input routing priority (Invariant #4): inject keys with a modal open → modal consumes; close →
   focused pane receives. (Impossible to test E2E today.)
2. IME proxy lifecycle (Invariant #6): preedit → focus switch → commit-in-place (the carry bug
   class that `editor-ide-polish` fixed) — inject IME events, await-idle, capture.
3. Workspace-swap CLI routing (`cli-workspace-routing` BR-1/2): command with `_caller_pane` in a
   background Workspace leaves the active Workspace untouched — assert via observe + screenshot.
4. P-1/P-5 regression guards: start a worktree add / type into finder search on a large fixture
   repo → `test-await-idle` returns within budget (the "UI never freezes" assertions these
   slices need to stay fixed).
5. Wrapped-agent status chrome via the E-3 fake agent.

---

## 8. Execution order

Each slice: (spec new/amended) → behavior tests → code → `cargo test` + `lint-arch.sh` +
(hot-path slices) `cargo bench` spot-check. One slice ≈ one PR.

| Phase | Slices | Rationale |
|---|---|---|
| **0. Contracts** | D-1, D-2 | Minutes of work; every later PR cites correct docs |
| **1. App-thread perf** | P-3+P-6+M-1 (diff cluster) → P-4 (poller) → P-1 (finder search) → P-2 (finder open/symbols) → P-5 (worktree jobs) | Biggest user-visible wins; directly roadmap-aligned; P-3/P-4 unlock M-4 and P-5's cache |
| **2. Structure** | M-4 (git port move) → M-2 (dispatch ctx) → M-3 (spawn config) → M-5 (Send cells) | Each makes a later split cleaner |
| **3. Splits** | S-1 (+lint-arch allowlist) → S-3 → S-2 → S-4 → S-5 → S-6/S-7 → S-8 | Pure motion; after the rewrites that touch the same lines |
| **4. E2E** | E-1 (await-idle first, then inject, then screenshot) → E-2 → E-3 → E-5 list | E-1 await-idle is the prerequisite for de-flaking everything; Phase-1 slices each gain an E-5 #4 guard as they land |

Phases 1–2 and Phase 4's E-1/E-2 are worth doing soon; Phase 3 can interleave as
opportunity allows (each split is an independent, safe PR).

### Implementation status (2026-06-12)

Done and on `terminal-rev` (each its own commit, `cargo test` + `lint-arch.sh`
green after every slice; suite grew 1458 → 1472):

- **Phase 0** — D-1, D-2. ✅
- **Phase 1** — P-3+P-6+M-1 (diff cluster), P-4 (poller single-spawn + wants_diff),
  P-1 (finder search worker), P-2 (`#` symbols worker), P-5 **Part A** (Git Switcher
  opens from the poller cache), **P-5 Part B** (worktree add/remove/branch-delete as
  background jobs + optimistic delete). ✅
- **Phase 2** — M-2 (CliDispatch context), **M-3** (TerminalSpawnConfig replaces the
  domain spawn-config statics; env injection unit-tested), **M-4** (git CLI I/O moved
  to `git_adapter/git_cli`, types stay in domain), **M-5** (blanket `unsafe impl Send
  for App` replaced by localized impls on Ports/WebViewHandle/Highlighter). ✅
- **Phase 3 (partial)** — the architecturally-valuable splits: **S-7** (browser
  page-map parser → domain), **S-1 (core)** (provider notification interpretation →
  `domain/agent/notification`; `translate_key` → `domain/input`), **S-6** (browser JS
  bridge builders → `browser_bridge`). ✅
- **Phase 4** — E-2 (e2e lane gated `#[ignore]` + `scripts/e2e.sh`), E-3 (harness
  `wait_for_pane_contains` / `wait_for_idle`; `wait_until` already existed), E-4
  (`docs/testing/e2e-tests.md`), and the first E-1 step: the `test-poll-state`
  gateway method (runtime-gated by `TIDE_TERMINAL_TEST_DRIVER=1`) + harness
  `poll_state`/`wait_for_idle`, with in-process behavior tests. ✅

Remaining (pure size-reduction motion of interleaved/coupled files, or
display-blocked):

- **Phase 3 size-only splits** — the rest of S-1 (interleaved browser/observe/panes
  command handlers), S-2 (header.rs), S-3 (webview.rs objc2 delegates), S-4 (modal —
  FileFinderState et al. are interleaved with shared helpers), S-5 (terminal
  grid_sync, tightly coupled to `Terminal`), S-8 (the 4k-line agent_gateway test
  file). These reduce file size with zero behaviour change; the code is interleaved
  or tightly coupled, so each is a focused, independently-verifiable PR rather than a
  clean line-range move.
- **E-1 rest** — `test-inject-event` (needs `serde` derives on `Key`/`Modifiers`/
  `MouseButton`/`PlatformEvent` + an injected-event queue drained in the loop),
  `test-await-idle` (deferred-response), `test-screenshot` (wgpu readback). The
  mechanism is implementable but the payoff (real-window input/visual E2E) can only be
  verified with a display.

  Older deferral notes below are superseded by the status above where they overlap.

- **M-4** — move `domain/terminal/git.rs` to `git_adapter` (the duplicated DiffPane
  parsers were already deleted in P-3; what remains is pure relocation + a
  `GitPort`-types move).
- **M-5** — `MainThreadCell` to retire the blanket `unsafe impl Send for App`
  (compile-time only; pairs with S-3).
- **Phase 3** — all module splits (S-1…S-8). Pure mechanical motion; each an
  independent safe PR.
- **Phase 4 E-1** — the gated Gateway test-driver (`test-poll-state` →
  `test-await-idle` → `test-inject-event` → `test-screenshot`) and E-5 targets.
  Specced in `docs/testing/e2e-tests.md`; `test-poll-state` is the low-risk first step.

### Explicitly out of scope (decided, not forgotten)

- Full "no I/O in domain" purge (`tree`, `settings`, `editor/buffer`) — high churn, no current payoff (M-4 scope note).
- Rewriting the webview Ctx-dispatch boilerplate into a generic mechanism — objc2 block
  boundaries make the boilerplate the safer pattern.
- `action_service`/`pane_create_service` splits — large but cohesive single-concern dispatchers;
  revisit only if a feature forces growth.
- A second renderer backend / non-macOS platform work.
