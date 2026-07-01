# Spec: UI/UX Polish Pass (production-readiness)

## Scope

A polish pass over the Desktop (v2) renderer chrome to close the gap between
"works" and "production-ready". Driven by concrete user-reported issues plus a
broader audit of motion, alignment, and state consistency. CSS/markup only where
possible; no domain/contract changes.

## Evidence

User report (2026-06-14): left-rail section collapse has no animation; the start
composer text is large and does not grow with input; in native fullscreen the
left-rail toggle button is not flush-left and misaligns with the New Thread row
below it. User notes these are *examples* of a wider polish gap, so an audit is
in scope.

Confirmed in code (file:line in Decisions below). Established patterns already in
the codebase guide the fixes:
- `.collapsible` grid-rows height animation (`product-shell.css:232-255`), already
  used by individual project groups (`project-section.tsx:147`).
- `field-sizing: content` auto-grow on the follow-up composer (`composer.css:54-61`).
- Native-fullscreen signal → `.tide-fullscreen` on `<html>` (`main-window.ts:52-58`,
  preload `index.ts:151`), consumed by `.tide-fullscreen .traffic-controls`
  (`product-shell.css:139`).

## Decisions

### Confirmed issues (from user report)

1. **Section collapse has no animation.** `createProjectSection`
   (`project-section.tsx:25`) and `createThreadSection` (`thread-section.tsx:30`)
   render `{collapsed ? null : ...}` → instant mount/unmount. Fix: wrap the
   section body in the existing `.collapsible` / `.collapsible__inner` pattern with
   `data-expanded={!collapsed}`. Chevron rotation already animates.

2. **Start composer does not grow + oversized text.** Start-mode input has
   `min-height: 44px; font-size: 18px` and no `field-sizing`/`max-height`
   (`composer.css:41-52`); follow-up mode grows (`composer.css:54-61`). Fix: give
   start mode `field-sizing: content` + `max-height` and reduce font to 16px.

3. **Fullscreen: left-rail toggle not flush-left / misaligned.**
   `.tide-fullscreen .traffic-controls { width: 0 }` leaves the flex item in place,
   so the `gap: 18px` + `padding: 16px` (`left-rail.css:23-28`) push the toggle to
   ~34px while the New Thread row sits at 18px. Fix: in fullscreen `display: none`
   the traffic spacer (drops the gap) and set the top-row left padding so the
   toggle aligns with the nav rows (~10px).

### Audit findings (broader sweep)

4. **Hover highlights snap (motion inconsistency).** Interactive rows
   (`.left-rail-nav-row`/`.thread-row`/`.project-row`, `left-rail.css`) and the
   shared chrome/action buttons (`.top-row-button` et al., `product-shell.css`) and
   the section toggle change `background`/`color`/`opacity` on hover with **no
   transition** — they snap, while the composer chips fade. Same "no animation"
   theme as #1. Fix: add `transition: background-color/color/opacity 0.12s ease` to
   the shared base rules. Confidence: high. (Workbench tabs already transition —
   `workbench.css:80` — left as-is.)

5. **File-tree rows have no hover feedback.** `.file-tree-row` had only a
   `cursor: pointer` rule and no `:hover` background (`file-tree.css`), unlike every
   other list row. Fix: add `button.file-tree-row:hover { background:
   var(--tide-selection) }` + transition. Confidence: high.

6. **No keyboard focus ring.** `:focus-visible` was effectively absent across the
   renderer (2 incidental hits); the composer input even sets `outline: none`. Fix:
   a themed `:focus-visible` ring in `base.css` scoped to buttons/links/inputs/roles
   (keyboard-only, editor/webview untouched). Confidence: high (standard a11y).

### Deep audit (round 2 — "fix everything, don't defer")

7. **Overlays/menus/dialogs popped in instantly** (no entrance motion anywhere —
   only looping pulses/shimmers existed). Added shared keyframes in `base.css`
   (`tide-overlay-in` backdrop fade, `tide-pop-in` anchored menus, `tide-modal-in`
   centered modal, `tide-sheet-in` top palettes, `tide-tree-row-in` tree rows) and
   applied them: settings modal + backdrop, left-rail context menu, composer
   choice-surface, quick-open, content-search, worktree dialogs, editor context
   menu, image lightbox (backdrop + image). Added a global
   `@media (prefers-reduced-motion: reduce)` guard that neutralizes all
   animation/transition for opt-out users.

8. **Menu/dropdown/dialog row & button hovers snapped** — added
   `transition: background-color/color/opacity` to: context-menu item,
   choice-surface row + row-action, quick-open row, content-search match, worktree
   cancel/confirm, settings close, launcher action, editor menu item.

9. **Undefined `--tide-accent` (greenish `#6b7` fallback) in settings** focus
   border → `--tide-action` (monochrome-consistent). Other phantom tokens
   (`--tide-mono/sans/surface-2/success`) have working fallbacks; left as-is.

