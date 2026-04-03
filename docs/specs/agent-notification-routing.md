# Spec: Agent Notification Routing

## Overview

### As-Is
When AgentStatus changes (Running/Idle/NeedsInput), the only visual feedback is a colored dot on the pane's tab header. Problems:
- Users may not see the dot when viewing a different pane (buried tab in stacked mode, different workspace)
- When Tide is in the background (unfocused window), there is no way to notice the notification at all
- The urgency difference between NeedsInput and Idle is only conveyed by dot color, which lacks visual distinction

### To-Be
When AgentStatus changes, the notification is routed to the appropriate channel based on the user's current context (where they are looking):

| User Context | NeedsInput | Idle |
|---|---|---|
| Focused on the pane | None | None |
| Foreground + different pane focused | Tab dot (orange) + blink + **border blink** | Tab dot (dim green, static) |
| Different workspace | Workspace sidebar dot + **sidebar blink** | Workspace sidebar dot |
| Background (window unfocused) | macOS notification + dock bounce | macOS notification only |

### Approach
1. Add `is_focused: bool` to `WindowState` — tracked via `PlatformEvent::Focused(bool)` events
2. Add `send_system_notification(title, body)` and `request_user_attention()` methods to `PlatformWindow` trait
3. Add notification routing policy to `handle_terminal_notification` and `cli_notify` handler: determine user context after status change → select channel
4. Add blink animation to tab dot: opacity pulse when NeedsInput + unfocused
5. Show agent notification dot on workspace sidebar items
6. Add `has_agent_notification: bool` to `WorkspaceExtras` to propagate notification state for inactive workspaces

## Bounded Contexts
- **platform** (`adapter/outward/platform_adapter/`) — macOS system notifications, dock bounce
- **gateway** (`domain/state/gateway_status.rs`, `app.rs`) — notification routing policy logic
- **renderer** (`adapter/outward/view/`) — tab dot blink, workspace sidebar dot
- **state** (`domain/state/`) — `WindowState.is_focused`, `WorkspaceExtras.has_agent_notification`

## Use Cases

### UC-1: RouteNotificationByContext
- **Actor**: App (event loop)
- **Trigger**: AgentStatus changes to Idle or NeedsInput (via notify CLI or OSC 9)
- **Precondition**: Status change has been successfully applied
- **Flow**:
  1. Check if the changed pane_id is the currently focused pane (`self.focus.focused == Some(pane_id)`)
  2. If focused → do nothing (user is already looking at it)
  3. If not focused + pane is in the active workspace:
     - NeedsInput → start tab dot blink (record `dot_blink_start` timestamp)
     - Idle → static dot only (existing behavior)
  4. If pane is in an inactive workspace:
     - Set `has_agent_notification = true` on that workspace
  5. If `!window.is_focused` (Tide is in background):
     - Send macOS system notification
     - If NeedsInput, additionally bounce dock icon
- **Postcondition**: Appropriate notification channels activated based on user context
- **Business Rules**:
  - BR-1: Running status changes do not trigger notification routing (task start was just triggered by the user)
  - BR-2: If the pane is focused, all notification channels are skipped
  - BR-3: Background notifications are sent in addition to foreground notifications (tab dot + system notification simultaneously)
  - BR-4: System notifications are not sent again for the same pane until the user acknowledges (focuses) it

### UC-2: TrackWindowFocusState
- **Actor**: Platform (macOS NSWindow)
- **Trigger**: `PlatformEvent::Focused(bool)` received
- **Precondition**: None
- **Flow**:
  1. `PlatformEvent::Focused(true)` → `window.is_focused = true`
  2. `PlatformEvent::Focused(false)` → `window.is_focused = false`
- **Postcondition**: `WindowState.is_focused` reflects actual window focus state
- **Business Rules**:
  - BR-1: Initial value is `true` (window is focused at app startup)

### UC-3: SendSystemNotification
- **Actor**: App (invoked by notification routing policy)
- **Trigger**: Background condition met in UC-1
- **Precondition**: `!window.is_focused`
- **Flow**:
  1. Call `PlatformWindow::send_system_notification(title, body)`
  2. Send system notification via macOS `UNUserNotificationCenter`
  3. title: agent name (e.g. "Claude Code"), body: status message
