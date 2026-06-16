# Spec: Multi-Step Prompt Navigation

## Scope

Let the user move **back and forth** across the steps of a multi-step agent prompt —
review and revise an earlier answer after moving on — before anything is committed.

Today the only batched multi-step prompt is claude's **AskUserQuestion** (1–4 questions
in one tool call). The card surfaces those questions one at a time with a `(i/N)` counter
baked into the message, and the flow is **forward-only**: answering question `i` deletes
its pending entry and surfaces `i+1`, so there is no way back
(`claude-stream-json-client.ts:213`, `:250-263`).

This slice replaces that forward-only backend state machine with a **client-side wizard**:
the backend emits the whole question set at once; the card lets the user navigate freely,
edit any step, and submits all answers together in one allow.

Single-step prompts — every permission/approval from claude, codex, gemini, opencode, and
a 1-question AskUserQuestion — must render and behave **exactly as today** (non-regression).

## Evidence

- `src/shared/contracts/prompt.ts` — `PromptStateDto` (single `message` + `choices` + `multiSelect`); `PromptChoiceDto`.
- `src/backend/.../structured/claude-stream-json-client.ts`
  - `:90-103` `PendingPermission.askUserQuestion = { questions, answers, index }`.
  - `:228-264` answer path: records one answer, advances `index`, re-surfaces next or allows.
  - `:280-341` `surfaceAskUserQuestion` — per-index emit; `:321` bakes `(i/N)` into `message`; `:335` deferred `setImmediate` emit to dodge the about-to-clear prior card.
  - `:672-678` AskUserQuestion `can_use_tool` carries the FULL `questions` array; surfaces index 0.
- `src/backend/.../structured/acp-client.ts:606-649` (gemini/opencode) and
  `codex-app-server-client.ts:513-528` (codex) — each emits a **single** `kind:"approval"`
  prompt per permission; no batching. Confirms only claude batches.
- Answer path up:
  - `prompt-card.tsx` → `onSelectChoice`/`onAnswerText` (`composer.tsx:301-306`).
  - `composer.ts:171-191` `answerPromptText` → command `prompt.answer { threadId, promptId, value }`.
  - `commands.ts:105-110` `"prompt.answer" { promptId, threadId, choiceId?, value? }`.
  - `thread-runtime-service.ts:690-725` `answerPrompt` → `promptAnswerValue` → `writeInput({ kind:"prompt_answer", value, choiceId, promptId })`.
  - `structured-runtime-events.ts:92-94` `StructuredRuntimeWrite.prompt_answer`.
- `prompt` passthrough: `view-model.ts:27` `prompt: state.promptState`; `events.ts:32,169`
  `promptState: payload.prompt` — **no field-by-field mapping**, so a new `steps` field on
  the type definitions flows end-to-end automatically.

## Decisions

- **Client-side wizard, single final submit.** Backend emits all questions as `steps`; the
  renderer owns navigation + per-step answer state; one `prompt.answer` carries every
  answer. (Chosen over keeping one-at-a-time + a backend "go back" signal, which keeps the
  laggy round-trip-per-step machine and its deferred-emit/cancel complexity.)
- **Only `steps.length > 1` is a wizard.** A 1-question AskUserQuestion and all single
  permission/approval prompts carry **no `steps`** and render byte-identically to today.
