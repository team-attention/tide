# Spec: Prompt Card Number-Key Selection (⌘1..⌘9)

## Scope

Add `⌘/Ctrl + 1..9` keyboard selection to the prompt card (every agent
question / approval / permission / AskUserQuestion choice card), for both the
single card and each step of the multi-step wizard.

`⌘N` **selects only** — it highlights the N-th visible option (or, for a
multi-select question, toggles it). It does NOT submit. Confirmation stays on
the existing `⌘Enter`. This is deliberate: after picking an option the user can
still type more (a custom reply, or an AskUserQuestion note) before confirming,
and every prompt is submitted through one consistent path (`⌘Enter`).

## Evidence

- `src/desktop/.../agent-chat/prompt-card/prompt-card.tsx` — `SinglePromptCard`
  (keydown effect ~L139) and `WizardPromptCard` (keydown effect ~L331) already
  bind a `window` keydown listener: `⌘/Ctrl+Enter` submits/advances from
  anywhere, and `↑/↓` move between options when focus is not in a text field.
  `renderOptions()` is the shared option list used by both.
- Option order in `renderOptions()` is: every `choice` in listed order, then a
  trailing `"Other…"` slot (only when `hasChoices && !multiSelect`). The arrow
  navigation already treats this same `[...choiceIds, "__other"]` list as the
  ordered set — number keys reuse that exact order.
- No conflict on `⌘/Ctrl + digit`: multitask jump uses **Option(⌥)+digit**
  matched on `event.code` and gated by `event.altKey`
  (`product-shell/multitask/use-multitask-navigation.tsx`); the only `Cmd+digit`
  menu accelerator is `CmdOrCtrl+0` (Actual Size zoom) — we reserve `1..9` only,
  never `0`.

## Decisions

- **Select-only, not select-and-submit** (user decision, 2026-06-23): `⌘N`
  highlights; `⌘Enter` confirms. Rationale: lets the user add text after
  picking, a single consistent submit path, and no accidental execution of an
  `Allow`/`Deny` on one keystroke.
- **Dynamic mapping to the visible option count**, not a fixed 1/2/3. `⌘1` = the
  first listed option … `⌘K` = the K-th. The `"Other…"` slot is the last number
  (`choices.length + 1`) when present.
- **Digits 1..9 only.** Options past the 9th get no shortcut (kept reachable by
  `↑/↓` / click). No two-digit chords, no `⌘0`.
- **Match the physical key via `event.code` (`/^Digit([1-9])$/`)**, gated by
  `(metaKey || ctrlKey) && !altKey`, mirroring the multitask handler — robust
  across layouts and disjoint from the Option+digit path.
- **Works from anywhere, including the composer / note field** (like `⌘Enter`):
  `⌘N` does not insert a character into a textarea, so intercepting it globally
  is safe and lets the user re-pick mid-typing.
- **Discoverability:** each shortcut-bearing option shows a subtle `⌘N` keycap on
  its right edge, mirroring the existing `⌘↵` hint on the Submit button.

## Out Of Scope

- Changing the submit gesture or the `↑/↓` / click behaviors.
- Two-digit selection, `⌘0`, or paging for >9 options.
- Backend/contract changes — this is renderer-only.
- The wizard's Back/dot navigation (unchanged; `⌘N` acts within the current step
  only and never advances).

## Domain Model

No new domain types. Selection state is the component-local
`selectedId` / `selectedIds` / `otherActive` already present.

## Contracts

No `src/shared/contracts` change. `AgentChatPromptChoice` already carries the
listed order; numbering is derived in the renderer.

## Flow

1. A prompt card is mounted (single or wizard).
2. User presses `⌘N` (1..9):
   - Build the ordered id list for the active mode:
     - multi-select: `choices` only (no `"Other…"`).
     - single: `[...choices, "__other"]` when `hasChoices`.
   - If `N-1` indexes a real choice → single-select sets it selected (and clears
     `otherActive`); multi-select toggles it.
   - If `N-1` indexes `"__other"` → activate the custom-reply field
     (`otherActive = true`, `selectedId = null`); its textarea autofocuses.
   - If `N` is out of range → no-op (event not consumed).
3. User may keep typing (note / custom reply) or press a different `⌘N`.
4. `⌘Enter` confirms exactly as today (single: submit; wizard: Next/Submit).

## Invariants

- `⌘N` never calls `onSelectChoice` / `onAnswerText` / `onAnswerSteps`. Only
  `⌘Enter` (or the Submit/Next button) commits.
- The visible `⌘N` keycaps map 1:1, in order, to what `⌘N` selects.
- In the wizard, `⌘N` changes only the current step's answer and never changes
  `stepIndex`.
- A pure free-text prompt (no choices) has no numbered options and ignores `⌘N`.

## Tests

`tests/multi-step-prompt-navigation.test.tsx` (extended — same JSDOM + `act`
harness, dispatching `KeyboardEvent` on `window`):

1. Single approval card: `⌘2` selects the 2nd option (`data-selected`) and does
   NOT call `onSelectChoice`; a following `⌘Enter` then calls `onSelectChoice`
   with the 2nd option's `choiceId`.
2. Single card: `⌘N` on the trailing number (= `choices.length + 1`) activates
   the `Other…` custom-reply field without submitting.
3. Multi-select card: `⌘1` toggles the first option on, a second `⌘1` toggles it
   off (no submit on either).
4. Wizard: `⌘2` selects the 2nd option of the current step and stays on
   `1 of N` (no advance); `⌘Enter` still advances.
5. Each shortcut-bearing option renders a `⌘N` keycap (`.prompt-card__option-kbd`).

## Implementation Notes

- Renderer-only. Two keydown effects gain a digit branch after the `⌘Enter`
  branch; `renderOptions()`'s `option()` helper gains an optional 1-based
  `numberHint` that renders `.prompt-card__option-kbd`.
- `.prompt-card__option-kbd` styled like `.prompt-card__submit-kbd` (muted,
  ~11px), placed as a `flex: 0 0 auto` trailing element so the `__option-text`
  (flex 1) pushes it to the right edge.
