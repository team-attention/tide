# Event-Driven Terminal Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Tide's recurring terminal/runtime state polling with shell, PTY, filesystem, socket, and worker events while preserving all current features and UI behavior for zsh, bash, and fish.

**Architecture:** Supported shells emit authenticated OSC 7 and OSC 133 signals into a typed PTY side channel, and `TerminalContext` becomes the only application-level CWD/shell-state source. Filesystem and repository watchers, PTY exit, Agent Gateway topology, renderer/LSP/browser callbacks, and worker completion explicitly wake the app thread; an optional earliest `RuntimeDeadline` retains only user-visible timers and coalescing. There is no periodic state-discovery fallback.

**Tech Stack:** Rust 2021, vendored `vte` and `alacritty_terminal`, macOS PTY/process APIs, `notify`/FSEvents, Unix domain sockets, shell integrations for zsh/bash/fish, Cargo tests.

**Spec:** `apps/terminal/docs/specs/event-driven-terminal-runtime.md`

## Global Constraints

- Preserve all current Tide features and UI behavior for zsh, bash, and fish.
- Automatically install shell-state integration for zsh, bash, and fish independently of the agent auto-integration preference.
- Use OSC 7 for Working Directory Signals and OSC 133 `A`/`B`/`C`/`D` for Command Lifecycle Signals.
- Do not add process/CWD polling, output heuristics, periodic refresh, or any other fallback path.
- Unsupported shells may omit tracked CWD/command state, but must remain usable as Terminal Panes.
- Keep exact Wrapped Agent `Running`, `Idle`, and `NeedsInput` behavior; retain unwrapped-agent observations through event-triggered work only.
- Keep FileTree View, Git badges/status/diffs/worktrees, session CWD, split/new/respawn CWD, relative links, file operations, busy styling, and guarded worktree actions behaviorally unchanged.
- Runtime timers are allowed only for cursor blink, focused-window autosave, resize/render coalescing, layout/FileTree animation, filesystem/Git debounce, and bounded teardown.
- Preserve active and background Workspace state and Retained Context state.
- Preserve the hexagonal dependency direction and pass `scripts/lint-arch.sh`.
- Independently author Tide shell integration; do not copy Ghostty's GPL-derived shell code.
- Do not modify, revert, stage, or commit unrelated pre-existing worktree changes.
- Do not commit, push, merge, tag, or deploy unless the user explicitly asks.

## File Structure

| File | Responsibility after this work |
|------|--------------------------------|
| `crates/vte/src/ansi.rs` | Parse OSC 7/133 and call typed handler methods. |
| `crates/alacritty_terminal/src/event.rs` | Carry VTE working-directory and command-boundary events to an embedder. |
| `crates/alacritty_terminal/src/term/mod.rs` | Translate VTE handler callbacks into terminal events. |
| `crates/tide-app/src/domain/terminal/runtime_event.rs` | Define `ShellStateSignal`, `CommandBoundary`, and `TerminalRuntimeEvent`; validate/decode shell payloads. |
| `crates/tide-app/src/domain/terminal/grid_sync.rs` | Queue terminal runtime events and wake the app thread. |
| `crates/tide-app/src/domain/terminal/mod.rs` | Build shell launch configuration, own the runtime-event queue and nonce, initialize event CWD, expose drains. |
| `crates/tide-app/src/application/services/terminal_runtime_service/mod.rs` | Apply terminal runtime events to active/background `TerminalContext` and trigger dependent work. |
| `crates/tide-app/src/application/services/file_tree_service/mod.rs` | Reconcile repository targets, dispatch/consume Git refreshes, and update existing Git/FileTree/Diff consumers. |
| `crates/tide-app/src/application/ports/outward/repository_watcher_port.rs` | Define repository watch registration and change-drain boundary. |
| `crates/tide-app/src/adapter/outward/repository_watcher_adapter/mod.rs` | Implement reference-counted worktree/Git metadata watching with wake callbacks. |
| `crates/tide-app/src/domain/tree/mod.rs` | Wake on FileTree View changes and expose its debounce deadline. |
| `crates/tide-app/src/domain/state/timing.rs` | Represent optional Runtime Deadlines and event-triggered debounce/observation deadlines. |
| `crates/tide-app/src/domain/state/background.rs` | Own typed worker channels and repository-watch/refresh state. |
| `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` | Wait for an event or earliest Runtime Deadline and drain ready sources. |
| `crates/tide-app/src/adapter/inward/cli_adapter/server.rs` | Block on socket/subscription events and shut down through explicit wakes. |
| `crates/tide-app/resources/shell-integration/*` | Emit silent, authenticated shell-state signals for zsh/bash/fish. |
| `crates/tide-app/src/application/behavior_tests/event_driven_terminal_runtime.rs` | Executable UC/BR coverage for application behavior. |
| `scripts/test-shell-state-integration.sh` | Black-box shell startup and signal compatibility suite. |

---

### Task 1: Prove automatic shell integration without startup regressions

**Files:**

- Modify: `apps/terminal/crates/tide-app/src/domain/terminal/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/terminal/tests.rs`
- Modify: `apps/terminal/crates/tide-app/resources/shell-integration/.zshenv`
- Create: `apps/terminal/crates/tide-app/resources/shell-integration/.bash_profile`
- Modify: `apps/terminal/crates/tide-app/resources/shell-integration/bash.sh`
- Modify: `apps/terminal/crates/tide-app/resources/shell-integration/config.fish`
- Create: `apps/terminal/scripts/test-shell-state-integration.sh`

**Interfaces:**

