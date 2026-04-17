# Spec: Codex App Server NeedsInput

## Overview

### As-Is

- Tide already stores wrapped-agent lifecycle as `AgentStatus` and routes `AgentStatus::NeedsInput` through existing notification and user-attention behavior.
- The checked-in Codex `Agent Wrapper` injects Codex hooks for `UserPromptSubmit` and `Stop`, then launches the real Codex CLI.
- The hook path can classify a completed Codex turn as `Idle` or `NeedsInput` after `Stop`, but it does not receive a structured command-approval request while the Codex TUI is blocked on an approval prompt.
- The installed Codex app-server schema exposes server requests for `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, and `mcpServer/elicitation/request`.

### To-Be

- Tide accepts Codex App Server request payloads through the existing Agent Gateway `notify` command.
- Codex App Server requests that require user approval or user input update the source `Pane`'s wrapped-agent `AgentStatus` to `NeedsInput`.
- Codex App Server turn lifecycle notifications may update the source `Pane` to `Running` or `Idle` when the payload includes `turn/started` or `turn/completed`.
- Codex App Server thread status notifications may update the source `Pane` to `NeedsInput` when `thread/status/changed` reports `waitingOnApproval`.
- The Codex `Agent Wrapper` owns app-server launch and Codex App Server Watcher launch while preserving the existing hook path as a fallback.

### Approach

1. Add a `codex-app-server-event` notification event handled by the Agent Gateway.
2. Normalize Codex App Server server requests into `AgentStatus::NeedsInput`.
3. Normalize Codex App Server `turn/started` and `turn/completed` notifications into `Running` and `Idle`.
4. Normalize Codex App Server `thread/status/changed` notifications into `NeedsInput`, `Running`, or `Idle` when the status payload is recognized.
5. Derive a `Notification Snippet` from structured request payload fields before falling back to generic text.
6. Update the Codex `Agent Wrapper` to prefer an app-server-backed remote Codex TUI when supported, and keep the current hook-injected direct Codex CLI launch as fallback.

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
  3. Tide updates wrapped-agent `AgentStatus`.
- Postcondition: The source `Pane` reflects app-server turn lifecycle without relying on terminal text.
- Business Rules:
  - BR-7: `turn/started` maps to `AgentStatus::Running`.
  - BR-8: `turn/completed` maps to `AgentStatus::Idle`.
  - BR-9: `thread/status/changed` maps to `AgentStatus::NeedsInput` when the status payload contains the `waitingOnApproval` active flag.
  - BR-10: `thread/status/changed` maps to `AgentStatus::Running` when the status payload reports active without the `waitingOnApproval` active flag.
  - BR-11: `thread/status/changed` maps to `AgentStatus::Idle` when the status payload reports idle.
  - BR-12: Unsupported Codex App Server payload methods are ignored without changing status.

### UC-4: AppServerWrapperLaunch

- Actor: User launching `codex` inside a Tide `Terminal` Pane.
- Trigger: The Codex `Agent Wrapper` is first on `PATH`.
- Precondition: `TIDE_BIN` and `TIDE_PANE` are present.
- Flow:
  1. The Codex `Agent Wrapper` reports `agent-attached`.
  2. The wrapper creates a temporary `CODEX_HOME` overlay as before.
  3. The wrapper starts Codex App Server on a localhost websocket endpoint.
  4. The wrapper starts Codex App Server Watcher for the same endpoint and source `Pane`.
  5. The wrapper launches Codex TUI in remote mode against the endpoint.
  6. If app-server launch fails, the wrapper falls back to the existing direct Codex CLI launch.
- Postcondition: The visible Codex TUI remains in the same Terminal `Pane`.
- Business Rules:
  - BR-13: The wrapper owns Codex App Server and watcher process lifecycle.
  - BR-14: The wrapper preserves existing MCP and hook injection for fallback.
  - BR-15: The wrapper still reports `agent-detached` and removes its temporary `CODEX_HOME` and wrapper-owned app-server log files on exit.

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
| UC-3 | BR-12 | `codex_app_server_unsupported_payload_does_not_change_status` |
| UC-4 | BR-13, BR-14, BR-15 | `codex_wrapper_launches_app_server_remote_tui_and_watcher` |

## Location

- `crates/tide-app/resources/bin/codex`
- `crates/tide-app/resources/bin/codex-app-server-watch`
- `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs`
- `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs`
- `crates/tide-app/src/application/behavior_tests/agent_gateway.rs`
