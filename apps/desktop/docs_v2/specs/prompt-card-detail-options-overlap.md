# Spec: Approval Card Detail Overlaps the Options (and crams them)

## Scope

When the agent prompt card (`agent-chat/prompt-card/`) is an **approval with a tall detail**
— e.g. a `gh pr create … --body "$(cat <<'EOF' … EOF)"` command, or a multi-line diff — the
detail region and the **Allow / Deny** options collide: the detail's bottom lines render
*on top of* the option rows, and the option list is squeezed into a cramped little scroll
that hides the 3rd option. Two scrollbars (detail + options) fight each other.

In scope: the card's vertical structure so the "what you're approving" content scrolls as
ONE region and the answer options always show in full below it.

Out of scope: horizontal containment (`prompt-card-column-overflow.md`); the card's docked
placement (`prompt-card-height-overflow.md`, which this spec amends — see Related).

## Symptom (user report + screenshots)

An `APPROVAL NEEDED` card for a long `gh pr create` command: the command text scrolls, but
its last lines (`## Verification`, `EOF`) are drawn behind the highlighted **Allow** row, and
**Allow / Deny / Allow always** are jammed into a ~110px scroll so the 3rd option is clipped.
Report: "전체적인 구조가 좀 그런듯. 일단 영역이 겹치고 스크롤도 이상하고" — the overall structure
is off; the regions overlap and the scroll is weird.

## Root cause (confirmed, reproduced in Electron at 1392×932)

The card is a bounded flex column (`max-height: min(52vh, 560px)`) with three rows: head
(`flex: 1 1 auto`), options, actions. Two compounding bugs:

1. **The head had no overflow guard.** `.prompt-card__head` was `flex: 1 1 auto; min-height: 0`
   but **no `overflow`**, and the approval detail inside it (`.prompt-card__detail-body`) had a
   **fixed `max-height: 260px`** that does not shrink. When the head's flex allotment fell
   below `kind + message + 260`, the detail-body **spilled past the head's box and drew over
   the options** below it (flex items don't reflow what overflows a non-clipping ancestor).
2. **The options were shrinkable.** `.prompt-card__options` was the default `flex: 0 1 auto`,
   so the tall head squeezed it below the natural height of Allow/Deny/Allow-always (132px →
   118px), tripping its own `max-height: 30vh` overflow into a cramped scroll that clipped the
   3rd option.

Measured "before": `options` 118px (`scrollHeight` > `clientHeight` → cramped scroll), the
detail's bottom edge **+12px past** the options' top edge (overlap).

## Decisions (applied)

- **D1 — One scroll region for the asked/approved content.** Wrap the message + approval
  detail in a new `.prompt-card__body` (`flex: 1 1 auto; min-height: 0; overflow-y: auto;
  overscroll-behavior: contain; flex column, gap 6px`). The question/command message and the
  diff/command detail now scroll **together as one area** — no more two competing scrollbars.
  Both `SinglePromptCard` and `WizardPromptCard` wrap their message in `__body`.
- **D2 — Pin the head's chrome; clip the head.** `.prompt-card__kind` (and the wizard's
  `.prompt-card__wizard-head`) get `flex: 0 0 auto` so they stay above the scroll; the head
  gets `overflow: hidden` so a tall body can **never** spill over the options — the body's own
  scroll is what keeps the content reachable.
- **D3 — The detail flows in the body, with no scroll of its own.** Drop
  `.prompt-card__detail-body`'s `max-height: 260px` + `overflow: auto` (and add `flex: 0 0 auto`
  to `.prompt-card__detail`). It now sizes to content inside the single body scroll; long lines
  wrap (`overflow-wrap: anywhere`) instead of scrolling horizontally.
- **D4 — Pin the option list.** `.prompt-card__options` gets `flex: 0 0 auto` so it is never
  shrunk to cram the options. A genuinely long list still scrolls on its own (`max-height: 30vh`
  is kept); the body above yields the space instead. (`.prompt-card__other` / `__note` /
  `__option-preview` inside it stay `flex: 0 0 auto` — see Related, the textarea-crush fix.)
- **D5 — Message stops being the scroll region.** `.prompt-card__message` drops
  `flex: 1 1 auto; min-height: 0; overflow-y: auto` (now `flex: 0 0 auto`); the body owns the
  scroll. Amends `prompt-card-height-overflow.md` D2.

TSX adds one wrapper `<div className="prompt-card__body">` per card; the rest is CSS.

## Invariants

- For any detail/message length, the option rows render in full and the detail never overlaps
  them; the content scrolls in exactly one region (`__body`); Skip/Submit stay pinned.
- A few-option approval (Allow/Deny[/Allow always]) never scrolls its option list; a long
  choice list still does (`max-height: 30vh`).
- Short prompts are unchanged (card sizes to content, nothing scrolls).
- The "Other…" reply + note textareas keep full height (no crush).

## Tests

- `prompt_card_with_a_tall_body_…` (visual-foundation): renders `prompt-card__body`; CSS
  asserts `.prompt-card__body { overflow-y: auto }`, `.prompt-card__head { overflow: hidden }`,
  `.prompt-card__options { flex: 0 0 auto }` (+ existing actions/other/note pins).
- Live (Electron repro at 1392×932): approval body scrolls as one region, `overlapPx ≤ 0`,
  all 3 options shown with no option scroll; AUQ "Other…" textareas full height; short
  permission card scrolls nothing. All PASS.

## Related

- `agent-chat/prompt-card/prompt-card.{tsx,css}`.
- Amends `prompt-card-height-overflow.md` (D2: the scroll region moved from `__message` to the
  wrapping `__message + __detail` → `.prompt-card__body`).
- Sibling fixes: `prompt-card-column-overflow.md` (horizontal), and the textarea-crush fix
  (`.prompt-card__other` / `__note` pinned `flex: 0 0 auto`).