- **Each step pre-selects its `defaultChoiceId`** (mirrors today's default-first option), so
  every step always has a valid answer and Submit is always enabled. Free navigation only
  reviews/changes; it never leaves a required step blank by accident.
- **Footer per step:** `Back` (disabled on step 1) + `Next ▸` on steps `1..N-1`, `Back` +
  `Submit ⌘↵` on step `N`. Step **dots are clickable** to jump to any step. The single-step
  `Skip` button is **not** shown in a wizard (a step can still be blanked via "Other…" empty);
  single-step prompts keep `Skip` exactly as today.
- **`stepAnswers` is a typed contract field**, not an encoded string — consistent with the
  rest of the structured pipeline. Each entry is `{ stepId, value }` where `value` is the
  provider-native answer the renderer already resolves (a chosen option's `providerValue`,
  free text, or `""` to skip), i.e. exactly what the single-answer `value` carries today.
- **request-permission is out of multi-step by nature:** the agent acts on each answer
  immediately, so a prior permission cannot be navigated back to. Those stay single cards.

## Out Of Scope

- Start Composer setup flow (source → agent → branch) navigation — explicitly excluded.
- Any new batched/multi-question behavior for codex/gemini/opencode (they don't batch; this
  slice only guarantees their single prompts are unaffected).
- Keyboard "Back" shortcut (Back via button/dot click); arrows still move options, ⌘↵ goes forward.

## Domain Model

- `PromptStep` — one question in a batched prompt: `{ stepId, message, choices?, defaultChoiceId?, multiSelect? }`.
- `PromptStepAnswer` — one resolved answer: `{ stepId, value }`.
- `PromptState` gains optional `steps?: PromptStep[]`. When present with length > 1 the
  prompt is a navigable wizard; otherwise it is the existing single prompt.

## Contracts

Shared DTOs (`src/shared/contracts/prompt.ts`):

```ts
export interface PromptStepDto {
  stepId: string;            // stable per-step id (claude: "q-<index>")
  message: string;           // raw question text — chrome shows the i/N position
  choices?: PromptChoiceDto[];
  defaultChoiceId?: string;
  multiSelect?: boolean;
}
// PromptStateDto: + steps?: PromptStepDto[];
```

`commands.ts` `"prompt.answer"`: `+ stepAnswers?: PromptStepAnswerDto[]`
where `PromptStepAnswerDto = { stepId: string; value: string }`.

Backend domain (`thread.ts`) mirrors `PromptStep` + `PromptStepAnswer`; `PromptState` gains
`steps?`. `StructuredRuntimeWrite.prompt_answer` and `AnswerPromptInput` gain
`stepAnswers?: PromptStepAnswer[]` (passthrough). `promptState` type passthrough means
`AgentChatPromptState` + the view payload type also gain `steps?`.

## Flow

1. claude `can_use_tool(AskUserQuestion)` with N questions:
   - N === 1 → unchanged single prompt (no `steps`).
   - N > 1 → one `prompt` event: `steps = questions.map((q,i) => step("q-"+i, q))`, top-level
     `message`/`choices`/`multiSelect` mirror `steps[0]` (fallback for non-wizard consumers),
     `kind:"choice"`. One pending entry `{ requestId, toolInput, askUserQuestion:{ questions } }`.
2. Renderer renders the wizard; local state holds an answer per step (seeded from each
   step's `defaultChoiceId`). Back/Next/dot navigation only changes the visible step.
3. Final **Submit** → `prompt.answer { promptId, stepAnswers: [{ stepId, value }, …] }`.
4. `answerPrompt` forwards `stepAnswers` to `writeInput` (claim-guard + queue logic unchanged).
5. claude client `write`: for an AskUserQuestion pending with `stepAnswers`, build the
   `answers` map (stepId `q-<i>` → `questions[i].question`; value interpreted as today —
   strip `STRUCTURED_OPTION_PREFIX` for a listed option, keep free text verbatim, `""` skips/
   omits), then `sendAskUserQuestionAllow(requestId, toolInput, answers)` **once**. A
   `STRUCTURED_DENY_TOKEN` value denies the whole tool.

## Invariants

- A prompt with no `steps` (or `steps.length === 1`) renders and answers exactly as before.
- A wizard never commits any answer until the single final Submit (free navigation is lossless).
- Every step has an answer at Submit time (default-seeded), so claude never sees a missing
  required answer unless the user actively blanks a step.
- claude receives exactly one `control_response` allow per AskUserQuestion tool call.
- The service-layer synchronous answer-claim and `promptQueue` promotion are unchanged
  (multi-step is still one prompt, answered once).

## Tests

Backend (claude client, fake child):
- N>1 AskUserQuestion → emits ONE `prompt` with `steps.length === N`, each step's `message`
  is the raw question (no `(i/N)`), top-level mirrors step 0.
- N===1 → no `steps`; identical to current single-question emission.
- `prompt_answer` with `stepAnswers` (mixed option + free-text + skipped) → one allow whose
  `updatedInput.answers` maps each question text to the interpreted answer; skipped omitted.
- `prompt_answer` with `STRUCTURED_DENY_TOKEN` → one `deny`.

Renderer (PromptCard):
- `steps.length > 1` → wizard chrome (Back/Next/Submit + dots); Back disabled on step 1;
  Submit only on last step; selecting then navigating away and back preserves the selection;
  editing an earlier step changes only that step; Submit emits one `stepAnswer` per step.
- No `steps` → no wizard chrome; Skip + Submit present; single-select and multiSelect behave
  as today (regression guard, also stands in for codex/gemini/opencode single approvals).

Contract/arch:
- DTO ↔ domain `steps` shapes stay structurally compatible (existing boundary tests).

## Implementation Notes

- Deletes the per-index re-surface, the `setImmediate` deferred emit, and the
  `index`-advancing answer path for N>1 in the claude client (kept only for the N===1 single path).
- No mapping code edits for `steps` down — type additions suffice (passthrough).
- Add one renderer handler `onAnswerPromptSteps(stepAnswers)` parallel to `onAnswerPromptText`;
  agent-chat action `answerPromptSteps` builds the `prompt.answer` command with `stepAnswers`.
- "make sure other agents' question interface": covered by the no-`steps` regression test
  plus a live check that a codex/gemini approval still renders as a single card.
