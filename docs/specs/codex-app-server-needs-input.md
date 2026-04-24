# Spec: Codex App Server NeedsInput

## Overview

### As-Is

- Tide already stores wrapped-agent lifecycle as `AgentStatus` and routes `AgentStatus::NeedsInput` through existing notification and user-attention behavior.
- The checked-in Codex `Agent Wrapper` injects Codex hooks for `UserPromptSubmit` and `Stop`, then launches the real Codex CLI.
- The hook path can normalize a completed Codex turn to `Idle` after `Stop`, but it does not receive a structured command-approval request while the Codex TUI is blocked on an approval prompt.
- The installed Codex app-server schema exposes server requests for `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, and `mcpServer/elicitation/request`.
- The checked-in Codex wrapper keeps App Server remote mode behind `TIDE_CODEX_APP_SERVER=1` because the current watcher is not yet a protocol-complete Codex app-server client.
- The checked-in App Server normalization still lets an initial `thread/status/changed` idle snapshot become `AgentStatus::Idle`, so resuming an already-idle Codex session can raise a generic `Codex finished` completion alert instead of preserving `ConnectedIdle`.

### To-Be

- Tide accepts Codex App Server request payloads through the existing Agent Gateway `notify` command.
- Codex App Server requests that require user approval or user input update the source `Pane`'s wrapped-agent `AgentStatus` to `NeedsInput`.
- Codex App Server turn lifecycle notifications may update the source `Pane` to `Running` or `Idle` when the payload includes `turn/started` or `turn/completed`.
- Codex App Server thread status notifications may update the source `Pane` to `NeedsInput` when `thread/status/changed` reports `waitingOnApproval`.
- An initial Codex App Server idle snapshot that arrives while the source `Pane` only has `Wrapped Agent Presence` must stay presence-only (`AgentInfo.status = None`) instead of projecting a fresh completion alert.
- The Codex `Agent Wrapper` keeps App Server remote mode as an explicit opt-in, keeps the Watcher on the same source `Pane` only when enabled, and otherwise defaults to the direct Codex CLI launch.

### Approach

1. Add a `codex-app-server-event` notification event handled by the Agent Gateway.
2. Normalize Codex App Server server requests into `AgentStatus::NeedsInput`.
3. Normalize Codex App Server `turn/started` and `turn/completed` notifications into `Running` and `Idle`.
4. Normalize Codex App Server `thread/status/changed` notifications into `NeedsInput`, `Running`, or `Idle` when the status payload is recognized, but keep initial idle snapshots as presence-only when Tide has not observed an active wrapped-agent turn yet.
5. Derive a `Notification Snippet` from structured request payload fields before falling back to generic text.
6. Keep the Codex `Agent Wrapper` App Server path behind an explicit opt-in until Tide has a protocol-complete watcher, and preserve the hook-injected direct Codex CLI launch as the default path.

## Bounded Contexts

- `gateway`: receives wrapper-managed lifecycle reports through `notify` and stores `AgentStatus`.
- `terminal`: runs the Codex `Agent Wrapper` in a `Terminal` Pane.
- `platform`: routes notification and user-attention commands already produced from `AgentStatus::NeedsInput`.

## Use Cases

### UC-1: CommandApprovalNeedsInput

- Actor: Codex App Server Watcher
- Trigger: Codex App Server sends `item/commandExecution/requestApproval`.
- Precondition: The source `Pane` exists in the active or cold-stored `Workspace`.
- Flow:
  1. Codex App Server Watcher forwards the server request as `tide notify codex-app-server-event --pane <PaneId> --agent codex --payload-stdin`.
  2. Tide reads `payload.method`.
  3. Tide updates the wrapped-agent record for the source `Pane` to `AgentStatus::NeedsInput`.
  4. Tide stores a `Notification Snippet` derived from the request reason or command.
- Postcondition: Existing wrapped-agent notification routing handles the `NeedsInput` state.
- Business Rules:
  - BR-1: `item/commandExecution/requestApproval` maps to `AgentStatus::NeedsInput`.
  - BR-2: Command approval snippets prefer `params.reason`, then `params.command`, then generic Codex text.

### UC-2: OtherAppServerRequestsNeedInput

- Actor: Codex App Server Watcher
- Trigger: Codex App Server sends a non-command request that still requires user input.
- Precondition: The source `Pane` exists.
- Flow:
  1. Codex App Server Watcher forwards the request payload through `notify`.
  2. Tide recognizes the request method.
  3. Tide updates the wrapped-agent record to `AgentStatus::NeedsInput`.
- Postcondition: Existing wrapped-agent notification routing handles the `NeedsInput` state.
- Business Rules:
  - BR-3: `item/fileChange/requestApproval` maps to `AgentStatus::NeedsInput`.
  - BR-4: `item/permissions/requestApproval` maps to `AgentStatus::NeedsInput`.
  - BR-5: `item/tool/requestUserInput` maps to `AgentStatus::NeedsInput`.
  - BR-6: `mcpServer/elicitation/request` maps to `AgentStatus::NeedsInput`.

### UC-3: AppServerStatusLifecycle

- Actor: Codex App Server Watcher
- Trigger: Codex App Server emits a turn lifecycle notification or thread status notification.
- Precondition: The source `Pane` exists.
- Flow:
  1. Codex App Server Watcher forwards the notification payload through `notify`.
  2. Tide recognizes `turn/started`, `turn/completed`, or `thread/status/changed`.
  3. Tide updates wrapped-agent `AgentStatus`, or preserves presence-only connected idle when the payload is only an initial idle snapshot for an already-idle resumed session.
- Postcondition: The source `Pane` reflects app-server turn lifecycle without relying on terminal text.
- Business Rules:
  - BR-7: `turn/started` maps to `AgentStatus::Running`.
  - BR-8: `turn/completed` maps to `AgentStatus::Idle`.
  - BR-9: `thread/status/changed` maps to `AgentStatus::NeedsInput` when the status payload contains the `waitingOnApproval` active flag.
  - BR-10: `thread/status/changed` maps to `AgentStatus::Running` when the status payload reports active without the `waitingOnApproval` active flag.
  - BR-11: `thread/status/changed` idle maps to `AgentStatus::Idle` only after Tide has already observed an active wrapped-agent turn for that source `Pane`; otherwise it preserves presence-only connected idle, such as right after attach or resume.
  - BR-12: Unsupported Codex App Server payload methods are ignored without changing status.

### UC-4: AppServerWrapperLaunch

- Actor: User launching `codex` inside a Tide `Terminal` Pane.
- Trigger: The Codex `Agent Wrapper` is first on `PATH`.
- Precondition: `TIDE_BIN` and `TIDE_PANE` are present.
- Flow:
  1. The Codex `Agent Wrapper` reports `agent-attached`.
  2. The wrapper creates a temporary `CODEX_HOME` overlay as before.
  3. Only when `TIDE_CODEX_APP_SERVER=1` explicitly enables App Server remote mode, the wrapper starts Codex App Server on a localhost websocket endpoint.
  4. When App Server remote mode is enabled, the wrapper starts Codex App Server Watcher for the same endpoint and source `Pane`.
  5. When App Server remote mode is enabled, the wrapper launches Codex TUI in remote mode against the endpoint.
  6. Otherwise, or when App Server launch fails, the wrapper falls back to the direct Codex CLI launch.
- Postcondition: The visible Codex TUI remains in the same Terminal `Pane`.
- Business Rules:
  - BR-13: The wrapper owns Codex App Server and Watcher process lifecycle only when `TIDE_CODEX_APP_SERVER=1` explicitly enables the app-server path.
  - BR-14: The wrapper preserves existing MCP and hook injection for fallback.
  - BR-15: The wrapper still reports `agent-detached` and removes its temporary `CODEX_HOME` and wrapper-owned app-server log files on exit.
  - BR-16: The wrapper defaults to the direct Codex CLI launch and enters App Server remote mode only when `TIDE_CODEX_APP_SERVER=1` explicitly enables it.

## Invariants

- Inward adapters do not directly mutate domain state; `notify` handling uses `GatewayPort`.
- `AgentStatus` remains the only lifecycle state consumed by UI and routing.
- `Codex App Server Watcher` never writes Tide state directly; it forwards a `Wrapper-Managed Lifecycle Signal` through the Agent Gateway.
- Unsupported app-server payloads do not overwrite a known wrapped-agent status.

## Tests

| Use Case | Business Rule | Test |
|----------|---------------|------|
| UC-1 | BR-1, BR-2 | `codex_app_server_command_approval_marks_needs_input` |
| UC-2 | BR-3, BR-4, BR-5, BR-6 | `codex_app_server_user_input_requests_mark_needs_input` |
| UC-3 | BR-7, BR-8 | `codex_app_server_turn_lifecycle_updates_running_and_idle` |
| UC-3 | BR-9 | `codex_app_server_waiting_on_approval_thread_status_marks_needs_input` |
| UC-3 | BR-10, BR-11 | `codex_app_server_thread_status_updates_running_and_idle` |
| UC-3 | BR-11 | `codex_app_server_initial_idle_snapshot_preserves_connected_idle_presence` |
| UC-3 | BR-12 | `codex_app_server_unsupported_payload_does_not_change_status` |
| UC-4 | BR-13, BR-14, BR-15, BR-16 | `codex_wrapper_keeps_app_server_opt_in_and_direct_cli_default` |

## Location

- `crates/tide-app/resources/bin/codex`
- `crates/tide-app/resources/bin/codex-app-server-watch`
- `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs`
- `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs`
- `crates/tide-app/src/application/behavior_tests/agent_gateway.rs`
