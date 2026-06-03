# Spec: Agent Integration Toggle

## Overview

### As-Is
Agent auto-integration (commit d9be898) injects MCP + hooks into every agent launched in Tide. There is no way to disable this. The titlebar shows a gateway status badge (connected/total ratio) that opens a Gateway modal. The modal's original purposes (agent detection, Enable button, status display) are now handled by auto-wrappers + tab status dots, making it nearly obsolete.

The persisted `auto_integration` setting now exists and defaults to `true`, and Tide already queues proactive macOS notification-permission requests on startup and on toggle-on. The remaining problem is in the macOS adapter path: Tide does not currently read `UNUserNotificationCenter.getNotificationSettings`, so the app cannot tell whether notification authorization is `notDetermined`, `denied`, or `authorized`, and the integration toggle gives the user no visible signal when notification delivery is blocked at the OS level.

### To-Be
- The gateway badge is replaced by a toggle button that enables/disables auto-integration
- The Gateway modal is removed entirely
- When auto-integration is off, wrapper scripts are not injected into PTY PATH, and shell integration is skipped
- The setting persists across sessions via `TideSettings`
- When auto-integration is enabled, Tide proactively requests macOS notification permission before the first wrapped-agent completion needs to notify
- The macOS send path keeps permission request only as a fallback, and frontmost Tide notifications are still presented through the notification-center delegate
- Tide tracks a shared `NotificationAuthorizationStatus` in app state, updates it from the macOS notification center, and reflects it in the integration toggle chrome
- If notification authorization is still unresolved after startup bootstrap, Tide retries the permission request once the window is focused and active instead of assuming the first early request succeeded
- When notification authorization is missing or denied, Tide logs the current status and points the user to `System Settings > Notifications > Tide`

### Approach
1. Add `auto_integration: bool` to `TideSettings` (default `true`)
2. Replace titlebar gateway badge with a toggle button using existing `render_titlebar_btn` pattern
3. Add `HoverTarget::TitlebarIntegration` for hit testing and hover tooltip
4. On click: toggle the flag, persist settings, invalidate chrome
5. In PTY env setup: skip `AGENT_WRAPPER_DIR` PATH prepend and shell integration when `auto_integration == false`
6. Remove Gateway modal and all associated code
7. Add a dedicated platform command for notification permission requests and trigger it when auto-integration boots enabled or is toggled on
8. Move notification presentation policy into the macOS notification-center delegate so Tide-created notifications can still present while the app is frontmost
9. Add a platform event for notification-authorization status changes and update app state from `UNUserNotificationCenter.getNotificationSettings`
10. Reflect the current `NotificationAuthorizationStatus` on the integration toggle chrome instead of leaving the user to guess whether Tide is authorized
11. If the status is still `Unknown` or `NotDetermined` once the Tide window becomes focused, queue another permission request and let the macOS adapter retry while authorization remains unresolved

## Bounded Contexts
- **input** (`domain/input/`) — no changes (no new GlobalAction needed; toggle is mouse-only via titlebar)
- **terminal** (`domain/terminal/`) — conditionally skip PATH/ZDOTDIR injection
- **renderer** (`adapter/outward/view/chrome/`) — replace badge with toggle button
- **gateway** (`application/ports/inward/gateway_port/`) — remove modal-related port methods
- **platform** (`adapter/outward/platform_adapter/macos/`) — query notification authorization status and emit status updates

## Use Cases

### UC-1: ToggleAutoIntegration
- **Actor**: User (mouse click on titlebar toggle button)
- **Trigger**: Click on the auto-integration toggle in titlebar
- **Precondition**: Titlebar is visible (top_inset > 0)
- **Flow**:
  1. Hit test detects click on `TitlebarIntegration` area
  2. Invert `app.settings.auto_integration` flag (via port method)
  3. Persist updated `TideSettings` to disk
  4. Bump `chrome_generation` to trigger re-render
- **Postcondition**: Toggle visually reflects new state; new terminals will use updated PATH
- **Business Rules**:
  - BR-1: Toggle only affects **newly spawned** terminals. Existing terminals keep their current PATH
  - BR-2: Default value is `true` (auto-integration on)
  - BR-3: Setting is persisted to `~/Library/Application Support/tide/settings.json`

### UC-2: ConditionalPATHInjection
- **Actor**: Terminal (PTY spawn)
- **Trigger**: New Terminal pane creation
- **Precondition**: `AGENT_WRAPPER_DIR` is set
- **Flow**:
  1. Check `auto_integration` flag
  2. If `true`: prepend wrapper dir to PATH, set ZDOTDIR for shell integration
  3. If `false`: skip wrapper dir and shell integration; still set TIDE_SOCKET, TIDE_PANE, TIDE_BIN
