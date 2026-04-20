# Spec: Codex NeedsInput Attention

## Overview

### As-Is

- Tide already supports wrapper-managed `AgentStatus::NeedsInput` in `crates/tide-app/src/app.rs`, `crates/tide-app/src/application/services/workspace_infra_service/mod.rs`, and the chrome renderers.
- The current Codex wrapper in `crates/tide-app/resources/bin/codex` marks `Wrapped Agent Presence` on launch, emits `agent-running` from `UserPromptSubmit`, emits `codex-stop` from `Stop`, and uses process `EXIT` as the fallback wrapper teardown path.
- The current Claude wrapper in `crates/tide-app/resources/bin/claude` is different: it maps Claude's `Notification`, `Stop`, and `UserPromptSubmit` hooks directly to `agent-needs-input`, `agent-idle`, and `agent-running`.
- OpenAI's official Codex config reference documents a top-level `notify` command that receives a JSON payload from Codex.
- OpenAI's official Codex hooks docs document `UserPromptSubmit`, `Stop`, `PreToolUse`, and `PostToolUse`, with hooks gated behind `[features] codex_hooks = true` and loaded from `hooks.json`.
- The official Codex hooks docs do not document a `Notification` hook like Claude's.
- OpenAI's open-source Codex hook implementation shows the current notification payload shape as `agent-turn-complete`, including `input_messages` and `last_assistant_message`.
- OpenAI's official Codex hooks docs document `PreToolUse` only for `Bash`, and explicitly say unsupported output forms such as `permissionDecision: "ask"` fail open today.
- The checked-in `read_codex_transcript_resolution()` helper inspects `response_item` assistant messages, `event_msg.agent_message`, and `event_msg.task_complete.last_agent_message`.
- A real locally captured Codex `Stop` hook stdin payload uses `snake_case` keys such as `transcript_path`, `hook_event_name`, and `last_assistant_message`; the checked-in `CodexStopHookPayload` parser accepts `snake_case` and tolerates older `kebab-case` aliases for the fields Tide consumes.
- The checked-in Codex App Server path can map structured approval requests into `AgentStatus::NeedsInput`, but a visible Codex TUI permission prompt can still appear only as `Terminal` text when App Server transport is unavailable or disabled.

### To-Be

- Codex `NeedsInput` in Tide must use a Codex-specific attention adapter, not the Claude `Notification` model.
- Tide should treat Codex `Stop` as the primary turn-complete signal, use `transcript_path` to confirm the current thread is the main thread, and classify the final main-thread assistant response as `Idle` or `NeedsInput`, including short confirmation or permission prompts such as `yes` and `allow`.
- Transcript resolution should accept the checked-in Codex transcript shapes in priority order: `response_item` final-answer assistant messages, `event_msg.agent_message` with `phase = final_answer`, then `event_msg.task_complete.last_agent_message`, before falling back to payload text.
- Tide should use Codex `UserPromptSubmit` to return the source `Pane` to `Running` at the beginning of each new turn, while launch only marks `Wrapped Agent Presence`.
- While a Codex `Terminal` shows a recognizable permission prompt, Tide should emit a wrapper-managed `NeedsInput` lifecycle update from the visible `Terminal` text even if no Codex App Server event arrives.
- Codex App Server remote mode should be an explicit opt-in helper path, not the default launch path, because the user-facing contract is the `Agent Wrapper` lifecycle state rather than the App Server transport.
- Tide must not infer Codex `NeedsInput` from unverified hook ordering or unsupported hook outputs.

### Approach

1. Add a Codex-specific CLI entrypoint, invoked from Codex `Stop`, that parses the official hook payload passed on stdin and maps it to Tide lifecycle events.
2. Use `transcript_path` as the source of truth for the final assistant response so Tide can prefer the main-thread final answer over intermediate terminal text or stale payload text.
3. Resolve the transcript by accepting the checked-in Codex record shapes in order: `response_item` final answer, `event_msg.agent_message` final answer, then `event_msg.task_complete.last_agent_message`.
4. Enable Codex hooks for `UserPromptSubmit` and `Stop` so Tide can emit `agent-running` at turn start and only finalize completion after Codex declares the turn stopped.
5. Use a conservative Codex-specific classifier over the resolved final assistant message to decide whether a completed turn is `Idle` or `NeedsInput`.
6. Fail closed for `NeedsInput`: unknown payloads, subagent transcripts, or unclassified messages may still produce `Idle`, but must not be upgraded to `NeedsInput` without an explicit classifier match.
7. Do not use `PreToolUse` or unsupported `permissionDecision: "ask"` semantics to infer permission waits until Tide has repo-backed evidence for Codex approval ordering.
8. Add a visible-`Terminal` fallback classifier for the Codex TUI permission prompt shape that asks whether to allow an MCP server tool call, including the checked-in choice set shown by Codex.
9. Keep Codex App Server launch code available behind `TIDE_CODEX_APP_SERVER=1`, but use the direct Codex CLI launch as the default path.

