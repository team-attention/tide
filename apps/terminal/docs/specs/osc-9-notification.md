# Spec: OSC 9 Terminal Notification

## Overview

### As-Is

- The terminal backend queues OSC 9 notification payloads and the main thread drains them through `Terminal::drain_notifications()`.
- `poll_background_events()` drains those notifications from `Terminal` Panes in both the active and inactive `Workspace`s before routing them through `handle_terminal_notification()`.
- `handle_terminal_notification()` accepts three wrapper-related forms:
  - `tide:wrapped-agent:<agent>:agent-running|agent-idle|agent-needs-input`
  - `tide:agent-running`
  - `tide:agent-idle`
  - `tide:agent-needs-input`
- The wrapped-agent form bootstraps a Wrapped Agent identity for an existing `Pane` in either the active or an inactive `Workspace`, marks it `wrapper_managed`, invalidates chrome, and emits `agent-status-changed`.
- The plain `tide:agent-*` form only updates an already-registered wrapper-managed agent. If no wrapped agent is registered, Tide ignores the message and does not synthesize an `Unknown` agent.
- The checked-in Codex wrapper uses wrapped-agent OSC 9 only as a fallback transport for `agent-running` and `agent-idle` when `tide notify` is unavailable. There is no repo-backed evidence that the Codex wrapper emits `agent-needs-input`.

### To-Be

- Keep OSC 9 as a valid wrapper fallback transport.
- Keep wrapper registration, not raw OSC 9 receipt alone, as the gate for Routed Agent attention.
- Preserve the current evidence-backed Codex fallback contract instead of assuming unverified Codex hooks.

### Approach

1. Preserve OSC 9 parsing and queueing in the terminal layer.
2. Continue draining active and inactive `Workspace` terminals on the main thread.
3. Separate wrapped-agent bootstrap (`tide:wrapped-agent:*`) from plain wrapped-agent status updates (`tide:agent-*`).
4. Keep unmanaged OSC 9 messages from creating synthetic attention sources.

## Bounded Contexts

| Context | Role |
|---------|------|
| `terminal` | Queues OSC 9 payloads from PTY output |
| `event loop` | Drains queued OSC 9 payloads for active and inactive `Workspace`s |
| `gateway` | Stores wrapped-agent identity and lifecycle state |
| `wrapper` | Defines which wrapped-agent OSC 9 messages are actually emitted by the checked-in wrappers |

## Use Cases

### UC-1: ParseOSC9Payload

- **Actor**: Terminal PTY
- **Trigger**: A child process writes an OSC 9 sequence
- **Precondition**: The terminal parser is processing PTY output
- **Flow**:
  1. The terminal decodes the OSC 9 payload
  2. The terminal queues the message for the main thread
  3. The event loop drains the queued message
- **Postcondition**: Tide receives the OSC 9 payload on the main thread
- **Business Rules**:
  - BR-1: OSC 9 payloads are drained for Terminal Panes in both active and inactive `Workspace`s
  - BR-2: Non-`tide:` messages are ignored for Wrapped Agent lifecycle routing

### UC-2: BootstrapWrappedAgentFromOSC9

- **Actor**: Tide App
- **Trigger**: A wrapped-agent OSC 9 bootstrap message arrives
- **Precondition**: The source `Pane` already exists in the active or an inactive `Workspace`
- **Flow**:
  1. Tide parses `tide:wrapped-agent:<agent>:<event>`
  2. Tide resolves the wrapped agent display name
  3. Tide stores or updates a `wrapper_managed` agent record for that `Pane`
  4. Tide invalidates chrome and emits `agent-status-changed`
- **Postcondition**: The source `Pane` now has wrapper-managed lifecycle state
- **Business Rules**:
  - BR-3: Wrapped-agent OSC 9 may bootstrap a `wrapper_managed` agent record for an existing `Pane`
  - BR-4: Wrapped-agent OSC 9 emits the same subscriber event shape as the CLI notify path

### UC-3: UpdateRegisteredWrappedAgentStatusFromOSC9

- **Actor**: Tide App
- **Trigger**: A plain `tide:agent-*` OSC 9 message arrives
- **Precondition**: The source `Pane` already has a `wrapper_managed` agent record
- **Flow**:
  1. Tide parses the `tide:agent-*` message
  2. Tide updates the registered wrapped agent status
  3. Tide invalidates chrome and routes attention as needed
- **Postcondition**: Registered wrapped-agent lifecycle state updates through OSC 9
- **Business Rules**:
  - BR-5: `tide:agent-running` sets `AgentStatus::Running` for a registered wrapped agent
  - BR-6: `tide:agent-needs-input` sets `AgentStatus::NeedsInput` for a registered wrapped agent
  - BR-7: `tide:agent-idle` sets `AgentStatus::Idle` for a registered wrapped agent

### UC-4: IgnoreUnmanagedOSC9Status

- **Actor**: Tide App
- **Trigger**: An unknown or unmanaged OSC 9 message arrives
- **Precondition**: The message is not a valid wrapped-agent bootstrap or the source `Pane` has no wrapped-agent identity
- **Flow**:
  1. Tide parses the message
  2. Tide skips synthetic agent creation for unmanaged plain `tide:agent-*`
  3. Tide ignores unknown `tide:` payloads and non-`tide:` payloads
- **Postcondition**: Unmanaged OSC 9 does not affect Wrapped Agent attention
- **Business Rules**:
  - BR-8: Unknown `tide:` messages are ignored
  - BR-9: Non-`tide:` messages are ignored
  - BR-10: Plain unmanaged `tide:agent-*` does not create a synthetic Wrapped Agent source

## Invariants

1. Active and inactive `Workspace` terminals use the same OSC 9 drain path.
2. Wrapped-agent registration, not raw OSC 9 receipt, decides whether Routed Agent attention may change.
3. The checked-in Codex wrapper contract remains limited to the OSC 9 fallback that the script actually emits.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-2 | BR-3 | `wrapped_agent_osc9_auto_registers_and_requests_redraw` |
| UC-2 | BR-4 | `wrapped_agent_osc9_broadcasts_agent_status_changed_event` |
| UC-3 | BR-5 | `osc9_agent_running_updates_status` |
| UC-3 | BR-6 | `osc9_agent_needs_input_updates_status` |
| UC-3 | BR-7 | `osc9_agent_idle_updates_status` |
| UC-4 | BR-8 | `osc9_unknown_tide_message_ignored` |
| UC-4 | BR-9 | `osc9_non_tide_message_ignored` |
| UC-4 | BR-10 | `osc9_unmanaged_notification_does_not_create_attention_source` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Terminal backend | `crates/tide-app/src/domain/terminal/mod.rs` | Queues OSC 9 payloads for later drain |
| Event loop | `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` | Drains OSC 9 from active and inactive `Workspace` terminals |
| App routing | `crates/tide-app/src/app.rs` | Parses wrapped-agent OSC 9 and updates lifecycle state |
| Wrapper | `crates/tide-app/resources/bin/codex` | Proves the current Codex OSC 9 fallback contract |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verifies wrapper bootstrap, registered status updates, and unmanaged-message rejection |
