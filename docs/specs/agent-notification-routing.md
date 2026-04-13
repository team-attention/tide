# Spec: Agent Notification Routing

## Overview

### As-Is

- Tide already stores wrapped-agent lifecycle state in `AgentInfo.status` as `AgentStatus::Running`, `AgentStatus::Idle`, or `AgentStatus::NeedsInput`.
- The fixed wrapped-agent set is already `claude`, `codex`, and `gemini`.
- The checked-in wrappers are agent-specific: Claude maps `Notification`, `Stop`, and `UserPromptSubmit` directly; Gemini maps `BeforeAgent`, `AfterAgent`, and `Notification`; Codex currently reports `agent-running` on launch, forwards the official completed-turn `notify` payload into Tide's Codex-specific classifier, and keeps an `EXIT` fallback for `agent-idle`, but the checked-in Codex wrapper does not emit `NeedsInput` directly.
- `handle_terminal_notification()` in `App` is the current Tide entrypoint that normalizes wrapper-managed lifecycle messages and wrapped-agent OSC 9 fallback messages into shared `AgentStatus`.
- `cli_notify()` already validates `event` and `pane`, maps normalized lifecycle events into `AgentStatus`, classifies `codex-turn-complete` into `Idle` or `NeedsInput`, and returns no-op success for panes that do not exist in any Workspace.
- `route_agent_notification()` already treats `Running` as visible-only state, queues background notification commands for `Idle` and `NeedsInput` when the window is unfocused, and requests user attention only for `NeedsInput`.
- `route_agent_notification()` still suppresses macOS notification routing for a wrapped-agent `Pane` when the Tide window is focused, even if the user is looking at another `Pane` in the same Workspace, so a split Stage layout does not notify when an unfocused wrapped-agent `Terminal` finishes or needs input.
- `WorkspaceExtras.has_agent_notification` already projects unresolved wrapped-agent attention into inactive Workspace chrome without loading the inactive Workspace into active App fields.
- `notified_panes` already suppresses duplicate background notifications until the pane is acknowledged.
- `activate_notification_target()` already resolves a notification click to the owning Workspace and target Pane, then focuses that Pane.
- `acknowledge_agent_attention()` still clears the associated wrapped-agent `Terminal` when a paired non-terminal `Pane` gets focus, so simply focusing an `Editor` can clear a wrapped-agent alert even though the wrapped-agent `Terminal` itself was never focused.
- `new_workspace()` still seeds a fresh `SplitLayout::with_initial_pane()` root at `PaneId = 1`, and `load_active_workspace()` does not yet rebase the active `SplitLayout` allocator above the rest of the app. Wrapper-managed payloads carry only `pane`, not `Workspace`, so a later Workspace can reuse an earlier `PaneId` and leak wrapped-agent status into the wrong Stage `Terminal` header or Workspace item.
- Tide already queues proactive notification-permission requests on startup when auto-integration is enabled and when the user turns auto-integration on, but the macOS adapter still mixes permission requests into the notification send path and does not yet present routed notifications while Tide is frontmost through `UNUserNotificationCenterDelegate.willPresent`.

### To-Be

- Keep `AgentStatus` as the single agent-agnostic lifecycle state.
- Keep the supported wrapped-agent set fixed to `claude`, `codex`, and `gemini`.
- Normalize every wrapper-managed signal into `Running`, `NeedsInput`, or `Idle` before UI or routing reads it.
- Add a Codex-specific Tide-side helper that classifies the official completed-turn payload into `Idle` or `NeedsInput` and fails closed to `Idle` unless the payload clearly indicates user input is required.
- Make UI chrome, inactive Workspace projection, notification routing, and notification activation consume only the normalized common state plus workspace projection flags.
- Queue a macOS notification for wrapper-managed `Idle` and `NeedsInput` whenever the wrapped-agent `Terminal` is not the focused `Pane`, and also whenever the Tide window is unfocused.
- Present routed macOS notifications even while Tide is frontmost when the wrapped-agent `Terminal` is not the focused `Pane`.
- When wrapped-agent attention resolves, both macOS notification and Tide UI attention should clear through the same focus-and-acknowledgment path.
- Only direct focus on the wrapped-agent `Terminal`, or notification activation that focuses that `Terminal`, may resolve a wrapped-agent alert.
- App-created Workspaces must allocate app-wide unique `PaneId`s for wrapped-agent owner `Terminal`s, and loading a Workspace must rebase its `SplitLayout` allocator above every live and cold-stored `PaneId` before more panes are created there.
- Keep notification-permission prompting on proactive setup paths, using the send path only as a fallback for missed startup or toggle timing.