- Produces: `SupportedShell::{Zsh, Bash, Fish, Other}`
- Produces: `ShellLaunch { program: String, args: Vec<String>, env: HashMap<String, String>, shell_state_enabled: bool }`
- Produces: `TerminalSpawnConfig::shell_launch(shell, cwd, nonce) -> ShellLaunch`
- Preserves: agent-wrapper `PATH` changes only when `auto_integration == true`
- Requires: shell-state variables are removed from the exported environment before user commands run

- [ ] **Step 1: Add failing launch-policy tests**

Add tests in `domain/terminal/tests.rs` that exercise `TerminalSpawnConfig::shell_launch` directly:

```rust
#[test]
fn shell_state_integration_is_independent_from_agent_auto_integration() {
    let cfg = TerminalSpawnConfig {
        shell_integration_dir: Some("/bundle/shell".into()),
        auto_integration: false,
        ..Default::default()
    };
    for shell in ["/bin/zsh", "/bin/bash", "/opt/homebrew/bin/fish"] {
        let launch = cfg.shell_launch(Path::new(shell), Path::new("/work"), "nonce");
        assert!(launch.shell_state_enabled);
        assert!(!launch.env.contains_key("__TIDE_TERMINAL_WRAPPER_DIR"));
    }
}

#[test]
fn unsupported_shell_has_no_state_fallback() {
    let launch = TerminalSpawnConfig::default()
        .shell_launch(Path::new("/bin/ksh"), Path::new("/work"), "nonce");
    assert!(!launch.shell_state_enabled);
    assert_eq!(launch.args, vec!["--login"]);
}
```

- [ ] **Step 2: Run the focused unit tests and confirm the missing API fails**

Run from `apps/terminal`:

```bash
cargo test -p tide-app domain::terminal::tests::shell_state_integration_is_independent_from_agent_auto_integration
cargo test -p tide-app domain::terminal::tests::unsupported_shell_has_no_state_fallback
```

Expected: FAIL because `SupportedShell`, `ShellLaunch`, and `shell_launch` do not exist.

- [ ] **Step 3: Implement shell-specific launch policy**

