# Spec: Agent Chat Fidelity — Reasoning, Message Actions, Usage Meter

## Scope

Close the felt gap between the Tide v2 Agent Chat transcript and the native
Codex/Claude apps by adding three provider-neutral transcript details:

1. **Reasoning / thinking** renders as a quiet, collapsible disclosure that stays
   secondary to the answer (not a prominent card, not flattened into the answer).
2. **Per-answer hover actions**: copy the answer, retry the prompt.
3. **Context/token usage meter**: a quiet chip above the composer showing the
   provider's last-known context %/token usage for the active thread.

It does not cover any provider-specific reasoning UI.

## Evidence

- `docs_v2/master-plan.md`: Agent Chat owns the conversation narrative; the
  baseline UX follows the Codex app.
- Before this slice, codex/claude reasoning was dropped or shown as an `event`
  card; there was no role for it in the block contract.
- `src/.../agent-chat-shell.ts` already groups tool blocks into an expandable
  Codex-style activity summary, renders markdown answers, file chips, and diffs —
  so the basics were present; reasoning + per-answer actions were the gap.

## Decisions

- Reasoning is a first-class block **role** (`reasoning`) and **kind**
  (`reasoning`), added to both the shared contract DTO and the backend domain.
- Reasoning is **provider-neutral** in the UI but **provider-adapted** at the
  source: codex `agent_reasoning` event_msg + `reasoning` response_item summary;
  claude extended-thinking content items (`type: "thinking"`). Antigravity has no
  cheap reasoning channel yet and is intentionally not wired (acceptable
  per-provider adaptation — empty reasoning simply does not render).
- Empty/encrypted reasoning (no readable text) is dropped, never shown as a
  hollow disclosure.
- Reasoning is expanded while streaming (watch it think) and collapsed once the
  turn completes; a user toggle wins over the stream-follow default.
- Retry = resend the preceding user prompt as a new turn (providers do not
  support in-place regeneration), routed through the normal composer submit path.

## Domain Model

- `AgentSessionBlockRole`: add `reasoning`.
- `AgentSessionBlockKind`: add `reasoning`.
- A reasoning block carries `title` (e.g. "Thinking") + `body` (the reasoning
  text), `role: "reasoning"`, `kind: "reasoning"`.

## Contracts

- `AgentSessionBlockRoleDto`: add `reasoning`.
- `AgentSessionBlockReference.role` (thread domain): add `reasoning`.
- No new event kinds.

## Flow

- Live codex/claude: provider-history readers emit a `reasoning` provider_record
  frame; the agent-session reader maps it to a reasoning block.
- Reopen: provider-conversation-rebuilders emit reasoning blocks from the same
  history.
- Renderer: `renderSessionItem` routes `role/kind === "reasoning"` to a
  `ReasoningTurn` collapsible; agent answer turns get an event-delegated
  copy/retry action strip revealed on hover/focus.

## Invariants

- A reasoning block never renders as an answer turn, and never enters the tool
  activity group.
- Copy/retry actions appear only on completed, non-empty agent answers.
- The transcript stays clean at rest: actions are invisible until hover/focus.

## Tests

- 580 existing behavior tests stay green (optional contract fields, additive
  roles).
- Renderer fixture (`dev-harness ?mode=rich`) exercises reasoning + actions for
  visual verification.

## Implementation Notes

- Files: `shared/contracts/agent-session-block.ts`,
  `backend/.../agent-session/agent-session-block.ts`,
  `backend/.../thread/thread.ts`,
  `backend/.../fixture-agent-session-reader.ts`,
  `backend/infrastructure/node/provider-history-helpers.ts`,
  `backend/infrastructure/node/live-backend-json.ts`,
  `backend/infrastructure/node/provider-history-readers.ts`,
  `backend/infrastructure/node/provider-conversation-rebuilders.ts`,
  `desktop/.../agent-chat-shell-state.ts`,
  `desktop/.../agent-chat-shell.ts`, `desktop/.../tide-product-shell.ts`,
  `desktop/renderer/tide-product-shell.css`, `desktop/renderer/dev-harness.ts`.

## Usage Meter (implemented)

- contract: `AgentRuntimeUsageDto { totalTokens?, contextWindow?,
  contextUsedPercent?, model? }` + a dedicated additive event
  `agentRuntime.usageChanged { threadId, usage }` (chosen over mutating existing
  event payloads so the 580 existing tests stay untouched).
- backend: `provider-usage.ts` parses codex `token_count`
  (`info.total_token_usage.total_tokens`, `model_context_window`) and claude
  assistant `usage`; `live-backend` emits `usageChanged` on each codex/claude
  history poll, de-duped by a per-thread usage signature so the chip doesn't
  churn every tick.
- state: `AgentChatShellState.usage`; gated to the active thread via
  `threadIdFromBackendEvent`; reset on hydrate (thread switch).
- renderer: a quiet right-aligned `NN% context · NN.Nk tokens` chip with an
  optional context-window meter bar, above the composer.
- tests: `tests/provider-usage.test.ts` (5), `tests/provider-reasoning.test.ts`
  (6). Full suite 591 green.

## Out Of Scope — Future

- Antigravity reasoning + usage channels (server-first; no cheap transcript
  field yet).
- Live per-token streaming of the usage chip during a turn (currently updates
  on each history poll, which is frequent enough).
