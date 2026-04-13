# Spec: Codex NeedsInput Attention

## Overview

### As-Is

- Tide already supports wrapper-managed `AgentStatus::NeedsInput` in `crates/tide-app/src/app.rs`, `crates/tide-app/src/application/services/workspace_infra_service/mod.rs`, and the chrome renderers, but the current Codex wrapper in `crates/tide-app/resources/bin/codex` still marks presence on launch and forwards the completed-turn payload into Tide, with process `EXIT` still acting as the fallback wrapper teardown path.
- The current Claude wrapper in `crates/tide-app/resources/bin/claude` is different: it maps Claude's `Notification`, `Stop`, and `UserPromptSubmit` hooks directly to `agent-needs-input`, `agent-idle`, and `agent-running`.
- OpenAI's official Codex config reference documents a top-level `notify` command that receives a JSON payload from Codex.
- OpenAI's official Codex hooks docs document `UserPromptSubmit`, `Stop`, `PreToolUse`, and `PostToolUse`, with hooks gated behind `[features] codex_hooks = true` and loaded from `hooks.json`.
- The official Codex hooks docs do not document a `Notification` hook like Claude's.
- OpenAI's open-source Codex hook implementation shows the current notification payload shape as `agent-turn-complete`, including `input_messages` and `last_assistant_message`.
- OpenAI's official Codex hooks docs document `PreToolUse` only for `Bash`, and explicitly say unsupported output forms such as `permissionDecision: "ask"` fail open today.

### To-Be

- Codex `NeedsInput` in Tide must use a Codex-specific attention adapter, not the Claude `Notification` model.
- Tide should treat Codex turn completion as the primary stable signal source, then classify that completed turn as `Idle` or `NeedsInput` from the official Codex payload.
- Tide should use Codex `UserPromptSubmit` to return the source `Pane` to `Running` at the beginning of each new turn, while launch only marks `Wrapped Agent Presence`.
- Tide must not infer Codex `NeedsInput` from unverified hook ordering or unsupported hook outputs.

### Approach

1. Add a Codex-specific CLI entrypoint, invoked from Codex `notify`, that parses the official payload passed by Codex and maps it to Tide lifecycle events.
2. Keep `notify` as the primary completed-turn source because it is documented in Codex config and already yields completed-turn payload data.
3. Enable Codex hooks only for `UserPromptSubmit` so Tide can emit `agent-running` on every new turn, while launch only reports `agent-attached` for idle presence.
4. Use a conservative Codex-specific classifier over `last_assistant_message` to decide whether a completed turn is `Idle` or `NeedsInput`.
5. Fail closed for `NeedsInput`: unknown payloads or unclassified messages may still produce `Idle`, but must not be upgraded to `NeedsInput` without an explicit classifier match.
6. Do not use `PreToolUse` or unsupported `permissionDecision: "ask"` semantics to infer permission waits until Tide has repo-backed evidence for Codex approval ordering.

## Adapter Contract

- The Codex wrapper remains the source of the official signal surface: `UserPromptSubmit` for turn start, `notify` for completed turns, and `EXIT` for the fallback `agent-detached` report.
- Tide owns the Codex-specific helper that classifies the completed-turn payload before shared routing consumes it.
- The helper input is the official completed-turn `agent-turn-complete` payload, with `last_assistant_message` as the primary decision field and `input_messages` as supporting context only.
- The helper returns `Running` for `UserPromptSubmit`, `Idle` for a completed turn that does not match the checked-in classifier, and `NeedsInput` only for a completed turn whose normalized `last_assistant_message` matches a checked-in request phrase.
- The shared routing, inactive-Workspace projection, and notification activation rules live in `docs/specs/agent-notification-routing.md`; this spec only defines the Codex-specific classifier boundary.

## Bounded Contexts

| Context | Role |
|---------|------|
| `wrapper` | Injects Codex `notify` config and Codex hook config into the wrapped command |
| `gateway` | Receives Codex-derived lifecycle events and stores `AgentStatus` |
| `terminal` | Supplies Pane-scoped environment so Codex helper commands know the source `Pane` |
| `renderer` | Reuses existing `NeedsInput` and `Idle` chrome once Codex produces the correct lifecycle signal |

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

