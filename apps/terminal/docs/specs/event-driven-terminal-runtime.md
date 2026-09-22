# Spec: Event-Driven Terminal Runtime

Replace recurring state discovery with explicit events while preserving Terminal Pane, FileTree View, Git, session, Agent Gateway, and Wrapped Agent behavior.

## Overview

### As-Is

- The app thread never sleeps longer than 100 ms because `next_timeout()` starts with a fixed ceiling, even when no work is pending.
- Terminal CWD and shell-idle state are inferred after PTY output by querying the shell process with `proc_pidinfo` and `proc_listchildpids`.
- CWD fallback calls also supply session persistence, relative-path links, file operations, Terminal Pane creation/respawn, chrome labels, project-root lookup, and Git refresh requests.
- The FileTree View owns a recursive `notify` watcher, but its callback does not wake the app thread; its 100 ms debounce completes only because the app thread wakes periodically.
- Git refreshes are requested after terminal output and filesystem actions. The worker blocks with a two-second timeout, and there is no repository watcher registry spanning all live and Retained Context CWDs.
- PTY `ChildExit` exists in `alacritty_terminal`, but Tide ignores it and checks child liveness every two seconds with `kill(pid, 0)`.
- Agent Gateway accept and subscription loops wake every 50–100 ms to inspect shutdown flags. Other background workers use two-second receive timeouts for the same reason.
- zsh shell integration is injected through `ZDOTDIR` only when agent auto-integration is enabled. Bash and fish snippets require manual sourcing and currently only modify `PATH`.
- Wrapped Agent `Running`, `Idle`, and `NeedsInput` status already arrives through wrapper hooks or wrapper-owned OSC 9 notifications. Separate process-tree inspection recognizes known unwrapped agents.

### To-Be

- zsh, bash, and fish automatically emit authenticated OSC 7 Working Directory Signals and OSC 133 Command Lifecycle Signals in every Tide Terminal Pane, independently of the agent-wrapper preference.
- `TerminalContext` is the cached source of truth for CWD and shell-idle consumers. No process/CWD polling fallback exists.
- Filesystem callbacks, PTY events, renderer completion, LSP responses, browser bridge messages, worker completion, and Agent Gateway topology changes explicitly wake the app thread.
- FileTree View and repository notifications are debounced with exact Runtime Deadlines. Git refreshes cover every unique repository represented by active or background Terminal Panes and Retained Contexts.
- PTY child exit and Agent Gateway shutdown are event-driven. Background workers block until work or an explicit shutdown message arrives.
- The app thread blocks indefinitely when there is neither an event nor a Runtime Deadline.
- All existing user-visible behavior remains unchanged for zsh, bash, and fish.

### Approach

1. Prove shell startup compatibility for zsh, bash, and fish with black-box PTY tests before removing any fallback.
2. Extend the vendored VTE and `alacritty_terminal` event boundary for OSC 7, OSC 133, and child exit.
3. Drain typed terminal runtime events into `TerminalContext` for active and background Workspaces.
4. Migrate every CWD and shell-idle consumer to cached event state, then delete fallback process queries.
5. Wake and debounce FileTree View and repository watchers explicitly; refresh Git from CWD, command-completion, filesystem, and Tide-owned mutation events.
6. Preserve Wrapped Agent signals and trigger any remaining unwrapped-agent observation only from lifecycle or Agent Gateway topology events.
7. Convert socket and worker shutdown from timeout loops to blocking receives with explicit wake/shutdown messages.
8. Replace the fixed app-loop ceiling with the earliest optional Runtime Deadline.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| `terminal` | Shell launch, OSC parsing boundary, typed runtime-event queue, child-exit delivery |
| `pane` | `TerminalContext` CWD, shell-idle, Git metadata, and child-dead state |
| `tree` | FileTree View filesystem refresh and debounce state |
| `application/services` | Applying runtime events, reconciling repository watches, dispatching Git refresh work |
| `application/ports/outward` | Repository watcher and process-observation interfaces |
| `adapter/outward` | macOS filesystem notifications and event-triggered process observation |
| `adapter/inward` | App event dispatch, optional Runtime Deadline waiting, Agent Gateway socket lifecycle |
| `renderer` | Existing dirty-tracked rendering and completion wakeups |

