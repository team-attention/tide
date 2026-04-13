# Spec: Agent Notification Routing

## Overview

### As-Is

- Tide already stores wrapped-agent lifecycle state in `AgentInfo.status` as `AgentStatus::Running`, `AgentStatus::Idle`, or `AgentStatus::NeedsInput`.
- The fixed wrapped-agent set is already `claude`, `codex`, and `gemini`.
- The checked-in wrappers are agent-specific: Claude maps `Notification`, `Stop`, and `UserPromptSubmit` directly; Gemini maps `BeforeAgent`, `AfterAgent`, and `Notification`; Codex forwards the official completed-turn `notify` payload into Tide's Codex-specific classifier; all three wrappers still use a shell `EXIT` trap as the lifecycle fallback path.
- `handle_terminal_notification()` in `App` is the current Tide entrypoint that normalizes wrapper-managed lifecycle messages and wrapped-agent OSC 9 fallback messages into shared `AgentStatus`.
- `cli_notify()` already validates `event` and `pane`, maps normalized lifecycle events into `AgentStatus`, classifies `codex-turn-complete` into `Idle` or `NeedsInput`, and returns no-op success for panes that do not exist in any Workspace.
- The checked-in Codex notify path already carries `last_assistant_message`, but `route_agent_notification()` still discards that text and always emits generic macOS notification bodies such as `Codex finished`.
- The checked-in Claude and Gemini wrappers currently call `tide notify` with only lifecycle event names, so Tide does not yet receive their hook `stdin` JSON even though those hook contracts already run through structured `stdin`.
- `route_agent_notification()` already treats `Running` as visible-only state, queues background notification commands for `Idle` and `NeedsInput` when the window is unfocused, and requests user attention only for `NeedsInput`.
- `route_agent_notification()` still suppresses macOS notification routing for a wrapped-agent `Pane` when the Tide window is focused, even if the user is looking at another `Pane` in the same Workspace, so a split Stage layout does not notify when an unfocused wrapped-agent `Terminal` finishes or needs input.
- Tide still routes wrapped-agent notifications only at lifecycle-transition time. If an unresolved wrapped-agent `Terminal` becomes backgrounded later because focus moved to another `Pane` or the window blurred, Tide does not currently re-route the existing alert into a system notification.
- `WorkspaceExtras.has_agent_notification` already projects unresolved wrapped-agent attention into inactive Workspace chrome without loading the inactive Workspace into active App fields.
- `notified_panes` already suppresses duplicate background notifications until the pane is acknowledged.
- `activate_notification_target()` already resolves a notification click to the owning Workspace and target Pane, then focuses that Pane.
- Tide's source `crates/tide-app/Info.plist` can declare `LSMultipleInstancesProhibited`, but the checked-in `cargo bundle` output currently drops that key from `Tide.app/Contents/Info.plist`. The macOS startup path also always creates a `MacosWindow` during launch and does not yet check `NSRunningApplication.runningApplicationsWithBundleIdentifier:` before window creation, so a notification click that Launch Services resolves as a fresh Tide launch can surface as a second Tide window instead of reusing the already running app instance.
- `acknowledge_agent_attention()` still clears the associated wrapped-agent `Terminal` when a paired non-terminal `Pane` gets focus, so simply focusing an `Editor` can clear a wrapped-agent alert even though the wrapped-agent `Terminal` itself was never focused.
- `new_workspace()` still seeds a fresh `SplitLayout::with_initial_pane()` root at `PaneId = 1`, and `load_active_workspace()` does not yet rebase the active `SplitLayout` allocator above the rest of the app. Wrapper-managed payloads carry only `pane`, not `Workspace`, so a later Workspace can reuse an earlier `PaneId` and leak wrapped-agent status into the wrong Stage `Terminal` header or Workspace item.
- Tide already queues proactive notification-permission requests on startup when auto-integration is enabled and when the user turns auto-integration on, but the macOS adapter still mixes permission requests into the notification send path and does not yet present routed notifications while Tide is frontmost through `UNUserNotificationCenterDelegate.willPresent`.

