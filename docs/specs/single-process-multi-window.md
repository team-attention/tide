# Spec: Single-Process Multi-Window

## Overview
### As-Is
`GlobalAction::NewWindow` is bound to `Cmd+N` and currently delegates to `ProcessPort::launch_new_tide_window`. The bundled macOS process adapter launches `open -n <Tide.app>`, which creates another `Tide Instance` instead of another `Tide Window` in the same process.

`main.rs` constructs one `App`, one `WindowProxy`, and one `MacosApp::run` callback. `MacosApp` stores a single `MAIN_WINDOW`. `WindowCommand` values are not addressed by `TideWindowId`, so the main thread implicitly applies them to the only native window.

`App` already owns its active `Workspace` fields and a `WorkspaceManager` for cold-stored Workspaces. A separate `App` per `Tide Window` preserves those boundaries without turning `App` into a process-wide multi-window aggregate.

### To-Be
`Cmd+N` creates a new `Tide Window` in the same `Tide Instance`, without using `open -n` and without creating a second Dock icon.

Each `Tide Window` has an independent `App` aggregate. Each `App` owns its own panes, layout, focus, router, IME state, `WorkspaceManager`, active `Workspace` fields, renderer state, Browser Pane native view attachments, and pending platform commands.

Platform commands sent from an `App` to the main thread are addressed by `TideWindowId`. The main thread executes each command on the addressed `Tide Window`.

Terminals export both `TIDE_SOCKET` and `TIDE_WINDOW`. CLI, MCP, and notification clients include `_caller_window`, and the Agent Gateway routes commands to the addressed `Tide Window` before the target `App` performs its existing Workspace routing by `_caller_pane`.

`CloseRequested` closes the addressed `Tide Window`. Closing one of multiple `Tide Window`s tears down only that window's `App` runtime and Agent Gateway target. Closing the last live `Tide Window` exits the `Tide Instance`.

Process-global state that is only safe for one native window must either be keyed by `TideWindowId` or explicitly kept process-wide. Browser Pane bridge queues and native handler tables are window-scoped. Notification authorization status is process-wide but must be delivered to all live `Tide Window`s. Settings are stored once but changes are broadcast to every live `App`. Crash recovery is decided once for the first `Tide Window`; later in-process windows start fresh with global preferences only.

### Approach
1. Add `TideWindowId` to the domain core identity types.
2. Add `WindowCommand::CreateWindow` and a `WindowCommandEnvelope` that pairs every `WindowCommand` with a `TideWindowId`.
3. Make `WindowProxy` carry a `TideWindowId` and send `WindowCommandEnvelope` values.
4. Change `GlobalAction::NewWindow` to queue `WindowCommand::CreateWindow` instead of launching another process.
5. Replace the single `MAIN_WINDOW` storage in `MacosApp` with a window registry keyed by `TideWindowId`.
6. In `main.rs`, create one `App` runtime per `Tide Window`; each runtime owns its own event channel and `WindowProxy`, while the main thread owns the registry and routes addressed commands.
7. Export `TIDE_WINDOW` to terminal children and route Agent Gateway commands through `GatewayCommandRouter`.
8. Add `WindowCommand::CloseWindow`; a close request from one `App` asks the main thread to close that `TideWindowId`.
9. Unregister a closed `TideWindowId` from `GatewayCommandRouter`; only commands without `_caller_window` may fall back to the active `Tide Window`.
10. Remove the addressed `Tide Window` from the native registry before reporting the remaining live window count.
11. Delete the running marker and exit only when the close request consumes the last live `Tide Window`.
12. Key Browser Pane bridge queues, new-tab queues, and pending native handler maps by `TideWindowId`.
13. Replace main-window-only notification authorization routing with all-window delivery.
14. Pass the current Workspace name into terminal creation instead of reading a process-global active Workspace name.
15. Broadcast settings changes to all live `App` runtimes.
16. Gate crash recovery restore by a first-window-only startup flag.
17. Allow periodic crash-recovery session auto-save only from the focused `Tide Window`.
18. Route cross-thread wakeups through the main dispatch queue before touching native views.
19. Request an initial redraw after each new `App` runtime finishes native window initialization.
20. Release the native `Tide Window` registry borrow before invoking platform callbacks, because callbacks can drain commands that create or close `Tide Window`s.
21. Disable AppKit's automatic `NSWindow` release-on-close behavior because Tide owns native windows through `Retained<NSWindow>`.
22. Track a Cascaded Tide Window Position and apply it before registering each newly created native `Tide Window`.