### Approach

1. Keep wrapper-specific hook/event/payload parsing inside the wrapper adapters or Tide entrypoints that already own those translations.
2. Use the official Codex completed-turn payload as the Codex attention source, and classify it conservatively from `last_assistant_message` with `input_messages` and the other payload fields only as supporting context.
3. Do not infer Codex `NeedsInput` from Claude-style hooks, unsupported `PreToolUse` ordering, or any unverified Codex approval semantics.
4. Keep notification routing keyed by normalized `AgentStatus`, not by agent-specific hook names.
5. Recompute inactive Workspace attention from unresolved wrapper-managed panes whenever status or acknowledgment changes.
6. Keep notification activation on the existing path that resolves the target Workspace and Pane, then clears the pending attention state.
7. Present foreground notifications through the notification-center delegate instead of suppressing them just because Tide is the active app.
8. Seed every app-created Workspace root `PaneId` from the current app-wide maximum plus one, rather than resetting to `1`.
9. Rebase the loaded `SplitLayout` allocator above the current app-wide maximum before Tide creates or splits more panes in that Workspace.

## Concept Model

### Common Lifecycle State

- `AgentStatus` is the common lifecycle state shared by all wrapped agents.
- The canonical values are `Running`, `NeedsInput`, and `Idle`.
- `Running` means the wrapped agent is actively processing a turn and is not routed as attention.
- `Idle` means the wrapped agent finished a turn and may be routed as attention.
- `NeedsInput` means the wrapped agent is blocked on user input and is the strongest attention state.

### Agent Set

- The supported wrapped-agent set for this redesign is fixed to `claude`, `codex`, and `gemini`.
- Agent-specific hooks, events, and payloads stay inside the wrapper adapter for that agent.
- Tide stores only the normalized `AgentStatus` plus wrapper-managed identity on the pane record.

### Attention Projections

- Pane chrome reads `AgentStatus` directly.
- Inactive Workspace chrome reads the normalized Workspace projection and renders the Workspace-item indicator defined by `docs/specs/pane-chrome.md`.
- Duplicate notification suppression uses `App.notified_panes`.
- Notification activation resolves through the owning Workspace and target Pane, then clears the pending attention state.
- UI and app routing must not depend on raw agent hook names once the agent-specific adapter has normalized the signal.

### Codex Classification Model

- Codex uses a dedicated Tide-side helper for the official completed-turn payload.
- The helper recognizes the completed-turn payload as the stable Codex attention source.
- The helper classifies a completed turn as `NeedsInput` only when the rendered `last_assistant_message` text, after trim and lowercase normalization, begins with one of these checked-in explicit user-input request phrases and the phrase is followed only by end-of-message, whitespace, or punctuation:
  - `what would you like me to do next`
  - `what should i do next`
  - `how would you like me to proceed`
  - `please provide`
  - `please answer`
  - `can you clarify`
  - `do you want me to`
  - `would you like me to`
- The helper may consult `input_messages` for context, but `input_messages` alone must not upgrade a turn to `NeedsInput`.
- If the payload is missing, unrecognized, or does not match a checked-in rule, the helper must return `Idle`.
- The helper must not use `Notification`, `PreToolUse`, or unsupported approval ordering to infer `NeedsInput`.

## Adapter Contracts

### Claude

- Wrapper inputs: `Notification`, `Stop`, and `UserPromptSubmit`.
- Mapping:
  - `UserPromptSubmit` -> `Running`
  - `Stop` -> `Idle`
  - `Notification` -> `NeedsInput`
- Tide entrypoints:
  - `handle_terminal_notification()`
  - `route_agent_notification()`
  - `acknowledge_agent_attention()`
