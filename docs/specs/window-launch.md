# Spec: Window Launch

## Overview

### As-Is

- `GlobalAction::NewWindow` currently spawns `std::env::current_exe()` directly from `action_service`, so the action bypasses `ProcessPort` and is not behavior-testable through the outward boundary.
- The source `Info.plist` and `scripts/build-app.sh` currently stamp `LSMultipleInstancesProhibited`, and the macOS startup path checks for an existing Tide app instance before `MacosWindow::new(...)`.
- Tide's macOS platform path currently holds exactly one `MacosWindow` per `Tide Instance`, so `Cmd+N` can only work today by launching another `Tide Instance`.
- macOS notification identifiers already encode the owning `Tide Instance` PID and target `PaneId`, and activation already relays `activate-notification-target` to the owning `Tide Instance`.

### To-Be

- `GlobalAction::NewWindow` delegates to `ProcessPort` instead of spawning a process directly.
- `SystemProcess` launches another Tide `Window` by opening the bundled `Tide.app` with `open -n` when the current executable lives inside a bundle, and falls back to spawning the current executable otherwise.
- The bundled app path must allow multiple Tide instances, and the macOS startup path must create a new Tide `Window` instead of reusing an already-running Tide instance during ordinary launch.
- Notification activation must continue to encode the owning `Tide Instance` PID and target `PaneId`, relay to the owning `Tide Instance` when needed, and reveal the owning Tide `Window`.

### Approach

1. Add the `Tide Window` term to the glossary so the contract uses one term for native app windows.
2. Add behavior tests for `GlobalAction::NewWindow` delegation and the bundled multi-window launch contract.
3. Extend `ProcessPort` with a dedicated Tide-window launch method and route `GlobalAction::NewWindow` through it.
4. Remove the Launch Services single-instance bundle metadata and the macOS startup reuse path so a new Tide launch can create another Tide `Window`.
5. Keep the existing notification activation relay coverage so a notification still focuses the owning Tide `Window`.

## Bounded Contexts

| Context | Role |
|---------|------|
| `input` | Maps `Cmd+N` to `GlobalAction::NewWindow` |
| `action_service` | Dispatches `GlobalAction::NewWindow` through an outward port |
| `process_adapter` | Launches another Tide `Window` through the bundle path or current executable |
| `platform` | Builds the app bundle and creates a Tide `Window` on launch |
| `gateway` | Relays notification activation to the owning `Tide Instance` |

## Use Cases

### UC-1: DispatchNewWindowGlobalAction

- **Actor**: User
- **Trigger**: The user presses `Cmd+N`
- **Precondition**: A Tide `Window` is already running
- **Flow**:
  1. Tide resolves `Cmd+N` to `GlobalAction::NewWindow`
  2. `action_service` calls `ProcessPort` to launch another Tide `Window`
  3. The new Tide launch continues through the normal startup path
- **Postcondition**: Tide launches another Tide `Window` without bypassing the outward port boundary
- **Business Rules**:
  - BR-1: `GlobalAction::NewWindow` must delegate to `ProcessPort`
  - BR-2: `SystemProcess` must prefer `open -n <Tide.app>` when the current executable belongs to a bundled Tide app, and otherwise fall back to spawning the current executable

### UC-2: LaunchAnotherBundledTideWindow

- **Actor**: User
- **Trigger**: Tide launches another bundled Tide app instance
- **Precondition**: The local bundle build path produced `Tide.app`
- **Flow**:
  1. The source `Info.plist` omits Launch Services single-instance metadata
  2. `scripts/build-app.sh` leaves the built `Tide.app` multi-instance capable before signing
  3. `MacosApp::run` creates a new Tide `Window` instead of reusing an existing Tide instance during ordinary launch
- **Postcondition**: Launching Tide again creates another Tide `Window`
- **Business Rules**:
  - BR-3: The source Tide `Info.plist` must not declare `LSMultipleInstancesProhibited`
  - BR-4: The local Tide.app build script must not stamp `LSMultipleInstancesProhibited`
  - BR-5: `MacosApp::run` must not reuse an existing Tide instance before creating a Tide `Window`

### UC-3: FocusTheOwningTideWindowFromNotificationActivation

- **Actor**: User
- **Trigger**: The user activates a Tide macOS system notification
- **Precondition**: The target `Pane` belongs to another Tide `Window`
- **Flow**:
  1. Tide resolves the notification identifier into the owning `Tide Instance` PID and target `PaneId`
  2. A non-owning Tide process relays `activate-notification-target` to the owning `Tide Instance`
  3. The owning Tide process focuses the target `Workspace` and `Pane`, then reveals the owning Tide `Window`
- **Postcondition**: Notification activation focuses the owning Tide `Window`
- **Business Rules**:
  - BR-6: macOS system notifications must encode the owning `Tide Instance` PID and target `PaneId`
  - BR-7: A non-owning Tide process must relay notification activation to the owning `Tide Instance` and suppress its own Tide `Window`
  - BR-8: `activate-notification-target` must focus the target `Workspace` and `Pane`, then queue Tide `Window` reveal

## Invariants

1. `GlobalAction::NewWindow` must cross the outward port boundary before any process launch.
2. One Tide `Window` is owned by exactly one `Tide Instance`.
3. Notification activation must target the owning `Tide Instance` PID and `PaneId`.
4. Ordinary Tide launch must not collapse multiple requested Tide `Window`s into one reused instance.

## Tests

| UC | BR | Test function |
|----|----|---------------|
| UC-1 | BR-1 | `new_window_global_action_uses_process_port` |
| UC-1 | BR-2 | `system_process_prefers_open_n_for_bundled_tide_windows` |
| UC-2 | BR-3 | `source_tide_info_plist_does_not_prohibit_multiple_instances` |
| UC-2 | BR-4 | `local_bundle_build_script_does_not_stamp_lsmultipleinstancesprohibited_before_signing` |
| UC-2 | BR-5 | `macos_launch_path_does_not_reuse_an_existing_tide_instance_before_creating_a_window` |
| UC-3 | BR-6 | `notification_identifier_round_trips_the_target_pane_id` |
| UC-3 | BR-7 | `macos_notification_activation_relay_suppresses_non_owning_window_after_successful_relay` |
| UC-3 | BR-8 | `activate_notification_target_cli_command_switches_to_target_workspace_and_focuses_the_target_pane` |
| UC-3 | BR-8 | `activate_notification_target_cli_command_queues_window_reveal` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Glossary | `docs/glossary.md` | Add `Tide Window` |
| Spec | `docs/specs/window-launch.md` | Record Tide multi-window launch and notification focus contract |
| Action dispatch | `crates/tide-app/src/application/services/action_service/mod.rs` | Route `GlobalAction::NewWindow` through `ProcessPort` |
| Process adapter | `crates/tide-app/src/application/ports/outward/process_port/mod.rs`, `crates/tide-app/src/adapter/outward/process_adapter/mod.rs` | Add Tide-window launch method and bundle-aware implementation |
| Bundle launch | `crates/tide-app/Info.plist`, `scripts/build-app.sh`, `crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs` | Remove single-instance launch behavior |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/{bundle_behavior.rs,window_launch_behavior.rs,wrapped_agent_release_integration.rs}` | Cover `NewWindow`, bundle launch, and notification focus |
