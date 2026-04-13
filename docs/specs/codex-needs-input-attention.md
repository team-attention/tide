# Spec: Codex Stop Hook Lifecycle

## Overview

### As-Is

- Tide already supports wrapped-agent `AgentStatus` in `crates/tide-app/src/app.rs`, `crates/tide-app/src/application/services/workspace_infra_service/mod.rs`, and the chrome renderers.
- The current Codex wrapper contract in `crates/tide-app/resources/bin/codex` enables `features.codex_hooks=true` and wires both `UserPromptSubmit` and `Stop` into `tide notify`.
- `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` now parses the `Stop` hook payload only to extract a `Notification Snippet` from `last_assistant_message`.
- The official Codex hooks documentation exposes `UserPromptSubmit` and `Stop` as the turn-level hook events, and `Stop` already carries `last_assistant_message` on stdin.
- The shared routing and chrome layers still need a clearer contract boundary between projected `Idle` state and unresolved user-facing attention.

### To-Be

- The Codex lifecycle is driven explicitly by `UserPromptSubmit` and `Stop` hooks.
- Tide treats `UserPromptSubmit` as the start of a new turn and returns the source `Pane` to `Running`.
- Tide treats the `Stop` hook payload as the completed-turn source and normalizes Codex completion to `Idle`.
- A fresh Codex `Stop` payload may emit a `Wrapped Agent Completion Notification`, but it must not promote Codex completion to `NeedsInput`.
- `NeedsInput` remains reserved for explicit wrapper-managed lifecycle signals from agents that expose a dedicated input-required hook.
- Blink/color presentation for `NeedsInput` belongs in `docs/specs/pane-chrome.md`; this spec only defines the Codex lifecycle boundary and classification contract.

### Approach

1. Keep the checked-in Codex `Stop` hook contract that forwards stdin JSON through `tide notify agent-idle --payload-stdin`.
2. Keep `UserPromptSubmit` as the explicit turn-start hook and keep wrapper launch limited to `Wrapped Agent Presence`.
3. Parse the Codex `Stop` hook payload in Tide and derive only a `Notification Snippet`, not a synthetic `NeedsInput` state.
4. Route Codex completion through `Idle` plus `Wrapped Agent Completion Notification`.
5. Let shared routing and chrome consume normalized lifecycle state only.

## Adapter Contract

- The Codex wrapper remains the source of the signal surface: `UserPromptSubmit` for turn start and `Stop` for turn completion.
- Tide owns the Codex-specific helper that extracts `last_assistant_message` from the `Stop` hook payload into a `Notification Snippet`.
- The helper input is the Codex `Stop` hook payload, with `last_assistant_message` as the primary snippet field and the other common hook fields treated as supporting context only.
- The helper returns `Running` for `UserPromptSubmit` and `Idle` for `Stop`.
- Codex completion never upgrades itself to `NeedsInput` inside Tide.
- This spec does not define chrome color or animation details; those are owned by `docs/specs/pane-chrome.md`.
- The shared routing rules live in `docs/specs/agent-notification-routing.md`; this spec only defines the Codex-specific lifecycle boundary.

## Bounded Contexts

| Context | Role |
|---------|------|
| `wrapper` | Injects the Codex hook config into the wrapped command |
| `gateway` | Receives Codex-derived lifecycle events and stores `AgentStatus` |
| `terminal` | Supplies Pane-scoped environment so Codex helper commands know the source `Pane` |
| `renderer` | Reuses existing `NeedsInput`, `Idle`, and `Running` chrome once Codex produces the correct lifecycle signal |

## Use Cases

### UC-1: EmitRunningOnCodexPromptSubmit

- **Actor**: Wrapped Agent
- **Trigger**: Codex `UserPromptSubmit` hook fires
- **Precondition**: Codex hooks are enabled for the wrapped session
- **Flow**:
  1. Codex runs a Tide-managed hook command on `UserPromptSubmit`
  2. Tide emits `agent-running` for the source `Pane`
  3. Existing routed attention clears or transitions back to `Running`