Add the concrete types and keep shell detection based on the executable basename:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SupportedShell { Zsh, Bash, Fish, Other }

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellLaunch {
    pub program: String,
    pub args: Vec<String>,
    pub env: std::collections::HashMap<String, String>,
    pub shell_state_enabled: bool,
}
```

Implement these launch contracts:

- zsh: keep `--login`; always set the existing `ZDOTDIR` shim and original-ZDOTDIR variable when shell integration is present.
- bash: keep `--login`; temporarily point child `HOME` at the bundled shell-integration directory, pass the original HOME separately, and let the bundled `.bash_profile` restore HOME before sourcing exactly the first existing user file from `.bash_profile`, `.bash_login`, `.profile`, then install `bash.sh` hooks. Preserve `$0` and `shopt login_shell`.
- fish: keep `--login` and add `--init-command` containing a non-exported nonce assignment plus `source .../config.fish`. Fish runs the init command after its normal configuration, so system, vendor, and user startup files retain their normal ordering and count. Preserve `status is-login`.
- other shells: keep `--login`, add no shell-state integration variables, and do not substitute process polling.

Keep `TIDE_TERMINAL_SOCKET` unconditional as it is today. Keep `__TIDE_TERMINAL_WRAPPER_DIR` conditional on `auto_integration`.

- [ ] **Step 4: Write the black-box compatibility script before hook behavior**

The script must create isolated startup fixtures and assert, for each installed supported shell:

```text
startup marker count = 1
login-shell predicate = true
user prompt hook count = 1
user DEBUG/preexec hook count = expected command count
stdout contains no Tide text
captured PTY bytes contain OSC 7 and OSC 133 A/B/C/D
child environment does not contain __TIDE_TERMINAL_SHELL_NONCE
nested shell does not duplicate Tide boundaries
```

Use a fixture command containing `cd 'space ü;dir' && printf x`, an empty Enter, a failing command, Ctrl-C, a pipeline, a function, a background job, and `exec`. The script exits nonzero on a missing shell; release validation must install fish instead of silently skipping it.

- [ ] **Step 5: Implement independently authored zsh/bash/fish hooks**

Each integration must emit:

```text
OSC 7 ; file://<local-host><percent-encoded-absolute-path>?tide_nonce=<nonce> ST
OSC 133 ; A ; tide_nonce=<nonce> ST
OSC 133 ; B ; tide_nonce=<nonce> ST
OSC 133 ; C ; tide_nonce=<nonce> ST
OSC 133 ; D ; <exit-status> ; tide_nonce=<nonce> ST
```

Store the nonce in a non-exported shell variable and unset its exported bootstrap variable before sourcing user startup files. Chain, rather than overwrite, zsh `precmd`/`preexec`/`chpwd`, Bash `PROMPT_COMMAND`/`DEBUG`, and fish `fish_prompt`/`fish_preexec`/`fish_postexec` behavior. Emit CWD from zsh `chpwd`, fish's `$PWD` variable event, and Bash's DEBUG/pre-prompt comparison so a compound `cd` is reported before subsequent command execution.

- [ ] **Step 6: Run the shell compatibility gate**

Run:

```bash
./scripts/test-shell-state-integration.sh
cargo test -p tide-app domain::terminal::tests
```

Expected: PASS for zsh, Bash 3.2+, and fish 3.x. If startup order, login identity, hook chaining, or signal coverage differs, stop here and fix the integration; do not add a fallback.

---

### Task 2: Parse OSC 7 and OSC 133 into typed terminal events

**Files:**

- Modify: `apps/terminal/crates/vte/src/ansi.rs`
- Modify: `apps/terminal/crates/alacritty_terminal/src/event.rs`
- Modify: `apps/terminal/crates/alacritty_terminal/src/term/mod.rs`
- Modify tests in: `apps/terminal/crates/vte/src/ansi.rs`
- Modify tests in: `apps/terminal/crates/alacritty_terminal/src/term/mod.rs`

**Interfaces:**

- Produces in VTE: `CommandBoundary::{PromptStart, CommandLine, CommandStart, CommandFinished(Option<i32>)}`
- Adds to `Handler`: `set_working_directory(&mut self, uri: &str)` and `command_boundary(&mut self, boundary, params: &[String])`
- Adds to `alacritty_terminal::event::Event`: `WorkingDirectory(String)` and `CommandBoundary { boundary, params }`

- [ ] **Step 1: Add failing OSC parser tests**

Cover BEL and ST termination, semicolons in the URI payload, status-bearing and status-less `D`, extra key/value parameters, and malformed codes:

```rust
#[test]
fn osc_7_and_133_dispatch_typed_handler_calls() {
    let mut processor = Processor::<DefaultTimeout>::new();
    processor.advance(&mut handler, b"\x1b]7;file://localhost/tmp/a%20b\x1b\\");
    processor.advance(&mut handler, b"\x1b]133;C;tide_nonce=n\x07");
    processor.advance(&mut handler, b"\x1b]133;D;17;tide_nonce=n\x1b\\");
    assert_eq!(handler.cwd, Some("file://localhost/tmp/a%20b".into()));
    assert_eq!(handler.boundaries[1].exit_status(), Some(17));
}
```

- [ ] **Step 2: Run vendored parser tests and confirm failure**

```bash
cargo test -p vte osc_7_and_133_dispatch_typed_handler_calls
cargo test -p alacritty_terminal osc_7_and_133_become_terminal_events
```

Expected: FAIL because the handler methods and event variants do not exist.

- [ ] **Step 3: Add typed parser callbacks and event translation**

Handle `b"7"` and `b"133"` explicitly in `osc_dispatch`. Preserve the OSC 7 payload by joining remaining parser parameters with `;`; parse only the OSC 133 boundary/status fields and preserve extension parameters as owned strings. In `Term<T>` forward the callbacks through its existing `event_proxy`, just as OSC 9 and title changes are forwarded.

- [ ] **Step 4: Run both crate suites**

```bash
cargo test -p vte
cargo test -p alacritty_terminal
```

Expected: PASS with existing OSC 0/2/9/52, color, title, clipboard, and graphics behavior unchanged.

---

### Task 3: Add the Terminal runtime-event side channel

**Files:**

- Create: `apps/terminal/crates/tide-app/src/domain/terminal/runtime_event.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/terminal/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/terminal/grid_sync.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/terminal/tests.rs`

**Interfaces:**

- Produces: `ShellStateSignal::{WorkingDirectory { uri, nonce }, CommandLifecycle { boundary, nonce }}`
- Produces: `TerminalRuntimeEvent::{ShellState(ShellStateSignal), ChildExited(Option<i32>)}`
- Produces: `Terminal::drain_runtime_events(&mut self) -> Vec<TerminalRuntimeEvent>`
- Preserves: final grid snapshot delivery before child-dead rendering

- [ ] **Step 1: Add failing queue/validation tests**

Add tests for ordered events, a bounded queue, duplicate exit coalescing, percent-decoded Unicode paths, malformed URI rejection, local-host acceptance, remote-host rejection, and nonce mismatch:

```rust
#[test]
fn runtime_event_queue_coalesces_duplicate_child_exit() {
    let queue = TerminalRuntimeEventQueue::default();
    queue.push(TerminalRuntimeEvent::ChildExited(Some(7)));
    queue.push(TerminalRuntimeEvent::ChildExited(None));
    assert_eq!(queue.drain(), vec![TerminalRuntimeEvent::ChildExited(Some(7))]);
}

