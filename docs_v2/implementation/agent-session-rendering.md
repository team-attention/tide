# Implementation Plan: Agent Session Rendering

Status: draft derived from `docs_v2/master-plan.md`.

This document is not the product source of truth. It records a possible implementation breakdown for the Agent Session Rendering Model after the master plan direction is stable.

## Overview

### As-Is

`docs_v2/master-plan.md` defines Agent Runtime as the hidden provider process that powers a Thread. It defines Agent Session as the visible app rendering of the Raw Agent Session inside Agent Chat.

The current master plan already fixes these principles:

- Agent Runtime is not shown as a default Terminal Pane.
- Agent Chat renders Agent Runtime output as Agent Session.
- Raw Agent Session remains the source of truth.
- Unknown provider output falls back to raw or text blocks.
- The rendering pipeline is `Agent Runtime output -> Raw Agent Frame -> Agent-specific reader -> Agent Session Block -> Agent Session UI`.

The missing design is the concrete block model, reader contract, cache behavior, and first implementation slices.

### To-Be

Tide has a renderer-agnostic Agent Session model that can be implemented before the final UI surface decision.

The target model:

```text
Raw Agent Session
  owns provider-native session identity and raw output

Raw Agent Frame
  records one bounded observed unit from Agent Runtime output

Agent-specific reader
  converts Raw Agent Frames into Agent Session Blocks

Agent Session Block
  is the stable render/cache unit for Agent Chat

Agent Session UI
  renders blocks and sends user input through Composer
```

Agent Session Blocks are not tied to WGPU, WebView, native views, or any single renderer. They are product data first.

### Approach

1. Define the Agent Session Block schema.
2. Define Raw Agent Frame provenance and ordering.
3. Define Agent-specific reader rules.
4. Define cache and replay behavior.
5. Define first provider fixtures from bounded samples.
6. Implement the smallest reader path first: structured JSON/JSONL or synthetic frames into Agent Session Blocks.
7. Add PTY Transcript support after block rendering and fallback behavior are stable.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| Agent Integration | Launches/resumes the provider runtime, sends input, reads output, and labels provider capabilities. |
| Agent Runtime | Hidden provider process for one Thread. |
| Raw Agent Session | Provider-native session identity, log reference, resume identity, and raw output evidence. |
| Agent Session | Visible product rendering of a Raw Agent Session. |
| Agent Session Cache | Cached Agent Session Blocks for fast Thread reopen. |
| Composer | Sends user input and provider-native In-Session Commands to Agent Runtime. |
| Workbench | Provides visible file, diff, browser, editor, and terminal references linked from Agent Session Blocks. |

## Core Model

### Raw Agent Frame

Raw Agent Frame is the smallest bounded unit Tide records before interpretation.

Fields:

| Field | Purpose |
|-------|---------|
| `frame_id` | Stable Tide id for the observed frame. |
| `thread_id` | Thread that owns the frame. |
| `agent` | Provider identity: Codex CLI, Claude Code, or Antigravity CLI. |
| `lane` | `structured_batch`, `interactive_pty`, `provider_log`, or `raw_output`. |
| `source_ref` | Provider session id, log path, transcript offset, or stream offset. |
| `sequence` | Monotonic order within the Raw Agent Session observation stream. |
| `observed_at` | Tide observation time. |
| `payload_kind` | `json`, `text`, `ansi_text`, `stdout`, `stderr`, or `provider_record`. |
| `payload` | Bounded raw payload. |
| `truncated` | Whether Tide bounded the payload for safety. |

Rules:

- Raw Agent Frames are append-only for one observation pass.
- Readers may re-read provider logs and create equivalent frames, but they must preserve stable ordering.
- Tide must be able to show the raw frame payload for debugging or fallback.

### Agent Session Block

Agent Session Block is the stable renderable unit inside Agent Session.

Fields:

| Field | Purpose |
|-------|---------|
| `block_id` | Stable Tide id for rendering and cache diffing. |
| `thread_id` | Thread that owns the block. |
| `agent` | Provider identity that produced the block. |
| `kind` | Block kind. |
| `role` | `user`, `agent`, `tool`, `system`, or `runtime` when applicable. |
| `source_frame_ids` | Raw Agent Frames used to produce this block. |
| `status` | `pending`, `streaming`, `complete`, `failed`, or `needs_input`. |
| `title` | Short display label when the block needs one. |
| `body` | Renderable text, markdown, command text, or summary. |
| `data` | Structured provider-specific or Workbench-linked payload. |
| `raw_fallback` | Raw text shown when Tide cannot safely interpret the frame. |
| `created_at` | First observation time. |
| `updated_at` | Last update time for streaming or repaired blocks. |

Rules:

- Every block must retain provenance through `source_frame_ids`.
- A block may merge multiple adjacent frames only when the reader can prove they represent one user-facing unit.
- A block must never hide user-visible provider output without a raw fallback.
- `data` may contain provider-native fields, but UI labels must keep provider-native names when exposed.

### Block Kinds

Conversation:

- `user_message`
- `agent_message`
- `markdown`
- `code_block`

Runtime:

- `working_status`
- `progress_status`
- `waiting_for_input`
- `waiting_for_approval`
- `error`

Tool and action:

- `tool_call`
- `tool_result`
- `command_run`
- `file_read`
- `file_edit`
- `search`
- `browser_action`
- `mcp_call`

Review and artifact:

- `file_change`
- `diff_summary`
- `generated_file`
- `link`
- `attachment`
- `workbench_reference`

Interaction:

- `approval_prompt`
- `question_prompt`
- `choice_prompt`
- `command_picker`
- `model_picker`

Fallback:

- `raw_block`

## Reader Contract

An Agent-specific reader converts Raw Agent Frames into Agent Session Blocks.

Reader inputs:

- Thread metadata.
- Agent Binding.
- Launch Options when needed for interpretation.
- Raw Agent Session ref.
- Raw Agent Frames in sequence order.
- Existing cached blocks when repairing or appending.

Reader outputs:

- New or updated Agent Session Blocks.
- Last Known State update.
- Optional Supported Agent Feature observations.
- Optional Workbench references.
- Reader diagnostics for raw/debug view.

Rules:

- Readers are provider-specific at the boundary and product-normalized at the block output.
- Readers must prefer structured provider events when available.
- Readers must preserve PTY Transcript text when structured events are unavailable or incomplete.
- Readers must emit `raw_block` for unknown frames.
- Readers must be idempotent for the same ordered frame input.
- Readers must handle partial streaming blocks without requiring a final provider event.
- Readers must not invent file changes, approvals, tool calls, or model state without provider output evidence.

## Use Cases

### UC-1: Render Structured Batch Output

Actor: Tide.

Trigger: An Agent Integration receives structured JSON, JSONL, or stream output from a non-interactive provider mode.

Precondition:

- Thread has Agent Binding.
- Raw Agent Frames have `lane = structured_batch`.

Flow:

1. Tide records each structured event as a Raw Agent Frame.
2. The Agent-specific reader maps known event types to Agent Session Blocks.
3. Unknown structured events become `raw_block`.
4. Agent Session UI renders the resulting blocks.

Postcondition:

- Agent Session shows a readable block sequence.
- Raw Agent Frame provenance is retained.

Business rules:

- BR-1: Known structured message events become conversation blocks.
- BR-2: Known tool or command events become tool/action blocks.
- BR-3: Unknown structured events become raw blocks.
- BR-4: Reader output is stable for the same ordered frame list.

### UC-2: Render Interactive PTY Output

Actor: Tide.

Trigger: An Agent Runtime streams terminal-backed output from an interactive provider session.

Precondition:

- Thread has active Agent Runtime.
- Raw Agent Frames have `lane = interactive_pty`.

Flow:

1. Tide captures bounded PTY Transcript frames.
2. The Agent-specific reader detects safe patterns for messages, prompts, or statuses.
3. Unrecognized terminal output becomes `raw_block`.
4. Streaming text updates the current block until the reader detects a boundary.