- **Postcondition**: A new Codex turn re-enters the normal running state
- **Business Rules**:
  - BR-1: Codex `agent-running` should be emitted on every user prompt submission, not only on process launch
  - BR-2: Codex prompt-submit integration must use the documented `UserPromptSubmit` hook path

### UC-2: EmitIdleOnCodexStop

- **Actor**: Wrapped Agent
- **Trigger**: Codex `Stop` hook fires
- **Precondition**: Codex hooks are enabled for the wrapped session
- **Flow**:
  1. Codex runs a Tide-managed hook command on `Stop`
  2. Tide parses the Codex `Stop` hook payload
  3. Tide extracts `last_assistant_message` into a `Notification Snippet`
  4. Tide stores `Idle` for the source `Pane`
  5. Tide may route a `Wrapped Agent Completion Notification` without creating `NeedsInput` attention
- **Postcondition**: Completed Codex turns produce the right Tide lifecycle state
- **Business Rules**:
  - BR-3: Codex completion must be reported through the documented `Stop` hook path
  - BR-4: Codex `Stop` normalizes to `Idle`
  - BR-5: Codex `Stop` may emit a `Wrapped Agent Completion Notification`
  - BR-6: Codex `Stop` must not synthesize `NeedsInput`

### UC-3: PreserveCodexSpecificSafetyBoundary

- **Actor**: Tide wrapper maintainer
- **Trigger**: Codex integration changes
- **Precondition**: Tide is deciding whether to add more Codex hook mappings
- **Flow**:
  1. Tide evaluates the wrapper contract and the documented Codex hook surface
  2. Tide accepts only sources with documented semantics or checked-in repo evidence
  3. Tide rejects assumptions that are not backed by the current wrapper contract
- **Postcondition**: Codex completion routing remains evidence-backed
- **Business Rules**:
  - BR-7: Tide must keep the Codex lifecycle boundary explicit in the wrapper contract
  - BR-8: Tide must not infer Codex `NeedsInput` from completion text
  - BR-9: Codex completion parsing lives in Tide code and tests, not ad hoc shell-string matching inside the wrapper

## Invariants

1. `UserPromptSubmit` and `Stop` are the only Codex lifecycle signals Tide relies on.
2. Codex `Stop` normalizes to `Idle`, not `NeedsInput`.
3. Codex completion may emit a `Wrapped Agent Completion Notification` without creating unresolved alert attention.
4. Unknown or malformed Codex `Stop` payloads fail closed to `Idle`.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `codex_prompt_submit_hook_reports_running_for_each_new_turn` |
| UC-1 | BR-2 | `codex_wrapper_enables_hooks_and_registers_user_prompt_submit` |
| UC-2 | BR-3 | `codex_wrapper_uses_stop_hook_for_completion` |
| UC-2 | BR-4 | `codex_stop_hook_payload_sets_idle_without_attention` |
| UC-2 | BR-5 | `codex_stop_hook_completion_notification_uses_last_assistant_message_snippet` |
| UC-2 | BR-6 | `codex_stop_hook_payload_never_maps_to_needs_input` |
| UC-3 | BR-7 | `codex_wrapper_uses_the_explicit_hook_contract` |
| UC-3 | BR-8 | `codex_stop_hook_payload_never_maps_to_needs_input` |
| UC-3 | BR-9 | `codex_stop_hook_completion_notification_uses_last_assistant_message_snippet` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Wrapper | `crates/tide-app/resources/bin/codex` | Inject Codex `UserPromptSubmit` and `Stop` hooks for the explicit turn contract |
| CLI adapter | `crates/tide-app/src/adapter/inward/cli_adapter/` | Add the Codex-specific helper that parses the `Stop` hook payload and derives a `Notification Snippet` |
| Gateway | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Reuse existing `notify` handling once the Codex helper resolves `Running` vs `Idle` and emits completion notification data |
| Shared routing | `docs/specs/agent-notification-routing.md` | Define the common `AgentStatus` routing, inactive-Workspace projection, and notification activation behavior |
| Specs | `docs/specs/agent-notification-routing.md`, `docs/specs/codex-needs-input-attention.md` | Record the Codex-specific lifecycle boundary |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verify Codex running and completed-turn classification rules |
