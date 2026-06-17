# Spec: Prompt Full-Fidelity Fields

## Scope

Carry **every field a provider attaches to a user-facing prompt** through Tide's prompt
pipeline, instead of collapsing each prompt to a single `message` string + bare
`{label}` options. Covers all four providers' prompt surfaces:

- **claude — AskUserQuestion** (`kind:"choice"`, single + wizard): surface `question.header`
  (chip label), per-option `description` and `preview`; add a return channel for the user's
  per-question **`notes`** (and echo the selected option's `preview`) into the tool's
  `annotations`.
- **claude — permission** (`kind:"approval"`): surface the tool's structured input (command /
  diff / target) as a card **detail**, not a flattened one-liner.
- **codex — approval** (`kind:"approval"`): surface `command` + `cwd` for command approvals
  as a card detail. (fileChange approvals carry NO inline diff — see Decisions — so they stay
  headline-only with `reason`.)
- **gemini + opencode — permission** (`kind:"approval"`, shared ACP): surface
  `toolCall.content` (diff/command preview) + `toolCall.locations` (affected paths) as a
  detail, and carry each option's ACP **`kind`** (`allow_once` / `allow_always` /
  `reject_once` / `reject_always`) instead of re-deriving the default by string-matching
  `proceed_once`.

This is the "include everything the tool schema gives us, for every agent" follow-up to the
[Multi-Step Prompt Navigation](./multi-step-prompt-navigation.md) wizard. The wizard card is
extended in place; single prompts stay single.

## Evidence

Drop sites (current code; each reads only a subset of what the provider sends):

- `claude-ask-user-question.ts:210 buildOptionChoices` — reads `option.label` ONLY.
  Drops `option.description`, `option.preview`, and `question.header`
  (`buildAskUserQuestionStep:227` likewise). `sendAskUserQuestionAllow:194` returns
  `updatedInput = { ...toolInput, answers }` — **no `annotations`** (so user notes have no
  way back). AskUserQuestion tool input schema (harness contract): `questions[]` =
  `{ question, header, multiSelect, options[]{ label, description, preview? } }`; the
  response carries `answers` + `annotations[questionText]{ notes?, preview? }`.
- `claude-stream-json-client.ts:570-595` — flattens `tool_name` + full `input`
  (`command`/`url`/`query`/`path`/`file_path`/`pattern`/`description`) to ONE `message`
  string; Allow/Deny only.
- `codex-app-server-client.ts:491-529` — header comment `:20-21` confirms params shapes:
  `item/commandExecution/requestApproval {command, cwd, reason?}` and
  `item/fileChange/requestApproval`. `surfaceApproval:512` takes a single pre-joined
  `message` string; `cwd` and the file-change diff are dropped. Decision collapsed to
  `accept`/`decline` (`:294`).
- `acp-client.ts:603-650 surfacePermission` — reads `toolCall.title` + `options[]{optionId,
  name}` only. Drops `toolCall.content` (parseable today via `acpToolOutput`, used at
  `:559` for tool results), `toolCall.locations`, `toolCall.kind`, and **`options[].kind`**.
  Default option is re-derived by string-matching `proceed_once`/`proceed` (`:633-638`) —
  gemini-specific, fragile for opencode / other ACP agents.

Passthrough plumbing (so down-path fields need NO mapping edits — same as how `steps` was
added in multi-step-prompt-navigation):

- `view-model.ts` `prompt: state.promptState`; `events.ts` `promptState: payload.prompt` —
  no field-by-field mapping; new optional fields on the DTO/domain types flow end-to-end.
- Answer up-path (for the new `notes`): `prompt-card.tsx` `onAnswerText`/`onAnswerSteps` →
  `composer.ts answerPromptText` → command `prompt.answer { threadId, promptId, value,
  stepAnswers? }` (`commands.ts:131`) → `thread-runtime-service.ts answerPrompt` →
  `writeInput({ kind:"prompt_answer", value, stepAnswers, … })`
  (`structured-runtime-events.ts:102`, `agent-runtime.ts:27`, `thread-runtime-api.ts:175`,
  `agent-integration-agent-runtime-port.ts:218`).