- **Postcondition**: Banner displayed in macOS Notification Center
- **Business Rules**:
  - BR-1: NeedsInput body: "{agent_name} needs your input"
  - BR-2: Idle body: "{agent_name} finished"
  - BR-3: Silent fail if notification permission is not granted (must not interfere with agent work)
  - BR-4: Uses `UNUserNotificationCenter` `requestAuthorization` → `add` pattern

### UC-4: BounceDockIcon
- **Actor**: App (invoked by notification routing policy)
- **Trigger**: NeedsInput + background condition met in UC-1
- **Precondition**: `!window.is_focused`
- **Flow**:
  1. Call `PlatformWindow::request_user_attention()`
  2. Execute macOS `NSApp.requestUserAttention(.informational)`
- **Postcondition**: Dock icon bounces once
- **Business Rules**:
  - BR-1: Use `.informational` (single bounce) only, never `.critical` (repeated bounce)
  - BR-2: Do not bounce for Idle status

### UC-5: BlinkTabDotAndBorder
- **Actor**: Renderer (view layer)
- **Trigger**: chrome_generation change → tab rendering
- **Precondition**: Pane has an agent with NeedsInput status and the pane is unfocused
- **Flow**:
  1. Apply blink effect when rendering NeedsInput dot
  2. Use `app.interaction.frame_time` (or monotonic clock) to compute opacity
  3. `opacity = 0.5 + 0.5 * sin(time * frequency)` — smooth pulse
  4. Additionally, render the pane's border stroke in orange with the same blink opacity
  5. Request redraw each frame (to sustain the blink animation)
- **Postcondition**: Orange dot AND pane border pulse smoothly
- **Business Rules**:
  - BR-1: Blink period is approximately 1.5 seconds (frequency ≈ 4.2 rad/s)
  - BR-2: Opacity range: 0.3 ~ 1.0 (never fully disappears)
  - BR-3: Running and Idle dots do not blink (static)
  - BR-4: Blink stops when the pane is focused (status cleared to None automatically)
  - BR-5: Continuous redraw is triggered while blink is active (via timer or request_redraw)
  - BR-6: Pane border blinks orange only for NeedsInput + unfocused (same condition as dot blink)
  - BR-7: Border blink uses the same frequency and opacity range as the dot blink

### UC-6: ShowWorkspaceSidebarDot
- **Actor**: Renderer (view layer — titlebar.rs)
- **Trigger**: Workspace sidebar rendering
- **Precondition**: Inactive workspace has `has_agent_notification == true`
- **Flow**:
  1. Check `WorkspaceExtras.has_agent_notification` when rendering workspace items
  2. If `true`, render a small dot to the right of the workspace name with blink animation
  3. Dot color: orange (same as NeedsInput — use highest urgency at workspace level)
  4. Apply same blink animation as UC-5 (opacity pulse, same frequency)
- **Postcondition**: User can identify workspaces with pending notifications in the sidebar — blinking draws attention
- **Business Rules**:
  - BR-1: Do not show sidebar dot for the active workspace (tab dots are already visible)
  - BR-2: Clear `has_agent_notification = false` on the switched-to workspace when switching workspaces
  - BR-3: Set `has_agent_notification` when agent status changes in an inactive workspace
  - BR-4: Workspace sidebar dot blinks with same frequency as tab dot (≈ 4.2 rad/s)

### UC-8: ShowAgentDotInTabGroup
- **Actor**: Renderer (view layer — header.rs render_tab_bar_impl)
- **Trigger**: Tab group rendering (dock tab bar, stage stacked tab bar)
- **Precondition**: A pane in the tab group has an agent with non-None status
- **Flow**:
  1. For each tab in the tab group, check `detected_agents` for agent status
  2. If status is Some, render a 6px dot before the tab label (same as per-pane header)
  3. Apply same color and blink rules as UC-5
- **Postcondition**: Agent status dot visible in tab group tabs, not just per-pane headers
- **Business Rules**:
  - BR-1: Dot color and blink rules identical to UC-5 (Running=green, Idle=green dim, NeedsInput=orange+blink)
  - BR-2: Each tab in the group independently shows its own agent status

