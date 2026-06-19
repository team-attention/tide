# Spec: Window Launch

## Overview

### As-Is

- `GlobalAction::NewWindow` currently spawns `std::env::current_exe()` directly from `action_service`, so the action bypasses `ProcessPort` and is not behavior-testable through the outward boundary.
- The source `Info.plist` and `scripts/build-app.sh` currently stamp `LSMultipleInstancesProhibited`, and the macOS startup path checks for an existing Tide app instance before `MacosWindow::new(...)`.
- Tide's macOS platform path currently holds exactly one `MacosWindow` per `Tide Instance`, so `Cmd+N` can only work today by launching another `Tide Instance`.
- macOS notification identifiers already encode the owning `Tide Instance` PID and target `PaneId`, and activation already relays `activate-notification-target` to the owning `Tide Instance`.
- The 0.51.52 launch reveal path calls `makeMainWindow()` before the Tide `Window` is made key/ordered front, and the installed app aborts after AppKit throws from `-[NSWindow _changeJustMain]`.

### To-Be

- `GlobalAction::NewWindow` queues `WindowCommand::CreateWindow` so Tide creates another `Tide Window` inside the current `Tide Instance`.
- `WindowCommand::CreateWindow` carries the triggering `Tide Window` logical size, so `Cmd+N` opens the new `Tide Window` at the same content size as the source `Tide Window`.
- The legacy `SystemProcess::launch_new_tide_window` bundle path is not part of the `Cmd+N` flow.
- The bundled app path must allow multiple Tide instances, and the macOS startup path must create a new Tide `Window` instead of reusing an already-running Tide instance during ordinary launch.
- Ordinary Tide launch must use regular native app activation, and revealing a newly launched Tide `Window` must keep it foreground/frontmost instead of briefly flashing and then falling behind the previously active app.
- The launch reveal path must activate Tide before the final fronting pass, then make/order the Tide `Window` front before explicitly making it the main window.
- Notification activation must continue to encode the owning `Tide Instance` PID plus `TideWindowId` and target `PaneId`, relay to the owning `Tide Instance` when needed, and reveal the owning `Tide Window`.

### Approach

1. Add the `Tide Window` term to the glossary so the contract uses one term for native app windows.
2. Add behavior tests for `GlobalAction::NewWindow` in-process `Tide Window` creation and the bundled launch contract.
3. Route `GlobalAction::NewWindow` through addressed platform commands instead of through `ProcessPort`, and include the source `Tide Window` logical size in the create command.
4. Remove the Launch Services single-instance bundle metadata and the macOS startup reuse path so a new Tide launch can create another Tide `Window`.
5. Keep the existing notification activation relay coverage so a notification still focuses the owning Tide `Window`.

## Bounded Contexts

| Context | Role |
|---------|------|
| `input` | Maps `Cmd+N` to `GlobalAction::NewWindow` |
| `action_service` | Dispatches `GlobalAction::NewWindow` as `WindowCommand::CreateWindow` |
| `platform` | Routes addressed platform commands and owns native `Tide Window` creation |
| `platform` | Builds the app bundle and creates a Tide `Window` on launch |
| `gateway` | Relays notification activation to the owning `Tide Instance` |

## Use Cases

### UC-1: DispatchNewWindowGlobalAction

- **Actor**: User
- **Trigger**: The user presses `Cmd+N`
- **Precondition**: A Tide `Window` is already running
- **Flow**:
  1. Tide resolves `Cmd+N` to `GlobalAction::NewWindow`
  2. `action_service` queues `WindowCommand::CreateWindow` with the triggering `Tide Window` logical size
  3. The main thread creates a new native `Tide Window` in the same `Tide Instance`
- **Postcondition**: Tide creates another `Tide Window` without launching another process
- **Business Rules**:
  - BR-1: `GlobalAction::NewWindow` must queue `WindowCommand::CreateWindow`
  - BR-2: `GlobalAction::NewWindow` must not call `ProcessPort::launch_new_tide_window`
  - BR-10: `WindowCommand::CreateWindow` must carry the triggering `Tide Window` logical size

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
  4. Tide restores the native keyboard/IME target after the owning Tide `Window` is revealed