## Decisions

- **Down-path (display) fields are pure passthrough.** Add optional fields to the shared
  DTOs and the backend domain mirror, populate them at each `surface*` function, render them
  in the card. No `view-model`/`events` mapping edits (mirrors `steps`).
- **Per-option vs per-prompt richness are separate shapes.**
  - Per-option (claude AUQ): `PromptChoiceDto` gains `description?` + `preview?`.
  - Per-prompt (approvals): `PromptStateDto` gains `detail?: PromptDetailDto` = the thing
    being approved (command/diff body + format + affected paths).
  - The short question chip (claude AUQ `header`) is per-prompt/per-step: `header?`.
- **Option semantics carry as a typed `kind`, not string-matching.** `PromptChoiceDto.kind?:
  PromptChoiceKindDto` (`allow_once`/`allow_always`/`reject_once`/`reject_always`). ACP fills
  it from `options[].kind`; claude/codex leave it undefined. Default-option selection and
  allow/reject styling key off `kind` when present, falling back to today's first-option
  default when absent. This **replaces** the `proceed_once` string match (kept only as the
  fallback for an ACP agent that omits `kind`).
- **`notes` is claude-AskUserQuestion-only, and that is correct.** The "note attached to a
  selection" affordance exists in exactly one provider schema (AUQ `annotations.notes`).
  codex/gemini/opencode approval prompts have **no native notes sink** — "everything in
  their schema" for them is the display detail (content/locations/option-kind), which we DO
  add. So the notes textarea renders ONLY on AUQ cards (`kind:"choice"` with AUQ origin);
  approval cards never show it. This keeps the round-trip honest (no note silently dropped).
- **`notes` rides the existing answer channel as a typed field**, parallel to `value`
  (single) / per-step (`PromptStepAnswerDto.notes?`). claude packs it into
  `updatedInput.annotations[questionText] = { notes?, preview? }`, alongside the existing
  `answers`. `preview` is the **echo** of the selected option's authored preview (not user
  input) — set mechanically when the chosen option had a `preview`.
- **Detail is provider-normalized, not raw protocol.** Each `surface*` builds a
  `PromptDetailDto`; the renderer is provider-agnostic (renders `format:"diff"` as a diff,
  `"text"` as monospace, plus a locations line). Reuse the existing `acpToolOutput` parser
  for ACP `toolCall.content`.

## Out Of Scope

