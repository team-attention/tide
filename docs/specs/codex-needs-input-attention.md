# Spec: Codex NeedsInput Attention

## Overview

### As-Is

- Tide already supports wrapper-managed `AgentStatus::NeedsInput` in `crates/tide-app/src/app.rs`, `crates/tide-app/src/application/services/workspace_infra_service/mod.rs`, and the chrome renderers, but the current Codex wrapper in `crates/tide-app/resources/bin/codex` still marks presence on launch and forwards a top-level completed-turn notify payload into Tide before the turn's final main-thread assistant message is confirmed, with process `EXIT` still acting as the fallback wrapper teardown path.
- The current Claude wrapper in `crates/tide-app/resources/bin/claude` is different: it maps Claude's `Notification`, `Stop`, and `UserPromptSubmit` hooks directly to `agent-needs-input`, `agent-idle`, and `agent-running`.
- OpenAI's official Codex config reference documents a top-level `notify` command that receives a JSON payload from Codex.
- OpenAI's official Codex hooks docs document `UserPromptSubmit`, `PermissionRequest`, `Stop`, `PreToolUse`, and `PostToolUse`, with hooks gated behind `[features] codex_hooks = true` and loaded from `hooks.json`.
- The official Codex hooks docs do not document a `Notification` hook like Claude's.
- OpenAI's open-source Codex hook implementation shows the current notification payload shape as `agent-turn-complete`, including `input_messages` and `last_assistant_message`.
- OpenAI's official Codex hooks docs document `PreToolUse` only for `Bash`, and explicitly say unsupported output forms such as `permissionDecision: "ask"` fail open today.
- The checked-in `read_codex_transcript_resolution()` helper only inspects `response_item` assistant messages, while current local Codex transcripts also emit final-answer text through `event_msg.agent_message` and `event_msg.task_complete.last_agent_message`.
- A real locally captured Codex `Stop` hook stdin payload uses `snake_case` keys such as `transcript_path`, `hook_event_name`, and `last_assistant_message`, but the checked-in `CodexStopHookPayload` parser still expects `kebab-case`, so Tide drops the transcript path and fallback assistant message before notification routing.
- The checked-in Codex completed-turn classifier still lets a finished main-thread turn become `NeedsInput` from final assistant text unless Tide relies only on documented direct CLI hooks and transcript-backed completion classification.

### To-Be

- Codex `NeedsInput` in Tide must use a Codex-specific attention adapter, not the Claude `Notification` model.
- Tide should treat Codex `Stop` as the primary turn-complete signal, use `transcript_path` to confirm the current thread is the main thread, and classify every completed main-thread turn as `Idle`.
- Transcript resolution should accept the checked-in Codex transcript shapes in priority order: `response_item` final-answer assistant messages, `event_msg.agent_message` with `phase = final_answer`, then `event_msg.task_complete.last_agent_message`, before falling back to payload text.
- Tide should use Codex `UserPromptSubmit` to return the source `Pane` to `Running` at the beginning of each new turn, while launch only marks `Wrapped Agent Presence`.
- Tide should use the documented Codex `PermissionRequest` hook to mark `NeedsInput` for direct CLI approval waits without depending on raw terminal text.
- Visible Codex CLI prompt text alone must not upgrade a source `Pane` to `AgentStatus::NeedsInput`.
- Tide must not infer Codex `NeedsInput` from unverified hook ordering or unsupported hook outputs.
- Tide must fail closed for Codex completed turns: final assistant text must not become `AgentStatus::NeedsInput` and must not project `AgentChromeState::Attention`.
- Tide must remove the checked-in Codex App Server remote-mode path so the wrapped Codex contract stays direct-CLI-only.

### Approach

1. Add a Codex-specific CLI entrypoint, invoked from Codex `Stop`, that parses the official hook payload passed on stdin and maps it to Tide lifecycle events.
2. Use `transcript_path` as the source of truth for the final assistant response so Tide can prefer the main-thread final answer over intermediate terminal text or stale payload text.
3. Resolve the transcript by accepting the checked-in Codex record shapes in order: `response_item` final answer, `event_msg.agent_message` final answer, then `event_msg.task_complete.last_agent_message`.
4. Enable Codex hooks for `UserPromptSubmit`, `PermissionRequest`, and `Stop` so Tide can emit `agent-running` at turn start, `NeedsInput` for direct CLI approval waits, and only finalize completion after Codex declares the turn stopped.
5. Normalize every recognized completed Codex turn to `Idle` after Tide resolves the main-thread final assistant message for snippet and transcript safety.
6. Fail closed for `NeedsInput`: unknown payloads, subagent transcripts, or completed-turn text must not be upgraded to `NeedsInput`.
7. Do not use `PreToolUse` or unsupported `permissionDecision: "ask"` semantics to infer permission waits until Tide has repo-backed evidence for Codex approval ordering.
8. Preserve the direct Codex CLI launch as the only checked-in Codex launch path.