- Wrapper fallback:
  - OSC 9 fallback uses `tide:wrapped-agent:claude:<event>`.

### Codex

- Wrapper inputs:
  - launch-time `agent-running`
  - the official completed-turn `notify` payload
  - `UserPromptSubmit`
- Mapping:
  - `UserPromptSubmit` -> `Running`
  - completed-turn payload -> `Idle` or `NeedsInput` via the Codex-specific helper
  - unclassified completed-turn payload -> `Idle`
- Tide entrypoints:
  - `handle_terminal_notification()` for the common lifecycle sink
  - a Codex-specific payload helper before the common sink
  - `route_agent_notification()`
  - `acknowledge_agent_attention()`
- Wrapper fallback:
  - OSC 9 fallback uses `tide:wrapped-agent:codex:<event>`.

### Gemini

- Wrapper inputs: `BeforeAgent`, `AfterAgent`, and `Notification`.
- Mapping:
  - `BeforeAgent` -> `Running`
  - `AfterAgent` -> `Idle`
  - `Notification` -> `NeedsInput`
- Tide entrypoints:
  - `handle_terminal_notification()`
  - `route_agent_notification()`
  - `acknowledge_agent_attention()`
- Wrapper fallback:
  - OSC 9 fallback uses `tide:wrapped-agent:gemini:<event>`.

## State Machine

### Lifecycle Transitions

- `None` -> `Running` on a wrapper-managed launch or prompt-submit signal.
- `Running` -> `Idle` on a completed-turn, stop, or after-agent signal.
- `Running` -> `NeedsInput` on a wrapper-managed input-needed signal or on a Codex completed-turn payload classified as needing input.
- `Idle` -> `Running` on the next prompt-submit signal.
- `NeedsInput` -> `Running` on the next prompt-submit signal.
- `Idle` -> `None` when the pane is acknowledged by focus or notification activation.
- `NeedsInput` -> `None` when the pane is acknowledged by focus or notification activation.
- Unknown or unmanaged payloads leave the current state unchanged.

### Routing Rules

- `Running` never queues routed notification attention.
- `Idle` and `NeedsInput` may queue a macOS notification whenever the wrapped-agent `Terminal` is not the focused `Pane`.
- `Idle` and `NeedsInput` also queue a macOS notification whenever the window is unfocused, even if the wrapped-agent `Terminal` is still the internally focused `Pane`.
- `NeedsInput` also requests user attention and marks the UI for redraw.
- Only a focused wrapped-agent `Terminal` inside a focused Tide window suppresses the macOS notification path.
- Routed notifications that fire while Tide is frontmost are presented through the notification-center delegate with banner-capable presentation options.
- Duplicate system notifications remain suppressed until the pane is acknowledged.
- Inactive Workspace chrome is recomputed from unresolved wrapper-managed `Idle` and `NeedsInput` panes only.

### Acknowledgment Rules

- Acknowledgment applies only to panes whose wrapped-agent status is `Idle` or `NeedsInput`; `Running` is left intact.
- Focusing the wrapped-agent `Terminal` clears its pending wrapped-agent attention by setting `AgentInfo.status` to `None`.
- Restoring window focus also clears pending wrapped-agent attention when the already-focused `Pane` is the attention source.
- Focusing a paired non-terminal `Pane` does not acknowledge the wrapped-agent `Terminal`.
- Activating a macOS notification routes through the same acknowledgment path as direct focus.
- Acknowledgment clears the pane from `notified_panes`.
- Acknowledgment recomputes the affected Workspace highlight immediately after clearing status and suppression.

### Recompute Triggers

- `route_agent_notification()` refreshes inactive Workspace attention for any wrapper-managed status change that targets a pane outside the active Workspace.
- `acknowledge_agent_attention()` refreshes every Workspace that contained an acknowledged Pane or its associated Terminal.
- `switch_workspace()` refreshes the current Workspace before swapping and refreshes the new active Workspace after loading it.
- `refresh_workspace_agent_notification()` is the single projection function that sets `WorkspaceExtras.has_agent_notification` from unresolved wrapper-managed panes.
- Notification activation uses the existing `activate_notification_target()` path, which can trigger Workspace switching before the focus-based acknowledgment clears attention.

