# Spec: Mistral Vibe Wrapped Agent

## Overview
### As-Is
Terminal wrappers cover Claude, Codex, Antigravity and OpenCode. Vibe has no wrapper or display name.
### To-Be
Launching `vibe` in a Terminal Pane attaches a Mistral Vibe Wrapped Agent and supplies Tide MCP through Vibe configuration.
### Approach
Resolve the real executable outside the wrapper directory, preserve arguments, and inject a per-process MCP environment setting. The installed Vibe schema merges MCP entries by name. Never rewrite user configuration.

## Bounded Contexts
Wrapped Agent presence, Terminal launch environment and Agent Gateway compatibility inventory.

## Use Cases
### UC-1: Launch Vibe
- BR-1: Outside Tide, forward arguments unchanged without injection.
- BR-2: Inside Tide, expose the Tide MCP Runtime with the current Pane identity; preserve existing environment MCP entries.
- BR-3: Notify attachment and detachment, retaining the real exit status.
- BR-4: Show the display name Mistral Vibe and advertise the wrapper in compatibility inventory.

## Invariants
User config and authentication remain provider-owned. No automatic tool approvals. Presence does not imply a running turn.

## Tests
UC-1 BR-1/2/3 → fake CLI wrapper execution with captured arguments/environment/notifications.
UC-1 BR-4 → wrapped_agent_display_name_covers_vibe.

## Location
`resources/bin/vibe`, Wrapped Agent gateway status, compatibility inventory and wrapper tests.

## Verification (2026-09-15)
- Wrapper execution tests pass: arguments, existing MCP entries, quoted socket paths, presence notifications and child exit status.
- `cargo check -p tide-app --tests` passed.
- Native test executable linking is blocked by the local Xcode license requirement. No release binary was produced.
- Wrapper owns Vibe process environment/presence; gateway status owns the display name; compatibility inventory describes available wrappers.

### UC-2: Native Vibe attention
- BR-1: Only an attached, wrapper-managed Mistral Vibe Terminal Pane may turn native OSC title signals into lifecycle events. Ordinary terminals, other agents, and detached panes are ignored.
- BR-2: Vibe 2.25.4 emits `>> <title>` while running, `? <title>` or `<title> - Action Required` while awaiting approval/questions, and `<title> - Task Complete` after a completed turn. Returning from a running title to a plain title also completes a foreground turn. Initial/plain-title renames and waiting-to-plain transitions do not claim completion.
- BR-3: Repeated titles and focus-induced changes between waiting representations must not re-notify; running clears earlier attention through the existing notification route.
- BR-4: Active and inactive Workspace Terminal Panes feed the same existing lifecycle/attention/system-notification route. Acknowledged waiting state stays acknowledged until a new lifecycle transition.
- BR-5: Preserve ordered title transitions within a terminal output batch so a quick running-to-complete turn is not lost. Bound the title queue to 256 entries; the latest title always wins for display.
- BR-6: The wrapper enables native tab-status signaling only in the child process. Do not modify user hooks/config, force approvals, or infer attention from pre_tool or arbitrary terminal text. Native notification preference remains user-owned.

Evidence: installed 2.25.4 `TextualNotificationAdapter` and UI approval/question/finalize call sites. Native hooks expose only pre_tool/post_tool/post_agent, so no notification hook is injected. The adapter is limited to the current native OSC title protocol, and future upstream changes require another compatibility check.

UC-2 tests: lifecycle transition mapping, no initial idle, deduplication, ownership gating, inactive Workspace attention, detach, and ordered title draining; wrapper environment isolation.

### UC-2 validation (2026-09-15)
- Wrapper behavior test passes, including process-local tab-status configuration and outside-Tide passthrough.
- `cargo check -p tide-app --tests` passes; architecture lint passes.
- Added ownership, inactive Workspace, acknowledgment/deduplication, ordered-title and bounded-queue tests. Executing native Rust tests is blocked at linking by the local Xcode license requirement; native UI behavior remains unverified.

### Validation after Xcode license acceptance (2026-09-15)
- Vibe lifecycle tests: 3 passed. Ordered-title and bounded-queue tests: 2 passed in the full suite. Wrapper behavior test and architecture lint passed.
- Tide app test suite: 1606 passed, 1 failed, 2 ignored. `observing_terminal_reports_live_work_surface` fails its expected screen-content assertion, also when run individually outside the sandbox. Full workspace testing therefore did not complete successfully.
- Strict Clippy is blocked by `clippy::derivable_impls` in `crates/alacritty_terminal/src/event_loop.rs:431`.
- Release app bundle built successfully through `scripts/build-app.sh`; strict deep code-signature verification passed. Output: `target/release/bundle/osx/Tide Terminal.app`.
- Interactive native Vibe notification delivery has not been manually verified.