## Use Cases

### UC-1: InitializeSupportedShell

- **Actor**: Tide
- **Trigger**: Tide creates or restores a Terminal Pane
- **Precondition**: `$SHELL` resolves to zsh, bash, or fish
- **Flow**:
  1. Tide builds a shell-specific launch configuration.
  2. The shell executes its normal login startup files exactly once.
  3. Tide installs shell-state hooks after user startup configuration without printing visible text.
  4. The hooks retain a per-Terminal authentication nonce in a non-exported shell variable.
  5. The first prompt emits Working Directory and Command Lifecycle Signals.
- **Postcondition**: The Terminal Pane has event-driven CWD and shell-idle state before user interaction.
- **Business Rules**:
  - **BR-1**: Shell-state integration is automatic for zsh, bash, and fish even when agent auto-integration is disabled.
  - **BR-2**: Agent wrapper `PATH` injection remains controlled only by the existing agent auto-integration preference.
  - **BR-3**: Login-shell identity, startup-file ordering, startup-file count, prompt text, exit status, existing prompt hooks, and existing DEBUG/preexec hooks are preserved.
  - **BR-4**: Nested shells do not duplicate or replace the owning login shell's integration.
  - **BR-5**: The requested spawn CWD, or resolved HOME when no CWD is requested, initializes cached CWD before the first signal.
  - **BR-6**: Unsupported shells continue to function as terminals but do not receive tracked CWD/command-state features and never activate a polling fallback.
  - **BR-7**: If any supported-shell compatibility test fails, fallback removal must not proceed.

### UC-2: ApplyWorkingDirectorySignal

- **Actor**: Supported shell integration
- **Trigger**: The shell starts a prompt or changes `$PWD`
- **Precondition**: The signal carries the Terminal's authentication nonce
- **Flow**:
  1. The integration emits OSC 7 with a percent-encoded local `file://` URI.
  2. The VTE parser emits a typed Working Directory Signal.
  3. Tide validates the nonce, URI, hostname, and decoded path.
  4. Tide updates the owning `TerminalContext` and requests dependent refreshes.
- **Postcondition**: Every CWD consumer sees the new local path without a process query.
- **Business Rules**:
  - **BR-1**: CWD changes are applied for active and background Workspaces.
  - **BR-2**: Spaces, Unicode, semicolons, percent escapes, BEL termination, and ST termination decode without truncation.
  - **BR-3**: Malformed, unauthenticated, non-file, and remote-host URIs do not replace the last trusted local CWD.
  - **BR-4**: `cd` inside functions, pipelines, and compound commands emits a Working Directory Signal before the next command begins, or before the prompt when it is the final command.
  - **BR-5**: Session CWD, new/split/respawn Terminal Pane CWD, relative-path links, file-operation roots, project lookup, chrome labels, FileTree View root, and Git requests use cached `TerminalContext.cwd` only.
  - **BR-6**: CWD transition clears stale Git metadata immediately and schedules one Git refresh for the new context.

### UC-3: ApplyCommandLifecycleSignal

- **Actor**: Supported shell integration
- **Trigger**: Prompt or command execution crosses an OSC 133 boundary
- **Precondition**: The signal carries the Terminal's authentication nonce
- **Flow**:
  1. OSC 133 `A` marks prompt start, `B` marks command-line start, `C` marks command execution, and `D[;status]` marks command completion.
  2. Tide applies the ordered state transition to `TerminalContext.shell_idle`.
  3. Tide invalidates only affected chrome and schedules dependent Git/agent work.
- **Postcondition**: Busy styling and guarded actions match the shell's actual command lifecycle.
- **Business Rules**:
  - **BR-1**: `A`, `B`, and `D` produce idle state; `C` produces busy state.
  - **BR-2**: Empty Enter, Ctrl-C, syntax errors, functions, pipelines, background jobs, and `exec` leave the state consistent with the next emitted boundary.
  - **BR-3**: FileTree View “cd here,” Git worktree switching, and automatic `cd` after worktree creation retain their current shell-idle guards.
  - **BR-4**: Unauthenticated OSC 133 may be parsed for terminal compatibility but cannot authorize actions guarded by trusted shell-idle state.
  - **BR-5**: Command completion schedules one Git refresh even when the command produced no terminal output.