### UC-2: ClassifyCompletedCodexTurn

- **Actor**: Wrapped Agent
- **Trigger**: Codex invokes the configured `notify` command with a completed-turn payload
- **Precondition**: The payload type is recognized by Tide
- **Flow**:
  1. Tide parses the Codex notification payload
  2. Tide extracts `last_assistant_message` and other payload fields needed for classification
  3. Tide classifies the completed turn as either `Idle` or `NeedsInput`
  4. Tide routes the resulting wrapper-managed attention through the existing gateway path
- **Postcondition**: Completed Codex turns produce the right Tide attention state
- **Business Rules**:
  - BR-3: `agent-turn-complete` is the primary Codex completed-turn payload Tide recognizes
  - BR-4: A Codex turn is upgraded to `NeedsInput` only when the Codex-specific classifier matches a checked-in rule
  - BR-5: A recognized completed-turn payload that does not match the classifier falls back to `Idle`
  - BR-6: An unrecognized payload type must not produce `NeedsInput`

### UC-3: PreserveCodexSpecificSafetyBoundary

- **Actor**: Tide wrapper maintainer
- **Trigger**: Codex integration changes
- **Precondition**: Tide is deciding whether to add more Codex hook mappings
- **Flow**:
  1. Tide evaluates the official Codex hook or payload source
  2. Tide accepts only sources with documented semantics or checked-in repo evidence
  3. Tide rejects Claude-specific assumptions on the Codex path
- **Postcondition**: Codex `NeedsInput` remains evidence-backed
- **Business Rules**:
  - BR-7: Tide must not depend on a Codex `Notification` hook because the official Codex hooks docs do not expose one
  - BR-8: Tide must not depend on `PreToolUse` approval inference until approval ordering is proven for Codex
  - BR-9: Codex-specific classification rules live in Tide code and tests, not ad hoc shell-string matching inside the wrapper

## Invariants

1. Claude and Codex do not share the same attention source model.
2. Codex `NeedsInput` is derived from documented Codex events and checked-in classification rules only.
3. Unknown Codex payloads fail closed for `NeedsInput`.
4. Existing wrapper-managed attention rendering stays generic; only the Codex event adapter is agent-specific.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `codex_prompt_submit_hook_reports_running_for_each_new_turn` |
| UC-1 | BR-2 | `codex_wrapper_enables_hooks_and_registers_user_prompt_submit` |
| UC-2 | BR-3 | `codex_completed_turn_payload_classifies_idle_or_needs_input` |
| UC-2 | BR-4 | `codex_completed_turn_payload_classifies_idle_or_needs_input` |
| UC-2 | BR-5 | `codex_completed_turn_payload_falls_back_to_idle_when_unclassified` |
| UC-2 | BR-6 | `codex_unknown_notify_payload_does_not_map_to_needs_input` |
| UC-3 | BR-7 | `codex_wrapper_does_not_depend_on_notification_hook` |
| UC-3 | BR-8 | `codex_integration_does_not_emit_needs_input_from_pretooluse_without_classifier` |
| UC-3 | BR-9 | `codex_completed_turn_payload_classifies_idle_or_needs_input` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Wrapper | `crates/tide-app/resources/bin/codex` | Inject Codex `notify` and point Codex to Tide-managed helper commands |
| CLI adapter | `crates/tide-app/src/adapter/inward/cli_adapter/` | Add a Codex-specific helper that parses the official notify payload and maps it to Tide lifecycle events |
| Gateway | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Reuse existing `notify` handling once Codex helper resolves `Idle` vs `NeedsInput` |
| Shared routing | `docs/specs/agent-notification-routing.md` | Defines the common `AgentStatus` routing, inactive-Workspace projection, and notification activation behavior |
| Specs | `docs/specs/agent-auto-integration.md`, `docs/specs/agent-notification-routing.md`, `docs/specs/codex-needs-input-attention.md` | Record the Codex-specific event model |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verify Codex running and completed-turn classification rules |