## Adapter Contract

- The Codex wrapper remains the source of the official signal surface: `UserPromptSubmit` for turn start, `Stop` for turn completion, and `EXIT` for the fallback `agent-detached` report.
- Tide owns the Codex-specific helper that resolves the final assistant response from the `Stop` hook payload before shared routing consumes it.
- The helper input is the official `Stop` hook payload, with `transcript_path` as the primary decision source, `last_assistant_message` as a fallback when the transcript is unavailable, and the transcript session metadata as the guard against subagent threads.
- The helper must parse the real official `Stop` hook field names in `snake_case`, while tolerating the older internal `kebab-case` spellings where manual notify calls or legacy tests still use them.
- The helper must accept current checked-in Codex transcript record shapes from both `response_item` and `event_msg` records so notification routing can recover the final main-thread assistant response even when only the `event_msg` forms are present at hook time.
- The helper returns `Running` for `UserPromptSubmit`, ignores subagent `Stop` transcripts, returns `Idle` for a completed main-thread turn that does not match the checked-in classifier, and returns `NeedsInput` only for a completed main-thread turn whose normalized final assistant message matches a checked-in request phrase or short confirmation/permission prompt.
- The App scans visible `Terminal` text for a Codex permission prompt only for a `Wrapped Agent` whose display name is `Codex`; a match updates that `Pane` to `AgentStatus::NeedsInput` and routes the prompt text as the `Notification Snippet`.
- The visible-`Terminal` fallback is conservative: it only matches a prompt that asks to allow an MCP server to run a tool and includes the Codex approval-choice surface.
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
  4. Tide classifies the completed turn as either `Idle` or `NeedsInput`
  5. Tide routes the resulting wrapper-managed attention through the existing gateway path
- **Postcondition**: Completed Codex turns produce the right Tide attention state
- **Business Rules**:
  - BR-3: `Stop` is the primary Codex turn-complete payload Tide recognizes
  - BR-4: Tide must parse the official Codex `Stop` hook payload when its field names arrive in `snake_case`
  - BR-5: Tide must prefer the final main-thread assistant response from `transcript_path` over intermediate payload text when both exist, accepting the checked-in `response_item` and `event_msg` final-answer record shapes
  - BR-6: A Codex turn is upgraded to `NeedsInput` only when the Codex-specific classifier matches a checked-in rule
  - BR-7: A recognized completed-turn payload that does not match the classifier falls back to `Idle`
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
  - BR-8: Tide must not depend on a Codex `Notification` hook because the official Codex hooks docs do not expose one
  - BR-9: Tide must not depend on `PreToolUse` approval inference until approval ordering is proven for Codex
  - BR-10: Codex-specific classification rules live in Tide code and tests, not ad hoc shell-string matching inside the wrapper

### UC-4: DetectVisibleCodexPermissionPrompt

- **Actor**: Codex `Agent Wrapper`
- **Trigger**: A wrapped Codex `Terminal` receives new output
- **Precondition**: The source `Pane` is a wrapper-managed Codex `Terminal`
- **Flow**:
  1. Tide reads the visible `Terminal` grid text
  2. Tide matches a prompt asking whether to allow an MCP server to run a tool
  3. Tide confirms the visible Codex approval choices are present
  4. Tide updates the source `Pane` to `AgentStatus::NeedsInput`
  5. Tide routes the prompt text through the existing wrapped-agent notification path
- **Postcondition**: A visible Codex permission prompt produces the normal `NeedsInput` chrome and notification behavior even without a Codex App Server event
- **Business Rules**:
  - BR-11: Visible Codex MCP tool permission prompts map to `AgentStatus::NeedsInput`
  - BR-12: Visible prompt detection must only run for wrapper-managed Codex `Terminal` Panes
  - BR-13: The prompt line should be used as the `Notification Snippet`