### UC-4: RefreshFilesystemAndGit

- **Actor**: Filesystem watcher or Tide Git/file mutation
- **Trigger**: A watched path changes, CWD changes, a command completes, or Tide completes an explicit mutation
- **Precondition**: At least one relevant FileTree View, TerminalContext, Retained Context, or Diff Pane exists
- **Flow**:
  1. The callback queues a typed change and wakes the owning app thread.
  2. Tide records one debounce Runtime Deadline and coalesces the burst.
  3. FileTree View refreshes its expanded paths; repository events dispatch a background Git refresh.
  4. Worker completion wakes the app thread and applies badges, worktree data, FileTree decoration, and Diff Pane data.
- **Postcondition**: Filesystem and Git UI reaches the same state without periodic refreshes.
- **Business Rules**:
  - **BR-1**: FileTree View notifications wake the app thread and preserve the existing 100 ms debounce behavior.
  - **BR-2**: Repository watches cover every unique live TerminalContext and Retained Context repository across active and background Workspaces, independently of FileTree View visibility.
  - **BR-3**: Each repository watch includes its worktree plus resolved Git directory/common directory metadata required for index, HEAD, refs, packed-refs, and worktree-list changes.
  - **BR-4**: Watch registration is reference-counted and reconciled whenever CWD, Pane, Workspace, association, or Retained Context membership changes.
  - **BR-5**: Watch overflow/rescan notifications request one full refresh; they do not enable periodic fallback.
  - **BR-6**: Editor external-change reload/close behavior, FileTree expansion, Git badges, branch, dirty counts, worktree list/current worktree, and Diff Pane content remain unchanged.
  - **BR-7**: Git refresh requests coalesce while preserving the newest set and per-repository Diff Pane demand.

### UC-5: TrackAgentLifecycle

- **Actor**: Agent Wrapper, supported shell, or Agent Gateway
- **Trigger**: Wrapper lifecycle notification, command boundary, or client connection topology change
- **Precondition**: A Terminal Pane owns the process or Wrapper-Managed Lifecycle Signal
- **Flow**:
  1. Wrapper-managed `Running`, `Idle`, and `NeedsInput` signals update `AgentInfo` immediately.
  2. A command-start lifecycle event schedules one bounded, one-shot process observation, and Agent Gateway topology events trigger observation for affected terminals, for unwrapped-agent compatibility.
  3. Tide updates Pane and Workspace agent surfaces and MCP observations.
- **Postcondition**: Agent status and connection UX remain current without recurring process-tree scans.
- **Business Rules**:
  - **BR-1**: Wrapper-Managed Lifecycle Signals remain authoritative and preserve exact `Running`, `Idle`, and `NeedsInput` behavior.
  - **BR-2**: Agent Gateway connect and disconnect changes wake every Tide Window that consumes the shared client set.
  - **BR-3**: Known unwrapped-agent observation is event-triggered only; a command start may schedule one observation deadline, but there is no recurring or retrying process scan.
  - **BR-4**: Existing Terminal-owned attention, Workspace rail state, context-artifact availability, and MCP agent fields remain unchanged.

### UC-6: ApplyTerminalExit

- **Actor**: PTY runtime
- **Trigger**: The shell child exits
- **Precondition**: A live Terminal Pane exists
- **Flow**:
  1. `alacritty_terminal` emits `ChildExit` and may subsequently emit `Exit`.
  2. Tide queues one terminal-exit transition and wakes the app thread after final PTY output is available.
  3. Tide sets `TerminalContext.child_dead` and invalidates the correct Pane/chrome.
- **Postcondition**: Dead-shell UI and any-key respawn behavior remain unchanged.
- **Business Rules**:
  - **BR-1**: Active and background Workspace terminals receive exit state immediately.
  - **BR-2**: Duplicate `ChildExit`/`Exit` events are idempotent, including unknown exit status.
  - **BR-3**: Final PTY output is consumed before the dead-shell state is rendered.
  - **BR-4**: No periodic `kill(pid, 0)` child-liveness check remains.

