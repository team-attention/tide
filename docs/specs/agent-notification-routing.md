# Spec: Agent Notification Routing

## Overview

### As-Is

- Tide already normalizes wrapper-managed lifecycle signals from `claude`, `codex`, and `gemini` into `AgentStatus`.
- `Wrapped Agent Presence` already lets a connected direct wrapped-agent `Terminal` render `ConnectedIdle` when no lifecycle status is active.
- `handle_terminal_notification()` and `cli_notify()` already own the shared normalization path for wrapper-managed lifecycle and OSC 9 fallback messages.
- The notification path already stores a `Notification Snippet` and uses notification activation to jump to the source `Pane`.
- `route_agent_notification()` still formats `AgentStatus::Idle` into `SendSystemNotification` for backgrounded wrapped-agent panes, so current routing still alerts on `Idle`.
- Existing behavior tests still assert some `agent-idle` notification deliveries and body paths, including the `agent-idle` notification coverage in `gemini_after_agent_notification_uses_prompt_response_snippet`.
- The shared contract still needs an explicit boundary between `Idle` chrome or Workspace projection and actual alert delivery.

### To-Be

- `AgentStatus` remains the single lifecycle state UI and routing consume.
- `Idle` is a chrome and Workspace projection state only. It may update pane chrome and inactive Workspace chrome, but it must never queue macOS notifications or request user attention.
- `NeedsInput` is the only normalized lifecycle state that may queue macOS notifications, request user attention, or otherwise surface as an alert.
- `Running` remains visible-only and never routes attention.
- The supported wrapped-agent set stays fixed to `claude`, `codex`, and `gemini`.
- Codex completed-turn payloads classify conservatively: return `NeedsInput` only when `last_assistant_message` clearly requests user input, otherwise return `Idle`.
- Notification routing, duplicate suppression, snippet reuse, and notification activation all consume the normalized common state after adapter-specific parsing.
- Notification bodies prefer a `Notification Snippet`, but the title and alert routing remain Tide-owned and Pane-based.

### Approach

1. Normalize wrapper-managed signals in Tide entrypoints before any routing or chrome projection reads them.
2. Keep agent-specific parsing in the wrapper adapters or the Codex helper, then collapse results into `Running`, `Idle`, or `NeedsInput`.
3. Route only `NeedsInput` into macOS notification delivery and user-attention requests.
4. Keep `Idle` in the chrome and inactive Workspace projection path so connected agents still show presence without creating alerts.
5. Reuse the existing focus and notification-activation path to clear unresolved `NeedsInput` attention and to recompute affected Workspace chrome.
6. Store and reuse `Notification Snippet` values per source `Pane` so rerouted alerts keep their text without changing the routing rule.
7. Treat direct wrapped-agent `Terminal` identity as the source of routing and activation, and keep `PaneId` uniqueness across Workspaces for notification safety.

## Bounded Contexts

- `app`
- `adapter/inward/cli_adapter`
- `application/services/workspace_infra_service`
- `adapter/outward/view/chrome`
- `adapter/outward/platform_adapter/macos`
- `domain/state/gateway_status`

## Use Cases

### UC-1: NormalizeWrappedAgentLifecycle

- Trigger: a wrapped-agent lifecycle or fallback signal arrives.
- Preconditions: the signal targets an existing wrapped-agent `Pane`.
- Flow: Tide maps the raw signal to `AgentStatus::Running`, `AgentStatus::Idle`, or `AgentStatus::NeedsInput`.
- Postconditions: UI and routing read only the normalized `AgentStatus`.

### UC-2: ClassifyCodexCompletedTurns

- Trigger: the official Codex completed-turn `notify` payload arrives.
- Preconditions: the payload contains `last_assistant_message`.
- Flow: the Codex helper inspects the message text and classifies explicit user-input requests as `NeedsInput`; everything else fails closed to `Idle`.
- Postconditions: Codex never infers alerting state from unsupported hook ordering or unrelated payload fields.

### UC-3: ProjectIdleChrome