## Bounded Contexts
- `core_types`: defines `TideWindowId`.
- `input`: keeps `Cmd+N` mapped to `GlobalAction::NewWindow`.
- `platform`: owns `MacosApp`, native `Tide Window` registry, `WindowProxy`, and `WindowCommand` routing.
- `gateway`: routes CLI, MCP, and notification commands to the addressed `Tide Window`.
- `application/services`: changes `GlobalAction::NewWindow` dispatch to request an in-process `Tide Window`.
- `Workspace`: remains owned by each per-window `App` aggregate.

## Use Cases
### UC-1: CreateInProcessTideWindow
Actor: User

Trigger: User presses `Cmd+N`.

Precondition: A `Tide Instance` is already running with at least one `Tide Window`.

Flow:
1. The input router resolves `Cmd+N` to `GlobalAction::NewWindow`.
2. The active `App` queues `WindowCommand::CreateWindow`.
3. The active `WindowProxy` sends that command in a `WindowCommandEnvelope` with its `TideWindowId`.
4. The main thread receives the command and creates a new native `Tide Window` inside the same `Tide Instance`.
5. The new `Tide Window` starts a fresh `App` runtime.
6. The new `App` requests an initial redraw so the first rendered frame can reveal the native window.

Postcondition: The new `Tide Window` appears without launching another process.

Business Rules:
- BR-1: `Cmd+N` MUST continue to resolve to `GlobalAction::NewWindow`.
- BR-2: `GlobalAction::NewWindow` MUST request `WindowCommand::CreateWindow`.
- BR-3: `GlobalAction::NewWindow` MUST NOT call `ProcessPort::launch_new_tide_window`.
- BR-4: The bundled `open -n` path MUST NOT be part of the `Cmd+N` flow.
- BR-5: A newly created `Tide Window` MUST use the Cascaded Tide Window Position instead of appearing directly over the prior `Tide Window`.

### UC-2: RouteWindowCommandByTideWindowId
Actor: App runtime

Trigger: An `App` sends a platform command.

Precondition: Multiple `Tide Window` runtimes exist in one `Tide Instance`.

Flow:
1. A `WindowProxy` sends a `WindowCommandEnvelope`.
2. The envelope carries the source `TideWindowId`.
3. The main thread looks up the addressed `Tide Window`.
4. The main thread executes the command on only that native window.

Postcondition: Platform mutations affect the addressed `Tide Window` only.

Business Rules:
- BR-1: Every `WindowProxy` MUST carry a `TideWindowId`.
- BR-2: Every `WindowCommand` sent through a `WindowProxy` MUST be wrapped in a `WindowCommandEnvelope`.
- BR-3: The main thread MUST execute commands against the `Tide Window` addressed by the envelope.

### UC-3: OwnIndependentWindowAppState
Actor: Tide runtime

Trigger: A new `Tide Window` is created.

Precondition: A `Tide Instance` is already running.

Flow:
1. The main thread creates a fresh `App`.
2. The new `App` is initialized with the new native `Tide Window`.
3. The new `App` runs on its own app thread and event channel.

Postcondition: The new `Tide Window` has independent `Workspace` and `App` state.

Business Rules:
- BR-1: Each `Tide Window` MUST own a distinct `App` aggregate.
- BR-2: Each `App` MUST own its own `WorkspaceManager` and active `Workspace` fields.
- BR-3: Existing Workspace save/load/switch behavior MUST remain scoped to one `App`.

### UC-4: RouteGatewayCommandByTideWindowId
Actor: CLI or MCP client

Trigger: A process launched from a Terminal sends an Agent Gateway command.

Precondition: Multiple `Tide Window` runtimes exist in one `Tide Instance`.

Flow:
1. The Terminal child process receives `TIDE_WINDOW`.
2. The CLI, MCP, or notification client sends `_caller_window` with the command.
3. `GatewayCommandRouter` chooses the addressed `Tide Window` event channel.
4. The target `App` receives the command and applies existing `_caller_pane` Workspace routing.

Postcondition: Agent Gateway commands from a Terminal execute in the owning `Tide Window`.

Business Rules:
- BR-1: Terminal children MUST receive `TIDE_WINDOW`.
- BR-2: CLI, MCP, and notification clients MUST include `_caller_window` when `TIDE_WINDOW` is present.
- BR-3: `GatewayCommandRouter` MUST dispatch to the addressed `Tide Window` when `_caller_window` is present.
- BR-4: Commands without `_caller_window` MUST fall back to the active `Tide Window`.

