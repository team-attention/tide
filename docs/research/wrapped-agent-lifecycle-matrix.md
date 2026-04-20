# Wrapped Agent Lifecycle Matrix

Current checked-in behavior summary for:

- agent-specific wrapper hooks
- Tide-managed wrapped-agent state
- UI projection
- macOS notification routing

This document is descriptive, not normative. It summarizes the code currently checked into the repo.

## Sources

- `crates/tide-app/resources/bin/claude`
- `crates/tide-app/resources/bin/codex`
- `crates/tide-app/resources/bin/codex-app-server-watch`
- `crates/tide-app/resources/bin/gemini`
- `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs`
- `crates/tide-app/src/app.rs`
- `crates/tide-app/src/domain/state/gateway_status.rs`
- `crates/tide-app/src/application/services/workspace_infra_service/mod.rs`
- `crates/tide-app/src/adapter/outward/view/header.rs`
- `crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs`
- `crates/tide-app/src/application/services/focus_nav_service/mod.rs`

## Agent Wrapper Hook Surface

| Wrapped Agent | Wrapper path | Launch / presence | Running | Idle | NeedsInput | Detach |
|---|---|---|---|---|---|---|
| Claude | `crates/tide-app/resources/bin/claude` | `agent-attached` | `UserPromptSubmit -> agent-running` | `Stop -> agent-idle --payload-stdin` | `Notification -> agent-needs-input --payload-stdin` | `EXIT -> agent-detached` |
| Codex | `crates/tide-app/resources/bin/codex` | `agent-attached` | `UserPromptSubmit -> agent-running`; opt-in App Server `turn/started` | `Stop -> codex-stop --payload-stdin`; opt-in App Server `turn/completed` | `codex-stop` classifier, opt-in App Server approval/input requests, or visible MCP permission prompt fallback | `EXIT -> agent-detached` |
| Gemini | `crates/tide-app/resources/bin/gemini` | `agent-attached` | `BeforeAgent -> agent-running` | `AfterAgent -> agent-idle --payload-stdin` | `Notification -> agent-needs-input --payload-stdin` | `EXIT -> agent-detached` |

## Tide-Managed State

| State | Location | Meaning |
|---|---|---|
| `wrapper_managed` | `AgentInfo.wrapper_managed` | This Pane's agent state came from a Tide `Agent Wrapper` lifecycle path. |
| `gateway_connected` | `AgentInfo.gateway_connected` | Tide still considers the wrapped agent connected to the Agent Gateway path. |
| `status: Option<AgentStatus>` | `AgentInfo.status` | `None`, `Running`, `Idle`, or `NeedsInput`. |
| `notified_panes` | `App.notified_panes` | Duplicate suppression set for routed macOS notifications. |
| `agent_notification_snippets` | `App.agent_notification_snippets` | Best-known notification body per source Pane. |
| `has_agent_notification` | `WorkspaceExtras.has_agent_notification` | Inactive Workspace attention projection flag. |
| `notification_authorization_status` | `WindowState.notification_authorization_status` | OS notification-permission state for the integration-toggle indicator. |

## Normalized Lifecycle State

`AgentStatus` lives in `crates/tide-app/src/domain/state/gateway_status.rs`.

| AgentStatus | Meaning in code |
|---|---|
| `Running` | The wrapped agent is actively processing a turn. |
| `Idle` | The wrapped agent finished a turn. |
| `NeedsInput` | The wrapped agent is waiting for user input. |

For Codex, `codex-stop` is the primary completed-turn signal in `commands.rs`.
The older `codex-turn-complete` notify event is still accepted by the handler.

- `codex-stop` prefers `transcript_path` and accepts current transcript shapes before falling back to `last_assistant_message`.
- `NeedsInput` is returned only when the resolved assistant message begins with a checked-in explicit request phrase.
- `Idle` is returned for unclassified completed turns.
- `codex-app-server-event` is an opt-in structured path for App Server requests and lifecycle notifications.
- Visible `Terminal` prompt scanning only handles a conservative Codex MCP permission prompt fallback.

Current checked-in `CODEX_NEEDS_INPUT_PHRASES`:

- `yes`
- `allow`
- `approve`
- `confirm`
- `please allow`
- `please approve`
- `grant permission`
- `can i proceed`
- `may i proceed`
- `what would you like me to do next`
- `what should i do next`
- `how would you like me to proceed`
- `please provide`
- `please answer`
- `can you clarify`
- `do you want me to`
- `would you like me to`

## UI Projection

### Integration Toggle Indicator

This is the small dot on the titlebar integration icon in `titlebar.rs`.

It reflects `NotificationAuthorizationStatus`, not wrapped-agent lifecycle.

| NotificationAuthorizationStatus | Integration toggle dot |
|---|---|
| `Authorized`, `Provisional`, `Ephemeral` | green |
| `Unknown`, `NotDetermined` | orange |
| `Denied` | red |
| auto-integration disabled | hidden |

### Stage Terminal Dot

This is the wrapped-agent dot on a direct Stage `Terminal`.

`header.rs` currently maps:

- `Running -> AgentChromeState::Running`
- `Idle -> AgentChromeState::Attention`
- `NeedsInput -> AgentChromeState::Attention`
- `None + gateway_connected -> AgentChromeState::ConnectedIdle`

