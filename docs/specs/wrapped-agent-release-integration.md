# Spec: Wrapped Agent Release Integration

## Overview

### As-Is

- `team-attention/tide` `main` is still on `0.51.1`.
- The bundled `Info.plist` still declares `LSRequiresCarbon`, and there is no local `Tide.app` build script that strips the obsolete key before signing.
- The `codex` wrapper only reports `Running` on wrapper start and `Idle` on wrapper exit, so Tide does not receive the Codex `Stop` hook payload.
- Agent attention routing treats `Idle` as a passive green dot and clears both `Idle` and `NeedsInput` when the source `Pane` is focused.
- macOS system notifications do not carry a target `PaneId`, so notification activation cannot reliably focus the owning `Workspace`/`Pane` and may surface an extra Tide Window.

### To-Be

- The local `Tide.app` bundle path omits `LSRequiresCarbon`, and the local bundle build script strips it before signing.
- The `codex` wrapper injects `UserPromptSubmit` and `Stop` hooks through a temporary `CODEX_HOME` overlay and forwards the `Stop` payload through `tide notify --payload-stdin`.
- `Idle` and `NeedsInput` both render unresolved attention chrome when the source `Pane` is unfocused.
- Focusing an `Idle` wrapped-agent `Pane` acknowledges the completion notification but keeps the source `Pane` in connected idle state.
- Focusing a `NeedsInput` wrapped-agent `Pane` does not resolve the attention state; only the next `Running` signal clears it.
- macOS system notifications encode the owning `Tide Instance` and target `PaneId`, and notification activation relays to the owning `Tide Instance` before revealing the correct Tide Window.

### Approach

1. Add glossary terms for `Tide Instance` and `Notification Activation Relay`.
2. Add behavior tests that pin bundle launch compatibility, Codex hook wiring, wrapped-agent attention semantics, and notification activation relay.
3. Port the minimum code needed on top of `team-attention/tide` `main`:
   1. bundle metadata + local build script
   2. Codex hook overlay + notify payload stdin
   3. wrapped-agent attention routing + acknowledgment semantics
   4. macOS notification target encoding + activation relay
4. Verify with targeted behavior tests, `cargo test -p tide-app`, and a local `Tide.app` bundle build.

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
  1. The source `Info.plist` omits obsolete bundle keys that break the native AppKit launch path
  2. The local build script reuses the bundled `Tide.app`, strips obsolete keys, and re-signs the bundle
- **Postcondition**: The local `Tide.app` launches as a native multi-instance bundle
- **Business Rules**:
  - BR-1: The source Tide `Info.plist` must omit `LSRequiresCarbon`
  - BR-2: The local bundle build script must strip `LSRequiresCarbon` before signing
  - BR-3: `MacosApp::run` must defer app activation until explicit window reveal

### UC-2: ReportCodexLifecycleFromHooks

- **Actor**: Wrapped Agent
- **Trigger**: Codex prompt submit or turn stop
- **Precondition**: The `codex` wrapper is running inside Tide
- **Flow**:
  1. The wrapper creates a temporary `CODEX_HOME` overlay
  2. The wrapper injects `UserPromptSubmit` and `Stop` hooks into the overlay
  3. The `Stop` hook forwards its JSON payload through `tide notify --payload-stdin`
- **Postcondition**: Tide receives Codex lifecycle updates from hooks instead of wrapper start/exit heuristics
- **Business Rules**:
  - BR-4: The wrapper must not mutate the user’s real `CODEX_HOME`
  - BR-5: The wrapper must install both `UserPromptSubmit` and `Stop` hooks
  - BR-6: The notify client must accept payload JSON from stdin

### UC-3: PreserveWrappedAgentAttentionUntilAcknowledged

- **Actor**: User
- **Trigger**: A wrapped agent emits `Idle`, `NeedsInput`, or `Running`
- **Precondition**: The source `Pane` belongs to a `Wrapped Agent`
- **Flow**:
  1. `Idle` and `NeedsInput` mark the source `Pane` as unresolved attention when it is unfocused
  2. Focusing the source `Pane` acknowledges `Idle`, turning it into connected idle chrome
  3. Focusing the source `Pane` does not acknowledge `NeedsInput`
  4. The next `Running` signal clears stale notification suppression so future notifications can fire
- **Postcondition**: Completion and true input-needed states remain distinguishable after the user looks at the source `Pane`
- **Business Rules**:
  - BR-7: Unacknowledged `Idle` must render attention chrome
  - BR-8: Acknowledged `Idle` must render connected-idle chrome
  - BR-9: `NeedsInput` must remain attention chrome even when focused
  - BR-10: Focusing a source `Pane` must clear notification suppression without clearing `NeedsInput`
  - BR-11: `Running` must clear stale notification suppression

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
  - BR-15: `show_window()` must own `makeKeyAndOrderFront` plus app activation

## Invariants

1. Wrapped-agent attention must derive from `AgentStatus` updates, not from message text classification.
2. A focused `Pane` may acknowledge `Idle`, but `NeedsInput` must survive focus until the next `Running`.
3. Notification activation must target the owning `Tide Instance` and `PaneId`.
4. The local bundle path must preserve native AppKit launch compatibility.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `source_tide_info_plist_omits_lsrequirescarbon` |
| UC-1 | BR-2 | `local_bundle_build_script_strips_lsrequirescarbon_before_signing` |
| UC-1 | BR-3 | `macos_launch_path_defers_activation_until_window_reveal` |
| UC-2 | BR-4 | `codex_wrapper_uses_a_temporary_codex_home_overlay` |
| UC-2 | BR-5 | `codex_wrapper_installs_user_prompt_submit_and_stop_hooks` |
| UC-2 | BR-6 | `notify_client_accepts_payload_from_stdin` |
| UC-3 | BR-7 | `idle_status_is_attention_orange_until_acknowledged_then_connected_blue` |
| UC-3 | BR-8 | `idle_status_is_attention_orange_until_acknowledged_then_connected_blue` |
| UC-3 | BR-9 | `needs_input_status_stays_attention_orange_when_focused` |
| UC-3 | BR-10 | `focusing_wrapped_agent_pane_clears_notification_suppression_without_clearing_needs_input` |
| UC-3 | BR-11 | `running_status_clears_stale_notification_suppression` |
| UC-4 | BR-12 | `activate_notification_target_cli_command_switches_to_target_workspace_and_focuses_the_target_pane` |
| UC-4 | BR-13 | `activate_notification_target_cli_command_queues_window_reveal` |
| UC-4 | BR-14 | `macos_window_construction_keeps_window_hidden_until_show_window` |
| UC-4 | BR-15 | `macos_show_window_orders_front_and_activates_the_app` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Bundle metadata | `crates/tide-app/Info.plist`, `scripts/build-app.sh` | Remove obsolete bundle key and restore local build script |
| Wrapped-agent wrappers | `crates/tide-app/resources/bin/codex` | Install Codex hook overlay and forward `Stop` payload |
| Notify client | `crates/tide-app/src/adapter/inward/cli_adapter/notify.rs` | Accept `--payload-stdin` |
| CLI adapter | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Decode payloads and support activation relay |
| App routing | `crates/tide-app/src/app.rs` | Preserve idle/needs-input attention semantics and notification suppression behavior |
| Workspace navigation | `crates/tide-app/src/application/services/workspace_service/mod.rs` | Focus notification targets in the owning `Workspace` |
| macOS platform | `crates/tide-app/src/adapter/outward/platform_adapter/macos/{app.rs,window.rs}` | Relay notification activation and defer reveal |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/wrapped_agent_release_integration.rs` | Coverage for release integration regressions |
