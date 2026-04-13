# Spec: Agent Notification Routing

## Overview

### As-Is

- Tide already normalizes wrapped-agent lifecycle signals into `AgentStatus`.
- `Wrapped Agent Presence` already lets a connected direct wrapped-agent `Terminal` render `ConnectedIdle` when no lifecycle status is active.
- `handle_terminal_notification()` and `cli_notify()` already own the shared normalization path for wrapped-agent lifecycle and OSC 9 fallback messages.
- The notification path already stores a `Notification Snippet` and uses notification activation to jump to the source `Pane`.
- The current contract still needs a clearer split between projected `Idle` state, `Wrapped Agent Completion Notification`, and unresolved user-facing attention.

### To-Be

- `AgentStatus` remains the single lifecycle state UI and routing consume.
- `Idle` may emit a non-alert `Wrapped Agent Completion Notification`, but until the completed turn is explicitly acknowledged it still projects through the orange blinking wrapped-agent attention chrome family.
- `NeedsInput` is the only normalized lifecycle state that may queue macOS notifications or request user attention, but it shares the same unresolved orange blinking chrome family as unacknowledged `Idle`.
- `Running` remains visible-only and never routes attention.
- Codex completion is driven by the documented `Stop` hook and always normalizes to `Idle`.
- Notification routing, duplicate suppression, snippet reuse, and notification activation all consume the normalized common state after adapter-specific parsing.
- Notification bodies prefer a `Notification Snippet`, but the title and alert routing remain Tide-owned and Pane-based.

### Approach

1. Normalize wrapped-agent signals in Tide entrypoints before any routing or chrome projection reads them.
2. Keep agent-specific parsing in the wrapper adapters or the Codex helper, then collapse results into `Running`, `Idle`, or `NeedsInput`.
3. Route `NeedsInput` into macOS alert delivery and user-attention requests.
4. Route `Idle` completion payloads into `Wrapped Agent Completion Notification` delivery without turning them into routed alert attention.
5. Keep unresolved `Idle` and unresolved `NeedsInput` in the shared orange attention chrome path until they hit their distinct resolution rules.
6. Reuse the existing focus and notification-activation path to clear completed-turn `Idle`, clear pending completion notifications for the focused source `Pane`, and recompute affected Workspace chrome.
7. Keep unresolved `NeedsInput` active until the next real input turn reports `Running`.
8. Store and reuse `Notification Snippet` values per source `Pane` so rerouted alerts keep their text without changing the routing rule.
9. Treat direct wrapped-agent `Terminal` identity as the source of routing and activation, and keep `PaneId` uniqueness across Workspaces for notification safety.

## Bounded Contexts

- `app`
- `adapter/inward/cli_adapter`
- `application/services/workspace_infra_service`
- `adapter/outward/view/chrome`
- `adapter/outward/platform_adapter/macos`
- `domain/state/gateway_status`

## Use Cases

### UC-1: NormalizeWrappedAgentLifecycle

- **Trigger**: a wrapped-agent lifecycle or fallback signal arrives.
- **Preconditions**: the signal targets an existing wrapped-agent `Pane`.
- **Flow**: Tide maps the raw signal to `AgentStatus::Running`, `AgentStatus::Idle`, or `AgentStatus::NeedsInput`.
- **Postconditions**: UI and routing read only the normalized `AgentStatus`.

### UC-2: ClassifyCodexCompletedTurns

- **Trigger**: the documented Codex `Stop` hook payload arrives.
- **Preconditions**: the payload may contain `last_assistant_message`.
- **Flow**: the Codex helper extracts a `Notification Snippet` from the `Stop` payload and normalizes the lifecycle state to `Idle`.
- **Postconditions**: Codex completion never infers alerting state from unsupported hook ordering or unrelated payload fields.

### UC-3: RouteWrappedAgentCompletionNotification

- **Trigger**: a wrapped agent reaches `Idle` with a fresh completion payload.
- **Preconditions**: the source `Pane` is wrapper-managed and the payload yields a `Notification Snippet`.
- **Flow**: Tide stores the snippet, suppresses delivery if the source `Pane` is still the current focus, and otherwise queues a non-alert macOS notification for the source `Pane`.
- **Postconditions**: turn completion may surface as a `Wrapped Agent Completion Notification` without creating alert attention.

### UC-4: ProjectIdleChrome

- **Trigger**: a wrapped agent is `Idle` or a connected wrapped-agent `Terminal` has no active lifecycle status.
- **Preconditions**: the `Pane` remains a wrapped-agent source.
- **Flow**: Tide keeps unresolved `Idle` in the orange blinking attention chrome path until acknowledgment, then falls back to `ConnectedIdle` presence once the completed turn is acknowledged.
- **Postconditions**: the UI can distinguish unacknowledged completion from plain connected presence without broadening routed alert delivery.