#[test]
fn trusted_working_directory_requires_local_uri_and_nonce() {
    assert_eq!(
        decode_working_directory("file://localhost/tmp/a%20%C3%BC?tide_nonce=n", "n"),
        Some(PathBuf::from("/tmp/a ü")),
    );
    assert_eq!(decode_working_directory("file://remote/tmp?a=tide_nonce=n", "n"), None);
}
```

- [ ] **Step 2: Run the tests and confirm failure**

```bash
cargo test -p tide-app domain::terminal::tests::runtime_event
cargo test -p tide-app domain::terminal::tests::trusted_working_directory
```

Expected: FAIL because the runtime-event queue and decoder do not exist.

- [ ] **Step 3: Queue side-channel events and install the direct waker**

Create the shared queue and construct the event-loop waker `Arc<Mutex<Option<Box<dyn Fn() + Send>>>>` before constructing `TermEventListener`. Give the listener both the runtime-event queue and waker. For `WorkingDirectory`, `CommandBoundary`, and `ChildExit`, enqueue the typed event and invoke the app waker directly; continue using the sync-thread wake for grid dirtiness. Treat later `Exit` as a duplicate unknown-status exit only when no `ChildExit` has already been queued.

- [ ] **Step 4: Initialize event CWD at spawn**

Clone the resolved `working_directory` into `Terminal.current_dir` before moving it into `tty::Options`. When `drain_runtime_events` accepts a trusted Working Directory Signal, update `current_dir` before returning the event. `TerminalBackend::cwd()` remains an event-backed value; it must never query a process.

- [ ] **Step 5: Run terminal tests**

```bash
cargo test -p tide-app domain::terminal
```

Expected: PASS, including existing title, clipboard, notification, graphics, resize, and grid-sync tests.

---

### Task 4: Apply shell and exit events to every TerminalContext

**Files:**

- Create: `apps/terminal/crates/tide-app/src/application/services/terminal_runtime_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/pane/mod.rs`
- Create: `apps/terminal/crates/tide-app/src/application/behavior_tests/event_driven_terminal_runtime.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/mod.rs`

**Interfaces:**

- Produces: `App::drain_terminal_runtime_events() -> TerminalRuntimeEffects`
- Produces: `TerminalRuntimeEffects { chrome_changed: bool, git_refresh: bool, agent_observation: HashSet<PaneId> }`
- Changes: `TerminalContext` comments and mutations become event-driven

- [ ] **Step 1: Add failing UC-2/UC-3/UC-6 behavior tests**

Use a test helper that queues events without a real shell:

```rust
// Spec: docs/specs/event-driven-terminal-runtime.md
// --- UC-3: ApplyCommandLifecycleSignal ---
#[test]
fn osc_133_boundaries_drive_idle_and_busy_state() {
    let (mut app, pane_id) = app_with_terminal();
    app.queue_terminal_runtime_event_for_test(pane_id, trusted(CommandBoundary::CommandStart));
    app.drain_terminal_runtime_events();
    assert!(!terminal_context(&app, pane_id).shell_idle);
    app.queue_terminal_runtime_event_for_test(
        pane_id,
        trusted(CommandBoundary::CommandFinished(Some(0))),
    );
    app.drain_terminal_runtime_events();
    assert!(terminal_context(&app, pane_id).shell_idle);
}
```

Add parallel assertions for active/background Workspaces, remote/malformed OSC 7, stale Git clearing, unauthenticated idle rejection, final-output-before-exit, duplicate exit, and any-key respawn.

- [ ] **Step 2: Run the new behavior module and confirm failure**

```bash
cargo test -p tide-app application::behavior_tests::event_driven_terminal_runtime
```

Expected: FAIL because the application service and test queue seam do not exist.

- [ ] **Step 3: Implement one application service for runtime-event application**

Drain live terminals from `App.panes` and cold terminals from every `WorkspaceManager.workspaces[*].panes`. Apply transitions by PaneId without loading/switching the Workspace:

```rust
match event {
    TerminalRuntimeEvent::ShellState(ShellStateSignal::WorkingDirectory { .. }) => {
        context.cwd = trusted_path;
        context.git_info = None;
        context.worktree_count = 0;
        context.current_worktree = None;
    }
    TerminalRuntimeEvent::ShellState(ShellStateSignal::CommandLifecycle { boundary, .. }) => {
        context.shell_idle = !matches!(boundary, CommandBoundary::CommandStart);
    }
    TerminalRuntimeEvent::ChildExited(_) => context.child_dead = true,
}
```

Request Pane/chrome redraw only for changed active state. Record Git refresh and agent-observation effects for dispatch after mutable Pane iteration ends.

- [ ] **Step 4: Replace the delayed badge path**

Remove `terminal_badge_check_delay`, `TimingState.badge_check_at`, the post-PTY-output scheduling block, and the badge-check branch in `poll_background_events`. Drain terminal runtime events on every `AppEvent::Wake`/event batch before rendering. Keep terminal grid snapshot consumption independent so final output is visible.

- [ ] **Step 5: Run focused behavior tests**

```bash
cargo test -p tide-app event_driven_terminal_runtime
cargo test -p tide-app pane_chrome_behavior
cargo test -p tide-app git_switcher
```

Expected: PASS with existing shell-idle visual/action expectations unchanged.

---

### Task 5: Migrate all CWD consumers and delete fallback discovery

**Files:**

- Modify: `apps/terminal/crates/tide-app/src/application/services/session_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/text_extract_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/pane_create_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/file_ops_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/file_tree_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/adapter/inward/cli_adapter/commands.rs`
- Modify: `apps/terminal/crates/tide-app/src/adapter/outward/view/ui.rs`
- Modify: `apps/terminal/crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/terminal/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/pane/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/event_driven_terminal_runtime.rs`

**Interfaces:**

- Consumes: `TerminalContext.cwd` initialized and updated by Tasks 3–4
- Removes: `Terminal::detect_cwd_fallback()` on macOS and non-macOS
- Preserves: `TerminalBackend::cwd()` as cached event state where the trait still requires it

- [ ] **Step 1: Add behavior tests for every CWD-dependent feature**

Create a Terminal Pane whose backend process CWD differs from `context.cwd`, then assert that the context value wins for:

```text
session snapshot
new Terminal Pane
split Terminal Pane
dead-shell respawn
relative file link and project search
file create/rename/delete base directory
project config discovery
tab and titlebar labels
FileTree View root
Git refresh target
```

Name the aggregate test `all_terminal_cwd_consumers_use_terminal_context`, and retain focused existing tests in their current modules for regression locality.

- [ ] **Step 2: Run the CWD tests and confirm the old fallback wins or remains callable**

```bash
cargo test -p tide-app all_terminal_cwd_consumers_use_terminal_context
rg -n "detect_cwd_fallback" crates/tide-app/src
```

Expected: the test fails before migration and the search lists the current callers.

- [ ] **Step 3: Replace every caller with cached context**

Use `pane.context.cwd.clone()` for live Terminal Panes and the existing `Retained Context.cwd` for closed owning terminals. `focused_terminal_cwd()` must resolve the focused Terminal, then Associated Terminal, then Retained Context, then the existing last-known event CWD. Do not call `TerminalBackend::cwd()` from application/view code when `TerminalContext` is available.

- [ ] **Step 4: Delete the fallback APIs**

Remove both target-specific `detect_cwd_fallback` implementations and their `proc_pidinfo`/`/proc/<pid>/cwd` code. Update the periodic wording on `TerminalContext` fields to say “updated by signals/refresh results.” Keep `current_dir` solely as the backend's event cache for `TerminalBackend::cwd()`.

- [ ] **Step 5: Verify no CWD fallback remains**

```bash
rg -n "detect_cwd_fallback|PROC_PIDVNODEPATHINFO|/proc/.*/cwd" crates/tide-app/src
cargo test -p tide-app session_behavior
cargo test -p tide-app terminal_text_interaction
cargo test -p tide-app file_tree
cargo test -p tide-app event_driven_terminal_runtime
```

Expected: the search returns no matches and all focused suites pass.

---

### Task 6: Make FileTree View refresh wake-driven with an exact debounce deadline

**Files:**

- Modify: `apps/terminal/crates/tide-app/src/domain/tree/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/tree/tests.rs`
- Modify: `apps/terminal/crates/tide-app/src/app.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/session_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/update_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/state/timing.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/event_driven_terminal_runtime.rs`

**Interfaces:**

- Adds: `FsTree::set_waker(Option<Arc<dyn Fn() + Send + Sync>>)`
- Adds: `FsTree::next_refresh_deadline() -> Option<Instant>`
- Changes: `FsTree::drain_events(now: Instant) -> FsTreeDrain::{Idle, WaitingUntil(Instant), Refreshed}`

- [ ] **Step 1: Add deterministic FileTree watcher/debounce tests**

Inject a counting waker and explicit `Instant` into the drain seam. Assert the callback wakes once, a burst coalesces, `WaitingUntil(last_refresh + 100 ms)` is exact, and the due drain preserves expanded paths while rebuilding entries.

- [ ] **Step 2: Run the tree tests and confirm failure**

```bash
cargo test -p tide-app domain::tree::tests
cargo test -p tide-app file_tree_event_wakes_and_completes_at_debounce_deadline
```

- [ ] **Step 3: Install the waker in every FsTree construction path**

After `FsTree::new` in app initialization, session restore, and FileTree root replacement, call `set_waker(self.bg.event_loop_waker.clone())`. The `notify::recommended_watcher` callback must queue the raw event and invoke the waker; it must not mutate `FsTree` off the app thread.

- [ ] **Step 4: Expose and consume the deadline**

Replace `poll_events()/has_pending_events()` with `drain_events(now)`. A raw event schedules or maintains the 100 ms rule; a due deadline refreshes exactly once, synchronizes path identity, requests Git refresh, and invalidates chrome. Do not keep `cache.needs_redraw = true` merely to force another loop iteration.

- [ ] **Step 5: Run FileTree and editor watcher regressions**

```bash
cargo test -p tide-app domain::tree
cargo test -p tide-app file_tree
cargo test -p tide-app editor_file_watch_sync
```

Expected: PASS; FileTree expansion and editor external-change behavior remain unchanged.

---

### Task 7: Add an event-driven repository watch registry and Git refresh worker

**Files:**

- Create: `apps/terminal/crates/tide-app/src/application/ports/outward/repository_watcher_port.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/ports/outward/mod.rs`
- Create: `apps/terminal/crates/tide-app/src/adapter/outward/repository_watcher_adapter/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/adapter/outward/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/adapter/outward/git_adapter/git_cli.rs`
- Modify: `apps/terminal/crates/tide-app/src/app.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/state/background.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/file_tree_service/mod.rs`
- Modify: all existing `trigger_git_poll()` call sites returned by `rg`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/event_driven_terminal_runtime.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/diff_auto_refresh.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/editor_file_watch_sync.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/pane_close_responsiveness.rs`