### UC-7: BlockBackgroundServices

- **Actor**: Agent Gateway or background worker owner
- **Trigger**: Work arrives or shutdown begins
- **Precondition**: The service thread is running
- **Flow**:
  1. An idle listener/worker blocks on socket accept or channel receive.
  2. Work completion queues its result and wakes the app thread.
  3. Shutdown sends an explicit message or self-connects to unblock accept.
  4. The owner joins the thread and removes its socket resources.
- **Postcondition**: Idle services generate no timeout wakeups and shutdown remains prompt.
- **Business Rules**:
  - **BR-1**: Agent Gateway accept uses blocking `accept()` and an explicit shutdown wake.
  - **BR-2**: Subscription delivery blocks on a typed outbound channel and terminates when the sender disconnects or an explicit shutdown message arrives.
  - **BR-3**: Git refresh, workspace scan, and worktree mutation workers block on typed `Work`/`Shutdown` messages rather than `recv_timeout`.
  - **BR-4**: Worker and listener completion paths wake the app thread exactly when consumable state changes.

### UC-8: WaitForEventOrDeadline

- **Actor**: App thread
- **Trigger**: The previous event batch and render attempt finish
- **Precondition**: All background producers have installed wake callbacks
- **Flow**:
  1. Tide computes the earliest Runtime Deadline.
  2. With a deadline, Tide waits only until an event arrives or that deadline expires.
  3. Without a deadline, Tide blocks until an event arrives.
  4. Tide drains ready sources, advances due timers, and renders only dirty state.
- **Postcondition**: Idle wakeups are caused only by real events or user-visible timed behavior.
- **Business Rules**:
  - **BR-1**: There is no fixed maximum sleep and no periodic state-discovery timer.
  - **BR-2**: Runtime Deadlines preserve cursor blink, focused-window 30-second autosave, deferred resize, layout and FileTree scroll animation, render coalescing, and filesystem/Git debounce.
  - **BR-3**: A focused Pane cursor keeps its existing 530 ms phase and rendering remains dirty-tracked.
  - **BR-4**: PTY output, file/repository changes, renderer completion, LSP results, browser bridge messages, worker results, settings reload, platform input, and Agent Gateway changes wake the app thread.
  - **BR-5**: Background and occluded Tide Windows do not lose queued state while blocked.

## Invariants