### UC-5: RouteNeedsInputAttention

- **Trigger**: a wrapped agent reaches `NeedsInput`.
- **Preconditions**: the `Pane` is not already acknowledged and duplicate suppression does not block delivery.
- **Flow**: Tide may queue a macOS notification, may request user attention, and may present the alert even when the app is frontmost if the source `Pane` is not the focused `Pane`.
- **Postconditions**: only `NeedsInput` enters the routed-alert path.

### UC-6: ResolveNeedsInputAttention

- **Trigger**: the user focuses the source wrapped-agent `Terminal`, activates its delivered notification, or submits the next user input turn.
- **Preconditions**: the source `Pane` still carries unresolved wrapped-agent attention.
- **Flow**: Tide clears completed-turn `Idle` on acknowledgment, but it keeps unresolved `NeedsInput` active until the next `Running` signal arrives.
- **Postconditions**: completed turns acknowledge independently from real input-required states.

### UC-7: ComposeWrappedAgentNotificationBody

- **Trigger**: Tide routes either a `Wrapped Agent Completion Notification` or a `NeedsInput` alert.
- **Preconditions**: a structured `Notification Snippet` may or may not be available.
- **Flow**: Tide prefers structured payload text, falls back to the visible `Terminal` grid when needed, and otherwise emits a generic lifecycle body.
- **Postconditions**: the body is stable across reroutes for the same unresolved alert.

### UC-8: PreservePaneIdIdentityAcrossWorkspaces

- **Trigger**: a notification activation targets a `Pane`.
- **Preconditions**: the delivered notification refers to a source `PaneId`.
- **Flow**: Tide resolves the owning `Workspace`, then focuses the target `Pane`.
- **Postconditions**: notification activation cannot leak attention across Workspaces through `PaneId` reuse.

## Invariants

- `AgentStatus` is the only lifecycle state UI and routing consume.
- `Running` is visible-only and never queues alert delivery.
- `Idle` may queue a `Wrapped Agent Completion Notification`, and until acknowledgment it still projects through the orange attention chrome family, but it never requests user attention.
- `NeedsInput` is the only lifecycle state that may queue macOS notifications or request user attention.
- `Wrapped Agent Presence` is separate from `AgentStatus`; a connected wrapped-agent `Terminal` with no active status may render `ConnectedIdle`.
- Direct focus on the wrapped-agent `Terminal`, or activation of its delivered notification, resolves only completed-turn `Idle`; unresolved `NeedsInput` persists until the next `Running` signal.
- `PaneId` values used by routed notifications must remain unique across live and cold-stored Workspaces so activation resolves the correct source `Pane`.
- Duplicate suppression may block repeated `NeedsInput` deliveries until acknowledgment, but it must not broaden the set of routable states.

## Tests

### Module Placement

- `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` owns wrapped-agent lifecycle normalization, Codex classification, alert routing, duplicate suppression, workspace projection, and notification activation.
- `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` also owns `Wrapped Agent Completion Notification` routing for Idle hook payloads.
- `crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs` owns the chrome projection checks for connected idle-presence and inactive Workspace emphasis.
- `needs_input_border_blinks_orange_when_unfocused` is gateway evidence for unresolved `NeedsInput` routing and redraw invalidation while unfocused; the orange blink/color assertions belong in `docs/specs/pane-chrome.md`.
- Existing `agent-idle` notification assertions in the behavior suite are legacy coverage for the current repo state and should be read against the `As-Is` section, not the `To-Be` routing contract.

### Traceability Table

| UC | BR | Status | Test function |
|----|-----|--------|---------------|
| UC-1 | BR-1 | existing | `notify_agent_running_updates_status` |
| UC-1 | BR-1 | existing | `notify_agent_idle_updates_status` |
| UC-1 | BR-1 | existing | `notify_agent_needs_input_updates_status` |
| UC-2 | BR-2 | new | `codex_stop_hook_payload_sets_idle_without_attention` |
| UC-2 | BR-2 | new | `codex_stop_hook_payload_never_maps_to_needs_input` |
| UC-3 | BR-3 | new | `idle_completion_payload_routes_a_background_notification_without_attention` |
| UC-3 | BR-3 | new | `backgrounded_wrapped_agent_completion_reroute_reuses_the_stored_notification_snippet` |
| UC-4 | BR-4 | existing | `connected_wrapped_agent_without_active_status_renders_idle_presence_dot` |
| UC-4 | BR-4 | new | `idle_completion_projects_to_attention_until_acknowledged` |
| UC-5 | BR-5 | existing | `needs_input_border_blinks_orange_when_unfocused` |
| UC-5 | BR-5 | new | `background_notification_routes_for_focused_pane_when_window_is_unfocused` |
| UC-5 | BR-5 | new | `window_blur_after_an_unresolved_alert_routes_a_system_notification` |
| UC-6 | BR-6 | new | `focusing_terminal_acknowledges_idle_completion_but_not_needs_input` |
| UC-6 | BR-6 | new | `notification_activation_with_missing_pane_is_no_op` |
| UC-7 | BR-7 | existing | `codex_stop_hook_completion_notification_uses_last_assistant_message_snippet` |
| UC-7 | BR-7 | new | `backgrounded_wrapped_agent_completion_reroute_reuses_the_stored_notification_snippet` |
| UC-8 | BR-8 | existing | `macos_notification_activation_switches_to_target_workspace_and_focuses_target_pane` |
| UC-8 | BR-8 | new | `wrapped_agent_attention_does_not_leak_across_workspaces_after_switching_back` |