### UC-5: LaunchCodexDirectByDefault

- **Actor**: User
- **Trigger**: The user runs `codex` from a Tide-managed `Terminal`
- **Precondition**: The Codex `Agent Wrapper` is first on `PATH`
- **Flow**:
  1. The wrapper reports `agent-attached`
  2. The wrapper creates the temporary `CODEX_HOME` overlay and hook config
  3. Unless `TIDE_CODEX_APP_SERVER=1`, the wrapper launches the real Codex CLI directly in the current `Terminal` working directory
  4. If `TIDE_CODEX_APP_SERVER=1`, the wrapper may attempt the Codex App Server remote mode and fall back to direct launch on failure
- **Postcondition**: The default Codex launch path preserves the user's `Terminal` working directory and does not depend on App Server transport
- **Business Rules**:
  - BR-14: Codex App Server remote mode is opt-in through `TIDE_CODEX_APP_SERVER=1`
  - BR-15: Direct Codex launch remains the default and keeps the existing hook and MCP injection

## Invariants

1. Claude and Codex do not share the same attention source model.
2. Codex `NeedsInput` is derived from documented Codex events, checked-in classification rules, and the main-thread transcript only.
3. Visible Codex permission prompts may produce `NeedsInput` only for wrapper-managed Codex `Terminal` Panes.
4. Unknown or subagent Codex stop payloads fail closed for routed attention.
5. Existing wrapper-managed attention rendering stays generic; only the Codex event adapter is agent-specific.

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `codex_prompt_submit_hook_reports_running_for_each_new_turn` |
| UC-1 | BR-2 | `codex_wrapper_injects_tide_mcp_turn_stop_hook_and_prompt_submit_hook` |
| UC-2 | BR-3 | `codex_stop_payload_classifies_idle_or_needs_input` |
| UC-2 | BR-4 | `codex_stop_payload_prefers_main_thread_transcript_over_payload_text` |
| UC-2 | BR-5 | `codex_stop_payload_prefers_main_thread_transcript_over_payload_text` |
| UC-2 | BR-5 | `codex_stop_notification_uses_event_msg_final_answer_snippet` |
| UC-2 | BR-5 | `codex_stop_notification_uses_task_complete_last_agent_message_snippet` |
| UC-2 | BR-6 | `codex_stop_payload_classifies_idle_or_needs_input` |
| UC-2 | BR-7 | `codex_stop_payload_falls_back_to_idle_when_unclassified` |
| UC-2 | BR-8 | `codex_stop_payload_ignores_subagent_transcript` |
| UC-3 | BR-8 | `codex_wrapper_does_not_depend_on_notification_hook` |
| UC-3 | BR-9 | `codex_integration_does_not_emit_needs_input_from_pretooluse_without_classifier` |
| UC-3 | BR-10 | `codex_stop_payload_classifies_idle_or_needs_input` |
| UC-4 | BR-11, BR-12, BR-13 | `visible_codex_mcp_permission_prompt_marks_needs_input` |
| UC-4 | BR-12 | `visible_codex_permission_prompt_is_ignored_for_unmanaged_terminal` |
| UC-5 | BR-14, BR-15 | `codex_wrapper_launches_direct_cli_by_default_and_app_server_only_when_enabled` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Wrapper | `crates/tide-app/resources/bin/codex` | Inject Codex `UserPromptSubmit` and `Stop` hooks and point Codex to Tide-managed helper commands |
| CLI adapter | `crates/tide-app/src/adapter/inward/cli_adapter/` | Add a Codex-specific helper that parses the official `Stop` hook payload and transcript file and maps it to Tide lifecycle events |
| Gateway | `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs` | Reuse existing `notify` handling once the Codex helper resolves the main-thread final answer into `Idle` vs `NeedsInput` |
| App | `crates/tide-app/src/app.rs` | Detect visible Codex permission prompts in wrapper-managed `Terminal` Panes and route `NeedsInput` |
| Event loop | `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` | Run the visible-`Terminal` prompt scan after new terminal output |
| Shared routing | `docs/specs/agent-notification-routing.md` | Defines the common `AgentStatus` routing, inactive-Workspace projection, and notification activation behavior |
| Specs | `docs/specs/agent-auto-integration.md`, `docs/specs/agent-notification-routing.md`, `docs/specs/codex-needs-input-attention.md` | Record the Codex-specific event model |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/agent_gateway.rs` | Verify Codex running and completed-turn classification rules |