Postcondition:

- Agent Session remains readable while preserving raw output.

Business rules:

- BR-1: PTY output must remain available as raw fallback.
- BR-2: Partial output may render as `streaming`.
- BR-3: Reader boundaries must be conservative.
- BR-4: Prompt-like output may become `waiting_for_input` only when the provider output supports that interpretation.

### UC-3: Ask For Approval

Actor: Agent Runtime.

Trigger: Provider output asks the user to allow or deny an action.

Precondition:

- Reader sees provider-supported approval evidence.

Flow:

1. Reader emits `approval_prompt`.
2. Agent Session UI renders provider-native action labels.
3. User chooses an action in Agent Chat.
4. Composer or Agent Integration sends the provider-native response back to Agent Runtime.

Postcondition:

- Thread returns to running, idle, failed, or waiting state based on subsequent output.

Business rules:

- BR-1: Approval labels must remain provider-native.
- BR-2: Tide must not auto-approve through the renderer.
- BR-3: Approval prompt block keeps raw provenance.

### UC-4: Ask A Question

Actor: Agent Runtime.

Trigger: Provider output asks the user for free-form input or a choice.

Precondition:

- Reader sees provider-supported question or choice evidence.

Flow:

1. Reader emits `question_prompt` or `choice_prompt`.
2. Agent Session UI renders the prompt.
3. User answers through Composer or prompt controls.
4. Agent Integration sends the answer to Agent Runtime.

Postcondition:

- The answer appears as a user-visible block or is linked to the prompt block.

Business rules:

- BR-1: Free-form answers use Composer unless provider output requires a choice.
- BR-2: Choice labels must remain provider-native.
- BR-3: Prompt state must survive Thread reopen through Agent Session Cache.

### UC-5: Reopen A Thread

Actor: User.

Trigger: User opens an existing Thread.

Precondition:

- Thread metadata has Raw Agent Session ref.
- Agent Session Cache may or may not exist.

Flow:

1. Tide loads Thread metadata.
2. Tide shows Agent Session Cache if present.
3. If cache is absent or stale, Tide rebuilds blocks from Raw Agent Session logs or available frames.
4. Agent Runtime remains stopped until follow-up or live attachment is needed.

Postcondition:

- User sees the previous Agent Session without manually resuming a terminal command.

Business rules:

- BR-1: Cache is an optimization, not source of truth.
- BR-2: Rebuild must preserve raw provenance when raw frames are available.
- BR-3: Reopen must not start Agent Runtime by default.

### UC-6: Send Follow-Up

Actor: User.

Trigger: User sends a message in Follow-up Composer.

Precondition:

- Thread has Agent Binding.
- Thread has Raw Agent Session ref or fallback launch path.

Flow:

1. Tide records the user message as an Agent Session Block.
2. Agent Integration resumes or attaches to the Raw Agent Session when possible.
3. New Raw Agent Frames stream into the reader.
4. Reader appends or updates Agent Session Blocks.

Postcondition:

- Follow-up output appears in the same Agent Session.

Business rules:

- BR-1: Sending a follow-up uses provider-native resume behavior when possible.
- BR-2: If native resume fails, the failure appears as recovery UI, not raw terminal noise by default.
- BR-3: The user message block must precede output caused by that message.

### UC-7: Link Workbench Artifacts

Actor: Tide or Agent Runtime.

Trigger: Output references a file, diff, browser result, generated artifact, or command output.

Precondition:

- Reader has enough evidence to identify the reference target.

Flow:

1. Reader emits `workbench_reference`, `file_change`, `diff_summary`, `generated_file`, or `link`.
2. Agent Session UI renders an affordance.
3. User opens the linked Workbench Pane or Workbench View.

Postcondition:

- Agent Session remains the narrative and Workbench provides inspection or action.

Business rules:

- BR-1: Workbench references must target Thread-owned state.
- BR-2: Missing targets must render as unavailable references, not broken UI.
- BR-3: File/diff claims require raw output or repository evidence.

## Invariants