### Business Rules

### UC-1: NormalizeWrappedAgentLifecycle

- BR-1: The supported wrapped-agent set is fixed to `claude`, `codex`, and `gemini`.

### UC-2: ClassifyCodexCompletedTurns

- BR-2: The Codex helper must normalize the documented `Stop` payload to `Idle` and extract a `Notification Snippet` from `last_assistant_message` when present.
- BR-3: Codex completion must never synthesize `NeedsInput`.

### UC-3: RouteWrappedAgentCompletionNotification

- BR-4: `Idle` completion payloads may queue a `Wrapped Agent Completion Notification`, but they must not request user attention or set inactive-`Workspace` alert chrome.

### UC-4: ProjectIdleChrome

- BR-5: Unacknowledged `Idle` uses the same orange attention chrome family as `NeedsInput`, but acknowledged completion falls back to `ConnectedIdle`.

### UC-5: RouteNeedsInputAttention

- BR-6: `NeedsInput` is the only normalized lifecycle state that may queue `RequestUserAttention`.
- BR-7: Background rerouting, duplicate suppression, and frontmost presentation apply only to unresolved `NeedsInput` attention.
- BR-8: Routed notification activation resolves through the owning `Workspace` and source `Pane`.

### UC-6: ResolveNeedsInputAttention

- BR-9: Focusing the source wrapped-agent `Terminal` or activating its delivered notification clears completed-turn `Idle`.
- BR-10: The same acknowledgment path also clears pending `Wrapped Agent Completion Notification` state for the focused source `Pane`.
- BR-11: Unresolved `NeedsInput` survives focus and notification activation until the next `Running` signal arrives.

### UC-7: ComposeWrappedAgentNotificationBody

- BR-12: Codex completion notifications must prefer `last_assistant_message` when the payload provides one.
- BR-13: When no structured snippet is available, Tide must fall back to the owning `Terminal`'s visible grid before falling back to generic lifecycle text.

### UC-8: PreservePaneIdIdentityAcrossWorkspaces

- BR-14: Notification activation must resolve the correct owning `Workspace` from the source `PaneId`.
- BR-15: `PaneId` reuse across live or cold-stored Workspaces must not cause a routed notification to target the wrong `Pane`.

## Failure Cases

- Invalid CLI notify event names return an error.
- Missing CLI notify `event` or `pane` parameters return an error.
- Notify against a missing `Pane` is a no-op and does not create agent state.
- Unknown `tide:` OSC 9 payloads are ignored.
- Non-`tide:` OSC 9 payloads are ignored.
- Unmanaged wrapped-agent status messages do not synthesize attention sources.
- Unmanaged notifications do not mark inactive Workspace attention.
- Duplicate `NeedsInput` deliveries are suppressed until acknowledgment.
- Malformed Codex `Stop` payloads fall back to `Idle`.
- Notification activation that cannot resolve a target `Pane` is a no-op.

## Location

| Module | Path | Change |
|--------|------|--------|
| Spec | `docs/specs/agent-notification-routing.md` | Define the contract that `NeedsInput` drives alert attention while `Idle` completion payloads may drive `Wrapped Agent Completion Notification` |
| App routing | `crates/tide-app/src/app.rs` | Normalize wrapped-agent signals and drive shared alert routing plus completion notification routing |
| CLI notify | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Validate notify events, parse Codex `Stop` payloads, and keep `Idle` separate from alert attention |
| Workspace infra | `crates/tide-app/src/application/services/workspace_infra_service/mod.rs` | Recompute inactive Workspace chrome from unresolved wrapped-agent projection state |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs` | Render inactive Workspace projection from normalized state |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/header.rs` | Render pane chrome from normalized state |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verify lifecycle normalization, completion notification routing, `NeedsInput` routing, snippet handling, and notification activation |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs` | Verify idle-presence chrome and inactive Workspace emphasis |