- New batched/multi-question behavior for codex/gemini/opencode (they don't batch; unchanged).
- codex per-session approval scope (`approve_for_session` style). Decision stays
  `accept`/`decline`; recorded as a follow-up, since it needs a third choice + protocol check.
- claude permission "allow always" / permission-mode mutation as card choices (separate
  concern from surfacing the request detail).
- Rich/interactive `preview` rendering (image mockups). `preview` renders as text/code in
  this slice; richer media is a later polish.

## Domain Model

- `PromptChoice` (domain, `thread.ts`) gains `description?`, `preview?`, `kind?`.
- `PromptState`/`PromptStep` gain `header?`; `PromptState` gains `detail?`.
- `PromptStepAnswer` gains `notes?`; the single-answer write gains `notes?`.
- `PromptDetail` = `{ format: "text" | "diff"; body: string; locations?: string[] }`.
- `PromptChoiceKind` = `"allow_once" | "allow_always" | "reject_once" | "reject_always"`.

## Contracts

`src/shared/contracts/prompt.ts`:

```ts
export type PromptChoiceKindDto =
  | "allow_once" | "allow_always" | "reject_once" | "reject_always";

export interface PromptChoiceDto {
  choiceId: string;
  label: string;
  providerValue: string;
  description?: string;          // per-option explanation (claude AUQ option.description)
  preview?: string;             // per-option preview content (claude AUQ option.preview)
  kind?: PromptChoiceKindDto;   // ACP option.kind; undefined for claude/codex
}

export interface PromptDetailDto {
  format: "text" | "diff";      // monospace command/summary vs unified diff
  body: string;                 // command (+cwd), diff text, or tool-input summary
  locations?: string[];         // affected file paths (ACP toolCall.locations)
}

export interface PromptStateDto {
  // …existing…
  header?: string;              // short chip label (claude AUQ question.header)
  detail?: PromptDetailDto;     // approval preview (claude/codex/ACP)
}

export interface PromptStepDto {
  // …existing…
  header?: string;
}

export interface PromptStepAnswerDto {
  stepId: string;
  value: string;
  notes?: string;               // free-text note attached to this step (claude annotations)
}
```

`commands.ts` `"prompt.answer"`: `+ notes?: string` (single-prompt note, parallel to `value`).

Backend domain (`thread.ts`) mirrors all of the above. `StructuredRuntimeWrite.prompt_answer`,
`AnswerPromptInput`, and the runtime port gain `notes?` (passthrough, like `stepAnswers`).

## Flow

**Down (display) — passthrough:**

1. Each `surface*` populates the new fields:
   - claude AUQ: `buildOptionChoices`/`buildAskUserQuestionStep` read `option.description`,
     `option.preview`; step/prompt set `header` from `question.header`.
   - claude permission: build `detail` from the tool input (command/path/diff → `format`+`body`).
   - codex: command approval → `detail{ format:"text", body: command + cwd }` (fields verified
     against the schema). fileChange approval → headline only (`reason`): its params carry no
     diff (see Decisions).
   - ACP: `detail` from `acpToolOutput(toolCall.content)` + `toolCall.locations`; each choice
     gets `kind` from `options[].kind`.
2. DTO/domain type additions flow through `view-model`/`events` unmapped to `PromptCard`.
3. `PromptCard` renders: `header` chip, per-option `description`/`preview`, `detail`
   (diff/text + locations). Default selection + allow/reject styling key off `choice.kind`.

**Up (notes) — threaded:**

4. AUQ card shows a notes textarea per question (coexists with the selection, NOT mutually
   exclusive with "Other…"). Single prompt → `prompt.answer { …, notes }`; wizard → each
   `PromptStepAnswerDto` carries `notes`.
5. `answerPrompt` forwards `notes` to `writeInput` (claim-guard/queue unchanged).
6. claude client builds `annotations[questionText] = { notes?, preview? }` (preview echoed
   from the chosen option), then `sendAskUserQuestionAllow` sets
   `updatedInput = { ...toolInput, answers, annotations }`.

## Invariants

- A prompt with none of the new fields renders byte-identically to today (every field optional).
- Down-path additions require zero `view-model`/`events` mapping edits.
- The notes textarea appears ONLY on AskUserQuestion cards; approval/permission cards never
  collect notes (no native sink ⇒ nothing silently dropped).
- ACP default option is chosen by `kind` (`allow_once` first) when present; the `proceed_once`
  string match remains only as the no-`kind` fallback.
- claude still receives exactly one `control_response` allow per AskUserQuestion; `annotations`
  is additive to the existing `answers` (absent when no notes/preview).
- A choice's `providerValue` (answer routing token) is unchanged by any display field.

## Tests

Backend:
- claude AUQ: option `description`/`preview` and question `header` populate the emitted
  `PromptState`/`steps`; absent fields stay undefined.
- claude AUQ answer with `notes` → `updatedInput.annotations[q] = { notes }`; with a chosen
  option that has a `preview` → `annotations[q].preview` echoes it; no notes ⇒ no `annotations`.
- claude permission: tool input → `detail` (command → text, edit/write → diff).
- codex: commandExecution approval → `detail.body` includes command + cwd. (fileChange has no
  inline diff → no codex fileChange detail test.)
- ACP: `surfacePermission` populates `detail` from `toolCall.content`/`locations` and each
  choice's `kind`; default option chosen by `kind` (allow_once) without the string match;
  no-`kind` payload still defaults via the fallback.

Renderer (`PromptCard`):
- Renders `header` chip, option `description`/`preview`, and `detail` (diff vs text + locations).
- AUQ card: notes textarea present, coexists with a selected option; Submit emits `notes`.
- Approval card (codex/gemini/opencode/claude permission): NO notes textarea; renders `detail`.
- All-optional regression: a prompt with no new fields matches the current snapshot.

Contract/arch: DTO ↔ domain new fields stay structurally compatible (existing boundary tests).

## Implementation Notes

- **Slice 1 — down-path display fidelity** (DTOs + domain + 4 `surface*` + `PromptCard`
  render + `choice.kind` default/styling). Pure additive + passthrough; no answer-channel
  change. Self-contained and shippable. **DONE + verified** (typecheck 0; full suite
  979 pass / 0 fail / 2 skip; file-size ratchet green). Tests: `prompt-full-fidelity-fields.test.ts`
  (the 4 per-provider mappers) + an AUQ header/description/preview assertion in
  `claude-ask-user-question.test.ts`. Also fixed a pre-existing leak where the internal
  `structured:` answer-routing token was shown as an option's secondary text.
- **Slice 2 — up-path notes** (notes textarea on AUQ card → `prompt.answer.notes` /
  `PromptStepAnswerDto.notes` → claude `annotations`). **DONE + live-verified.** Wizard path
  threads via `stepAnswers` (`PromptStepAnswer.notes`); single-card answers (pick included)
  route through `onAnswerText(value, notes)` — AUQ picks are rerouted from the shared
  choice-surface path to the value path so a note rides along, leaving approval picks on the
  `onSelectChoice` choiceId path. **The live gate PASSED**: on a real AUQ turn the note was
  packed into `updatedInput.annotations` and claude acted on it (it echoed a token embedded in
  the note), so claude **does** honor `updatedInput.annotations` — no `answers`-text fallback
  needed. Tests: notes→annotations + preview-echo + no-note⇒no-annotations + wizard per-step
  notes in `claude-ask-user-question.test.ts`.
- **Slice 1 deviation:** ACP detail is built by a dedicated `buildAcpPermissionDetail`
  (extracted to `acp-permission.ts`), NOT by reusing `acpToolOutput` as first planned —
  `acpToolOutput` is text-only (for tool RESULTS) and drops `diff` content items, so it
  cannot surface an edit's diff. The new parser handles both text and diff content and must
  stay separate so tool-result rendering keeps its text-only behavior. The extraction also
  kept `acp-client.ts` under the 800-line file-size cap (was 841).
- `PromptCard` already centralizes option rendering in `renderOptions`; add
  `description`/`preview` there and `detail`/`header` in the card head — single render path
  shared by single card + wizard step.
- Live-verify outcomes (Playwright against real providers, `scripts/pw-*-verify.cjs`):
  - **claude reads `updatedInput.annotations`** — confirmed: a note instructing claude to echo
    a token produced that token in claude's follow-up, so the notes round-trip is real (the
    `answers`-text fallback was NOT needed). `pw-notes-roundtrip-verify.cjs`.
  - claude AUQ header/description + Write approval detail — confirmed (`pw-full-fidelity-*`).
  - gemini ACP detail + native option kinds — confirmed via a real WriteFile permission
    (`pw-provider-card-verify.cjs`).
  - **codex fileChange resolved by the protocol schema** (`codex app-server generate-json-schema`):
    `FileChangeRequestApprovalParams` = `{ itemId, threadId, turnId, startedAtMs, reason?, grantRoot? }`
    — **NO inline diff**; the edits live in a separate fileChange item referenced by `itemId`.
    The earlier speculative `buildCodexFileChangeDetail` (probed `unifiedDiff`/`diff`/`changes[]`,
    none of which exist) was **removed**; codex fileChange approvals are headline-only (`reason`)
    until item correlation lands. `CommandExecutionRequestApprovalParams` DOES have `command`/`cwd`/
    `reason`, so the codex command detail is correct. (The diff-bearing shape is the legacy
    `ApplyPatchApprovalParams.fileChanges` — an object map of path → `{type:add|delete|update,
    content|unified_diff}` — which Tide's `item/fileChange/requestApproval` handler does not receive;
    surfacing the codex diff = a future itemId-correlation feature.)
  - codex live card not triggerable (codex auto-approves safe ops); the shared card render path is
    proven live via claude + gemini, and the codex command-detail fields are schema-verified.