### UC-5: CloseTideWindow
Actor: User

Trigger: User clicks a `Tide Window` close control.

Precondition: A `Tide Instance` has one or more `Tide Window`s, or the user invokes `GlobalAction::ClosePane` on the last `Pane` in a `Tide Window`.

Flow:
1. The native window delegate emits `CloseRequested` for the addressed `TideWindowId`.
2. The owning `App` checks for running Terminal panes or dirty Editor panes.
3. If confirmation is required and cancelled, the `Tide Window` remains open.
4. If close is accepted, the `App` saves its session state and sends `WindowCommand::CloseWindow`.
5. If `GlobalAction::ClosePane` targets the last `Pane` in the active Workspace, the owning `App` follows the same `WindowCommand::CloseWindow` path instead of calling `exit_app`.
6. The main thread unregisters the `TideWindowId` from Agent Gateway routing.
7. If other `Tide Window`s remain, the main thread closes only the addressed native window.
8. If no other `Tide Window` remains, the main thread deletes the running marker and exits the `Tide Instance`.

Postcondition: Closing one `Tide Window` does not terminate other live `Tide Window`s.

Business Rules:
- BR-1: `CloseRequested` MUST send `WindowCommand::CloseWindow` for the addressed `TideWindowId` instead of calling `std::process::exit` from the `App` runtime.
- BR-2: A closed `TideWindowId` MUST be unregistered from `GatewayCommandRouter`.
- BR-3: A command addressed to an unregistered `TideWindowId` MUST NOT fall back to another `Tide Window`.
- BR-4: A command without `_caller_window` MUST continue to fall back to the active `Tide Window`.
- BR-5: The running marker MUST be deleted only when the last live `Tide Window` closes.
- BR-6: The remaining-window count used for process exit MUST be computed after removing the addressed `Tide Window` from the registry.
- BR-7: `GlobalAction::ClosePane` on the last `Pane` in a `Tide Window` MUST send `WindowCommand::CloseWindow` instead of calling `exit_app`.
- BR-8: The App event loop MUST forward pending `WindowCommand::CloseWindow` through the owning `WindowProxy`.
- BR-9: A retained native `NSWindow` MUST disable release-on-close before any close command can run.

### UC-6: IsolateProcessGlobalWindowState
Actor: Tide runtime

Trigger: Multiple `Tide Window`s are live in one `Tide Instance`.

Precondition: A `Tide Instance` has at least two live `Tide Window`s.

Flow:
1. Browser Pane native delegates enqueue bridge messages and new-tab requests into queues keyed by their owning `TideWindowId`.
2. Each `App` drains only the Browser Pane queue addressed to its own `TideWindowId`.
3. Browser Pane permission, certificate, and download native handler tables use both `TideWindowId` and `PaneId`.
4. Notification authorization callbacks deliver process-wide status to every live `Tide Window`.
5. Terminal creation receives the owning `App`'s active Workspace name directly.
6. Settings changes are saved once and broadcast to every live `App`.
7. Crash recovery restore is enabled only for the first `Tide Window` created at process startup.
8. Periodic crash-recovery session auto-save runs only in the focused `Tide Window`.
9. App-thread wakeups schedule redraw work onto the main dispatch queue and trigger only one live native view to drain main-thread commands.
10. A newly initialized `App` runtime requests redraw before entering `app_thread_run`.
11. Platform event dispatch clones the addressed native `Tide Window` handle before invoking the `EventCallback`.

Postcondition: State that used to assume one native window cannot be consumed by or applied to the wrong `Tide Window`.

Business Rules:
- BR-1: Browser Pane bridge messages MUST be queued and drained by `TideWindowId`.
- BR-2: Browser Pane new-tab requests MUST be queued and drained by `TideWindowId`.
- BR-3: Browser Pane pending permission, certificate, and download handlers MUST be keyed by both `TideWindowId` and `PaneId`.
- BR-4: Notification authorization status updates MUST NOT target only `TideWindowId::MAIN`.
- BR-5: `TIDE_WORKSPACE` MUST come from the owning `App`'s active Workspace, not a process-global active Workspace value.
- BR-6: Settings changes MUST refresh in-memory settings in every live `App`.
- BR-7: Crash recovery session restore MUST run only for the first `Tide Window` in a `Tide Instance`.
- BR-8: Periodic session auto-save MUST NOT write from an unfocused `Tide Window`.
- BR-9: The main thread waker MUST NOT send Objective-C messages to native views from an `App` thread and MUST trigger at most one native view per wake.
- BR-10: A newly initialized `App` runtime MUST request redraw before entering `app_thread_run`.
- BR-11: Platform event dispatch MUST NOT hold a registry borrow while invoking `EventCallback`.