## Adapter Contract

- The Codex wrapper remains the source of the official signal surface: `UserPromptSubmit` for turn start, `PermissionRequest` for direct CLI approval waits, `Stop` for turn completion, and `EXIT` for the fallback `agent-detached` report.
- Tide owns the Codex-specific helper that resolves the final assistant response from the `Stop` hook payload before shared routing consumes it.
- The helper input is the official `Stop` hook payload, with `transcript_path` as the primary decision source, `last_assistant_message` as a fallback when the transcript is unavailable, and the transcript session metadata as the guard against subagent threads.
- The helper must parse the real official `Stop` hook field names in `snake_case`, while tolerating the older internal `kebab-case` spellings where manual notify calls or legacy tests still use them.
- The helper must accept current checked-in Codex transcript record shapes from both `response_item` and `event_msg` records so notification routing can recover the final main-thread assistant response even when only the `event_msg` forms are present at hook time.
- The helper returns `Running` for `UserPromptSubmit`, `NeedsInput` for the documented `PermissionRequest` payload, ignores subagent `Stop` transcripts, and returns `Idle` for every completed main-thread turn.
- Raw visible `Terminal` prompt text must not update a source `Pane` to `AgentStatus::NeedsInput`.
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
- **Trigger**: Codex invokes the configured `Stop` hook with turn-stop payload JSON on stdin
- **Precondition**: The payload type is recognized by Tide
- **Flow**:
  1. Tide parses the Codex `Stop` hook payload
  2. Tide resolves the final main-thread assistant response from `transcript_path`, preferring `response_item` final-answer text, then `event_msg.agent_message` final-answer text, then `event_msg.task_complete.last_agent_message`, and falling back to `last_assistant_message` only if the transcript is unavailable
  3. Tide ignores the event if the transcript belongs to a subagent thread
  4. Tide classifies the completed turn as `Idle`
  5. Tide routes the resulting wrapper-managed attention through the existing gateway path
- **Postcondition**: Completed Codex turns produce the shared `Idle` state
- **Business Rules**:
  - BR-3: `Stop` is the primary Codex turn-complete payload Tide recognizes
  - BR-4: Tide must parse the official Codex `Stop` hook payload when its field names arrive in `snake_case`
  - BR-5: Tide must prefer the final main-thread assistant response from `transcript_path` over intermediate payload text when both exist, accepting the checked-in `response_item` and `event_msg` final-answer record shapes
  - BR-6: A recognized completed-turn payload always normalizes to `Idle`
  - BR-7: Final assistant text from a completed turn must not upgrade Codex to `NeedsInput`
  - BR-8: A subagent transcript must not produce a routed Codex lifecycle update

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
  - BR-9: Tide should use the documented Codex `PermissionRequest` hook for direct CLI approval waits
  - BR-10: PermissionRequest snippets should prefer `tool_input.description`, then `tool_input.command`, then generic Codex text
  - BR-11: Tide must not depend on a Codex `Notification` hook because the official Codex hooks docs do not expose one
  - BR-12: Tide must not depend on `PreToolUse` approval inference until approval ordering is proven for Codex
  - BR-13: Codex-specific classification rules live in Tide code and tests, not ad hoc shell-string matching inside the wrapper
  - BR-14: Unsupported Codex hook ordering must not be used to infer permission waits or user-input waits

### UC-4: IgnoreVisibleCodexCliPromptText

- **Actor**: Codex `Agent Wrapper`
- **Trigger**: A wrapped Codex `Terminal` receives new output
- **Precondition**: The source `Pane` is a wrapper-managed Codex `Terminal`
- **Flow**:
  1. Tide reads the visible `Terminal` grid text
  2. Tide keeps the visible prompt text as transport text only
  3. Tide waits for a documented direct CLI hook signal or a later completed-turn `Idle` signal