**Interfaces:**

- Produces: `RepositoryWatchPaths { worktree_root, git_dir, git_common_dir }`
- Produces: `RepositoryChangeSignal::{Changed(PathBuf), Rescan(PathBuf)}`
- Produces: `RepositoryWatcherPort::{init, reconcile, drain_changes}`
- Renames: `GitPollRequest/Results/CwdResult` to `GitRefreshRequest/Results/RepoResult`
- Produces: `GitWorkerMessage::{Refresh(Vec<GitRefreshRequest>), Shutdown}`
- Renames: `trigger_git_poll()` to `request_git_refresh(GitRefreshCause)`

- [ ] **Step 1: Add failing registry and refresh tests**

Use a fake `RepositoryWatcherPort` to assert that the desired root set includes:

```rust
assert_eq!(desired_roots, HashSet::from([
    active_terminal_repo,
    background_terminal_repo,
    retained_context_repo,
]));
```

Also assert reference counting for two CWDs in one worktree, separate linked-worktree roots, `.git` file indirection, common-dir metadata, hidden FileTree View coverage, rescan-to-full-refresh, and latest-request coalescing with `wants_diff` retained.

- [ ] **Step 2: Run focused Git tests and confirm failure**

```bash
cargo test -p tide-app repository_watch_registry
cargo test -p tide-app repository_change_refreshes_badges_tree_worktrees_and_diff_panes
cargo test -p tide-app diff_auto_refresh
```

- [ ] **Step 3: Implement repository path discovery in the outward adapter**

Add `git_cli::repository_watch_paths(cwd)` using:

```text
git rev-parse --show-toplevel
git rev-parse --absolute-git-dir
git rev-parse --git-common-dir
```

