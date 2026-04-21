# Spec: Wrapped Agent Release Integration

## Overview

### As-Is

- The source `Info.plist` omits `LSRequiresCarbon`, but the local bundled `Tide.app` can still retain the obsolete key after `cargo bundle`, and `scripts/build-app.sh` currently swallows strip failures before signing.
- The checked-in `codex` wrapper already uses a temporary `CODEX_HOME` overlay, emits `agent-attached` on launch, enables the documented `UserPromptSubmit` hook, but still forwards turn completion through top-level Codex `notify` instead of waiting for the documented `Stop` hook and transcript-based main-thread confirmation.
- The wrapper-hook `notify` client still accepts any gateway socket that receives the request, because wrapped-agent lifecycle payloads do not carry the owning `Tide Instance` identity. A stale or misrouted hook can therefore deliver wrapper-managed notifications into the wrong `Tide Instance` when another instance has the same `PaneId`.
- Shared wrapped-agent routing already treats `Running` as visible-only, routes background macOS notifications for unresolved `Idle` and `NeedsInput`, and reserves `RequestUserAttention` for unresolved `NeedsInput`.
- Focusing a wrapped-agent source `Pane` now acknowledges unresolved wrapped-agent attention immediately in the focused Tide Window, while a later `Running` signal still does not acknowledge the unresolved alert on its own.
- macOS system notifications already encode the owning `Tide Instance` and target `PaneId`, and activation relays to the owning `Tide Instance` before focusing the target `Workspace` and `Pane`, but `show_window()` currently only calls `makeKeyAndOrderFront` and `activateIgnoringOtherApps`, which is not enough to pin Full-Screen Space reveal behavior.
- The non-owning Tide notification-relay path only terminates an unrevealed launcher window today, so an already revealed non-owning Tide Window can stay frontmost after a successful relay and steal focus from the owning `Tide Instance`.
- `MacosApp::run` sets the app activation policy to `Regular` and directly emits the initial `RedrawRequested` before `NSApp.run()` starts. A notification-launched, non-owning `Tide Instance` can therefore show a Dock icon and reveal its own hidden startup window before the notification response delegate relays activation to the owning `Tide Instance`.
- This release-integration spec and its behavior tests still expect the older Codex `Stop` hook contract and a `Running`-clears-suppression rule, so they no longer match the merged code.

### To-Be

- The local `Tide.app` bundle path omits `LSRequiresCarbon`, and the local bundle build script strips it before signing, verifies the key is gone, and fails closed if the obsolete key survives while keeping the bundle multi-instance capable.
- The `codex` wrapper injects the documented `UserPromptSubmit` and `Stop` hooks through a temporary `CODEX_HOME` overlay, uses the `Stop` hook payload and transcript file to finalize main-thread completion, and keeps `agent-attached`/`agent-detached` as the wrapper-owned presence signals.
- Wrapper-managed hook notifications require the owning `TIDE_SOCKET`, and the payload carries the owning `Tide Instance` PID. A gateway must ignore wrapper-managed lifecycle notifications whose owning `Tide Instance` PID does not match the current process.
- `Idle` and `NeedsInput` may still render unresolved attention chrome until the user acknowledges the source `Pane`, and both may route a macOS notification when the source `Pane` is backgrounded.
- Only `NeedsInput` is allowed to request user attention.
- Focusing an `Idle` wrapped-agent `Pane` acknowledges the completion notification and returns the source `Pane` to connected-idle chrome.
- Focusing a `NeedsInput` wrapped-agent `Pane` acknowledges the unresolved alert and clears notification suppression.
- A new `Running` signal does not acknowledge unresolved wrapped-agent attention by itself.
- macOS system notifications encode the owning `Tide Instance` and target `PaneId`, and notification activation relays to the owning `Tide Instance` before revealing the correct Tide Window, including when that Tide Window is in a Full-Screen Space.
- `MacosApp::run` starts without a Dock icon and schedules initial redraw on the run loop, giving notification response delivery a chance to relay before any automatic first-frame reveal.
- A non-owning Tide process that successfully relays notification activation must not leave its own Tide Window frontmost or leave a separate Dock icon visible; revealed non-owning windows hide themselves, and unrevealed relay launches terminate.

### Approach

1. Add glossary terms for `Tide Instance`, `Notification Activation Relay`, `Tide Window`, and `Full-Screen Space`.
2. Keep behavior tests that pin bundle launch compatibility, Codex wrapper wiring, wrapped-agent attention semantics, and notification activation relay.
3. Port the minimum code needed on top of `team-attention/tide` `main`:
   1. bundle metadata + local build script
   2. Codex `CODEX_HOME` overlay + `UserPromptSubmit` hook + `Stop` hook + owning-instance wrapper hook delivery
   3. wrapped-agent attention routing + acknowledgment semantics
   4. macOS notification target encoding + activation relay
4. Align the release-integration spec and behavior tests with the merged wrapper and routing contract.
5. Verify with targeted behavior tests, `cargo test -p tide-app`, and a local `Tide.app` bundle build.