### UC-9: RouteNotifyForInactiveWorkspace
- **Actor**: CLI adapter (cli_notify handler)
- **Trigger**: `tide notify` command received for a pane in an inactive workspace
- **Precondition**: Pane exists in one of the cold-stored workspaces
- **Flow**:
  1. Check active workspace panes first (existing `has_pane`)
  2. If not found, search all inactive workspaces for the pane
  3. If found in an inactive workspace, update the agent status in that workspace's pane data
  4. Route notification (sets `has_agent_notification` on the workspace)
- **Postcondition**: Agent notifications are not silently dropped for inactive workspace panes
- **Business Rules**:
  - BR-1: Notifications for panes in any workspace must be processed, not just the active workspace

### UC-7: ClearNotificationOnAcknowledge
- **Actor**: App (focus_nav_service)
- **Trigger**: User focuses the pane
- **Precondition**: Pane has an agent with NeedsInput or Idle status
- **Flow**:
  1. `agent.status = None` (existing behavior — already implemented)
  2. If the pane came from an inactive workspace: clear `has_agent_notification = false` if no other panes in that workspace have pending notifications
  3. System notifications are managed by the OS (dismissed by user or auto-timeout)
- **Postcondition**: Tab dot/blink cleared, sidebar dot conditionally cleared
- **Business Rules**:
  - BR-1: Preserve existing focus-clears-status logic
  - BR-2: `has_agent_notification` is determined by checking all pane agent statuses within the workspace

## Invariants
1. `WindowState.is_focused` is only modified by `PlatformEvent::Focused` events
2. System notification failure must not affect app operation (best-effort)
3. Blink animation is active only for the NeedsInput + unfocused combination
4. Inactive workspace `has_agent_notification` is kept consistent with actual agent statuses of panes within that workspace

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `running_status_does_not_trigger_notification_routing()` |
| UC-1 | BR-2 | `focused_pane_skips_all_notification_channels()` |
| UC-1 | BR-3 | `background_notification_includes_foreground_dot()` |
| UC-1 | BR-4 | `duplicate_system_notification_suppressed_until_acknowledged()` |
| UC-2 | BR-1 | `window_focus_state_tracks_platform_event()` |
| UC-5 | BR-1,2 | `needs_input_dot_blinks_when_unfocused()` |
| UC-5 | BR-3 | `idle_dot_does_not_blink()` |
| UC-5 | BR-6,7 | `needs_input_border_blinks_orange_when_unfocused()` |
| UC-6 | BR-1 | `active_workspace_has_no_sidebar_dot()` |
| UC-6 | BR-2 | `workspace_switch_clears_notification_dot()` |
| UC-6 | BR-3 | `inactive_workspace_agent_status_sets_notification_dot()` |
| UC-6 | BR-4 | `workspace_sidebar_dot_blinks_for_notification()` |
| UC-7 | BR-1 | `focusing_pane_clears_agent_status()` (existing test) |
| UC-7 | BR-2 | `focusing_pane_clears_workspace_notification_if_no_others()` |
| UC-8 | BR-1 | `tab_group_shows_agent_dot_per_tab()` |
| UC-9 | BR-1 | `cli_notify_routes_to_inactive_workspace_pane()` |

## Location

| Module | Path | Change |
|--------|------|--------|
| state | `domain/state/window.rs` | Add `is_focused: bool` field |
| event_loop | `adapter/inward/event_loop_adapter/mod.rs` | Set `window.is_focused` on `Focused` event |
| platform | `adapter/outward/platform_adapter/mod.rs` | Add `send_system_notification`, `request_user_attention` to `PlatformWindow` trait |
| platform_macos | `adapter/outward/platform_adapter/macos/window.rs` | Implement `UNUserNotificationCenter` + `NSApp.requestUserAttention` |
| gateway_port | `application/ports/inward/gateway_port/mod.rs` | Add `route_agent_notification` method |
| app | `app.rs` | Implement notification routing policy in `handle_terminal_notification` and `cli_notify` |
| header | `adapter/outward/view/header.rs` | Add blink animation to NeedsInput dot |
| titlebar | `adapter/outward/view/chrome/titlebar.rs` | Add notification dot to workspace sidebar items |
| workspace_infra | `application/services/workspace_infra_service/mod.rs` | Add `has_agent_notification` to `WorkspaceExtras` |
| workspace_service | `application/services/workspace_service/mod.rs` | Clear `has_agent_notification` on workspace switch |
| behavior_tests | `application/behavior_tests/agent_gateway.rs` | New tests per Tests table |