1. zsh, bash, and fish retain all current Terminal Pane and Tide UI behavior; shell-state transport is invisible.
2. CWD and shell-idle state never fall back to `proc_pidinfo`, `/proc/<pid>/cwd`, `proc_listchildpids`, output heuristics, or a recurring timer.
3. Unauthenticated shell protocol data never enables an action guarded by trusted shell-idle state.
4. Wrapped Agent lifecycle status remains event-driven and exact.
5. Every asynchronous producer that can change user-visible state wakes the owning app thread.
6. Timers exist only as Runtime Deadlines for user-visible timing, coalescing/debounce, autosave, or bounded teardown; they never rediscover state.
7. Repository and terminal state for background Workspaces and Retained Contexts remains current.
8. Inward Adapters mutate application state only through Inward Ports.
9. Shell integration is independently authored for Tide; no GPL-derived Ghostty integration code is copied.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 | BR-1, BR-2 | `shell_state_integration_is_independent_from_agent_auto_integration` |
| UC-1 | BR-3 | `supported_shell_launches_preserve_login_startup_contract` |
| UC-1 | BR-3 | `supported_shell_hooks_preserve_existing_prompt_and_debug_hooks` |
| UC-1 | BR-4 | `nested_shell_does_not_install_duplicate_shell_state_hooks` |
| UC-1 | BR-5 | `terminal_context_starts_with_requested_or_home_cwd` |
| UC-1 | BR-6 | `unsupported_shell_has_no_state_fallback` |
| UC-2 | BR-1 | `working_directory_signal_updates_active_and_background_terminal_contexts` |
| UC-2 | BR-2 | `osc_7_decodes_local_paths_without_losing_characters` |
| UC-2 | BR-3 | `untrusted_or_remote_working_directory_signal_keeps_last_local_cwd` |
| UC-2 | BR-4 | `supported_shells_emit_cwd_for_compound_directory_changes` |
| UC-2 | BR-5 | `all_terminal_cwd_consumers_use_terminal_context` |
| UC-2 | BR-6 | `cwd_change_clears_git_context_before_refresh` |
| UC-3 | BR-1 | `osc_133_boundaries_drive_idle_and_busy_state` |
| UC-3 | BR-2 | `supported_shell_command_edge_cases_finish_in_correct_state` |
| UC-3 | BR-3 | `shell_idle_guards_remain_unchanged_with_lifecycle_signals` |
| UC-3 | BR-4 | `untrusted_command_lifecycle_cannot_mark_terminal_idle` |
| UC-3 | BR-5 | `command_completion_requests_git_refresh_without_output` |
| UC-4 | BR-1 | `file_tree_event_wakes_and_completes_at_debounce_deadline` |
| UC-4 | BR-2, BR-4 | `repository_watch_registry_covers_live_background_and_retained_contexts` |
| UC-4 | BR-3 | `repository_watch_paths_include_worktree_and_git_metadata` |
| UC-4 | BR-5 | `repository_rescan_event_requests_one_debounced_full_refresh` |
| UC-4 | BR-6 | `repository_change_refreshes_badges_tree_worktrees_and_diff_panes` |
| UC-4 | BR-7 | `git_refresh_worker_coalesces_to_newest_repository_set` |
| UC-5 | BR-1 | `wrapper_managed_agent_status_remains_authoritative` |
| UC-5 | BR-2 | `gateway_client_topology_change_wakes_each_tide_window` |
| UC-5 | BR-3, BR-4 | `unwrapped_agent_observation_runs_once_after_command_start_deadline` |
| UC-6 | BR-1 | `child_exit_updates_active_and_background_terminal_contexts` |
| UC-6 | BR-2, BR-3 | `duplicate_exit_events_preserve_final_output_and_apply_once` |
| UC-6 | BR-4 | `terminal_exit_path_has_no_liveness_poll` |
| UC-7 | BR-1 | `blocking_gateway_accept_stops_after_shutdown_wake` |
| UC-7 | BR-2 | `subscription_loop_stops_without_timeout_polling` |
| UC-7 | BR-3, BR-4 | `background_workers_block_until_work_or_shutdown_and_wake_on_results` |
| UC-8 | BR-1 | `runtime_wait_has_no_deadline_when_idle` |
| UC-8 | BR-2, BR-3 | `runtime_wait_selects_the_earliest_exact_deadline` |
| UC-8 | BR-4 | `every_background_result_path_invokes_the_app_waker` |
| UC-8 | BR-5 | `background_workspace_events_survive_indefinite_wait` |

## Location

| Layer | Key Files |
|-------|-----------|
| Shell resources | `crates/tide-app/resources/shell-integration/.zshenv`, `.bash_profile`, `bash.sh`, `config.fish` |
| VTE parser | `crates/vte/src/ansi.rs` |
| Terminal event boundary | `crates/alacritty_terminal/src/event.rs`, `crates/alacritty_terminal/src/term/mod.rs`, `crates/tide-app/src/domain/terminal/` |
| TerminalContext application | `crates/tide-app/src/application/services/terminal_runtime_service/mod.rs` |
| CWD consumers | `session_service`, `pane_create_service`, `text_extract_service`, `file_ops_service`, `file_tree_service`, CLI config discovery, and view chrome |
| File/repository watchers | `domain/tree/mod.rs`, `application/ports/outward/repository_watcher_port.rs`, `adapter/outward/repository_watcher_adapter/` |
| Agent Gateway | `adapter/inward/cli_adapter/server.rs`, `domain/state/gateway_status.rs` |
| Runtime scheduling | `domain/state/timing.rs`, `adapter/inward/event_loop_adapter/mod.rs`, `application/services/update_service/mod.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/event_driven_terminal_runtime.rs` |
| Shell black-box tests | `scripts/test-shell-state-integration.sh` |