### To-Be

- Keep `AgentStatus` as the single agent-agnostic lifecycle state.
- Keep the supported wrapped-agent set fixed to `claude`, `codex`, and `gemini`.
- Normalize every wrapper-managed signal into `Running`, `NeedsInput`, or `Idle` before UI or routing reads it.
- Track `Wrapped Agent Presence` separately from `AgentStatus`, so a connected wrapped-agent `Terminal` can render an idle-presence dot when no lifecycle alert is active.
- Add a Codex-specific Tide-side helper that classifies the official completed-turn payload into `Idle` or `NeedsInput` and fails closed to `Idle` unless the payload clearly indicates user input is required.
- Make UI chrome, inactive Workspace projection, notification routing, and notification activation consume only the normalized common state plus workspace projection flags.
- Queue a macOS notification for wrapper-managed `Idle` and `NeedsInput` whenever the wrapped-agent `Terminal` is not the focused `Pane`, and also whenever the Tide window is unfocused.
- Re-evaluate unresolved wrapped-agent `Idle` and `NeedsInput` attention whenever focus moves away from the source `Terminal` or the window blurs, so existing alert dots still promote into macOS notifications after the alert was first raised in-focus.
- Present routed macOS notifications even while Tide is frontmost when the wrapped-agent `Terminal` is not the focused `Pane`.
- Prefer a structured `Notification Snippet` for the macOS notification body and only fall back to generic lifecycle text when Tide cannot derive a snippet from either a wrapper payload or the owning `Terminal`.
- Use a Tide-owned notification title derived from the source `Pane`, so macOS banners read as `Tide - <Pane title>` instead of surfacing only the wrapped-agent vendor name.
- When wrapped-agent attention resolves, both macOS notification and Tide UI attention should clear through the same focus-and-acknowledgment path.
- Only direct focus on the wrapped-agent `Terminal`, or notification activation that focuses that `Terminal`, may resolve a wrapped-agent alert.
- App-created Workspaces must allocate app-wide unique `PaneId`s for wrapped-agent owner `Terminal`s, and loading a Workspace must rebase its `SplitLayout` allocator above every live and cold-stored `PaneId` before more panes are created there.
- Keep notification-permission prompting on proactive setup paths, using the send path only as a fallback for missed startup or toggle timing.
- Keep notification-permission prompting on proactive setup paths and also queue the same request as a wrapper-lifecycle fallback when auto-integration is active, so Tide does not rely on startup timing alone.
- The bundled Tide app must prohibit multiple instances in Launch Services, and Tide's local bundle build path must stamp that key into the produced `Tide.app` before signing, so notification activation targets the running Tide app instead of launching a second app window.
- The macOS startup path must also guard against a second bundled Tide process at runtime by activating the already running Tide instance before any new `Window` is created.
- Wrapper process exit must be modeled separately from turn-complete `Idle`, so force-ending a Wrapped Agent clears `Wrapped Agent Presence` instead of rendering orange attention.

### Approach