## Bounded Contexts

| Context | Role |
|---------|------|
| `gateway` | Stores wrapped-agent lifecycle state and notification suppression |
| `cli_adapter` | Accepts wrapper hook notifications and payloads |
| `platform` | Builds the bundle, delivers macOS system notifications, and handles activation callbacks |
| `workspace` | Locates the target `Workspace`/`Pane` for notification activation relay |
| `renderer` | Projects wrapped-agent idle vs attention chrome in pane headers |

## Use Cases

### UC-1: BuildLaunchableTideBundle

- **Actor**: Developer
- **Trigger**: Building a local `Tide.app`
- **Precondition**: The repo is on a release branch
- **Flow**:
  1. The source `Info.plist` omits obsolete bundle keys that break the native AppKit launch path and does not prohibit multiple Tide windows
  2. The local build script reuses the bundled `Tide.app`, strips obsolete keys, keeps the bundle multi-instance capable, and re-signs the bundle
  3. The macOS launch path creates a Tide Window instead of reusing another Tide Instance during ordinary launch
- **Postcondition**: The local `Tide.app` can launch another Tide Window while still allowing notification activation to target the owning Tide Instance
- **Business Rules**:
  - BR-1: The source Tide `Info.plist` must omit `LSRequiresCarbon`
  - BR-2: The local bundle build script must strip `LSRequiresCarbon` before signing
  - BR-19: The local bundle build script must fail closed if `LSRequiresCarbon` is still present before signing
  - BR-3: `MacosApp::run` must defer regular app activation until explicit window reveal
  - BR-20: `MacosApp::run` must schedule initial redraw on the run loop instead of directly revealing a startup Tide Window before notification responses can be delivered
  - BR-16: The source Tide `Info.plist` must not declare `LSMultipleInstancesProhibited`
  - BR-17: The local Tide.app build script must not stamp `LSMultipleInstancesProhibited` and must re-sign with the stable Tide bundle identifier
  - BR-18: `MacosApp::run` must not reuse an existing Tide Instance during ordinary launch

### UC-2: ReportCodexLifecycleFromPromptSubmitAndStopHook

- **Actor**: Wrapped Agent
- **Trigger**: Codex prompt submit or `Stop`
- **Precondition**: The `codex` wrapper is running inside Tide
- **Flow**:
  1. The wrapper creates a temporary `CODEX_HOME` overlay
  2. The wrapper injects the documented `UserPromptSubmit` hook into the overlay
  3. The wrapper installs a `Stop` hook command that forwards hook stdin JSON into Tide
  4. Tide resolves the main-thread final assistant response from `transcript_path`
  5. The wrapper keeps `agent-attached` on launch and `agent-detached` on `EXIT`
- **Postcondition**: Tide receives Codex lifecycle updates from `UserPromptSubmit` and the documented `Stop` hook instead of top-level notify timing
- **Business Rules**:
  - BR-4: The wrapper must not mutate the user’s real `CODEX_HOME`
  - BR-5: The wrapper must install `UserPromptSubmit` and `Stop` hook wiring
  - BR-6: The notify client must accept payload JSON from stdin
  - BR-7: Wrapper-hook `notify` must require the owning `TIDE_SOCKET`
  - BR-8: Wrapper-hook `notify` must forward the owning `Tide Instance` PID, and a mismatched gateway must ignore the wrapped-agent lifecycle notification

### UC-3: PreserveWrappedAgentAttentionUntilAcknowledged

- **Actor**: User
- **Trigger**: A wrapped agent emits `Idle`, `NeedsInput`, or `Running`
- **Precondition**: The source `Pane` belongs to a `Wrapped Agent`
- **Flow**:
  1. `Idle` and `NeedsInput` mark the source `Pane` as unresolved attention when it is unfocused
  2. Focusing the source `Pane` acknowledges `Idle`, turning it into connected idle chrome
  3. Focusing the source `Pane` acknowledges unresolved `NeedsInput` in the active Tide Window
  4. The next `Running` signal does not acknowledge the unresolved alert by itself
- **Postcondition**: Completion and true input-needed states remain distinguishable after the user looks at the source `Pane`
- **Business Rules**:
  - BR-7: Unacknowledged `Idle` must render attention chrome
  - BR-8: Acknowledged `Idle` must render connected-idle chrome
  - BR-9: `NeedsInput` must remain attention chrome even when focused
- BR-10: Focusing a source `Pane` in the active Tide Window must acknowledge unresolved attention and clear notification suppression
  - BR-11: `Running` must not clear unresolved notification suppression on its own

### UC-4: RelayNotificationActivationToOwningTideInstance

- **Actor**: User
- **Trigger**: The user activates a Tide macOS system notification
- **Precondition**: A `Wrapped Agent` previously sent a system notification for a source `Pane`
- **Flow**:
  1. Tide encodes the owning `Tide Instance` PID and target `PaneId` into the notification identifier
  2. The activation callback resolves the identifier
  3. If the current process owns the target, it focuses the target `Workspace`/`Pane` and reveals the Tide Window
  4. If the current process does not own the target, it relays `activate-notification-target` to the owning `Tide Instance` over the Agent Gateway socket