- Trigger: a wrapped agent is `Idle` or a connected wrapped-agent `Terminal` has no active lifecycle status.
- Preconditions: the `Pane` remains a wrapped-agent source.
- Flow: Tide updates pane chrome and inactive Workspace chrome from the normalized state.
- Postconditions: the UI can show an idle-presence dot or Workspace projection without creating a macOS notification.

### UC-4: RouteNeedsInputAttention

- Trigger: a wrapped agent reaches `NeedsInput`.
- Preconditions: the `Pane` is not already acknowledged and duplicate suppression does not block delivery.
- Flow: Tide may queue a macOS notification, may request user attention, and may present the alert even when the app is frontmost if the source `Pane` is not the focused `Pane`.
- Postconditions: only `NeedsInput` enters the routed-alert path.

### UC-5: ResolveNeedsInputAttention

- Trigger: the user focuses the source wrapped-agent `Terminal` or activates its delivered notification.
- Preconditions: the source `Pane` still carries unresolved `NeedsInput` attention.
- Flow: Tide clears the unresolved alert, clears duplicate suppression, and recomputes the affected Workspace chrome.
- Postconditions: `Idle` remains a projection state and does not need alert acknowledgment.

### UC-6: ComposeWrappedAgentNotificationBody

- Trigger: Tide routes a `NeedsInput` alert.
- Preconditions: a structured `Notification Snippet` may or may not be available.
- Flow: Tide prefers structured payload text, falls back to the visible `Terminal` grid when needed, and otherwise emits a generic lifecycle body.
- Postconditions: the body is stable across reroutes for the same unresolved alert.

### UC-7: PreservePaneIdIdentityAcrossWorkspaces

- Trigger: a notification activation targets a `Pane`.
- Preconditions: the delivered notification refers to a source `PaneId`.
- Flow: Tide resolves the owning `Workspace`, then focuses the target `Pane`.
- Postconditions: notification activation cannot leak attention across Workspaces through `PaneId` reuse.

## Invariants

- `AgentStatus` is the only lifecycle state UI and routing consume.
- `Running` is visible-only and never queues alert delivery.
- `Idle` may update chrome and inactive Workspace projection, but it never queues macOS notifications or requests user attention.
- `NeedsInput` is the only lifecycle state that may queue macOS notifications or request user attention.
- `Wrapped Agent Presence` is separate from `AgentStatus`; a connected wrapped-agent `Terminal` with no active status may render `ConnectedIdle`.
- Direct focus on the wrapped-agent `Terminal`, or activation of its delivered notification, is the only resolution path for unresolved `NeedsInput` attention.
- `PaneId` values used by routed notifications must remain unique across live and cold-stored Workspaces so activation resolves the correct source `Pane`.
- Duplicate suppression may block repeated `NeedsInput` deliveries until acknowledgment, but it must not broaden the set of routable states.

## Tests

### Module Placement

- `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` owns wrapped-agent lifecycle normalization, Codex classification, alert routing, duplicate suppression, workspace projection, and notification activation.
- `crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs` owns the chrome projection checks for connected idle-presence and inactive Workspace emphasis.
- Existing `agent-idle` notification assertions in the behavior suite are legacy coverage for the current repo state and should be read against the `As-Is` section, not the `To-Be` routing contract.

### Traceability Table

| UC | BR | Status | Test function |
|----|-----|--------|---------------|
| UC-1 | BR-1 | existing | `notify_agent_running_updates_status` |
| UC-1 | BR-1 | existing | `notify_agent_idle_updates_status` |
| UC-1 | BR-1 | existing | `notify_agent_needs_input_updates_status` |
| UC-2 | BR-2 | new | `codex_completed_turn_payload_classifies_idle_or_needs_input` |
| UC-2 | BR-2 | new | `codex_completed_turn_payload_falls_back_to_idle_when_unclassified` |
| UC-3 | BR-3 | existing | `connected_wrapped_agent_without_active_status_renders_idle_presence_dot` |
| UC-3 | BR-3 | existing | `inactive_workspace_agent_status_sets_notification_dot` |
| UC-4 | BR-4 | existing | `needs_input_border_blinks_orange_when_unfocused` |
| UC-4 | BR-4 | new | `background_notification_routes_for_focused_pane_when_window_is_unfocused` |
| UC-4 | BR-4 | new | `window_blur_after_an_unresolved_alert_routes_a_system_notification` |
| UC-5 | BR-5 | existing | `focusing_terminal_clears_wrapped_agent_attention` |
| UC-5 | BR-5 | new | `notification_activation_with_missing_pane_is_no_op` |
| UC-6 | BR-6 | existing | `codex_completed_turn_notification_uses_last_assistant_message_snippet` |
| UC-6 | BR-6 | new | `backgrounded_wrapped_agent_reroute_reuses_the_stored_notification_snippet` |
| UC-7 | BR-7 | existing | `macos_notification_activation_switches_to_target_workspace_and_focuses_target_pane` |
| UC-7 | BR-7 | new | `wrapped_agent_attention_does_not_leak_across_workspaces_after_switching_back` |