1. Keep wrapper-specific hook/event/payload parsing inside the wrapper adapters or Tide entrypoints that already own those translations.
2. Use the official Codex completed-turn payload as the Codex attention source, and classify it conservatively from `last_assistant_message` with `input_messages` and the other payload fields only as supporting context.
3. Do not infer Codex `NeedsInput` from Claude-style hooks, unsupported `PreToolUse` ordering, or any unverified Codex approval semantics.
4. Keep notification routing keyed by normalized `AgentStatus`, not by agent-specific hook names.
5. Let wrapper launch paths mark `Wrapped Agent Presence` without forcing `Running`.
5. Recompute inactive Workspace attention from unresolved wrapper-managed panes whenever status or acknowledgment changes.
6. Keep notification activation on the existing path that resolves the target Workspace and Pane, then clears the pending attention state.
7. Present foreground notifications through the notification-center delegate instead of suppressing them just because Tide is the active app.
8. Seed every app-created Workspace root `PaneId` from the current app-wide maximum plus one, rather than resetting to `1`.
9. Rebase the loaded `SplitLayout` allocator above the current app-wide maximum before Tide creates or splits more panes in that Workspace.
10. Re-route unresolved wrapped-agent attention whenever a focus change or window-blur transition moves the source `Terminal` into the background.
11. Reuse the existing permission-request command for a wrapper-lifecycle fallback instead of inventing a second notification-permission path.
12. Extend `tide notify` so checked-in wrappers can forward hook `stdin` JSON as payload without shell-side JSON parsing.
13. Derive the `Notification Snippet` from the best available source in order: structured wrapper payload, stored unresolved snippet, then the owning `Terminal`'s visible grid.
14. Keep `LSMultipleInstancesProhibited` in the source `Info.plist`, and add a post-bundle fixup path that stamps the same key into the produced `Tide.app` before signing.
15. Before `MacosWindow::new(...)`, inspect `NSRunningApplication.runningApplicationsWithBundleIdentifier:` for another bundled Tide instance and activate that instance instead of creating a second `Window`.
16. Treat wrapper `EXIT` as `agent-detached`, not `agent-idle`, and clear the wrapped-agent record plus notification state on that event.

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
- Tide stores the normalized `AgentStatus`, wrapper-managed identity, and `gateway_connected` presence signal on the pane record.

### Attention Projections

- Pane chrome reads `AgentStatus` plus `Wrapped Agent Presence`, deriving an `AgentChromeState` for the visible dot.
- Inactive Workspace chrome reads the normalized Workspace projection and renders the Workspace-item indicator defined by `docs/specs/pane-chrome.md`.
- Duplicate notification suppression uses `App.notified_panes`.
- Notification activation resolves through the owning Workspace and target Pane, then clears the pending attention state.
- UI and app routing must not depend on raw agent hook names once the agent-specific adapter has normalized the signal.
- macOS notification bodies prefer a `Notification Snippet`, not a generic lifecycle string, when Tide can derive one from the wrapped-agent source.

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

- Wrapper inputs: launch-time `agent-attached`, `Notification`, `Stop`, and `UserPromptSubmit`.
- Mapping:
  - launch-time `agent-attached` -> `Wrapped Agent Presence` only
  - `UserPromptSubmit` -> `Running`
  - `Stop` -> `Idle`
  - `Notification` -> `NeedsInput`
  - wrapper `EXIT` -> `agent-detached`
- Tide entrypoints:
  - `handle_terminal_notification()`
  - `route_agent_notification()`
  - `acknowledge_agent_attention()`
- Wrapper fallback:
  - OSC 9 fallback uses `tide:wrapped-agent:claude:<event>`.

### Codex

- Wrapper inputs:
  - launch-time `agent-attached`
  - the official completed-turn `notify` payload
  - `UserPromptSubmit`
- Mapping:
  - launch-time `agent-attached` -> `Wrapped Agent Presence` only
  - `UserPromptSubmit` -> `Running`
  - completed-turn payload -> `Idle` or `NeedsInput` via the Codex-specific helper
  - unclassified completed-turn payload -> `Idle`
  - wrapper `EXIT` -> `agent-detached`
- Tide entrypoints:
  - `handle_terminal_notification()` for the common lifecycle sink
  - a Codex-specific payload helper before the common sink
  - `route_agent_notification()`
  - `acknowledge_agent_attention()`
- Wrapper fallback:
  - OSC 9 fallback uses `tide:wrapped-agent:codex:<event>`.

### Gemini

- Wrapper inputs: launch-time `agent-attached`, `BeforeAgent`, `AfterAgent`, and `Notification`.
- Mapping:
  - launch-time `agent-attached` -> `Wrapped Agent Presence` only
  - `BeforeAgent` -> `Running`
  - `AfterAgent` -> `Idle`
  - `Notification` -> `NeedsInput`
  - wrapper `EXIT` -> `agent-detached`
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
- Any state -> detached when the wrapper process exits, clearing `Wrapped Agent Presence`, `AgentStatus`, and unresolved notification state for that `Pane`.
- Unknown or unmanaged payloads leave the current state unchanged.

### Presence Transitions