- **Postcondition**: Terminal PATH includes/excludes wrapper dir based on setting
- **Business Rules**:
  - BR-1: `TIDE_SOCKET`, `TIDE_PANE`, `TIDE_BIN`, `TIDE_WORKSPACE` are always set regardless of toggle (they support manual `tide` CLI usage)
  - BR-2: Only `PATH` prepend and `ZDOTDIR` override are conditional

### UC-3: RenderIntegrationToggle
- **Actor**: Renderer (view layer)
- **Trigger**: chrome_generation change
- **Precondition**: Titlebar is visible
- **Flow**:
  1. Render toggle button at the position previously occupied by gateway badge
  2. Use plug icon (\u{f1e6}) — active color when on, dimmed when off
  3. Show hint text (same style as existing toggle buttons)
- **Postcondition**: User can visually distinguish on/off state
- **Business Rules**:
  - BR-1: Active state: icon uses `dock_tab_underline` color with `badge_bg_unfocused` background
  - BR-2: Inactive state: icon uses `tab_text` color, transparent background
  - BR-3: Hover state: `badge_bg` background regardless of active state

### UC-4: RemoveGatewayModal
- **Actor**: Developer (code removal)
- **Trigger**: This spec
- **Precondition**: Gateway modal code exists
- **Flow**:
  1. Remove `GatewayModalState`, `GatewayButtonAction` from `domain/modal/mod.rs`
  2. Remove `gateway_modal` field from `ModalStack`
  3. Delete `adapter/outward/view/overlays/gateway_modal.rs`
  4. Remove `gateway_toggle_modal()`, `gateway_enable_unconnected_agents()` from `GatewayPort` trait and App impl
  5. Remove all gateway modal checks in keyboard/mouse/text routing adapters
  6. Remove gateway modal render call from overlays
- **Postcondition**: No gateway modal code remains; compile succeeds
- **Business Rules**:
  - BR-1: `GatewayStatus` struct itself is NOT removed — it still tracks detected agents and connected clients for tab dots
  - BR-2: `GatewayPort` trait retains non-modal methods (`gateway_notify`, `gateway_subscribe`, etc.)

### UC-5: RequestNotificationPermissionForAutoIntegration
- **Actor**: Tide app bootstrap or User
- **Trigger**: Tide starts with `auto_integration = true`, or the user toggles auto-integration on
- **Precondition**: Tide is running on macOS and wrapped-agent attention may route through macOS notifications
- **Flow**:
  1. Tide determines whether auto-integration is enabled
  2. Tide queues a platform command dedicated to requesting notification permission
  3. The macOS adapter calls `UNUserNotificationCenter.requestAuthorizationWithOptions` without waiting for a notification send attempt
- **Postcondition**: Notification permission is requested proactively instead of only on first delivery attempt
- **Business Rules**:
  - BR-1: Startup queues the notification-permission request when persisted `auto_integration` is `true`
  - BR-2: Toggling auto-integration from `false` to `true` queues the same notification-permission request
  - BR-3: Toggling auto-integration from `true` to `false` does not queue a notification-permission request
  - BR-4: If notification authorization is still `Unknown` or `NotDetermined` when the Tide window becomes focused, Tide queues another notification-permission request instead of assuming the earlier attempt stuck

### UC-6: TrackNotificationAuthorizationStatus
- **Actor**: Tide app bootstrap or macOS notification center
- **Trigger**: Tide creates the macOS window, requests notification permission, or receives an updated authorization snapshot
- **Precondition**: Tide is running on macOS
- **Flow**:
  1. Tide asks `UNUserNotificationCenter` for the current notification settings
  2. Tide maps the authorization result into `NotificationAuthorizationStatus`
  3. Tide stores the latest status in app state and invalidates chrome
  4. If the status is missing or denied, Tide logs the current state and points the user to `System Settings > Notifications > Tide`
- **Postcondition**: Tide always knows the latest notification-authorization state the OS reported
- **Business Rules**:
  - BR-1: Startup queries the current notification-authorization status without waiting for a wrapped-agent notification send
  - BR-2: `requestAuthorizationWithOptions` is followed by a status refresh so Tide stores the OS result instead of assuming success
  - BR-3: Tide stores `Unknown` when the platform result cannot be classified instead of assuming `Denied` or `Authorized`
  - BR-4: Tide logs a warning when notification authorization is `Denied`

### UC-7: RenderNotificationAuthorizationOnIntegrationToggle
- **Actor**: Renderer
- **Trigger**: Titlebar chrome render
- **Precondition**: Titlebar is visible
- **Flow**:
  1. Tide renders the integration toggle icon
  2. When auto-integration is enabled, Tide overlays a small status indicator derived from `NotificationAuthorizationStatus`
  3. Authorized states use a success indicator, missing authorization uses a warning indicator, and denied authorization uses an error indicator
