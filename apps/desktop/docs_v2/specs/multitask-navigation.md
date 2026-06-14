# Spec: Multitask Navigation (Floating Rail Peek · Pin Jump · Live Switcher)

> Status: **PLAN ONLY** (no code/tests yet, by request). This spec is the deliverable.

## Scope

Re-design how a user moves between many parallel Threads, replacing the implicit
"open the Left Rail and click a row" model with three transient, modifier/hover-gated
navigation layers. All three appear **only while a trigger is held**; at rest the
screen is byte-identical to today.

- **L1 — Floating Rail Peek.** When the Left Rail is collapsed, hovering the left
  screen edge floats the full rail **over** the content (overlay, no layout reflow);
  it retracts when the pointer leaves.
- **L2 — Pin Jump (`Ctrl+1..9`).** Pinned Threads become a flat, stable-ordered,
  authoritative list (lifted out of their Project groups). Holding `Ctrl` reveals
  `^1 ^2 …` badges in each pinned row's timestamp slot; `Ctrl+N` jumps to that pin.
- **L3 — Live Switcher (`Ctrl+Tab` / `Ctrl+Shift+Tab`).** Cycles the **live set**
  (Threads with a hydrated, in-process Agent Runtime, regardless of state) through a
  centered, ⌘-Tab-style horizontal HUD; the highlighted Thread commits on `Ctrl` release.

**Unifying principle:** every surface here is transient (Ctrl-held or edge-hover), so
nothing new is *persistently* on screen. This deliberately satisfies the existing
master-plan decisions — Left Rail stays work history, no global status buckets, App
Chrome stays compact — *without reopening them*. There is no new dashboard.

## Evidence