- A launch-time wrapper-managed `agent-attached` signal marks `Wrapped Agent Presence` without setting `AgentStatus`.
- `Wrapped Agent Presence` stays true while the wrapper-managed agent remains gateway-connected.
- `Wrapped Agent Presence` plus `AgentStatus = None` maps to `AgentChromeState::ConnectedIdle`.
- `agent-detached` clears `Wrapped Agent Presence` immediately, even if the last lifecycle state was `Running`, `Idle`, or `NeedsInput`.

### Routing Rules

- `Running` never queues routed notification attention.
- `Idle` and `NeedsInput` may queue a macOS notification whenever the wrapped-agent `Terminal` is not the focused `Pane`.
- `Idle` and `NeedsInput` also queue a macOS notification whenever the window is unfocused, even if the wrapped-agent `Terminal` is still the internally focused `Pane`.
- `NeedsInput` also requests user attention and marks the UI for redraw.
- Only a focused wrapped-agent `Terminal` inside a focused Tide window suppresses the macOS notification path.
- Routed notifications that fire while Tide is frontmost are presented through the notification-center delegate with banner-capable presentation options.
- Duplicate routing for the same unresolved pane remains suppressed until the pane is acknowledged, but each routed delivery must use a fresh macOS notification request identifier so a newly delivered alert can still present as a banner instead of only replacing an older stack entry.
- Inactive Workspace chrome is recomputed from unresolved wrapper-managed `Idle` and `NeedsInput` panes only.

### Acknowledgment Rules

- Acknowledgment applies only to panes whose wrapped-agent status is `Idle` or `NeedsInput`; `Running` is left intact.
- Focusing the wrapped-agent `Terminal` clears its pending wrapped-agent attention by setting `AgentInfo.status` to `None`.
- Restoring window focus also clears pending wrapped-agent attention when the already-focused `Pane` is the attention source.
- Focusing a paired non-terminal `Pane` does not acknowledge the wrapped-agent `Terminal`.
- Activating a macOS notification routes through the same acknowledgment path as direct focus.
- Acknowledgment clears the pane from `notified_panes`.
- Acknowledgment recomputes the affected Workspace highlight immediately after clearing status and suppression.
- `agent-detached` also clears the pane from `notified_panes` and drops any stored `Notification Snippet`.

### Recompute Triggers

- `route_agent_notification()` refreshes inactive Workspace attention for any wrapper-managed status change that targets a pane outside the active Workspace.
- Focus changes that move attention away from an unresolved wrapped-agent `Terminal` must re-run the same notification-routing rules against existing `Idle` and `NeedsInput` panes.
- Window blur must re-run the same notification-routing rules against existing unresolved wrapped-agent panes, even when no new lifecycle event arrived.
- `acknowledge_agent_attention()` refreshes every Workspace that contained an acknowledged Pane or its associated Terminal.
- `switch_workspace()` refreshes the current Workspace before swapping and refreshes the new active Workspace after loading it.
- `refresh_workspace_agent_notification()` is the single projection function that sets `WorkspaceExtras.has_agent_notification` from unresolved wrapper-managed panes.
- Notification activation uses the existing `activate_notification_target()` path, which can trigger Workspace switching before the focus-based acknowledgment clears attention.

### Notification Snippet Rules

- A `Notification Snippet` is a single-line summary string used as the macOS notification body for wrapped-agent attention.
- The macOS notification title is `Tide - <Pane title>` for the source wrapped-agent `Terminal`.
- Tide stores the most recent unresolved `Notification Snippet` per wrapped-agent source `Pane` so a later re-route can reuse the same body.
- Codex completed-turn payloads provide the structured snippet through `last_assistant_message`.
- Claude `Notification` hook payloads provide the structured snippet through `message`.
- Gemini `Notification` hook payloads provide the structured snippet through `message`, and Gemini `AfterAgent` hook payloads provide it through `prompt_response`.
- When a wrapped-agent payload does not expose response text, Tide falls back to the owning `Terminal`'s visible grid and selects the best available visible response line.
- If Tide cannot derive any snippet, it falls back to the generic lifecycle body.
- Each routed macOS notification request must keep the target `PaneId` recoverable for activation while using a delivery-unique request identifier so repeated alerts from the same `Pane` do not silently replace the previously delivered notification banner.

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