### Business Rules

### UC-1: NormalizeWrappedAgentLifecycle

- BR-1: The supported wrapped-agent set is fixed to `claude`, `codex`, and `gemini`.

### UC-2: ClassifyCodexCompletedTurns

- BR-2: The Codex helper must classify `NeedsInput` only when `last_assistant_message` clearly requests user input.
- BR-3: Unrecognized or unclassified Codex completed-turn payloads fail closed to `Idle`.

### UC-3: ProjectIdleChrome

- BR-4: `Idle` may update pane chrome and inactive Workspace projection, but it must not queue macOS notifications or request user attention.

### UC-4: RouteNeedsInputAttention

- BR-5: `NeedsInput` is the only normalized lifecycle state that may queue a macOS notification or request user attention.
- BR-6: Background rerouting, duplicate suppression, and frontmost presentation apply only to unresolved `NeedsInput` attention.
- BR-7: Routed notification activation resolves through the owning `Workspace` and source `Pane`.

### UC-5: ResolveNeedsInputAttention

- BR-8: Focusing the source wrapped-agent `Terminal` or activating its delivered notification clears unresolved `NeedsInput` attention.
- BR-9: Acknowledgment recomputes the affected Workspace chrome after clearing unresolved attention.

### UC-6: ComposeWrappedAgentNotificationBody

- BR-10: Codex notifications must prefer `last_assistant_message` when the payload provides one.
- BR-11: When no structured snippet is available, Tide must fall back to the owning `Terminal`'s visible grid before falling back to generic lifecycle text.

### UC-7: PreservePaneIdIdentityAcrossWorkspaces

- BR-12: Notification activation must resolve the correct owning `Workspace` from the source `PaneId`.
- BR-13: `PaneId` reuse across live or cold-stored Workspaces must not cause a routed notification to target the wrong `Pane`.

## Failure Cases

- Invalid CLI notify event names return an error.
- Missing CLI notify `event` or `pane` parameters return an error.
- Notify against a missing `Pane` is a no-op and does not create agent state.
- Unknown `tide:` OSC 9 payloads are ignored.
- Non-`tide:` OSC 9 payloads are ignored.
- Unmanaged wrapped-agent status messages do not synthesize attention sources.
- Unmanaged notifications do not mark inactive Workspace attention.
- Duplicate `NeedsInput` deliveries are suppressed until acknowledgment.
- Codex completed-turn payloads that do not match a checked-in classifier rule fall back to `Idle`.
- Notification activation that cannot resolve a target `Pane` is a no-op.
- `Idle` never becomes a system-notification trigger.

## Location

| Module | Path | Change |
|--------|------|--------|
| Spec | `docs/specs/agent-notification-routing.md` | Define the contract that only normalized `NeedsInput` states route macOS notifications and user attention |
| App routing | `crates/tide-app/src/app.rs` | Normalize wrapper-managed signals and drive shared alert routing |
| CLI notify | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Validate notify events, classify Codex completed turns, and keep `Idle` as projection only |
| Workspace infra | `crates/tide-app/src/application/services/workspace_infra_service/mod.rs` | Recompute inactive Workspace chrome from unresolved wrapped-agent projection state |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs` | Render inactive Workspace attention from normalized state |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/header.rs` | Render pane chrome from normalized state |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verify lifecycle normalization, `NeedsInput` routing, snippet handling, and notification activation |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs` | Verify idle-presence chrome and inactive Workspace emphasis |