- **Postcondition**: Notification activation focuses the owning Tide `Window`
- **Business Rules**:
  - BR-6: macOS system notifications must encode the owning `Tide Instance` PID, `TideWindowId`, and target `PaneId`
  - BR-7: A non-owning Tide process must relay notification activation to the owning `Tide Instance` and suppress its own Tide `Window`
  - BR-8: `activate-notification-target` must focus the target `Workspace` and `Pane`, then queue Tide `Window` reveal
  - BR-9: Notification activation reveal must restore the native keyboard/IME target after `show_window()`

### UC-4: RevealLaunchedTideWindowFrontmost

- **Actor**: User
- **Trigger**: The user launches Tide Terminal from Finder, Dock, Spotlight, or CLI
- **Precondition**: Another macOS app is frontmost when Tide orders its launch `Tide Window` front
- **Flow**:
  1. `MacosApp::run` starts Tide with regular native app activation
  2. `MacosWindow::new` avoids alpha-hiding the startup `Tide Window`
  3. `show_window()` activates the running Tide app
  4. `show_window()` performs the final key/order-front calls after app activation
  5. `show_window()` calls `makeMainWindow()` only after the Tide `Window` has been ordered front
- **Postcondition**: The newly revealed Tide `Window` stays frontmost after launch
- **Business Rules**:
  - BR-11: `show_window()` must activate the running Tide app before its final key/main/order-front pass
  - BR-12: ordinary launch must not use `NSApplicationActivationPolicy::Accessory` or alpha hiding in the startup window path
  - BR-13: `show_window()` must order the Tide `Window` front before explicitly calling `makeMainWindow()`

## Invariants

1. `GlobalAction::NewWindow` must request an in-process `Tide Window`.
2. One Tide `Window` is owned by exactly one `Tide Instance`.
3. Notification activation must target the owning `Tide Instance` PID, `TideWindowId`, and `PaneId`.
4. Ordinary Tide launch must not collapse multiple requested Tide `Window`s into one reused instance.

## Tests

| UC | BR | Test function |
|----|----|---------------|
| UC-1 | BR-1, BR-2 | `new_window_global_action_queues_create_window_without_process_launch` |
| UC-1 | BR-2 | `cmd_n_creates_new_tide_window_in_same_process` |
| UC-1 | BR-10 | `cmd_n_create_window_command_uses_source_tide_window_logical_size` |
| UC-2 | BR-3 | `source_tide_info_plist_does_not_prohibit_multiple_instances` |
| UC-2 | BR-4 | `local_bundle_build_script_does_not_stamp_lsmultipleinstancesprohibited_before_signing` |
| UC-2 | BR-5 | `macos_launch_path_does_not_reuse_an_existing_tide_instance_before_creating_a_window` |
| UC-3 | BR-6 | `notification_identifier_round_trips_the_target_pane_id` |
| UC-3 | BR-7 | `macos_notification_activation_relay_suppresses_non_owning_window_after_successful_relay` |
| UC-3 | BR-8 | `activate_notification_target_cli_command_switches_to_target_workspace_and_focuses_the_target_pane` |
| UC-3 | BR-8 | `activate_notification_target_cli_command_queues_window_reveal` |
| UC-3 | BR-9 | `notification_window_reveal_restores_ime_proxy_focus_after_show_window` |
| UC-4 | BR-11, BR-13 | `macos_show_window_orders_front_before_making_window_main_after_app_activation` |
| UC-4 | BR-12 | `macos_launch_path_uses_regular_activation_for_ordinary_launch` |
| UC-4 | BR-12 | `macos_window_construction_does_not_alpha_hide_startup_window` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Glossary | `docs/glossary.md` | Add `Tide Window` |
| Spec | `docs/specs/window-launch.md` | Record Tide multi-window launch and notification focus contract |
| Action dispatch | `crates/tide-app/src/application/services/action_service/mod.rs` | Route `GlobalAction::NewWindow` through `WindowCommand::CreateWindow` |
| Process adapter | `crates/tide-app/src/application/ports/outward/process_port/mod.rs`, `crates/tide-app/src/adapter/outward/process_adapter/mod.rs` | Add Tide-window launch method and bundle-aware implementation |
| Bundle launch | `crates/tide-app/Info.plist`, `scripts/build-app.sh`, `crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs` | Remove single-instance launch behavior |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/{bundle_behavior.rs,window_launch_behavior.rs,wrapped_agent_release_integration.rs}` | Cover `NewWindow`, bundle launch, and notification focus |
| macOS window reveal | `crates/tide-app/src/adapter/outward/platform_adapter/macos/{app.rs,window.rs}` | Keep ordinary launch regular and keep launch-time reveal frontmost by ordering after app activation |