### UC-14: TrackWrappedAgentPresence

- BR-39: Launch-time wrapper integration marks `Wrapped Agent Presence` without forcing `AgentStatus::Running`.
- BR-40: `Wrapped Agent Presence` plus `AgentStatus = None` may render idle-presence chrome, but it must not route notifications.
- BR-42: Wrapper `EXIT` must emit `agent-detached`, and Tide must clear `Wrapped Agent Presence` plus any unresolved alert state for that `Pane`.

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

### UC-9: ReRouteBackgroundedAttention

- BR-28: If a wrapped-agent `Terminal` already has unresolved `Idle` or `NeedsInput` attention and focus moves to another `Pane`, Tide must queue the same macOS notification path immediately unless that pane was already notified.
- BR-29: If a wrapped-agent `Terminal` already has unresolved `Idle` or `NeedsInput` attention and the Tide window blurs, Tide must queue the same macOS notification path immediately unless that pane was already notified.

### UC-10: RequestNotificationPermissionFallback

- BR-30: Startup still proactively queues a notification-permission request when auto-integration is enabled.
- BR-31: Turning auto-integration on still proactively queues a notification-permission request.
- BR-32: The first wrapper-managed lifecycle signal in an auto-integrated session also queues the same notification-permission request as a fallback, without needing a routed alert first.

### UC-11: ComposeWrappedAgentNotificationBody

- BR-33: Codex completed-turn notifications must use a sanitized `last_assistant_message` snippet when the official payload provides one.
- BR-34: Claude `Notification` and Gemini `Notification` or `AfterAgent` notifications must use sanitized structured snippet fields from the forwarded hook payload when those fields are present.
- BR-35: When no structured snippet is available, Tide must fall back to the owning `Terminal`'s visible grid before falling back to a generic lifecycle body.
- BR-36: Re-routing an unresolved wrapped-agent alert must reuse the last stored `Notification Snippet` for that `Pane` when one exists.

### UC-12: PreventSecondLaunchOnNotificationActivation

- BR-37: The source Tide `Info.plist` must declare `LSMultipleInstancesProhibited`.
- BR-38: The local Tide bundle build path must stamp `LSMultipleInstancesProhibited` into `target/release/bundle/osx/Tide.app/Contents/Info.plist` before signing the produced app bundle.
- BR-41: The macOS startup path must check for another running Tide app with the same bundle identifier before creating a `Window`, activate that existing app, and exit the later launch without creating a second `Window`.

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
- A delivered notification created by an older Tide bundle without the updated Launch Services metadata may still follow the older bundle's activation behavior until that notification ages out or is dismissed.

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
| UC-9 | BR-28 | new | `focusing_another_pane_after_an_unresolved_alert_routes_a_system_notification` |
| UC-9 | BR-29 | new | `window_blur_after_an_unresolved_alert_routes_a_system_notification` |
| UC-10 | BR-30 | existing | `auto_integration_bootstrap_requests_notification_permission_when_enabled` |
| UC-10 | BR-31 | existing | `enabling_auto_integration_requests_notification_permission` |
| UC-10 | BR-32 | new | `wrapped_agent_lifecycle_signal_requests_notification_permission_as_a_fallback` |
| UC-11 | BR-33 | new | `codex_completed_turn_notification_uses_last_assistant_message_snippet` |
| UC-11 | BR-34 | new | `gemini_after_agent_notification_uses_prompt_response_snippet` |
| UC-11 | BR-35 | new | `wrapped_agent_notification_falls_back_to_visible_terminal_snippet` |
| UC-11 | BR-36 | new | `backgrounded_wrapped_agent_reroute_reuses_the_stored_notification_snippet` |
| UC-12 | BR-37 | new | `source_tide_info_plist_declares_lsmultipleinstancesprohibited` |
| UC-12 | BR-38 | new | `local_bundle_build_script_stamps_lsmultipleinstancesprohibited_before_signing` |
| UC-12 | BR-41 | new | `macos_launch_path_reuses_an_existing_tide_instance_before_creating_a_window` |
| UC-14 | BR-42 | new | `agent_detached_clears_wrapped_agent_presence_and_attention` |
| UC-12 | BR-38 | new | `local_bundle_build_script_stamps_lsmultipleinstancesprohibited_before_signing` |
| UC-14 | BR-39 | new | `agent_attached_marks_presence_without_running_or_notification_routing` |
| UC-14 | BR-40 | new | `connected_wrapped_agent_without_active_status_renders_idle_presence_dot` |

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
- `focusing_another_pane_after_an_unresolved_alert_routes_a_system_notification`
- `window_blur_after_an_unresolved_alert_routes_a_system_notification`
- `wrapped_agent_lifecycle_signal_requests_notification_permission_as_a_fallback`
- `codex_completed_turn_notification_uses_last_assistant_message_snippet`
- `gemini_after_agent_notification_uses_prompt_response_snippet`
- `wrapped_agent_notification_falls_back_to_visible_terminal_snippet`
- `backgrounded_wrapped_agent_reroute_reuses_the_stored_notification_snippet`
- `source_tide_info_plist_declares_lsmultipleinstancesprohibited`
- `local_bundle_build_script_stamps_lsmultipleinstancesprohibited_before_signing`
- `agent_attached_marks_presence_without_running_or_notification_routing`
- `connected_wrapped_agent_without_active_status_renders_idle_presence_dot`