- **Postcondition**: Visible Codex CLI prompt text alone does not produce `NeedsInput` chrome or routed attention
- **Business Rules**:
  - BR-15: Raw visible Codex CLI prompt text must not map to `AgentStatus::NeedsInput`
  - BR-16: Codex permission waits should prefer the documented `PermissionRequest` hook instead of visible `Terminal` prompt text
  - BR-17: Unknown visible Codex prompt text fails closed and must not map to `AgentStatus::NeedsInput`

### UC-5: LaunchCodexDirectCliOnly

- **Actor**: User
- **Trigger**: The user runs `codex` from a Tide-managed `Terminal`
- **Precondition**: The Codex `Agent Wrapper` is first on `PATH`
- **Flow**:
  1. The wrapper reports `agent-attached`
  2. The wrapper creates the temporary `CODEX_HOME` overlay and hook config
  3. The wrapper launches the real Codex CLI directly with hook and MCP injection
- **Postcondition**: The checked-in Codex launch path remains the direct CLI path only
- **Business Rules**:
  - BR-18: The Codex wrapper must not launch App Server remote mode
  - BR-19: Direct Codex launch keeps the existing hook and MCP injection

## Invariants

1. Claude and Codex do not share the same attention source model.
2. Codex `NeedsInput` is derived from documented Codex direct CLI events only.
3. Raw visible Codex CLI prompt text alone must not produce `NeedsInput`.
4. Codex completed-turn text, unknown Codex final assistant text, and unknown or subagent Codex stop payloads fail closed for routed attention.
5. Existing wrapper-managed attention rendering stays generic; only the Codex event adapter is agent-specific.
6. `AgentChromeState::Attention` is derived from `AgentStatus::NeedsInput`; Codex-specific adapters must not set chrome state directly.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `codex_prompt_submit_hook_reports_running_for_each_new_turn` |
| UC-1 | BR-2 | `codex_wrapper_injects_tide_mcp_turn_stop_hook_and_prompt_submit_hook` |
| UC-2 | BR-3 | `codex_stop_payload_always_classifies_idle` |
| UC-2 | BR-4 | `codex_stop_payload_prefers_main_thread_transcript_over_payload_text` |
| UC-2 | BR-5 | `codex_stop_payload_prefers_main_thread_transcript_over_payload_text` |
| UC-2 | BR-5 | `codex_stop_notification_uses_event_msg_final_answer_snippet` |
| UC-2 | BR-5 | `codex_stop_notification_uses_task_complete_last_agent_message_snippet` |
| UC-2 | BR-6 | `codex_stop_payload_always_classifies_idle` |
| UC-2 | BR-7 | `codex_stop_payload_always_classifies_idle` |
| UC-2 | BR-8 | `codex_stop_payload_ignores_subagent_transcript` |
| UC-3 | BR-9, BR-10 | `codex_permission_request_hook_marks_needs_input` |
| UC-3 | BR-11 | `codex_wrapper_does_not_depend_on_notification_hook` |
| UC-3 | BR-12 | `codex_integration_does_not_emit_needs_input_from_pretooluse_without_classifier` |
| UC-3 | BR-13 | `codex_stop_payload_always_classifies_idle` |
| UC-3 | BR-14 | `codex_integration_does_not_use_unsupported_hook_ordering_for_cli_waits` |
| UC-4 | BR-15, BR-17 | `visible_codex_cli_tool_approval_wait_does_not_mark_needs_input_without_structured_signal` |
| UC-5 | BR-18, BR-19 | `codex_wrapper_omits_app_server_and_launches_direct_cli_only` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Wrapper | `crates/tide-app/resources/bin/codex` | Inject Codex `UserPromptSubmit` and `Stop` hooks and point Codex to Tide-managed helper commands |
| CLI adapter | `crates/tide-app/src/adapter/inward/cli_adapter/` | Add a Codex-specific helper that parses the official `Stop` hook payload and transcript file and maps it to Tide lifecycle events |
| Gateway | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Reuse existing `notify` handling once the Codex helper resolves the main-thread final answer into `Idle` while direct CLI hooks remain the only `NeedsInput` source |
| App | `crates/tide-app/src/app.rs` | Keep raw visible Codex CLI prompt text from directly routing `NeedsInput` |
| Shared routing | `docs/specs/agent-notification-routing.md` | Defines the common `AgentStatus` routing, inactive-Workspace projection, and notification activation behavior |
| Specs | `docs/specs/agent-auto-integration.md`, `docs/specs/agent-notification-routing.md`, `docs/specs/codex-needs-input-attention.md` | Record the Codex-specific event model |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verify Codex running and completed-turn classification rules |