### PaneId Identity Rules

- Wrapped-agent routing treats `pane` as the only stable wrapper-managed identity in CLI notify payloads and OSC 9 fallback payloads.
- Because those payloads do not carry `Workspace`, app-created Workspaces must never reuse a live or cold-stored `PaneId`.
- Loading a Workspace must rebase its `SplitLayout` allocator above the highest `PaneId` already present across the active Workspace and every cold-stored Workspace before Tide creates or splits more panes there.
- Moving panes into a different Workspace must leave that Workspace's next allocation above the highest inserted `PaneId` before the Workspace creates more panes.

## Business Rules

### UC-1: NormalizeWrappedAgentLifecycle

- BR-1: The supported wrapped-agent set is fixed to `claude`, `codex`, and `gemini`.
- BR-2: `AgentStatus` is the only lifecycle state UI and routing may consume.
- BR-3: `Running` is visible chrome state only and does not route attention.
- BR-4: `NeedsInput` is the strongest routed attention state.

### UC-2: ClassifyCodexCompletedTurns

- BR-5: Codex completed-turn attention must come from the official `notify` payload, not from Claude-style hooks.
- BR-6: The Codex helper must classify `NeedsInput` only when the rendered `last_assistant_message` text, after trim and lowercase normalization, begins with one of the checked-in explicit input-request phrases at a whitespace-or-punctuation boundary.
- BR-7: Unrecognized or unclassified Codex completed-turn payloads fail closed to `Idle`.
- BR-8: Codex must not infer `NeedsInput` from `PreToolUse`, unsupported approval ordering, or any unverified hook surface.

### UC-3: RouteCommonAttention

- BR-9: `Idle` and `NeedsInput` may queue macOS notification attention when the window is unfocused.
- BR-10: `NeedsInput` also requests user attention and redraw.
- BR-11: A wrapped-agent `Terminal` that is not the focused `Pane` may queue macOS notification attention even while the Tide window is focused.
- BR-12: Window blur still routes the macOS notification path for `Idle` and `NeedsInput`, even when the wrapped-agent `Terminal` is the internally focused `Pane`.
- BR-13: Duplicate notifications remain suppressed until acknowledgment.
- BR-14: Routed notifications still present while Tide is frontmost when the wrapped-agent `Terminal` is not the focused `Pane`.

### UC-4: ProjectInactiveWorkspaceAttention

- BR-15: Inactive Workspace attention is projected from unresolved wrapper-managed Stage `Terminal`s.
- BR-16: Running does not count toward inactive Workspace alert projection.
- BR-17: Workspace attention projection stays unresolved until the same acknowledgment path clears the source `Terminal`; Workspace-item visual treatment is owned by `docs/specs/pane-chrome.md`.

### UC-5: ResolveNotificationActivation

- BR-18: Notification activation resolves the target Workspace before focusing the target `Terminal`.
- BR-19: Notification activation clears the pending attention state through the same acknowledgment path as direct focus.
- BR-20: If the target `Pane` cannot be found, activation is a no-op.

### UC-6: ResolveAttentionOnWindowFocus

- BR-21: Restoring window focus clears unresolved `Idle` or `NeedsInput` attention for the already-focused wrapped-agent `Terminal`.
- BR-22: Restoring window focus also clears duplicate-notification suppression for the acknowledged `Terminal`.

### UC-7: ResolveTerminalOwnedAttention

- BR-23: Only direct focus on the wrapped-agent `Terminal` acknowledges its pending alert.
- BR-24: Focusing a non-terminal `Pane` that has an `Associated Terminal` does not clear the wrapped-agent `Terminal` alert.

### UC-8: PreservePaneIdIdentityAcrossWorkspaces

- BR-25: `new_workspace()` must seed its initial Stage `Terminal` with a `PaneId` higher than every live and cold-stored `PaneId`.
- BR-26: Loading or switching to a Workspace must rebase that `SplitLayout` allocator above every `PaneId` already present in the app before Tide creates or splits more panes there.
- BR-27: Wrapped-agent attention from one Workspace must not project onto a different Workspace's Stage `Terminal` header or Workspace item through `PaneId` reuse.