## Location

| Module | Path | Change |
|--------|------|--------|
| Spec | `docs/specs/agent-notification-routing.md` | Define the redesign contract for normalized wrapped-agent attention |
| Gateway | `crates/tide-app/src/domain/state/gateway_status.rs` | Own the shared `AgentStatus` and wrapped-agent identity model |
| App routing | `crates/tide-app/src/app.rs` | Normalize wrapper-managed signals, route attention, and drive common state |
| Workspace infra | `crates/tide-app/src/application/services/workspace_infra_service/mod.rs` | Recompute inactive Workspace attention from unresolved wrapper-managed panes and preserve app-wide `PaneId` identity across Workspaces |
| Workspace service | `crates/tide-app/src/application/services/workspace_service/mod.rs` | Resolve notification activation to the target Workspace and Pane |
| Platform macOS app | `crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs` | Reuse an already running Tide app before creating a new `Window` during launch |
| Platform macOS | `crates/tide-app/src/adapter/outward/platform_adapter/macos/window.rs` | Emit activation events from macOS notifications |
| CLI notify | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Validate notify events, auto-register wrapper-managed panes, derive structured snippets, and ignore missing panes |
| CLI notify client | `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs` | Forward wrapper hook stdin JSON into Tide notify payloads when a checked-in wrapper requests it |
| Wrapper | `crates/tide-app/resources/bin/claude` | Forward Claude hook stdin JSON for `Notification` and `Stop` lifecycle events |
| Wrapper | `crates/tide-app/resources/bin/gemini` | Forward Gemini hook stdin JSON for `Notification` and `AfterAgent` lifecycle events |
| Bundle metadata | `crates/tide-app/Info.plist` | Prohibit multiple Tide instances so notification activation targets the running app |
| Build tooling | `scripts/build-app.sh` | Stamp single-instance Launch Services metadata into the produced Tide.app before signing |
| Build tooling | `scripts/build-dmg.sh` | Reuse the same Tide.app fixup path before Developer ID signing and DMG creation |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs` | Render inactive Workspace attention from normalized state |
| Chrome renderer | `crates/tide-app/src/adapter/outward/view/header.rs` | Render pane chrome from normalized state |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verify normalized lifecycle routing, suppression, Codex classification, inactive-Workspace recomputation, and notification activation |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/bundle_behavior.rs` | Verify bundled Tide metadata preserves single-instance notification activation |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs` | Verify stronger pane chrome attention and inactive-Workspace visual emphasis |
