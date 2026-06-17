# Spec: Composer block/image-only send + focus-on-add

## Scope

Two composer-input refinements, both rooted in one idea: **attaching content is itself
an input.**

1. A composer holding ONLY an attached content chip (a "block") — no typed text, no
   pasted image — is a valid send. The block IS the message.
2. Clicking "Add to chat" (a workbench/transcript selection → a composer chip) drops the
   cursor into THAT chip's comment field so the user can immediately note what they want
   about the selection, with no extra click.
3. A sent user message that carries a quoted block reads as a normal user message: a
   right-aligned bubble (not a left-aligned full-width card), and the quote shown once
   (not a "↳ <label>" header that repeats the first line of the quote below it).

## Evidence

- `state/composer.ts` `submitComposer` already treats draft / attachments / context chips
  uniformly: it no-ops only when ALL THREE are empty, and prepends chip content to the
  outgoing message. So the domain rule "a chips-only message is valid" already holds.
- `state/composer-bridge.ts` `submitProductShellComposerDraft` — the path the real app
  uses — guards with its OWN, older, incomplete check:
  `if (draft.length === 0 && attachments.length === 0) return noop;`
  It omits `contextChips`, so a block-only composer returns a no-op and `submitComposer`
  (which would have sent it) is never reached. Image-only already passes (attachments
  checked); block-only is the gap.
- `composer.tsx` `composerHasContent` already counts text OR attachments OR chips for the
  Send-vs-Stop button, so the button is already correct; only the submit path is wrong.
- `agent-chat.tsx` owns `composerInputRef` (passed to the composer textarea). "Add to
  chat" arrives via `onQuote` (transcript selection, in `agent-chat.tsx`) and
  `onAddContentToChat` (workbench panes, via product-shell handlers); both append a chip
  to `composer.contextChips`. Neither moves focus.

## Decisions

- Fix the submit path by DELETING the redundant outer guard, not by extending it.
  `submitComposer` is the single source of truth for "what is sendable"; it returns the
  same state reference for a truly-empty composer, which the existing
  `result.state === state.agentChat` branch already treats as a no-op. Removing the
  duplicate guard fixes the bug and removes the drift that caused it.
- Focus target = the NEWLY ADDED chip's comment field ("Comment on this selection…"), not
  the main composer textarea. The added block is what the user is reacting to, so the cursor
  lands right on its note field. A chip is always appended last, so it is identified and
  focused by its id (`data-chip-comment-id`).
- Trigger focus on any INCREASE of `composer.contextChips.length`. Chips only grow through
  an explicit user "Add to chat", so this never steals focus on load/thread-switch (no code
  path repopulates chips).
- A quoted-message user turn is right-aligned like every other user turn (drop the
  `:has(--attachments) → flex-start` special-case); the bubble is allowed to grow wider
  (`fit-content`, `max-width: min(680px, 100%)`) so the quote isn't cramped on the right.
- The `↳ <label>` header is dropped only for `kind === "message"` (label ⊂ quoted text).
  File/code/terminal/browser chips keep it (the label names a file/source). Because the
  marker also signals "render as a structured attachment body", a leading blockquote now
  also qualifies, so a header-less quote still renders as markdown (not literal `> `).

## Out Of Scope

- Image-only send (already works through the existing attachments check).
- Send-vs-Stop button logic (already correct via `composerHasContent`).

## Domain Model

No new types. Reuses `AgentChatContextChip` and the existing composer state.

## Contracts

No contract change.

## Flow

- Block-only send: user adds a chip → composer draft empty → Send →
  `submitProductShellComposerDraft` → `submitComposer` (chips non-empty) → `thread.start`
  (start composer) or `composer.sendInput` (started thread) with the chip(s) formatted as
  the message.
- Focus-on-add: user clicks "Add to chat" → chip appended → `contextChips.length`
  increases → `AgentChatShell` effect focuses the new chip's comment textarea (matched by
  `data-chip-comment-id`).

## Invariants

- A composer with at least one of {non-empty trimmed draft, attachment, context chip}
  produces a command; an all-empty composer is a no-op.
- Focus moves to the composer input exactly when the chip count increases.

## Tests

- `submitProductShellComposerDraft` with only a context chip (empty draft, no attachment)
  returns a non-null `thread.start` whose `initialMessage` contains the chip text.
- `submitProductShellComposerDraft` with an all-empty composer still returns a no-op
  (`command: null`).
- Live mount: `AgentChatShell` re-rendered from 0 → 1 context chips focuses the new chip's
  comment field (`document.activeElement` carries `data-chip-comment-id` = the chip id).
- A `kind === "message"` chip submits an input with no `**↳ ` header but the quote kept;
  file/code chips keep their `**↳ <label>**` header (existing tests).
- `renderUserBody` renders a blockquote-led body as the structured attachment body
  (`--attachments`, `<blockquote>`); a plain body stays a flat `<p>`.

## Implementation Notes

- `composer-bridge.ts`: drop the `input`/early-return guard in
  `submitProductShellComposerDraft`; call `submitComposer` directly.
- `composer.tsx`: tag each chip comment textarea with `data-chip-comment-id={chip.id}`.
- `agent-chat.tsx`: add a `prevChipCountRef` + effect keyed on the chip count and last chip
  id; on an increase, focus the textarea whose `data-chip-comment-id` matches.
- `state/composer.ts`: `formatContextChipForMessage` drops the header for `kind === "message"`.
- `transcript/user-turn.tsx`: `renderUserBody` treats a leading blockquote as an attachment.
- `transcript/transcript.css`: attachment user turns right-align as a `fit-content` bubble.
