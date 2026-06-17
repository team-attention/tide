# Spec: Prompt Card Overflows the Chat Column Vertically

## Scope

When the agent prompt card (`agent-chat/prompt-card/` — the unified question /
approval / permission / choice surface) carries a **tall** body — e.g. an
`APPROVAL NEEDED` card for a `gh pr create … --body "<long PR body>"` Bash command, or a
choice prompt with many options — the card grows taller than the chat viewport and its
bottom is **clipped with no way to scroll**. The user can't read the rest of the message
and, worse, can't reach the **Skip / Submit** (Allow / Deny) actions to answer.

In scope: vertical containment of the prompt card so its long content scrolls *inside* the
card while the answer controls stay reachable.

Out of scope: horizontal containment (already fixed — see
`prompt-card-column-overflow.md`); moving the card into the scrollable transcript (the card
is intentionally docked above the composer so it's always the focused thing to answer);
markdown rendering of the message body.

## Symptom (user report + screenshot)

An `APPROVAL NEEDED` card for a long `gh pr create --body "$(cat <<'EOF' … EOF)"` command
fills the whole chat area; the message runs off the bottom of the window
("…the live induced-crash test caught after the unit test alone passed." is the last
visible line) and the Skip / Submit buttons are below the fold. Nothing scrolls. Report:
"물어볼때 컨텐츠가 너무 많으면 스크롤도 안되고 전체 다 확인이 안돼" — when the prompt has too
much content it doesn't scroll and you can't see all of it.

## Root cause (confirmed)

The live prompt card mounts in `.agent-chat-shell__composer-stack` (the bottom dock), a
sibling of the composer — `composer.tsx` `createComposerStack` renders `<PromptCard>`
there, NOT inside the scrollable transcript. The shell is a CSS grid
(`agent-chat.css`):

```css
.agent-chat-shell {
  grid-template-rows: auto minmax(0, 1fr) auto;  /* header / transcript / composer-stack */
  overflow: hidden;
}
```

The transcript (middle `minmax(0,1fr)`) scrolls; the composer-stack (bottom `auto` row)
sizes to its content. `.prompt-card` and `.prompt-card__message` (`white-space: pre-wrap`)
set **no `max-height` and no `overflow`**, so a tall message grows the dock unbounded. It
eats the transcript row and then overflows the grid, which `overflow: hidden` **clips** —
there is no scroll container around it, so the clipped bottom (rest of message + the
Skip/Submit actions) is unreachable.

So the same class of bug as `prompt-card-column-overflow.md` (the card not bounded to its
container), on the vertical axis: there the `auto` *column* grew to max-content; here the
`auto` *row* grows to the card's full intrinsic height with no internal scroll.

## Decisions

- **D1 — Cap the card height to a viewport fraction.** Add
  `max-height: min(52vh, 560px)` to `.prompt-card`. The card is already
  `display: flex; flex-direction: column`, so this turns it into a bounded flex column:
  short content → card sizes to content (unchanged); tall content → card clamps and the
  inner regions scroll. The cap leaves room in the dock for the composer (and any usage
  meter / queued-steer stack) below it, so the composer stays visible too.
- **D2 — Make the message the flexible scroll region.** *(Amended by
  `prompt-card-detail-options-overlap.md` D1/D5: the scroll region moved off `__message` onto a
  wrapping `.prompt-card__body` that scrolls the message + approval detail together, and the
  head gained `overflow: hidden`, so a tall detail can't overlap the options below.)*
  `.prompt-card__head` gets
  `flex: 1 1 auto; min-height: 0` and `.prompt-card__message` gets
  `flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain`. The
  kind badge ("APPROVAL NEEDED") stays pinned above; the long body scrolls within the card.
  `overscroll-behavior: contain` keeps a wheel scroll inside the message from chaining to
  the transcript/page. `overflow-wrap: anywhere` lets an unbroken long token (URL, flag
  value) wrap instead of forcing horizontal overflow.
- **D3 — Bound a long options list too.** `.prompt-card__options` gets
  `min-height: 0; max-height: 30vh; overflow-y: auto; overscroll-behavior: contain` so a
  choice/permission prompt with many options scrolls instead of pushing the actions off.
- **D4 — Pin the actions.** `.prompt-card__actions` gets `flex: 0 0 auto` so Skip / Submit
  (Allow / Deny) never shrink or scroll away — they are always visible and clickable.

CSS-only; no DOM/TSX restructure, so the single card and the multi-step wizard
(`.prompt-card--wizard`, same base class + `.prompt-card__head` / `__message` / `__options`
/ `__actions`) are both fixed by the same rules.

## Invariants

- For any message length, the Skip/Submit (Allow/Deny) actions remain on-screen and
  clickable; the card never exceeds `min(52vh, 560px)`.
- Short prompts look identical to before (no scrollbars, no forced min-height).
- A wheel scroll inside the message/options does not scroll the transcript behind it.

## Tests

- CSS cascade assertions (via `readProductShellCss()`, the established CSS-rule test
  pattern): `.prompt-card` has `max-height`; `.prompt-card__message` is `overflow-y: auto`;
  `.prompt-card__options` is `overflow-y: auto`; `.prompt-card__actions` is `flex: 0 0 auto`.
- A `PromptCard` rendered with a very long message still renders the message text and the
  Skip + Submit buttons in the output (they are present, not conditionally dropped).
- Manual / live: open an approval card with a long body → message area scrolls, Allow/Deny
  reachable, composer still visible below.

## Related

- `agent-chat/prompt-card/prompt-card.{tsx,css}` (the card),
  `agent-chat/composer/composer.tsx` (`createComposerStack` mounts it in the dock),
  `agent-chat/agent-chat.css` (`.agent-chat-shell` grid + `.agent-chat-shell__composer-stack`).
- Sibling axis: `prompt-card-column-overflow.md` (horizontal containment).
