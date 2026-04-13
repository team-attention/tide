# Spec: Notification Activation Relay

## Overview

### As-Is

- Tide's macOS notification identifier currently carries only a target `PaneId` plus a delivery sequence.
- `SystemNotificationActivated` currently carries only `pane_id`, so Tide has no `Tide Instance` identity to decide whether the current process owns the target.
- The Agent Gateway has no dedicated command for notification activation; local macOS activation goes through `PlatformEvent::SystemNotificationActivated`, but another `Tide Instance` cannot forward that activation to the owning `Workspace` and `Pane`.
- `MacosWindow::new` currently controls whether the Tide Window is ordered front, and `MacosApp::run` controls app activation, so a non-owning `Tide Instance` can surface a new visible Window before notification activation resolves.

### To-Be

- Every Tide-owned macOS notification target must encode both the owning `Tide Instance` and the source `Pane`.
- A notification response received by the owning `Tide Instance` must focus the owning `Workspace`, focus the source `Pane`, and present the existing Tide Window.
- A notification response received by a non-owning `Tide Instance` must perform `Notification Activation Relay` to the owning `Tide Instance` through the Agent Gateway socket and must not surface a new visible Window from the non-owning instance.
- Tide Window reveal, order-front, and app activation must happen only in the explicit reveal path, not during window construction.

### Approach

1. Add `Tide Instance` and `Notification Activation Relay` to the glossary.
2. Expand the macOS notification target identifier to include the owning `Tide Instance` process ID plus the source `PaneId`.
3. Add an internal Agent Gateway command that activates a notification target by `PaneId`, focuses the owning `Workspace`, and queues Tide Window presentation.
4. Update macOS notification activation handling to relay to the owning `Tide Instance` when the current process does not own the target.
5. Keep a non-owning, unrevealed `Tide Instance` from surfacing a visible Window after a successful relay.
6. Move Tide Window order-front and app activation into the explicit reveal path.

## Bounded Contexts

- `adapter/outward/platform_adapter/macos`
- `adapter/inward/cli_adapter`
- `application/services/workspace_service`
- `application/ports/inward`

## Use Cases

### UC-1: EncodeNotificationTargetWithTideInstance

- **Actor**: Tide
- **Trigger**: Tide queues a macOS notification for a source `Pane`
- **Precondition**: the source `Pane` belongs to the current `Tide Instance`
- **Flow**:
  1. Tide captures the current process ID for the owning `Tide Instance`
  2. Tide builds a notification identifier that includes the owning `Tide Instance`, the source `PaneId`, and a delivery sequence
- **Postcondition**: the delivered notification target is sufficient to resolve the owning `Tide Instance` and source `Pane`

### UC-2: RelayNotificationActivationToOwningTideInstance

- **Actor**: Tide
- **Trigger**: macOS delivers a Tide-owned notification response to a non-owning `Tide Instance`
- **Precondition**: the notification identifier resolves to a different `Tide Instance` than the current process
- **Flow**:
  1. Tide parses the owning `Tide Instance` and source `PaneId` from the notification identifier
  2. Tide connects to `$TMPDIR/tide-<pid>.sock` for the owning `Tide Instance`
  3. Tide sends an internal activation command containing the source `PaneId`
- **Postcondition**: the owning `Tide Instance` receives the activation request without the non-owning instance mutating its own `Workspace`

### UC-3: ActivateNotificationTargetInOwningTideInstance

- **Actor**: Tide
- **Trigger**: a local notification response or relayed activation command targets a source `Pane`
- **Precondition**: the target `PaneId` still exists in a live or cold-stored `Workspace`
- **Flow**:
  1. Tide resolves the owning `Workspace`
  2. Tide focuses the target `Pane`
  3. Tide queues Tide Window presentation for the owning `Tide Instance`
- **Postcondition**: the existing Tide Window is brought forward on the owning `Tide Instance` and the correct `Pane` is focused

### UC-4: SuppressWrongInstanceWindowReveal

