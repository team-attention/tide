# Spec: Prompt Card Overflows the Chat Column

## Scope

When the agent prompt card renders (`agent-chat/prompt-card/` — the unified
question / approval / permission / choice surface: "APPROVAL NEEDED" + options +
Skip / Submit), it **overflows the chat column to the right and is clipped** (option
provider-values and the Submit button cut off, spilling toward the workbench). The plain
composer in the same column is fine.

In scope: width containment of the prompt card within the chat column.
Out of scope: the card's internal styling (it already truncates correctly once
contained); Browser Pane / zoom (this is NOT a zoom issue — "줌" was a misread of "질문";
the earlier `product-shell-zoom-layout.md` was deleted as wrong).

## Symptom (user report + screenshot)

With an `APPROVAL NEEDED` prompt card open, the card's right side is clipped — the mono
`prompt-card__option-value` (the permission scope) shows "structu…" and the Submit button
shows "Su…". The card extends past the chat column's right edge into the workbench. Remove
the card (plain composer) → no clipping. Report: "질문/approval UI가 뜨면 최소사이즈·컴포저
CSS가 깨지고, 그냥 컴포저만 있을 땐 괜찮다."

## Root cause (confirmed)

The card's container is `.agent-chat-shell__composer-stack` — `PromptCard` mounts there as
a direct child (`composer.tsx:238-249`), a SIBLING of the composer, not inside it. That
container is (`agent-chat.css:100-106`):

```css
.agent-chat-shell__composer-stack {
  width: min(760px, calc(100% - 32px));
  display: grid;          /* implicit single column = `auto` */
  gap: 16px;
  margin: 0 auto;
}
```

It is `display: grid` with NO `grid-template-columns`, so it has one implicit **`auto`**
column. An `auto` grid track sizes to its items' max-content, and a grid item's default
`min-width: auto` is min-content — so the track grows to the **prompt card's max-content**
(the options + the Skip/Submit actions row), exceeding the stack's capped width. The
card then overflows and is clipped by `.agent-chat-shell { overflow: hidden }`
(`agent-chat.css:33`). `.prompt-card` itself sets no `min-width`/`max-width`
(`prompt-card.css` — only the option label/value have it), so nothing pins the card to the
column.

**This is the exact bug the codebase already documents and fixes for the card's siblings,
just never applied to the prompt-card path:**
- `composer.css:23-26` (`.composer-shell`): *"Pin the column to the box width
  (minmax(0,1fr)); without this the implicit `auto` column grows to the toolbar/chips
  max-content and the rows (and the send button) spill past the composer's right edge into
  the workbench on a narrow column."* → fixed with `grid-template-columns: minmax(0, 1fr)`.
- `agent-chat.css:47-55` (`.agent-chat-shell__start-surface`): same note → fixed with
  `minmax(0, 1fr)`.

So the **plain composer is immune** (`.composer-shell` internally pins `minmax(0,1fr)`),
but the **prompt card is not** — exactly matching "approval UI breaks, plain composer
fine."

## Decisions (proposed)

- **D1 — Pin the composer-stack's column (the documented one-liner).** Add
  `grid-template-columns: minmax(0, 1fr);` to `.agent-chat-shell__composer-stack`
  (`agent-chat.css:100`). This forces the single column (and every child: prompt card,
  readiness, usage meter, steer queue, composer) to the stack's box width instead of
  growing to max-content. Mirrors the `.composer-shell` / `.start-surface` fix exactly.
- **D2 — Let the card shrink internally (belt-and-suspenders).** Add `min-width: 0;` to
  `.prompt-card` so, once column-bounded, the card fills the column and its existing
  internal truncation takes over: `.prompt-card__option-value` is
  `overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:45%`,
  `.prompt-card__option-label` is `min-width:0`.
- **D3 — Optional:** change `.prompt-card__option-value` from `flex: 0 0 auto` to
  `flex: 0 1 auto` so the mono value yields before forcing width. (D1 already contains it.)

Applied: **D1 only** — `grid-template-columns: minmax(0, 1fr)` on
`.agent-chat-shell__composer-stack` (`agent-chat.css:103-104`). With the track pinned, the
card's own min-content already fits the column (option values truncate via ellipsis, label
is `min-width:0`, buttons are short), so D2/D3 are NOT needed and were not added.

## Tests

- An `APPROVAL NEEDED` / question card with long option provider-values renders fully
  within the chat column at the narrowest supported column width — no right-edge clipping,
  no spill into the workbench. Option values truncate with an ellipsis; Skip/Submit stay
  visible.
- The other composer-stack children (provider readiness, usage meter, queued steer cards)
  also stay column-bounded (D1 covers them too — regression guard).
- Plain composer (no card) unchanged.

## Related

- `agent-chat/prompt-card/prompt-card.{tsx,css}` (the card),
  `agent-chat/composer/composer.tsx:238-249` (mount in `.agent-chat-shell__composer-stack`),
  `agent-chat/agent-chat.css:100-106` (the unconstrained stack), and the documented
  `minmax(0,1fr)` pattern the card is missing: `composer.css:17-26`,
  `agent-chat.css:18-55`.
- Supersedes the deleted `product-shell-zoom-layout.md` (written on a "질문"→"줌" misread).