- **Postcondition**: Notification activation focuses the existing Tide Window that owns the target `Pane`
- **Business Rules**:
  - BR-12: `activate-notification-target` must switch to the target `Workspace` and focus the target `Pane`
  - BR-13: Notification activation must queue Tide Window reveal for the owning `Tide Instance`
  - BR-14: `MacosWindow::new` must keep the Tide Window hidden until `show_window()`
  - BR-15: `show_window()` must own `makeKeyAndOrderFront`, full-window app activation, and ordering calls strong enough to reveal a Tide Window in a Full-Screen Space
  - BR-19: A non-owning Tide process that successfully relays notification activation must not leave a non-owning Tide Window frontmost or a separate Dock icon visible

## Invariants

1. Wrapped-agent attention must derive from `AgentStatus` updates, not from message text classification.
2. A focused `Pane` in the active Tide Window acknowledges unresolved `Idle` and `NeedsInput`, while a later `Running` signal still does not acknowledge unresolved attention on its own.
3. Notification activation must target the owning `Tide Instance` and `PaneId`.
4. The local bundle path must preserve native AppKit launch compatibility.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `source_tide_info_plist_omits_lsrequirescarbon` |
| UC-1 | BR-2 | `local_bundle_build_script_strips_lsrequirescarbon_before_signing` |
| UC-1 | BR-3 | `macos_launch_path_defers_activation_until_window_reveal` |
| UC-1 | BR-20 | `macos_launch_path_schedules_initial_redraw_on_run_loop` |
| UC-1 | BR-16 | `source_tide_info_plist_does_not_prohibit_multiple_instances` |
| UC-1 | BR-17 | `local_bundle_build_script_does_not_stamp_lsmultipleinstancesprohibited_before_signing` |
| UC-1 | BR-18 | `macos_launch_path_does_not_reuse_an_existing_tide_instance_before_creating_a_window` |
| UC-2 | BR-4 | `codex_wrapper_uses_a_temporary_codex_home_overlay` |
| UC-2 | BR-5 | `codex_wrapper_installs_user_prompt_submit_and_stop_hooks` |
| UC-2 | BR-6 | `notify_client_accepts_payload_from_stdin` |
| UC-2 | BR-7 | `notify_client_requires_an_explicit_tide_socket_for_wrapper_hooks` |
| UC-2 | BR-8 | `terminal_pty_env_exports_the_owning_tide_instance_pid` |
| UC-2 | BR-8 | `notify_client_forwards_the_owning_tide_instance_pid` |
| UC-2 | BR-8 | `notify_for_a_different_tide_instance_is_ignored` |
| UC-3 | BR-7 | `idle_status_is_attention_orange_until_acknowledged_then_connected_blue` |
| UC-3 | BR-8 | `idle_status_is_attention_orange_until_acknowledged_then_connected_blue` |
| UC-3 | BR-9 | `needs_input_status_stays_attention_orange_when_focused` |
| UC-3 | BR-10 | `focusing_wrapped_agent_pane_acknowledges_needs_input_and_clears_notification_suppression` |
| UC-3 | BR-11 | `running_status_does_not_clear_stale_notification_suppression` |
| UC-4 | BR-12 | `activate_notification_target_cli_command_switches_to_target_workspace_and_focuses_the_target_pane` |
| UC-4 | BR-13 | `activate_notification_target_cli_command_queues_window_reveal` |
| UC-4 | BR-14 | `macos_window_construction_keeps_window_hidden_until_show_window` |
| UC-4 | BR-15 | `macos_show_window_orders_front_and_activates_the_app` |
| UC-4 | BR-15 | `macos_show_window_uses_full_window_activation_for_full_screen_space` |
| UC-4 | BR-19 | `macos_notification_activation_relay_suppresses_non_owning_window_after_successful_relay` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Bundle metadata | `crates/tide-app/Info.plist`, `scripts/build-app.sh` | Remove obsolete bundle key and restore local build script |
| Wrapped-agent wrappers | `crates/tide-app/resources/bin/codex` | Install the Codex hook overlay and forward main-thread turn completion through the documented `Stop` hook |
| Notify client | `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs` | Accept `--payload-stdin`, require the owning `TIDE_SOCKET`, and forward the owning `Tide Instance` PID for wrapper-hook delivery |
| CLI adapter | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Decode payloads, ignore mismatched wrapped-agent lifecycle deliveries, and support activation relay |
| App routing | `crates/tide-app/src/app.rs` | Preserve idle/needs-input attention semantics and notification suppression behavior |
| Workspace navigation | `crates/tide-app/src/application/services/workspace_service/mod.rs` | Focus notification targets in the owning `Workspace` |
| macOS platform | `crates/tide-app/src/adapter/outward/platform_adapter/macos/{app.rs,window.rs}` | Relay notification activation and defer reveal |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/{wrapped_agent_release_integration.rs,bundle_behavior.rs}` | Coverage for release integration regressions |