Canonicalize existing paths without requiring files such as `index`, `packed-refs`, or a loose ref to exist. Watch the worktree recursively and Git directories recursively so later creation is observed. Normalize a linked worktree's `.git` file to its resolved Git directory.

- [ ] **Step 4: Reconcile watch ownership from all contexts**

Build the desired CWD set from active `App.panes`, every cold `Workspace.panes`, and `assoc.retained_contexts`. Resolve roots in the Git worker, then call `RepositoryWatcherPort::reconcile` with reference-counted `RepositoryWatchPaths`. Reconcile after CWD changes, Pane/Workspace lifecycle, association cleanup, session restore, and Git refresh results.

- [ ] **Step 5: Convert Git work to explicit refresh messages**

Keep Git commands on the worker. Replace the two-second receive loop with:

```rust
while let Ok(message) = rx.recv() {
    match message {
        GitWorkerMessage::Refresh(requests) => { /* drain newer refreshes, compute, send, wake */ }
        GitWorkerMessage::Shutdown => break,
    }
}
```

Request refresh on trusted CWD change, trusted command completion, repository change/debounce, editor/FileTree external change, and every existing Tide-owned Git/file/worktree mutation call site. Remove terminal-output-triggered Git refresh from `update_service`.

- [ ] **Step 6: Preserve every result consumer**

Apply one repository result to all matching TerminalContexts, cached roots/worktrees, the visible FileTree View, and matching Diff Panes. A CWD change clears old badges immediately; a refresh result repopulates them. Worker completion invokes the app waker.

- [ ] **Step 7: Run all Git/FileTree/Diff tests**

```bash
cargo test -p tide-app diff_auto_refresh
cargo test -p tide-app git_switcher
cargo test -p tide-app pane_close_responsiveness
cargo test -p tide-app editor_file_watch_sync
cargo test -p tide-app event_driven_terminal_runtime
```

Expected: PASS with no `GitPoll*`, `start_git_poller`, or `trigger_git_poll` identifiers remaining.

---

### Task 8: Preserve agent observation without recurring process scans

**Files:**

- Modify: `apps/terminal/crates/tide-app/src/domain/state/gateway_status.rs`
- Modify: `apps/terminal/crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/adapter/inward/cli_adapter/server.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/terminal_runtime_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/agent_gateway.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/event_driven_terminal_runtime.rs`

**Interfaces:**

- Produces: `AgentObservationCause::{CommandStarted(PaneId), CommandFinished(PaneId), GatewayClientsChanged}`
- Produces: `AppEvent::GatewayClientsChanged`
- Changes: `detect_agent(shell_pid)` may run only while applying an `AgentObservationCause`
- Preserves: wrapper notification handlers as the authoritative lifecycle path

- [ ] **Step 1: Add failing agent parity tests**

