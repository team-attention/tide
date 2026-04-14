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
- `Idle` and `NeedsInput` may both queue macOS notifications when the source wrapped-agent `Terminal` is backgrounded.
- `Idle` may update pane chrome and inactive Workspace chrome, but it must not request user attention.
- `NeedsInput` is the strongest routed alert state: it may queue macOS notifications and request user attention.
- `Running` remains visible-only and never routes attention.
- The supported wrapped-agent set stays fixed to `claude`, `codex`, and `gemini`.
- Codex completed-turn payloads classify conservatively: return `NeedsInput` only when `last_assistant_message` clearly requests user input, otherwise return `Idle`.
- Notification routing, duplicate suppression, snippet reuse, and notification activation all consume the normalized common state after adapter-specific parsing.
- Notification bodies prefer a `Notification Snippet`, but the title and alert routing remain Tide-owned and Pane-based.

### Approach

1. Normalize wrapper-managed signals in Tide entrypoints before any routing or chrome projection reads them.
2. Keep agent-specific parsing in the wrapper adapters or the Codex helper, then collapse results into `Running`, `Idle`, or `NeedsInput`.
3. Route backgrounded `Idle` and `NeedsInput` into macOS notification delivery, but reserve `RequestUserAttention` for `NeedsInput`.
4. Keep `Idle` in the chrome and inactive Workspace projection path while also preserving completion notifications for backgrounded wrapped-agent `Terminal`s.
5. Reuse the existing focus and notification-activation path to clear unresolved wrapped-agent attention and to recompute affected Workspace chrome.
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
- Postconditions: the UI can show an idle-presence dot or Workspace projection, and a backgrounded idle source may still route a completion notification.

### UC-4: RouteBackgroundAttention

- Trigger: a wrapped agent reaches `Idle` or `NeedsInput`, or an unresolved wrapped-agent source becomes backgrounded later.
- Preconditions: the `Pane` is not already acknowledged and duplicate suppression does not block delivery.
- Flow: Tide may queue a macOS notification for backgrounded `Idle` or `NeedsInput`, may request user attention only for `NeedsInput`, and may present the alert even when the app is frontmost if the source `Pane` is not the focused `Pane`.
- Postconditions: backgrounded `Idle` and `NeedsInput` enter the routed-alert path, but only `NeedsInput` escalates into user-attention requests.

### UC-5: ResolveBackgroundAttention

- Trigger: the user focuses the source wrapped-agent `Terminal` while Tide is focused, or Tide regains focus with that `Pane` already focused after a routed notification.
- Preconditions: the source `Pane` still carries unresolved wrapped-agent attention.
- Flow: Tide clears duplicate suppression on direct focus, and the focused-window restore path may also acknowledge the unresolved lifecycle state before recomputing the affected Workspace chrome.
- Postconditions: `Idle` and `NeedsInput` both acknowledge through the normal focused-window path.

### UC-6: ComposeWrappedAgentNotificationBody

- Trigger: Tide routes an `Idle` or `NeedsInput` alert.
- Preconditions: a structured `Notification Snippet` may or may not be available.
- Flow: Tide prefers structured payload text, falls back to the visible `Terminal` grid when needed, and otherwise emits a generic lifecycle body.
- Postconditions: the body is stable across reroutes for the same unresolved alert.

### UC-7: PreservePaneIdIdentityAcrossWorkspaces

- Trigger: a notification activation targets a `Pane`.
- Preconditions: the delivered notification refers to a source `PaneId`.
- Flow: Tide resolves the owning `Workspace`, then focuses the target `Pane`.
- Postconditions: notification activation cannot leak attention across Workspaces through `PaneId` reuse, acknowledgment remains the responsibility of the normal focused-window path, and activation itself does not queue a replacement background notification.

## Invariants

- `AgentStatus` is the only lifecycle state UI and routing consume.
- `Running` is visible-only and never queues alert delivery.
- `Idle` may update chrome and inactive Workspace projection, and it may queue a macOS notification when the source wrapped-agent `Terminal` is backgrounded, but it never requests user attention.
- `NeedsInput` may queue macOS notifications and may request user attention.
- `Wrapped Agent Presence` is separate from `AgentStatus`; a connected wrapped-agent `Terminal` with no active status may render `ConnectedIdle`.
- Direct focus on the wrapped-agent `Terminal` clears duplicate suppression, while the focused-window restore path is responsible for acknowledging the unresolved lifecycle state.
- `PaneId` values used by routed notifications must remain unique across live and cold-stored Workspaces so activation resolves the correct source `Pane`.
- Duplicate suppression may block repeated `Idle` or `NeedsInput` deliveries until acknowledgment, but it must not broaden the set of routable states.

## Tests

### Module Placement