- **Postcondition**: The integration toggle exposes Tide's notification-authorization state directly in chrome
- **Business Rules**:
  - BR-1: `Authorized`, `Provisional`, and `Ephemeral` render the success indicator
  - BR-2: `NotDetermined` and `Unknown` render the warning indicator
  - BR-3: `Denied` renders the error indicator
  - BR-4: When auto-integration is disabled, the integration toggle does not render a notification-authorization indicator

## Invariants
1. `auto_integration` flag only affects new PTY spawns, never modifies running terminals
2. `GatewayStatus` continues to track agent detection and connection for tab dot rendering
3. Toggle click does not open any modal or popup
4. Notification permission prompting is decoupled from sending a wrapped-agent completion notification
5. `NotificationAuthorizationStatus` is an OS-reported diagnostic state, not a user preference persisted in `TideSettings`

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `toggle_auto_integration_flips_setting()` |
| UC-1 | BR-2 | `auto_integration_defaults_to_true()` |
| UC-2 | BR-1 | `tide_env_vars_set_regardless_of_toggle()` |
| UC-2 | BR-2 | `wrapper_path_skipped_when_integration_off()` |
| UC-4 | BR-1 | `gateway_status_tracks_agents_after_modal_removal()` |
| UC-5 | BR-1 | `auto_integration_bootstrap_requests_notification_permission_when_enabled` |
| UC-5 | BR-2 | `enabling_auto_integration_requests_notification_permission` |
| UC-5 | BR-3 | `disabling_auto_integration_does_not_request_notification_permission` |
| UC-5 | BR-4 | `focusing_the_window_retries_notification_permission_when_authorization_is_unresolved` |
| UC-6 | BR-1 | `notification_authorization_status_event_updates_window_state` |
| UC-6 | BR-2 | `wrapped_agent_lifecycle_signal_requests_notification_permission_as_a_fallback` |
| UC-6 | BR-3 | `unknown_notification_authorization_status_is_preserved` |
| UC-7 | BR-1 | `integration_toggle_notification_indicator_uses_success_for_authorized_states` |
| UC-7 | BR-2 | `integration_toggle_notification_indicator_uses_warning_for_unknown_and_not_determined` |
| UC-7 | BR-3 | `integration_toggle_notification_indicator_uses_error_for_denied_status` |
| UC-7 | BR-4 | `integration_toggle_notification_indicator_hides_when_auto_integration_is_disabled` |

## Location

| Module | Path | Change |
|--------|------|--------|
| settings | `domain/state/settings.rs` | Add `auto_integration` field to `TideSettings` |
| drag_types | `domain/state/drag_types.rs` | Add `TitlebarIntegration` to `HoverTarget` |
| titlebar | `adapter/outward/view/chrome/titlebar.rs` | Replace gateway badge with toggle button |
| hit_test | `adapter/inward/click_adapter/hit_test.rs` | Replace gateway badge hit area with toggle hit area |
| mouse | `adapter/inward/mouse_adapter/mod.rs` | Replace gateway click → toggle click |
| hover | `adapter/outward/view/hover.rs` | Replace gateway tooltip with toggle tooltip |
| gateway_port | `application/ports/inward/gateway_port/mod.rs` | Remove modal methods, add toggle method |
| app | `app.rs` | Remove modal impl, add toggle impl |
| modal | `domain/modal/mod.rs` | Remove `GatewayModalState`, `GatewayButtonAction`, `gateway_modal` field |
| overlays | `adapter/outward/view/overlays/` | Delete `gateway_modal.rs`, remove from mod.rs |
| keyboard | `adapter/inward/keyboard_adapter/mod.rs` | Remove gateway modal Escape handling |
| mouse | `adapter/inward/mouse_adapter/mod.rs` | Remove gateway modal click-outside handling |
| text_routing | `adapter/inward/text_routing_adapter/mod.rs` | Remove gateway modal text check |
| layout_compute | `layout_compute.rs` | Remove gateway_modal check |
| terminal | `domain/terminal/mod.rs` | Conditionally skip PATH/ZDOTDIR injection |
| platform | `adapter/outward/platform_adapter/` | Add proactive notification-permission request command |
| app | `app.rs`, `main.rs` | Queue proactive notification-permission requests on startup and toggle-on |
| window state | `domain/state/window.rs` | Store `NotificationAuthorizationStatus` in app state |
| titlebar | `adapter/outward/view/chrome/titlebar.rs` | Render notification-authorization indicator on the integration toggle |