Assert that wrapper status updates remain exact, Gateway client add/remove sends `GatewayClientsChanged`, an unwrapped known agent is observed after a command/gateway event, and repeated unrelated app wakes do not call the process observer. Use a fake observer with a call counter rather than macOS process APIs.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
cargo test -p tide-app wrapper_managed_agent_status_remains_authoritative
cargo test -p tide-app unwrapped_agent_observation_runs_only_after_lifecycle_or_gateway_event
cargo test -p tide-app gateway_client_topology_change_wakes_each_tide_window
```

- [ ] **Step 3: Emit topology events at the source**

Give `ConnectedClients` a router callback. After a PID is actually inserted or removed, enqueue/wake `AppEvent::GatewayClientsChanged` for each registered Tide Window. On that event, snapshot connected PIDs, refresh connection flags, and observe only terminals affected by the changed topology.

- [ ] **Step 4: Move process observation behind explicit causes**

Delete detection from `update_terminal_badges` and the unconditional gateway-sync block. Invoke it only for authenticated command start/completion or a client-set change. Preserve existing wrapper-managed records when observation misses, and never let an unwrapped observation replace wrapper-owned `status` or `wrapper_managed`.

- [ ] **Step 5: Run agent and Workspace regressions**

```bash
cargo test -p tide-app agent_gateway
cargo test -p tide-app agent_coworking_context
cargo test -p tide-app cli_workspace_routing
cargo test -p tide-app tide_mcp_runtime
```

Expected: PASS; Terminal-owned attention, Workspace rail state, context artifacts, browser-control authorization, and MCP agent fields remain unchanged.

---

### Task 9: Consume PTY child exit and remove liveness polling

**Files:**

- Modify: `apps/terminal/crates/tide-app/src/application/services/terminal_runtime_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/update_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/state/timing.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/terminal/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/event_driven_terminal_runtime.rs`

**Interfaces:**

- Consumes: `TerminalRuntimeEvent::ChildExited(Option<i32>)`
- Removes: `Terminal::is_child_alive()` and `TimingState.last_child_check`
- Preserves: `TerminalContext.child_dead` and existing respawn entry points

- [ ] **Step 1: Run the Task 4 exit tests as the RED gate**

```bash
cargo test -p tide-app child_exit_updates_active_and_background_terminal_contexts
cargo test -p tide-app duplicate_exit_events_preserve_final_output_and_apply_once
```

Expected before this task: the side channel exists, but the old liveness scan is still present and the static no-poll assertion fails.

- [ ] **Step 2: Delete the two-second liveness block**

Remove the full `last_child_check` branch from `update_service`, delete the field/default from `TimingState`, and delete `Terminal::is_child_alive()`.

- [ ] **Step 3: Replace teardown wait polling with an exit notification wait**

Replace the `waitpid(WNOHANG)`/sleep loops in `wait_for_child_exit` with a blocking child-exit notification plus one bounded escalation deadline. On macOS, use `kqueue` `EVFILT_PROC/NOTE_EXIT` or a dedicated blocking waiter channel; after the deadline, send SIGKILL and perform one blocking reap. This is teardown coordination, not recurring liveness discovery.

- [ ] **Step 4: Verify exit and respawn behavior**

```bash
rg -n "last_child_check|is_child_alive|kill\([^,]+,\s*0|WNOHANG|thread::sleep" crates/tide-app/src/domain/terminal crates/tide-app/src/application/services/update_service
cargo test -p tide-app event_driven_terminal_runtime
cargo test -p tide-app pane_lifecycle
```

Expected: no recurring liveness or teardown sleep loop remains; tests pass.

---

### Task 10: Make Agent Gateway and background workers block until work

**Files:**

- Modify: `apps/terminal/crates/tide-app/src/adapter/inward/cli_adapter/server.rs`
- Modify: `apps/terminal/crates/tide-app/src/domain/state/background.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/file_tree_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/file_ops_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/pane_create_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/agent_gateway.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/event_driven_terminal_runtime.rs`

**Interfaces:**

- Produces: `GatewaySubscriptionMessage::{Notification(String), Shutdown}`
- Produces: `WorkspaceScanMessage::{Work(WorkspaceScanRequest), Shutdown}`
- Produces: `WorktreeWorkerMessage::{Work(WorktreeJob), Shutdown}`
- Stores: listener/worker `JoinHandle`s and explicit shutdown senders

- [ ] **Step 1: Add failing blocking/shutdown tests**

Start each worker/listener with a counting callback, leave it idle longer than the former timeout, and assert zero work/wake count. Send work and assert one completion wake. Send shutdown and assert the thread joins within a bounded test receive timeout. The timeout belongs only to the test harness.

- [ ] **Step 2: Run the focused tests and confirm the old loops fail source/runtime assertions**

```bash
cargo test -p tide-app blocking_gateway_accept_stops_after_shutdown_wake
cargo test -p tide-app subscription_loop_stops_without_timeout_polling
cargo test -p tide-app background_workers_block_until_work_or_shutdown_and_wake_on_results
```

- [ ] **Step 3: Make socket accept and subscriptions blocking**

Leave the listener blocking. On `GatewayServer::drop`, set shutdown, connect once to its own socket path to release `accept()`, join the listener, then remove socket/symlink files. Replace subscription `recv_timeout(100 ms)` with blocking `recv()` over `GatewaySubscriptionMessage`; broadcast `Shutdown` or drop all senders during server teardown.

- [ ] **Step 4: Make all three workers use typed shutdown messages**

Replace atomic-stop plus `recv_timeout(2 s)` in Git refresh, Workspace scan, and worktree mutation workers with blocking `recv()` and explicit `Shutdown`. Drain/coalesce already-queued work with `try_recv()` only after the first real message. Store and join each handle during App teardown.

- [ ] **Step 5: Verify no idle service loop remains**

```bash
rg -n "recv_timeout|thread::sleep" crates/tide-app/src/adapter/inward/cli_adapter/server.rs crates/tide-app/src/application/services/file_tree_service crates/tide-app/src/application/services/file_ops_service crates/tide-app/src/application/services/pane_create_service
cargo test -p tide-app agent_gateway
cargo test -p tide-app file_finder_behavior
cargo test -p tide-app git_switcher_worktree_actions
```

Expected: search returns no production idle-loop matches and tests pass.

---

### Task 11: Replace the fixed app-loop ceiling with optional Runtime Deadlines

**Files:**

- Modify: `apps/terminal/crates/tide-app/src/domain/state/timing.rs`
- Modify: `apps/terminal/crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/services/update_service/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/event_driven_terminal_runtime.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/single_process_multi_window.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/file_tree_scroll.rs`

**Interfaces:**

- Produces: `RuntimeDeadline { kind: RuntimeDeadlineKind, at: Instant }`
- Produces: `App::next_runtime_deadline(now: Instant) -> Option<RuntimeDeadline>`
- Changes: app wait chooses `Receiver::recv()` for `None`, `recv_timeout(at - now)` for future deadlines, and an immediate due-timer pass when `at <= now`
- Renames: `poll_background_events` to `drain_ready_events`

- [ ] **Step 1: Add failing scheduler tests**

Build a fixed-clock table test:

```rust
#[test]
fn runtime_wait_has_no_deadline_when_idle() {
    let app = settled_app_without_focused_cursor();
    assert_eq!(app.next_runtime_deadline(app.ports.clock.now()), None);
}