1. Raw Agent Session remains the source of truth.
2. Agent Session Cache is derived state.
3. Raw Agent Frames are ordered and retain source references.
4. Every Agent Session Block has provenance through Raw Agent Frames, except local user input blocks created before provider output exists.
5. Unknown provider output becomes `raw_block`.
6. Readers are conservative: they interpret only supported provider evidence.
7. Agent Session Blocks are renderer-agnostic.
8. UI affordances must not remove access to raw output for unsupported provider behavior.
9. Provider-native feature names remain provider-native in user-visible controls.
10. Opening a Thread does not start Agent Runtime by default.

## Tests

The first implementation should add behavior tests that map to these business rules.

| Use Case | Business Rule | Test Name |
|----------|---------------|-----------|
| UC-1 | BR-1 | `structured_message_events_render_as_conversation_blocks` |
| UC-1 | BR-3 | `unknown_structured_events_render_as_raw_blocks` |
| UC-1 | BR-4 | `reader_output_is_stable_for_same_frame_sequence` |
| UC-2 | BR-1 | `interactive_pty_output_preserves_raw_fallback` |
| UC-2 | BR-2 | `partial_pty_output_renders_as_streaming_block` |
| UC-3 | BR-1 | `approval_prompt_uses_provider_native_labels` |
| UC-3 | BR-2 | `approval_prompt_does_not_auto_approve_from_renderer` |
| UC-4 | BR-3 | `question_prompt_state_survives_thread_reopen` |
| UC-5 | BR-1 | `agent_session_cache_is_derived_from_raw_session` |
| UC-5 | BR-3 | `opening_thread_does_not_start_agent_runtime` |
| UC-6 | BR-1 | `follow_up_uses_provider_native_resume_when_available` |
| UC-6 | BR-3 | `follow_up_user_message_precedes_resulting_output` |
| UC-7 | BR-1 | `workbench_reference_targets_thread_owned_state` |
| UC-7 | BR-2 | `missing_workbench_reference_renders_unavailable` |

## Implementation Slices

### Slice 1: Product Data Types

- Add renderer-agnostic `RawAgentFrame`.
- Add renderer-agnostic `AgentSessionBlock`.
- Add block kind enum.
- Add source provenance fields.

### Slice 2: Fixture Reader

- Build a synthetic reader for test fixtures.
- Prove block ordering, raw fallback, and cache serialization.
- Use bounded local samples only.

### Slice 3: Structured Reader

- Add a reader path for structured JSON or JSONL frames.
- Start with Codex `exec --json` style non-interactive output because local help shows structured JSONL support.
- Keep this as evidence for block vocabulary, not as proof of live Thread behavior.

### Slice 4: PTY Transcript Reader

- Add PTY Transcript frame capture for interactive sessions.
- Preserve raw text first.
- Add conservative prompt/status detection only after fixtures exist.

### Slice 5: Cache And Reopen

- Store Agent Session Cache beside Thread metadata.
- Reopen Thread from cache without starting Agent Runtime.
- Rebuild from Raw Agent Session ref when cache is absent or stale.

### Slice 6: Prompt Round Trip

- Connect `approval_prompt`, `question_prompt`, and `choice_prompt` to Composer or prompt controls.
- Send provider-native responses back through Agent Integration.

## Location

Current product docs:

- `docs_v2/master-plan.md`
- `docs_v2/glossary.md`
- `docs_v2/research/ui-rendering-surface.md`

Expected implementation areas:

- Agent Integration and runtime launch/resume code.
- Thread metadata and Agent Session Cache storage.
- Agent Chat renderer surface.
- Behavior tests for Agent Session readers and Thread reopen behavior.

## Open Questions

1. What exact code module should own Agent Session Block types?
2. Should Raw Agent Frames be persisted permanently, or only provider log refs plus derived cache?
3. How much PTY Transcript should Tide retain for debug and fallback?
4. Should local user input blocks have synthetic Raw Agent Frames, or a separate local provenance field?
5. Which provider should be the first real reader after fixture reader?