## Invariants
- Every addressed `WindowCommand` targets one `TideWindowId`.
- A `TideWindowId` is unique within a `Tide Instance`.
- A `Tide Window` owns one `App` runtime.
- Agent Gateway routing chooses a `Tide Window` before Workspace routing chooses a Workspace.
- Existing `PaneId` sync remains scoped to the `App` that owns the active `Workspace`.
- Existing single-window startup remains valid as the first `Tide Window` runtime.
- Closing one `Tide Window` must not remove another `Tide Window` from the registry or Agent Gateway router.
- Process exit after close must depend on the registry count after the addressed `Tide Window` is removed.
- Browser Pane bridge messages from one `Tide Window` must not be consumed by another `Tide Window`.
- A stale addressed `TideWindowId` must not fall back to another live `Tide Window`.
- Process-wide settings may be stored once, but each live `App` must refresh its in-memory copy when they change.
- Crash recovery restore is a `Tide Instance` startup concern, not a per-window concern.
- Periodic crash-recovery session auto-save must be owned by the focused `Tide Window`.
- Cross-thread wakeups must dispatch to the main queue before emitting native view redraw events.
- A newly created invisible native `Tide Window` must receive a first frame request before it can be revealed.
- Platform callbacks must be able to create or close a `Tide Window` without re-entering the native window registry borrow.

## Tests
| Use Case | Business Rule | Test |
|----------|---------------|------|
| UC-1 | BR-1, BR-2, BR-3 | `cmd_n_creates_new_tide_window_in_same_process` |
| UC-1 | BR-5 | `new_tide_window_uses_cascaded_tide_window_position` |
| UC-2 | BR-1, BR-2, BR-3 | `window_targeted_commands_route_to_the_addressed_tide_window` |
| UC-3 | BR-1, BR-2, BR-3 | `each_tide_window_keeps_independent_workspace_state` |
| UC-4 | BR-1, BR-2 | `cli_callers_include_tide_window_for_gateway_routing` |
| UC-4 | BR-3, BR-4 | `gateway_router_dispatches_cli_command_to_the_addressed_tide_window` |
| UC-5 | BR-1 | `close_requested_closes_the_addressed_tide_window_without_process_exit` |
| UC-5 | BR-2, BR-3, BR-4 | `closed_tide_window_is_removed_from_gateway_routing` |
| UC-5 | BR-5 | `close_window_command_deletes_running_marker_only_for_last_tide_window` |
| UC-5 | BR-6 | `close_window_request_reports_remaining_count_after_registry_removal` |
| UC-5 | BR-7 | `closing_last_pane_requests_tide_window_close_without_process_exit` |
| UC-5 | BR-8 | `pending_close_window_command_is_forwarded_to_window_proxy` |
| UC-5 | BR-9 | `retained_native_window_disables_appkit_release_on_close` |
| UC-6 | BR-1, BR-2 | `browser_bridge_queues_are_scoped_by_tide_window` |
| UC-6 | BR-3 | `browser_native_handlers_are_keyed_by_tide_window_and_pane` |
| UC-6 | BR-4 | `notification_authorization_updates_are_not_main_window_only` |
| UC-6 | BR-5 | `terminal_workspace_environment_uses_the_owning_app_workspace` |
| UC-6 | BR-6 | `settings_changes_are_broadcast_to_live_tide_windows` |
| UC-6 | BR-7 | `crash_recovery_restore_is_limited_to_the_first_tide_window` |
| UC-6 | BR-8 | `periodic_session_auto_save_is_limited_to_the_focused_tide_window` |
| UC-6 | BR-9 | `main_thread_waker_does_not_message_native_views_from_app_threads` |
| UC-6 | BR-10 | `new_tide_window_runtime_requests_initial_redraw_before_app_thread_run` |
| UC-6 | BR-11 | `platform_event_dispatch_releases_window_registry_borrow_before_callback` |

## Location
- `docs/glossary.md`
- `crates/tide-app/src/domain/core_types.rs`
- `crates/tide-app/src/adapter/outward/platform_adapter/mod.rs`
- `crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs`
- `crates/tide-app/src/main.rs`
- `crates/tide-app/src/application/services/action_service/mod.rs`
- `crates/tide-app/src/adapter/inward/cli_adapter/`
- `crates/tide-app/src/application/behavior_tests/single_process_multi_window.rs`