10. **Settings modal was the lone overlay not closing on Escape** (Quick Open /
    Content Search / worktree dialogs all do) → added an Escape handler in
    `product-shell.tsx` mirroring the workbench-fullscreen Escape effect.

11. **File-tree folder expand** (deferred in round 1) — RESOLVED. The tree is a
    flat keyed list, so newly mounted rows now play `tide-tree-row-in` on insert
    (also a quiet reveal on tree load); persistent rows don't replay.

### Screenshot-backed visual correction (2026-07-01)

12. **Left Rail thread rows looked like bordered selected chips.** The active row
    and running/attention variants used inset 1px outlines, and the warm running
    treatment read like a warning border. Keep row cards as a permitted surface,
    but remove stroke-based selection and row-level running outline animation.
    Active rows use a quiet fill plus stronger text; running/attention use
    background-only tint plus a local dot, never an outline.

13. **Workbench tabs looked like full-height slabs.** The active tab consumed the
    whole 52px top row with a surface fill and strong underbar, making the label
    feel heavy. Keep the 52px column header, but make each tab a compact 32px
    chrome item with a soft active fill and no underline slab.

14. **Thread rows carried too much inline context, then exposed context
    inconsistently.** Pinned rows stacked a project/worktree subtitle under the
    title, and worktree rows carried an inline branch pill. Moving only those
    special cases into hover context made some rows inspectable and others not.
    Keep every thread row one-line, and give every thread row the same
    hover/focus context popover. The popover always includes Project/Scope and
    adds Worktree, Branch, and Status rows only when the Thread state actually
    provides those facts.

15. **The hover context looked bound to the row area.** Rendering the popover as
    an absolute child of the row kept it inside the rail width/scroll region, so
    it read like an inline expansion. Treat it like the existing left-rail context
    menu: measure the hovered row and render a fixed flyout beside the rail,
    escaping the scroll clip and never using the row's width as the popover
    width.

16. **The hover context disappeared before it could be inspected.** Closing the
    flyout immediately on row mouseleave and setting `pointer-events: none` made
    it impossible to move the cursor onto the context surface to read a long
    worktree/branch name. The flyout must be hoverable, keep itself open with a
    short close grace while crossing the gap from row to flyout, and expand long
    values on flyout hover.

17. **The close grace should not make row-to-row switching feel stale.** The
    grace only exists for crossing from row to its flyout. Moving into another
    Thread row should immediately replace the old context with the new row's
    context, so rows dispatch a local open signal that closes peer flyouts. The
    flyout uses stronger shadow, not borders, to read as a separate surface.

18. **The hover context should have a stable initial DOM.** The popover belongs
    to every row, but closed rows should render it hidden with deterministic
    fallback positioning. Do not gate the popover's existence on `typeof window`
    or viewport measurement; only the open state should swap to measured fixed
    positioning. This keeps renderer tests, any future hydration path, and the
    runtime DOM contract aligned.

Verified: `scripts/pw-ui-polish-verify.cjs` 13/13 checks pass on the real built
app; screenshots `/tmp/polish-*.png` eyeballed (composer grown, fullscreen aligned,
settings modal, choice-surface, expanded file tree). typecheck clean; build green.

## Out Of Scope

- Domain model / contract / backend changes.
- New features. This is polish of existing surfaces.
- Theme token redesign (light/dark token values stay).

## Domain Model

None — renderer presentation only.

## Contracts

None changed.

## Flow

Collapse: toggle handler flips `collapsedSections`; section body stays mounted and
animates height via `.collapsible[data-expanded]`. Composer: unchanged data flow;
input height is CSS-driven (`field-sizing`). Fullscreen: unchanged signal flow;
only CSS reacts to `.tide-fullscreen`.

## Invariants

- Motion respects `prefers-reduced-motion` (existing `.collapsible` media gate).
- Engines without `field-sizing` fall back to `min-height` (no regression).
- Collapsed section content is `overflow: hidden` so it never spills mid-animation.

## Tests

- Component/markup: section body renders the `.collapsible` wrapper with
  `data-expanded` reflecting collapsed state (not `null`).
- Visual (screenshot instrument): collapse animates; start composer grows with a
  long draft; fullscreen toggle aligns with New Thread row.
- Existing renderer test suite stays green.
- CSS assertions: thread-row active/running/attention states use background-only
  fills without 1px inset border shadows or row-level running outline animation;
  stacked Workbench tabs are compact and avoid full-height active slabs; thread
  rows always expose hover/focus context while keeping project/worktree/branch
  facts out of the inline row; hover context renders as a fixed flyout rather
  than a row-bound absolute child; the flyout is hoverable and reveals long values
  instead of disappearing on row mouseleave; row-to-row hover immediately switches
  the active flyout; popover depth comes from shadow rather than row borders;
  closed row popovers stay mounted but hidden with deterministic fallback style.

## Implementation Notes

Reuse existing patterns rather than introducing new ones. Keep CSS in the
colocated component `.css` files. Verify with the offscreen screenshot instrument
(text-only capture is insufficient for design).