#[test]
fn runtime_wait_selects_the_earliest_exact_deadline() {
    let mut app = settled_app();
    app.timing.resize_deferred_at = Some(now + Duration::from_millis(50));
    app.timing.file_tree_refresh_at = Some(now + Duration::from_millis(20));
    assert_eq!(app.next_runtime_deadline(now).unwrap().at, now + Duration::from_millis(20));
}
```

Add cases for cursor blink at 530 ms, focused-window autosave at 30 seconds, render coalescing at 2 ms, layout animation, FileTree scroll animation, FileTree debounce, and repository debounce. Assert no autosave deadline while unfocused, but an overdue save runs immediately on focus.

- [ ] **Step 2: Run scheduler tests and confirm the fixed 100 ms implementation fails**

```bash
cargo test -p tide-app runtime_wait
cargo test -p tide-app periodic_session_auto_save_is_limited_to_the_focused_tide_window
```

- [ ] **Step 3: Implement earliest-deadline calculation**

Collect only active deadlines:

```text
cursor blink: cursor_blink_at + next 530 ms phase
focused autosave: last_session_save + 30 s
deferred resize: resize_deferred_at
layout/surface/split animation: next 16 ms frame
FileTree scroll animation: next 16 ms frame while target differs
render coalescing: last_frame + 2 ms when dirty and not immediate
FileTree debounce: FsTree::next_refresh_deadline()
repository debounce: repository_refresh_at
event-triggered agent observation: the single due instant scheduled by a command-start signal
```

Return the minimum `RuntimeDeadline`, or `None` when the set is empty. Do not seed it with 100 ms.

- [ ] **Step 4: Switch between indefinite and deadline waits**

Use this shape in `app_thread_run`:

```rust
let event = match self.next_runtime_deadline(self.ports.clock.now()) {
    None => event_rx.recv().map(Some),
    Some(deadline) => {
        let wait = deadline.at.saturating_duration_since(self.ports.clock.now());
        match event_rx.recv_timeout(wait) {
            Ok(event) => Ok(Some(event)),
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => Err(()),
        }
    }
};
```

Then drain the event queue, call `drain_ready_events`, advance due timers/animations, and render only if dirty. Preserve the existing immediate-input/scroll render bypass and 2 ms coalescing rule.

- [ ] **Step 5: Prove every producer wakes the app thread**

Extend `every_background_result_path_invokes_the_app_waker` to cover PTY snapshots/runtime events, editor watcher, FileTree watcher, repository watcher, Git results, Workspace scan, worktree mutation, LSP, render completion, webview bridge/new-tab requests, Gateway command/client changes, and settings reload. A fake waker counter must increment when each producer queues consumable state.

- [ ] **Step 6: Run scheduler/UI timing regressions**

```bash
cargo test -p tide-app event_driven_terminal_runtime
cargo test -p tide-app pane_chrome_behavior
cargo test -p tide-app file_tree_scroll
cargo test -p tide-app single_process_multi_window
cargo test -p tide-app terminal_pane_inset
```

Expected: PASS with cursor, animation, autosave, resize, and render timing preserved.

---

### Task 12: Full verification and energy acceptance

**Files:**

- Modify if implementation discoveries require traceability only: `apps/terminal/docs/specs/event-driven-terminal-runtime.md`
- Modify if new terms were introduced: `apps/terminal/docs/glossary.md`
- Create: `apps/terminal/scripts/verify-event-driven-idle.sh`

**Interfaces:**

- Consumes: all prior tasks
- Produces: repeatable static, functional, and energy acceptance output

- [ ] **Step 1: Add the static no-poll verification script**

The script must fail when production runtime code contains any removed pattern:

```text
Duration::from_millis(100) used as a default app-loop ceiling
detect_cwd_fallback
proc_listchildpids
last_child_check or is_child_alive
recv_timeout in Gateway/Git/Workspace-scan/worktree idle loops
sleep in Gateway listener/subscription loops
terminal-output-triggered Git refresh
```

Allow documented exact 100 ms FileTree/Git debounce constants and bounded test-harness timeouts by scoping searches to the relevant functions/files.

- [ ] **Step 2: Run formatting, architecture, lint, and all tests**

From `apps/terminal`:

```bash
cargo fmt --all -- --check
./scripts/lint-arch.sh
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p vte
cargo test -p alacritty_terminal
cargo test -p tide-app
./scripts/test-shell-state-integration.sh
./scripts/verify-event-driven-idle.sh
```

Expected: every command exits 0.

- [ ] **Step 3: Run the manual feature-parity matrix**

For zsh, bash, and fish independently verify:

```text
startup/login files and custom prompt/hooks
plain cd, pushd/popd, function cd, and cd dir && long-command
empty Enter, Ctrl-C, syntax error, pipeline, background job, full-screen TUI, exec
spaces/Unicode/semicolon CWD
SSH and nested shell (remote OSC 7 cannot replace local CWD)
CWD labels, FileTree View root, Git badges, Diff Pane, GitSwitcher
new/split/respawn CWD and session restore
FileTree “cd here” and worktree safety while idle/busy
Wrapped Agent Running/Idle/NeedsInput and unwrapped known-agent observation
background Workspace command/CWD/exit updates
external file edit, external Git mutation, worktree add/remove
shell exit and any-key respawn
Agent Gateway subscribe/connect/disconnect and app shutdown
```

Record pass/fail per shell. Any difference is a release blocker; do not add fallback polling.

- [ ] **Step 4: Measure idle and active energy under controlled conditions**

Build one release binary, open one identical 80×24 idle login shell in Tide and Ghostty with no agent running, and sample each for 60 seconds after a 30-second settling period. Record process CPU time, wakeups/context switches, and system calls with the same macOS tools and sampling interval. Repeat three times and report the median. Then repeat with a fixed high-output command to ensure throughput/rendering has not regressed.

Acceptance criteria:

```text
idle Tide app-thread wakeups: only cursor/deadline or actual external events
idle state-discovery wakeups: 0
idle Gateway/worker timeout wakeups: 0
feature matrix: 100% pass for zsh, bash, fish
all automated tests/lints: pass
active output: no visible dropped frames, stale chrome, or stale filesystem/Git state
```

- [ ] **Step 5: Review the final diff without touching unrelated changes**

```bash
git status --short
git diff -- apps/terminal/crates/vte apps/terminal/crates/alacritty_terminal apps/terminal/crates/tide-app apps/terminal/docs/specs/event-driven-terminal-runtime.md apps/terminal/docs/glossary.md
```

Confirm every spec Business Rule maps to a passing test and no unrelated user-owned file change was included. Do not commit unless the user asks.
