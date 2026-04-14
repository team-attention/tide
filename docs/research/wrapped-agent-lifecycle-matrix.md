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
| Codex | `crates/tide-app/resources/bin/codex` | `agent-attached` | `UserPromptSubmit -> agent-running` | `codex-turn-complete` classified to `Idle` or `NeedsInput` | same completed-turn classifier | `EXIT -> agent-detached` |
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

For Codex, `codex-turn-complete` is classified in `commands.rs`:

- `NeedsInput` only when `last-assistant-message` begins with a checked-in explicit request phrase.
- `Idle` for all unclassified completed turns.

Current checked-in `CODEX_NEEDS_INPUT_PHRASES`:

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
| `Idle` | currently never | never |
| `NeedsInput` | yes, unless the source Pane is the focused Pane in the focused Tide window | yes |

Current routing details:

1. `Running` immediately returns and clears any cached snippet.
2. `Idle` immediately returns and clears any cached snippet.
3. `NeedsInput` continues into notification routing.
4. If the source Pane is the current UI focus and the Tide window is focused, Tide suppresses the macOS notification.
5. Otherwise Tide queues `SendSystemNotification`.
6. Only `NeedsInput` also queues `RequestUserAttention`.
7. `notified_panes` suppresses duplicate routed notifications until acknowledgment.

## Notification Body Sources

Notification body derivation order in current checked-in code:

1. structured payload snippet from the wrapper / Codex completed-turn payload
2. stored unresolved snippet for the same Pane
3. visible `Terminal` grid fallback
4. generic fallback text

Current structured sources:

| Wrapped Agent | Event | Structured body source |
|---|---|---|
| Claude | `agent-needs-input` | `payload.message` |
| Claude | `agent-idle` | no structured source in current checked-in `cli_notify()` path because Idle clears the snippet before routing |
| Codex | `codex-turn-complete` | `payload.last-assistant-message` |
| Gemini | `agent-needs-input` | `payload.message` or `payload.prompt_response` via helper |
| Gemini | `agent-idle` | `payload.prompt_response` via helper, but current checked-in routing returns before delivery |

## Acknowledgment / Focus Behavior

There are two distinct paths:

### Direct Pane focus

`focus_nav_service::focus_pane()` currently:

- sets the focused Pane
- removes that Pane from `notified_panes`
- refreshes Workspace projection
- does not clear `AgentInfo.status`

So direct focus clears duplicate suppression, but does not itself clear the wrapped-agent lifecycle state.

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

That means the user can see an orange wrapped-agent dot even when the code will not send a macOS notification.

### Integration-toggle dot vs wrapped-agent dot

These are different systems:

- integration-toggle dot = OS notification permission state
- Stage Terminal / Workspace orange dot = wrapped-agent attention state

They are independent.

## Recent Regression Note

Git evidence in this repo shows that commit `c9e547a` changed `route_agent_notification()` so `Idle` now returns before notification delivery.

Before that change:

- `Idle` and `NeedsInput` both routed `SendSystemNotification`
- only `NeedsInput` added `RequestUserAttention`
- generic idle fallback body was `<Agent> finished`

Current checked-in code no longer does that.
