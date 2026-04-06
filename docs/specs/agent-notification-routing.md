# Spec: Agent Notification Routing

## Overview

### As-Is

- `AgentStatus` changes already drive a tab-dot indicator and notification routing in `app.rs`.
- `cli_notify` auto-registers wrapped agents from wrapper hooks, but `handle_terminal_notification()` can also synthesize an `Unknown` agent from raw `tide:` OSC messages.
- Attention routing currently treats every `Idle` or `NeedsInput` status the same once it exists, regardless of whether the source came from a wrapper-managed lifecycle path.
- Tide already supports Pane border blink, inactive `Workspace` dots, and background platform notifications, but those channels are not yet restricted to wrapped agents only.

### To-Be

- Only wrapper-managed lifecycle signals may create or update attention for agent status.
- All wrapped agents, not only one wrapper, participate in the same attention policy.
- `Running` remains a visible in-progress status but does not trigger attention.
- Wrapper-managed `NeedsInput` and `Idle` drive `Pane` highlight when the source `Pane` is unfocused inside the active `Workspace`.
- Wrapper-managed `NeedsInput` and `Idle` also mark an inactive `Workspace` so the `Workspace` tree highlights pending agent attention.
- Unmanaged OSC-only or synthetic agent states do not trigger Pane or `Workspace` attention.

### Approach

1. Define wrapper-managed lifecycle signals as the only valid attention source.
2. Keep the existing attention channels, but gate them on wrapper-managed agent registration.
3. Normalize the wrapped-agent lifecycle expectations across `claude`, `gemini`, and `codex`.
4. Add behavior tests for active `Pane`, inactive `Workspace`, and unmanaged-notification cases before changing routing code.

## Bounded Contexts

| Context | Role |
|---------|------|
| `gateway` | Stores agent registration and lifecycle state in `GatewayStatus` |
| `cli_adapter` | Receives wrapper hook notifications and auto-registers wrapped agents |
| `terminal` | Receives OSC notifications used by wrappers that cannot inject hooks |
| `renderer` | Shows tab dots, blink animation, Pane highlight, and `Workspace` attention |
| `workspace` | Persists inactive-`Workspace` attention state |
| `platform` | Delivers best-effort background notifications |

## Use Cases

### UC-1: RouteWrapperManagedNotificationByContext

- **Actor**: App
- **Trigger**: A wrapper-managed agent status changes to `Running`, `Idle`, or `NeedsInput`
- **Precondition**: The source `Pane` belongs to a registered wrapped agent
- **Flow**:
  1. Tide updates the wrapped agent status for the source `Pane`
  2. If status is `Running`, Tide shows in-progress state only
  3. If status is `Idle` or `NeedsInput` and the source `Pane` is unfocused in the active `Workspace`, Tide highlights that `Pane`
  4. If status is `Idle` or `NeedsInput` and the source `Pane` lives in an inactive `Workspace`, Tide marks that `Workspace` for attention
  5. If the window is unfocused, Tide may also forward a best-effort platform notification
- **Postcondition**: Wrapper-managed attention is visible in the right context
- **Business Rules**:
  - BR-1: `Running` does not trigger attention routing
  - BR-2: A focused source `Pane` skips attention routing because the user is already looking at it
  - BR-3: Wrapper-managed `Idle` and `NeedsInput` highlight an unfocused source `Pane` in the active `Workspace`
  - BR-4: Wrapper-managed `Idle` and `NeedsInput` mark an inactive `Workspace` for attention
  - BR-5: Background platform notifications are best-effort and never replace `Pane` or `Workspace` attention

### UC-2: RejectUnmanagedNotificationAttention

- **Actor**: App
- **Trigger**: A `tide:` status message arrives without wrapper-managed registration
- **Precondition**: The source `Pane` has no wrapped-agent registration
- **Flow**:
  1. Tide parses the status message
  2. Tide declines to synthesize a new attention-driving agent record
  3. Tide skips `Pane` and `Workspace` attention routing
- **Postcondition**: Unmanaged notifications do not produce attention noise
- **Business Rules**:
  - BR-6: Raw `tide:` messages without wrapper-managed registration do not create a synthetic attention source
  - BR-7: Unmanaged notifications do not set inactive-`Workspace` attention

### UC-3: AcknowledgeWrapperManagedAttention

- **Actor**: User
- **Trigger**: The user focuses the source `Pane` or switches to the flagged `Workspace`
- **Precondition**: A wrapped agent has pending `Idle` or `NeedsInput` attention
- **Flow**:
  1. Focusing the source `Pane` clears the pending status indicator for that `Pane`
  2. Switching to an inactive `Workspace` recomputes whether any wrapped agents in that `Workspace` still need attention
- **Postcondition**: Attention state clears when the user acknowledges it
- **Business Rules**:
  - BR-8: Existing focus-clears-status behavior remains intact for wrapped agents
  - BR-9: `Workspace` attention clears only when no wrapped agents in that `Workspace` still have pending `Idle` or `NeedsInput`

## Invariants

1. Only wrapper-managed lifecycle signals may trigger `Pane` or `Workspace` attention.
2. `Running` remains visible as status but never causes attention routing.
3. Inactive-`Workspace` attention reflects wrapped-agent statuses only.
4. Best-effort platform notifications must not affect the internal attention state machine.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `running_status_does_not_trigger_notification_routing` |
| UC-1 | BR-2 | `focused_pane_skips_all_notification_channels` |
| UC-1 | BR-3 | `needs_input_border_blinks_orange_when_unfocused` |
| UC-1 | BR-4 | `inactive_workspace_agent_status_sets_notification_dot` |
| UC-1 | BR-5 | `background_notification_includes_foreground_dot` |
| UC-2 | BR-6 | `osc9_unmanaged_notification_does_not_create_attention_source` |
| UC-2 | BR-7 | `unmanaged_notification_does_not_mark_inactive_workspace` |
| UC-3 | BR-8 | `focusing_pane_clears_needs_input_status` |
| UC-3 | BR-9 | `focusing_pane_clears_workspace_notification_if_no_others` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Gateway state | `crates/tide-app/src/domain/state/gateway_status.rs` | Track which agent records are wrapper-managed |
| App routing | `crates/tide-app/src/app.rs` | Gate attention routing on wrapper-managed agent lifecycle signals |
| CLI notify | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Preserve wrapped-agent auto-registration and status updates |
| Wrapped agents | `crates/tide-app/resources/bin/claude`, `crates/tide-app/resources/bin/gemini`, `crates/tide-app/resources/bin/codex` | Normalize wrapper-managed lifecycle reporting |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Add wrapped-agent attention and unmanaged-notification coverage |