- **Actor**: Tide
- **Trigger**: a non-owning `Tide Instance` starts or receives a notification response before its Window is revealed
- **Precondition**: the Tide Window is still unrevealed and the relay to the owning `Tide Instance` succeeds
- **Flow**:
  1. Tide keeps the new Window hidden during construction
  2. Tide relays the activation to the owning `Tide Instance`
  3. Tide terminates the non-owning unrevealed `Tide Instance`
- **Postcondition**: the user does not see an extra Tide Window from the non-owning instance

## Invariants

- A Tide-owned notification identifier must encode both the owning `Tide Instance` and the source `PaneId`.
- `Notification Activation Relay` must target the Agent Gateway socket for the owning `Tide Instance`.
- The internal notification-activation command must reuse Tide's existing `Workspace` resolution by `PaneId`.
- Tide Window order-front and app activation must happen only in the explicit reveal path.
- A successful relay from an unrevealed non-owning `Tide Instance` must not leave a visible Window behind.

## Tests

| UC | BR | Test function |
|----|----|---------------|
| UC-1 | BR-1 | `notification_identifier_round_trips_the_tide_instance_pid_and_target_pane_id` |
| UC-1 | BR-2 | `notification_identifier_is_unique_per_delivery_for_the_same_tide_instance_and_pane` |
| UC-2 | BR-3 | `notification_relay_socket_path_uses_the_target_tide_instance_pid` |
| UC-3 | BR-4 | `activate_notification_target_cli_command_switches_to_the_target_workspace_and_focuses_the_target_terminal` |
| UC-3 | BR-5 | `activate_notification_target_cli_command_queues_window_reveal_for_the_owning_tide_instance` |
| UC-3 | BR-6 | `system_notification_activation_platform_event_brings_the_window_forward` |
| UC-3 | BR-7 | `activate_notification_target_cli_command_with_missing_pane_is_a_no_op` |
| UC-4 | BR-8 | `macos_window_construction_defers_window_order_front_until_show_window` |
| UC-4 | BR-9 | `macos_show_window_orders_front_and_activates_the_app` |
| UC-4 | BR-10 | `macos_app_launch_path_does_not_activate_the_app_before_window_reveal` |

### Business Rules

- BR-1: A Tide-owned notification identifier must round-trip the owning `Tide Instance` PID and the source `PaneId`.
- BR-2: Delivery uniqueness must come from a delivery sequence without changing the encoded owning `Tide Instance` or source `PaneId`.
- BR-3: `Notification Activation Relay` must target `$TMPDIR/tide-<pid>.sock` for the owning `Tide Instance`.
- BR-4: The internal activation command must switch to the owning `Workspace` and focus the target `Pane`.
- BR-5: The internal activation command must queue Tide Window presentation for the owning `Tide Instance`.
- BR-6: The local `SystemNotificationActivated` platform path must bring the Tide Window forward after focusing the target `Pane`.
- BR-7: Missing activation targets are a no-op and must not queue Tide Window presentation.
- BR-8: `MacosWindow::new` must not order the Tide Window front during construction.
- BR-9: `show_window()` must own Tide Window order-front plus app activation.
- BR-10: `MacosApp::run` must not activate the app before the explicit reveal path.

## Location

| Module | Path | Change |
|--------|------|--------|
| Spec | `docs/specs/notification-activation-relay.md` | Define `Tide Instance`-aware notification activation and reveal suppression |
| Glossary | `docs/glossary.md` | Add `Tide Instance` and `Notification Activation Relay` |
| Platform adapter | `crates/tide-app/src/adapter/outward/platform_adapter/macos/window.rs` | Encode Tide-owned notification targets, relay non-owning activations, and defer reveal to `show_window()` |
| Platform adapter | `crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs` | Stop activating the app before explicit reveal |
| CLI adapter | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Add the internal notification-activation command |
| Inward port | `crates/tide-app/src/application/ports/inward/app_core_port/mod.rs` | Add a Tide Window presentation hook for activation relay |
| Workspace service | `crates/tide-app/src/application/services/workspace_service/mod.rs` | Reuse `activate_notification_target` for local and relayed activation |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/notification_activation_relay.rs` | Verify the activation command and reveal contract |
| Unit tests | `crates/tide-app/src/adapter/outward/platform_adapter/macos/window.rs` | Verify notification target encoding and relay socket paths |
