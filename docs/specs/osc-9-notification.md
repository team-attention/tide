# Spec: OSC 9 Terminal Notification

## Overview

### As-Is

- Tide accepts `tide:` OSC 9 messages from any program running inside a `Terminal`.
- `handle_terminal_notification()` currently maps those messages directly to `AgentStatus`.
- If no agent record exists for the source `Pane`, Tide can synthesize an `Unknown` agent and still route attention from that status.
- This works for the `codex` wrapper bootstrap path, but it also lets unmanaged programs trigger agent attention.

### To-Be

- OSC 9 remains available as a transport for wrapper-managed lifecycle signals.
- Wrapped agents that cannot inject external hooks may still report `Running`, `Idle`, and `NeedsInput` through OSC 9 or another wrapper-managed bridge.
- Tide only applies OSC 9 lifecycle updates to agent attention when the source `Pane` is already tied to a wrapped agent or the wrapper bootstrap path registers that agent first.
- Unmanaged `tide:` OSC 9 messages are ignored for agent attention and do not create synthetic `Unknown` agents.

### Approach

1. Preserve OSC 9 parsing and event delivery in the terminal stack.
2. Move attention eligibility from raw OSC receipt to wrapper-managed agent registration.
3. Keep OSC 9 as a valid wrapper transport for wrappers such as `codex`, but require a wrapper-managed identity before routing attention.

## Bounded Contexts

| Context | Role |
|---------|------|
| `terminal` | Emits notification events from OSC 9 sequences |
| `gateway` | Owns wrapped-agent registration and lifecycle status |
| `wrapper` | Establishes wrapper-managed identity before or alongside OSC lifecycle signals |

## Use Cases

### UC-1: ParseOSC9

- **Actor**: Terminal PTY
- **Trigger**: Child process writes `ESC ] 9 ; <message> BEL` or `ESC ] 9 ; <message> ST`
- **Precondition**: The parser is processing the byte stream
- **Flow**:
  1. Tide collects the OSC payload
  2. Tide emits a terminal notification event with the decoded message
- **Postcondition**: The event listener receives the OSC 9 payload
- **Business Rules**:
  - BR-1: Message is UTF-8 decoded and invalid UTF-8 bytes are skipped
  - BR-2: Empty OSC 9 payloads are ignored
  - BR-3: Both BEL and ST terminators are supported

### UC-2: ApplyWrapperManagedOSC9Status

- **Actor**: Tide terminal notification handler
- **Trigger**: A `tide:` OSC 9 status message arrives from a wrapped agent path
- **Precondition**: The source `Pane` already has wrapper-managed registration or the wrapper bootstrap path has just registered it
- **Flow**:
  1. Tide parses the `tide:` status message
  2. Tide updates the wrapped agent status for the source `Pane`
  3. Tide invalidates chrome so `Pane` and `Workspace` attention can refresh
- **Postcondition**: Wrapper-managed lifecycle state updates through OSC 9
- **Business Rules**:
  - BR-4: `tide:agent-running` sets `AgentStatus::Running`
  - BR-5: `tide:agent-needs-input` sets `AgentStatus::NeedsInput`
  - BR-6: `tide:agent-idle` sets `AgentStatus::Idle`

### UC-3: IgnoreUnmanagedOSC9Status

- **Actor**: Tide terminal notification handler
- **Trigger**: A `tide:` OSC 9 status message arrives without wrapper-managed registration
- **Precondition**: The source `Pane` is not tied to a wrapped agent
- **Flow**:
  1. Tide parses the message
  2. Tide skips synthetic agent creation
  3. Tide skips attention routing
- **Postcondition**: Unmanaged OSC 9 messages do not affect agent attention
- **Business Rules**:
  - BR-7: Unknown `tide:` messages are logged at debug level and ignored
  - BR-8: Non-`tide:` messages are ignored
  - BR-9: OSC 9 does not create a synthetic `Unknown` attention source

## Invariants

1. OSC 9 parsing does not affect other OSC handling.
2. Invalid OSC 9 sequences do not crash or panic.
3. Wrapper-managed registration, not raw OSC 9 receipt alone, decides whether agent attention may change.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-2 | BR-4 | `osc9_agent_running_updates_status` |
| UC-2 | BR-5 | `osc9_agent_needs_input_updates_status` |
| UC-2 | BR-6 | `osc9_agent_idle_updates_status` |
| UC-3 | BR-7 | `osc9_unknown_tide_message_ignored` |
| UC-3 | BR-8 | `osc9_non_tide_message_ignored` |
| UC-3 | BR-9 | `osc9_unmanaged_notification_does_not_create_attention_source` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Gateway state | `crates/tide-app/src/domain/state/gateway_status.rs` | Track wrapper-managed agent registration and lifecycle state |
| App routing | `crates/tide-app/src/app.rs` | Gate OSC 9 attention routing on wrapper-managed agent identity |
| CLI notify | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Preserve wrapped-agent registration and notification delivery |
| Terminal notification | `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` | Decode OSC 9 terminal notifications before routing |
| Wrapped agents | `crates/tide-app/resources/bin/claude`, `crates/tide-app/resources/bin/gemini`, `crates/tide-app/resources/bin/codex` | Emit wrapper-managed lifecycle signals through OSC 9 or wrapper hooks |