- `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` owns wrapped-agent lifecycle normalization, Codex classification, alert routing, duplicate suppression, workspace projection, and notification activation.
- `crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs` owns the chrome projection checks for connected idle-presence and inactive Workspace emphasis.

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
| UC-4 | BR-4 | new | `idle_wrapped_agent_states_queue_notifications_without_user_attention` |
| UC-4 | BR-5 | existing | `background_notification_routes_for_focused_pane_when_window_is_unfocused` |
| UC-4 | BR-5 | existing | `window_blur_after_an_unresolved_alert_routes_a_system_notification` |
| UC-5 | BR-6 | existing | `focusing_terminal_clears_notification_suppression_without_clearing_status` |
| UC-5 | BR-6 | new | `notification_activation_with_missing_pane_is_no_op` |
| UC-5 | BR-6 | existing | `window_focus_acknowledges_attention_for_the_already_focused_pane` |
| UC-6 | BR-7 | existing | `codex_completed_turn_notification_uses_last_assistant_message_snippet` |
| UC-6 | BR-7 | existing | `gemini_after_agent_notification_uses_prompt_response_snippet` |
| UC-6 | BR-7 | existing | `wrapped_agent_notification_falls_back_to_visible_terminal_snippet` |
| UC-6 | BR-7 | existing | `backgrounded_wrapped_agent_reroute_reuses_the_stored_notification_snippet` |
| UC-7 | BR-7 | existing | `macos_notification_activation_switches_to_target_workspace_and_focuses_target_pane` |
| UC-7 | BR-7 | new | `notification_activation_does_not_queue_a_duplicate_background_notification_before_window_focus` |
| UC-7 | BR-7 | new | `wrapped_agent_attention_does_not_leak_across_workspaces_after_switching_back` |

### Business Rules

### UC-1: NormalizeWrappedAgentLifecycle

- BR-1: The supported wrapped-agent set is fixed to `claude`, `codex`, and `gemini`.

### UC-2: ClassifyCodexCompletedTurns

- BR-2: The Codex helper must classify `NeedsInput` only when `last_assistant_message` clearly requests user input.
- BR-3: Unrecognized or unclassified Codex completed-turn payloads fail closed to `Idle`.

### UC-3: ProjectIdleChrome

- BR-4: `Idle` may update pane chrome and inactive Workspace projection, and when backgrounded it may queue macOS notifications, but it must not request user attention.

### UC-4: RouteBackgroundAttention

- BR-5: `Idle` and `NeedsInput` may queue a macOS notification for backgrounded wrapped-agent `Terminal`s, but only `NeedsInput` may request user attention.
- BR-6: Background rerouting, duplicate suppression, and frontmost presentation apply to unresolved `Idle` and `NeedsInput` attention.
- BR-7: Routed notification bodies prefer structured snippets for both `Idle` and `NeedsInput`, then fall back to visible `Terminal` text before generic lifecycle text.

### UC-5: ResolveBackgroundAttention

- BR-8: Focusing the source wrapped-agent `Terminal` in the active Tide window clears duplicate suppression without changing `AgentStatus`.
- BR-9: Restoring Tide window focus to an already-focused source `Pane` acknowledges unresolved attention and recomputes the affected Workspace chrome.

### UC-6: ComposeWrappedAgentNotificationBody

- BR-10: Codex notifications must prefer `last_assistant_message` when the payload provides one.
- BR-11: When no structured snippet is available, Tide must fall back to the owning `Terminal`'s visible grid before falling back to generic lifecycle text.

### UC-7: PreservePaneIdIdentityAcrossWorkspaces

- BR-12: Notification activation must resolve the correct owning `Workspace` from the source `PaneId`.
- BR-13: `PaneId` reuse across live or cold-stored Workspaces must not cause a routed notification to target the wrong `Pane`.
- BR-14: Notification activation focuses the target `Workspace` and source `Pane`, but it does not acknowledge unresolved attention until the focused-window path runs.
- BR-15: Notification activation preserves duplicate suppression until the owning Tide window regains focus, so activation itself must not queue a replacement background notification.

## Failure Cases

- Invalid CLI notify event names return an error.
- Missing CLI notify `event` or `pane` parameters return an error.
- Notify against a missing `Pane` is a no-op and does not create agent state.
- Unknown `tide:` OSC 9 payloads are ignored.
- Non-`tide:` OSC 9 payloads are ignored.
- Unmanaged wrapped-agent status messages do not synthesize attention sources.
- Unmanaged notifications do not mark inactive Workspace attention.
- Duplicate `Idle` or `NeedsInput` deliveries are suppressed until acknowledgment.
- Codex completed-turn payloads that do not match a checked-in classifier rule fall back to `Idle`.
- Notification activation that cannot resolve a target `Pane` is a no-op.
- `Idle` never becomes a `RequestUserAttention` trigger.

## Location

| Module | Path | Change |
|--------|------|--------|
| Spec | `docs/specs/agent-notification-routing.md` | Define the contract that backgrounded `Idle` and `NeedsInput` route macOS notifications, while only `NeedsInput` requests user attention |
| App routing | `crates/tide-app/src/app.rs` | Normalize wrapper-managed signals and drive shared background alert routing |
| CLI notify | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Validate notify events, classify Codex completed turns, and preserve structured snippets for `Idle` and `NeedsInput` |
| Workspace infra | `crates/tide-app/src/application/services/workspace_infra_service/mod.rs` | Recompute inactive Workspace chrome from unresolved wrapped-agent projection state |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs` | Render inactive Workspace attention from normalized state |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/header.rs` | Render pane chrome from normalized state |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verify lifecycle normalization, `NeedsInput` routing, snippet handling, and notification activation |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs` | Verify idle-presence chrome and inactive Workspace emphasis |