## Failure Cases

- Invalid CLI notify event names return an error, matching `notify_rejects_unknown_event_type`.
- Missing CLI notify `event` or `pane` parameters return an error, matching `notify_requires_event_param` and `notify_requires_pane_param`.
- Notify against a missing Pane is a no-op and does not create agent state, matching `notify_ignores_nonexistent_pane`.
- Unknown `tide:` OSC 9 payloads are ignored, matching `osc9_unknown_tide_message_ignored`.
- Non-`tide:` OSC 9 payloads are ignored, matching `osc9_non_tide_message_ignored`.
- Unmanaged wrapped-agent status messages do not synthesize attention sources, matching `osc9_unmanaged_notification_does_not_create_attention_source`.
- Unmanaged notifications do not mark inactive Workspace attention, matching `unmanaged_notification_does_not_mark_inactive_workspace`.
- Duplicate background notifications are suppressed until acknowledgment, matching `duplicate_system_notification_suppressed_until_acknowledged`.
- Codex completed-turn payloads that do not match a checked-in classifier rule fall back to `Idle`, matching the Codex helper contract in this spec.
- Notification activation that cannot resolve a target Pane is a no-op, matching `notification_activation_with_missing_pane_is_no_op`.
- Restoring window focus without an already-focused wrapped-agent Pane leaves agent state unchanged; only the focused attention source is acknowledged.
- A session that already contains live duplicate `PaneId`s before this fix remains ambiguous for wrapper-managed notifications, because wrapper payloads only carry `pane`.

## Behavior Test Plan

### Module Placement

- `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` owns wrapped-agent lifecycle normalization, Codex classification, notification routing, duplicate suppression, inactive-Workspace recomputation, and notification activation.
- `crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs` owns pane chrome strength and the inactive-Workspace visual cue.
- New tests should live under `// Spec: docs/specs/agent-notification-routing.md` and use `// --- UC-N: ... ---` markers that match this spec.

### Traceability Table