- **Constraint (must respect):**
  - `master-plan.md#Product Decisions:3` — "no global status buckets such as `Needs
    attention`, `Running`, or `Recent` in the default Left Rail."
  - `master-plan.md:241` — "Left Rail remains work history, not a status dashboard."
  - `master-plan.md:119–122` — Thread Row is `[icon] title … time`; only "a tiny
    attention dot may appear", "status text stays out of the default row".
  - `concrete-design-backlog.md:367–385` — "Rich dashboard chrome" (Option B)
    **rejected** → "Minimal Thread-scoped chrome" (Option A); dashboards "compete
    with Agent Chat and risk visual noise". `:404` status bar "not a dashboard".
- **Current switching:** click-only. `left-rail/thread-row.tsx:71`
  `onClick → handlers.onThreadSelect(threadId)`. No keyboard thread nav exists;
  `product-shell/support/use-shell-effects.ts` only binds `Cmd+P` / `Cmd+Shift+F`.
- **Current rail collapse:** `handlers/rail-handlers.ts:39`
  `onLeftRailToggle → toggleProductShellLeftRail`. Collapse removes the column and
  reflows content wider; there is **no** hover-peek (no rail peek/float CSS).
- **Current pins (the L2 prerequisite gap):** `state/view-model.ts:352–369` —
  `pinnedThreads` is filtered, but `projectGroups` still carries the **full** thread
  set, so a pinned Thread also remains **under its Project group** (it appears twice).
  `left-rail/left-rail.tsx:84–88` renders a Pinned section *and* the full Project section.
- **Row indicators today:** `thread-row.tsx:104–110` — attention dot, running dot,
  time string; running is the only "activity" signal and means *mid-turn only*.
- **Liveness signal is missing from the contract:** `shared/contracts/thread.ts`
  `ThreadSummaryDto` has `pinned`, `archived`, `lastKnownState`
  (`idle|running|waiting_for_input|waiting_for_approval|failed|archived`),
  `runtimeStartedAt` — but **no "live in this process" flag**. `lastKnownState` is the
  *last observed/persisted* state, not "a runtime is alive right now". The renderer
  derives `running = state === "running"` (`product-shell/state/events.ts:63`).
  Backend already tracks hydrated threads (`infrastructure/node/live/live-projector.ts:133`
  `service.peekThread(...)`), so a true liveness flag is sourceable.

## Decisions

1. **Unified modifier = `Ctrl`** for all multitask nav: `Ctrl+1..9` (pins),
   `Ctrl+Tab` / `Ctrl+Shift+Tab` (live cycle). Rationale: `⌘+Tab` is macOS-reserved,
   and one modifier = one mental model ("hold Ctrl = multitask mode"). Cross-platform
   friendly (Ctrl is the natural nav modifier on Win/Linux too). `⌘+number` is the
   more common "go to tab N" muscle memory — consciously traded for consistency; `⌘`
   stays free.
2. **Live set definition** = Threads with a **hydrated, in-process Agent Runtime**,
   *regardless of runtime state* (running OR waiting OR idle-but-alive). Cold Threads
   that exist only as persisted session data are **never** in the live set, even if
   their `lastKnownState` is `running`. (User: "이 타이드 프로세스 안에서 살아있는
   거… 하이드레이트 된 상태로 돌아가는 거. 상태는 상관없어. 돌든 기다리든.")
3. **Live switcher shape** = centered horizontal HUD (⌘-Tab style): per Thread an
   agent icon + short title + small state chip; current highlighted; advances per Tab
   while Ctrl held; commits the highlighted Thread on Ctrl release.
4. **Pins lifted out of Project groups.** A pinned Thread shows **only** in the flat
   Pinned list (the `Ctrl+1..9` slots) and is removed from its Project group — exactly
   one place in the rail.
5. **Pin order = user manual order** (drag-to-reorder), persisted and independent of
   `sortBy` — owned by `left-rail-manual-ordering.md`. `^1..^9` map to the first 9
   pinned **threads** in that manual order; pinned *projects* in the Pinned section are
   **skipped** for numbering (you can't switch to a group). Stable until the user
   reorders, so `^2` stays the same Thread within a session.
6. **L1 peek = floating overlay** over content (no grid reflow); triggered by a thin
   left-edge hot zone while the rail is collapsed; retracts on pointer-leave (small delay).
7. **Ctrl-hold auto-reveals the peek when the rail is collapsed**, so the `^N` badges
   always have visible rows to attach to. (Ctrl is the "show me navigation" gesture.)
8. **Live-set cycle order = Left Rail order.** `Ctrl+Tab` walks live Threads in the
   **exact top-to-bottom order the Left Rail renders them** — i.e. the rail's flattened
   visual sequence (Pinned list, then each Project group's threads in project order,
   then Scratch) filtered down to live Threads. No separate MRU/recency ordering: what
   you see in the rail is the cycle order, and it honors the active `groupBy`/`sortBy`.
   Top-level items (Pinned items, Project folders) follow the user's **manual order**
   (`left-rail-manual-ordering.md`); nested threads follow `sortBy`.
   (User: "그 녀석들도 왼쪽 트레일에 있을거잖아 → 그 순서대로 유지.")
9. **Pin badges/shortcuts cap at 9.** Only the first 9 pins (rail order) get `^1..^9`
   badges and `Ctrl+N` shortcuts; pin #10+ are still pinned and reachable via the
   peek/click, just without a number. (User: "ㅇㅇ 9개까지만하자.")

### Open Questions

- None blocking. Pin/project **manual reorder** is in scope but specified separately in
  `left-rail-manual-ordering.md`; this spec only *consumes* the resulting order.

## Out Of Scope

- In-app "attention queue" (the earlier Option B) / OS-notification replacement.
- Side-by-side / split multi-Thread viewing (the earlier Option C).
- Drag-to-reorder pins; trackpad-gesture peek.
- Any **persistent** fleet board / dashboard chrome (explicitly excluded by master-plan).

## Domain Model

- **Pinned set** — pinned Threads in the user's **manual order**
  (`left-rail-manual-ordering.md`). Source of the `Ctrl+1..9` slots; the i-th pinned
  *thread* (skipping pinned projects) ↔ shortcut `^(i+1)` for `i < 9`.
- **Live set** — ordered list of Threads whose Agent Runtime is hydrated/alive in the
  current backend process (Decision 2), in **Left Rail render order** (Decision 8 —
  the rail's flattened top-to-bottom sequence filtered to live). Distinct from the
  pinned set (curated/stable) — a Thread can be in either, both, or neither.
- **Multitask mode** — renderer-only transient UI state, true while `Ctrl` is held.
  While active: pinned rows show number badges; the collapsed rail auto-peeks; if a
  `Tab` has been pressed this hold, the Live Switcher HUD is shown and owns cycling.

## Contracts

- **`shared/contracts/thread.ts`** — add optional `live?: boolean` to
  `ThreadSummaryDto` ("an Agent Runtime for this Thread is hydrated/alive in this
  process now"). Absent ⇒ `false` (back-compat with older payloads).
- **Backend projection** — `adapters/inbound/contract-message-adapter/dto/thread-dtos.ts`
  sets `live` from the in-process runtime registry (the same source as
  `peekThread`/`live-projector`). Liveness flips on runtime start/stop, which are
  already eventful (thread lifecycle + `agentRuntime.stateChanged`) → no new event kind
  required; recompute on each thread-list projection and on those events.
- **Renderer** — add `live?: boolean` to `ProductShellThreadView`
  (`product-shell/state/types.ts`); carry it through `state/events.ts`.
- **No new backend command for switching.** `Ctrl+N` and the HUD commit reuse the
  existing select path (`onThreadSelect` → `thread.hydrate`/active-thread selection).
- **View-model changes** (`product-shell/state/view-model.ts`):
  - `projectGroups` **excludes** pinned Threads (Decision 4).
  - `pinnedThreads` is the authoritative pin list in **manual order** (Decision 5;
    `left-rail-manual-ordering.md`), not `sortBy`-ordered.
  - new derived `liveThreads` selector (Decision 2 ordering) for the HUD.

## Flow

1. **L1 peek.** Rail collapsed → pointer enters left-edge hot zone (~6px) → floating
   rail overlay slides in over content (fixed/absolute, elevated z, shadow; **no grid
   reflow**) → pointer leaves overlay → retract after a short delay. Row click selects
   via the normal path; `Esc` retracts. Hover **never** changes `activeThreadId`.
2. **L2 pin jump.** `keydown Ctrl` (no other key) → enter multitask mode → first ≤9
   pinned rows replace their time string with a `^N` badge (and the collapsed rail
   auto-peeks, Decision 7). `Ctrl+Digit N` → select `pinnedThreads[N-1]` if present
   (else no-op). `keyup Ctrl` → exit mode; badges revert to time; auto-peek retracts.
3. **L3 live cycle.** While `Ctrl` held, `keydown Tab` → show HUD if hidden, advance
   highlight to next live Thread; `Shift+Tab` → previous; wraps. `keyup Ctrl` → commit:
   select highlighted Thread, hide HUD. Empty live set → no HUD, no selection. Single
   live Thread → HUD shows it; Tab is a no-op cycle. While the HUD is up it owns the
   cycle (pin badges may remain on the rail underneath but Tab drives the HUD).

## Invariants

- **Nothing new is persistent.** Every multitask surface (badges, HUD, peek) is
  visible only while `Ctrl` is held or the collapsed-rail hot zone is hovered. At rest,
  pixels equal today's. (Keeps master-plan no-dashboard / compact-chrome intact.)
- **Stable pin slots.** `^2` resolves to the same Thread across a session while pins
  are unchanged (no recency reshuffle).
- **One place per pin.** A pinned Thread appears only in the Pinned list, never also
  under its Project group.
- **Live ≠ last-known.** A cold/history-only Thread is never in the live set regardless
  of its `lastKnownState`; the set comes from in-process hydrated runtimes only.
- **Single switch path.** Peek-click, `Ctrl+N`, and HUD-commit all funnel through the
  existing `onThreadSelect`; no parallel switching logic.
- **No OS clash / no focus theft.** Only `⌘+Tab` is OS-reserved; `Ctrl+Tab` and
  `Ctrl+1..9` are captured at window level (preventDefault when handled) and work even
  when focus is in the Composer; plain `Tab` in the Composer is unaffected.

## Tests (to write at implementation time — not now)

- **view-model:** pinned Threads excluded from `projectGroups`; `pinnedThreads`
  stable-ordered; `liveThreads` = `live===true` in **Left Rail render order** (matches
  the rail's flattened sequence); `live` absent ⇒ excluded.
- **multitask-mode hook:** `Ctrl` down → mode on, up → off; `Ctrl+Digit` resolves to
  `pinnedThreads[N-1]` and emits select; out-of-range digit = no-op; emits via
  `onThreadSelect` only.
- **live switcher:** `Ctrl+Tab` advances within `liveThreads`, `Shift+Tab` reverses,
  wraps; commit-on-release selects highlighted; empty set ⇒ no HUD/no select; single ⇒
  no-op cycle.
- **rail peek:** collapsed + hot-zone enter ⇒ peek visible; leave ⇒ hidden (after
  delay); peek click selects via normal path; hover does not mutate `activeThreadId`.
- **contract/boundary:** `ThreadSummaryDto.live` optional; renderer treats absent as
  `false`.
- **architecture:** all switch entry points dispatch through the one select path.

## Implementation Notes (for later slices — do not implement now)

- **Suggested slice order:** (S1) contract `live` + backend projection + view-model
  `liveThreads`/pin-exclusion + tests; (S2) `useMultitaskNavigation` hook (Ctrl mode,
  `Ctrl+1..9`, `Ctrl+Tab`) + Live Switcher HUD; (S3) floating rail peek + Ctrl-hold
  auto-peek; (S4) pin badges in the row time slot + CSS polish.
- **Likely files:** `shared/contracts/thread.ts`;
  `backend/.../dto/thread-dtos.ts`; `product-shell/state/{types,view-model,events}.ts`;
  new renderer `product-shell/multitask/` (a `useMultitaskNavigation` hook +
  `live-switcher-hud.tsx` + `rail-peek.tsx`); `left-rail/thread-row.tsx` (time↔badge);
  `left-rail/left-rail.tsx` (peek host); area CSS.
- Keep all keyboard handling in **one** `useMultitaskNavigation` hook (sibling to
  `use-shell-effects.ts`) — do not scatter listeners.
- Respect render-isolation (memoized selectors; HUD/peek are their own components so
  cycling/hover does not re-render Agent Chat). Mount HUD/peek only while active.
  Performance budget: hot-zone is one cheap pointer listener; no idle work.