Result:

| Wrapped-agent state | Stage Terminal dot |
|---|---|
| `None + gateway_connected=true` | blue connected-idle dot |
| `Running` | green dot |
| `Idle` | orange attention dot |
| `NeedsInput` | orange attention dot |
| detached / unmanaged | no wrapped-agent dot |

Important:

- `Idle` and `NeedsInput` currently share the same orange attention dot family.
- The dot alone does not tell them apart.

### Workspace Item Dot

Workspace projection in `workspace_infra_service/mod.rs` currently treats:

- `Running` as running
- `Idle` or `NeedsInput` as alert
- `None + gateway_connected=true` as connected idle

Result:

| Workspace strongest direct Stage Terminal state | Workspace item dot |
|---|---|
| any unresolved `Idle` or `NeedsInput` | orange alert dot |
| otherwise any `Running` | green dot |
| otherwise any connected idle presence | blue dot |
| otherwise none | no dot |

## Notification Routing

Current checked-in routing is implemented in `App::route_agent_notification()` in `crates/tide-app/src/app.rs`.

### Current checked-in behavior

| Wrapped-agent state | macOS notification | `RequestUserAttention` |
|---|---|
| `Running` | never | never |
| `Idle` | yes, unless duplicate suppression blocks it | never |
| `NeedsInput` | yes, unless the source Pane is the focused Pane in the focused Tide window or duplicate suppression blocks it | yes when delivered |

Current routing details:

1. `Running` immediately returns and clears any cached snippet.
2. `Idle` and `NeedsInput` continue into notification routing.
3. If the source Pane is the current UI focus and the Tide window is focused, Tide suppresses `NeedsInput` macOS notification delivery.
4. Focused `Idle` may still queue a completion notification.
5. Otherwise Tide queues `SendSystemNotification`.
6. Only `NeedsInput` also queues `RequestUserAttention`.
7. `notified_panes` suppresses duplicate routed notifications until acknowledgment.

## Notification Body Sources

Notification body derivation in current checked-in code is status-specific:

1. An explicit `Notification Snippet` passed into routing wins first.
2. `NeedsInput` without an explicit snippet prefers the visible `Terminal` grid fallback, then a stored unresolved snippet for the same Pane.
3. `Idle` without an explicit snippet prefers the stored unresolved snippet for the same Pane, then the visible `Terminal` grid fallback.
4. If no snippet is available, routing emits generic lifecycle text.

Current structured sources:

| Wrapped Agent | Event | Structured body source |
|---|---|---|
| Claude | `agent-needs-input` | `payload.message` |
| Claude | `agent-idle` | `payload.message` |
| Codex | `codex-stop` | transcript final assistant text, then `payload.last_assistant_message`, then generic lifecycle text |
| Codex | `codex-turn-complete` | `payload.last-assistant-message` |
| Codex | `codex-app-server-event` | request reason, command, first question, elicitation message, or waiting-on-approval text |
| Gemini | `agent-needs-input` | `payload.message` or `payload.prompt_response` via helper |
| Gemini | `agent-idle` | `payload.prompt_response` or `payload.message` via helper |

## Acknowledgment / Focus Behavior

There are two distinct paths:

### Direct Pane focus

`focus_nav_service::focus_pane()` currently:

- sets the focused Pane
- acknowledges unresolved `Idle` or `NeedsInput` attention when the Tide Window is focused
- otherwise removes that Pane from `notified_panes`
- refreshes Workspace projection
- reroutes backgrounded wrapped-agent attention excluding the newly focused Pane

So direct focus clears duplicate suppression and can also clear the wrapped-agent lifecycle attention state.

### Focused-window acknowledgment

`acknowledge_attention_for_focused_pane()` in `app.rs` calls `acknowledge_agent_attention()` for the focused Pane.

`acknowledge_agent_attention()` currently:

- sets `AgentInfo.status = None` when the status is `Idle` or `NeedsInput`
- removes the Pane from `notified_panes`
- removes the stored snippet
- refreshes affected Workspace projection

So the focused-window restore path can clear the wrapped-agent attention state itself.

## Detach Behavior

`agent-detached` goes through `detach_wrapped_agent()` in `app.rs`.

That path:

- removes the wrapped-agent record from `gateway.detected_agents`
- removes the Pane from `notified_panes`
- removes the stored snippet
- refreshes affected Workspace projection

Result:

- no wrapped-agent UI state remains for that Pane after detach

## Important Current Ambiguities

### Orange dot ambiguity

Current checked-in UI makes these look the same:

- `Idle`
- `NeedsInput`

That means the user can see the same orange wrapped-agent dot for a completed turn and for a user-input wait, even though only `NeedsInput` requests user attention.

### Integration-toggle dot vs wrapped-agent dot

These are different systems:

- integration-toggle dot = OS notification permission state
- Stage Terminal / Workspace orange dot = wrapped-agent attention state

They are independent.

## Historical Routing Note

Current checked-in routing sends macOS notifications for both `Idle` and `NeedsInput` when duplicate suppression and focus rules allow it.

- `Idle` and `NeedsInput` both can route `SendSystemNotification`.
- Only `NeedsInput` adds `RequestUserAttention`.
- The generic idle fallback body is `<Agent> finished`.