| UC | BR | Status | Test function |
|----|-----|--------|---------------|
| UC-1 | BR-1 | existing | `wrapper_scripts_are_generated_at_known_path` |
| UC-1 | BR-1 | new | `discover_agent_resources_limits_to_claude_codex_and_gemini` |
| UC-1 | BR-2 | existing | `notify_agent_running_updates_status` |
| UC-1 | BR-2 | existing | `notify_agent_idle_updates_status` |
| UC-1 | BR-2 | existing | `notify_agent_needs_input_updates_status` |
| UC-1 | BR-2 | existing | `osc9_agent_running_updates_status` |
| UC-1 | BR-2 | existing | `osc9_agent_idle_updates_status` |
| UC-1 | BR-2 | existing | `osc9_agent_needs_input_updates_status` |
| UC-1 | BR-3 | existing | `running_status_does_not_trigger_notification_routing` |
| UC-1 | BR-4 | existing | `needs_input_border_blinks_orange_when_unfocused` |
| UC-1 | BR-4 | existing | `needs_input_border_blinks_orange_when_unfocused` |
| UC-2 | BR-5 | existing | `codex_wrapper_injects_tide_mcp_and_turn_complete_notify` |
| UC-2 | BR-6 | new | `codex_completed_turn_payload_classifies_idle_or_needs_input` |
| UC-2 | BR-7 | new | `codex_completed_turn_payload_falls_back_to_idle_when_unclassified` |
| UC-2 | BR-8 | new | `codex_unknown_notify_payload_does_not_map_to_needs_input` |
| UC-3 | BR-9 | existing | `background_notification_includes_foreground_dot` |
| UC-3 | BR-9 | new | `background_notification_routes_for_focused_pane_when_window_is_unfocused` |
| UC-3 | BR-10 | existing | `wrapped_agent_osc9_auto_registers_and_requests_redraw` |
| UC-3 | BR-10 | existing | `needs_input_border_blinks_orange_when_unfocused` |
| UC-3 | BR-11 | existing | `focused_pane_skips_background_notification_while_window_is_focused` |
| UC-3 | BR-14 | new | `foreground_notification_presentation_uses_banner_and_sound` |
| UC-3 | BR-12 | existing | `background_notification_routes_for_focused_pane_when_window_is_unfocused` |
| UC-3 | BR-13 | existing | `duplicate_system_notification_suppressed_until_acknowledged` |
| UC-4 | BR-15 | existing | `inactive_workspace_agent_status_sets_notification_dot` |
| UC-4 | BR-15 | existing | `inactive_workspace_osc9_notification_sets_workspace_dot_without_loading_workspace` |
| UC-4 | BR-16 | existing | `running_status_clears_inactive_workspace_highlight_when_no_pending_attention_remains` |
| UC-4 | BR-17 | existing | `workspace_notification_recomputes_for_remaining_pending_panes` |
| UC-5 | BR-18 | existing | `macos_notification_activation_switches_to_target_workspace_and_focuses_target_pane` |
| UC-5 | BR-19 | existing | `focusing_pane_clears_workspace_notification_if_no_others` |
| UC-5 | BR-20 | new | `notification_activation_with_missing_pane_is_no_op` |
| UC-6 | BR-21 | new | `window_focus_acknowledges_attention_for_the_already_focused_pane` |
| UC-6 | BR-22 | new | `window_focus_acknowledges_attention_for_the_already_focused_pane` |
| UC-7 | BR-23 | existing | `focusing_terminal_clears_wrapped_agent_attention` |
| UC-7 | BR-24 | new | `focusing_associated_pane_does_not_clear_paired_terminal_attention` |
| UC-8 | BR-25 | new | `new_workspace_seeds_a_distinct_root_terminal_pane_id` |
| UC-8 | BR-26 | new | `switching_back_to_an_older_workspace_rebases_future_pane_ids_above_other_workspaces` |
| UC-8 | BR-27 | new | `wrapped_agent_attention_does_not_leak_across_workspaces_after_switching_back` |

### New Tests Needed

- `discover_agent_resources_limits_to_claude_codex_and_gemini`
- `codex_completed_turn_payload_classifies_idle_or_needs_input`
- `codex_completed_turn_payload_falls_back_to_idle_when_unclassified`
- `codex_unknown_notify_payload_does_not_map_to_needs_input`
- `notification_activation_with_missing_pane_is_no_op`
- `window_focus_acknowledges_attention_for_the_already_focused_pane`
- `new_workspace_seeds_a_distinct_root_terminal_pane_id`
- `switching_back_to_an_older_workspace_rebases_future_pane_ids_above_other_workspaces`
- `wrapped_agent_attention_does_not_leak_across_workspaces_after_switching_back`

## Location

| Module | Path | Change |
|--------|------|--------|
| Spec | `docs/specs/agent-notification-routing.md` | Define the redesign contract for normalized wrapped-agent attention |
| Gateway | `crates/tide-app/src/domain/state/gateway_status.rs` | Own the shared `AgentStatus` and wrapped-agent identity model |
| App routing | `crates/tide-app/src/app.rs` | Normalize wrapper-managed signals, route attention, and drive common state |
| Workspace infra | `crates/tide-app/src/application/services/workspace_infra_service/mod.rs` | Recompute inactive Workspace attention from unresolved wrapper-managed panes and preserve app-wide `PaneId` identity across Workspaces |
| Workspace service | `crates/tide-app/src/application/services/workspace_service/mod.rs` | Resolve notification activation to the target Workspace and Pane |
| Platform macOS | `crates/tide-app/src/adapter/outward/platform_adapter/macos/window.rs` | Emit activation events from macOS notifications |
| CLI notify | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Validate notify events, auto-register wrapper-managed panes, and ignore missing panes |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs` | Render inactive Workspace attention from normalized state |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/header.rs` | Render pane chrome from normalized state |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verify normalized lifecycle routing, suppression, Codex classification, inactive-Workspace recomputation, and notification activation |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs` | Verify stronger pane chrome attention and inactive-Workspace visual emphasis |
