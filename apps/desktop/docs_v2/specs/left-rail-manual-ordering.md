# Spec: Left Rail Manual Ordering (Drag-and-Drop)

> Status: **PLAN ONLY** (no code/tests yet, by request). Sibling of
> `multitask-navigation.md`, which *consumes* the order this spec produces.

## Scope

Let the user manually reorder the **top-level items** of two Left Rail sections by
drag-and-drop, persisted, independent of the `sortBy` option. Nested thread contents
are never manually ordered — they always follow `sortBy`.

- **Pinned section, top-level** — standalone pinned Threads **and** pinned Projects,
  as one intermixed, manually-ordered list.
- **Projects section, top-level** — the Project folders themselves, manually ordered.
- **Always `sortBy` (never manual):** threads inside any Project group (**including a
  pinned Project's inner threads**), Scratch threads, and the flat "By thread" list.

One-line rule: **only the "1층" (top-level) item of a section is draggable; nested
thread contents always follow `sortBy`.**

## Evidence

- **No manual order exists today.** `state/view-model.ts:352–354` —
  `pinnedThreads = visibleThreads.filter(pinned)` → follows `sortBy` (`visibleThreads`
  is `sortThreads`-sorted, `:298–300`). `:357–364` `pinnedProjects`/`projectGroups`
  follow `topLevelProjects` = the `projects` array order (registration order), with no
  sort and no manual reorder.
- **Pinned section is fixed "projects then threads".** `left-rail/pinned-section.tsx:27–28`
  renders all pinned projects, then all pinned threads — not intermixed, not reorderable.
- **Nested threads already follow `sortBy`** (the behavior we keep): `view-model.ts:338–340`
  `threads: visibleThreads.filter(inGroup).map(...)`.
- **No DnD anywhere in the rail** (`rg drag/reorder` → none in product-shell).
- **Pin membership already persists** in Tide-owned metadata (see
  `v2-thread-cache-pointer-clobber`: pins were dropped on restore, then fixed in 0.1.35),
  so an order array can persist alongside it. Persistence model: `persistence.md`
  (provider-owned history + Tide-owned Thread/Project metadata).

## Decisions

1. **Manual order is top-level only.** Draggable: (a) Pinned-section top-level items
   (standalone pinned Threads + pinned Projects), (b) Projects-section Project folders.
   Everything nested stays `sortBy`-driven. (User: "1층 아이템들만 … 프로젝트가
   핀되었을때 그 안의 스레드들 정렬은 수동으로 되면 안돼"; "프로젝트 폴더들 정렬은
   할 수 있어야해. 물론 그 안의 내용은 안되고".)
2. **Pinned section is one intermixed ordered list.** A pinned Thread and a pinned
   Project may sit in any relative order (not the current "projects then threads").
3. **Manual order overrides `sortBy`** for those top-level items; changing `sortBy`
   does **not** reshuffle them. `sortBy` continues to govern nested threads.
4. **Gesture = press-and-hold then drag** (long-press to lift, drag to reorder, drop to
   commit). (User: "길게 눌러서 드래그앤드랍".)
5. **Persisted** in Tide-owned metadata; stable across restarts.
6. **Within-section only.** Drag reorders within a section; it never moves an item
   across sections (pinning/unpinning stays its own explicit action, not a drag).
7. **New items append at the end** of their list (newly pinned item; newly added
   project); the user can then drag them.

### Open Questions

- Keyboard-based reorder (a11y) — deferred; DnD only for v1.
- Auto-scroll while dragging near a section edge — implementation detail, default on.

## Out Of Scope

- Cross-section drag (drag-to-pin / drag-to-unpin / drag a thread into a project).
- Manual ordering of nested threads, Scratch, or the "By thread" flat list.
- Multi-select drag.

## Domain Model

- **`pinnedItemOrder`** — ordered list of pinned-item refs, each
  `{ kind: "thread"; threadId } | { kind: "project"; projectId }`. Defines the Pinned
  section's top-level order.
- **`projectOrder`** — ordered list of `projectId`. Defines the Projects section's
  folder order.
- **Nested threads** — unchanged: derived per Project via `sortThreads(..., sortBy)`.
- **Fallback** — an item present in the rail but absent from its order array
  (legacy/just-created) sorts **after** all ordered items, deterministically (e.g. by
  `createdAt`), then is appended to the persisted order on next write.

## Contracts / Persistence

- Persist `pinnedItemOrder` and `projectOrder` in the **Tide-owned** Left-Rail/Thread
  metadata store (same place pin membership and `collapsedProjectIds` live). These are
  product-shell UI-organization state; they do not cross the Agent Runtime boundary.
- **View-model changes** (`product-shell/state/view-model.ts`):
  - Pinned section: replace the separate `pinnedThreads` + `pinnedProjects` outputs with
    a single ordered `pinnedItems` list honoring `pinnedItemOrder` (NOT `sortBy`). (Keep
    a derived `pinnedThreads` view if `multitask-navigation.md` wants it for `^N`.)
  - `projectGroups` ordered by `projectOrder` (NOT registration order).
  - Nested `threads` per group: still `sortThreads(...)`.
- **State** (`product-shell/state/types.ts`): add `pinnedItemOrder`, `projectOrder`;
  a reducer action to move an item from index i to j within a list; persistence wiring.
- No backend contract change (this is renderer-owned organization state).

## Flow

1. Press-and-hold a Pinned top-level item, or a Project folder → it lifts (drag visual).
2. Drag over siblings in the same section → live reorder preview.
3. Drop → commit the new order → persist. Drop outside / `Esc` → cancel, restore.
4. Nested thread lists do not respond to the gesture (only the section's top-level rows
   are drag handles).

## Invariants

- Only top-level items reorder; **nested thread lists are always `sortBy`-derived**,
  including a pinned Project's inner threads.
- Manual order is **independent of `sortBy`**: toggling sort never reshuffles pinned
  top-level items or project folders.
- Order is **persisted** and is the single source consumed by `multitask-navigation.md`
  for (a) the `^1..^9` pin→thread mapping and (b) the Left Rail render order the live
  switcher cycles.
- Drag is **within-section only**; no cross-section moves.
- Every visible item has a deterministic position even if missing from the order array
  (fallback rule), so the rail never renders an undefined order.

## Tests (to write at implementation time — not now)

- view-model: `pinnedItems` honor `pinnedItemOrder` regardless of `sortBy`;
  `projectGroups` honor `projectOrder`; nested threads still follow `sortBy`; a pinned
  Project's inner threads follow `sortBy` (not manual); unknown/new ids fall to the end
  deterministically.
- reorder reducer: move i→j yields the expected order; persists; round-trips through
  save/restore; is idempotent.
- boundary: changing `sortBy` leaves `pinnedItems`/`projectGroups` top-level order
  unchanged.
- (DnD pointer interaction — component test at impl time.)

## Implementation Notes (later slices — do not implement now)

- **Slice order:** **S1 (data) first** — order model + view-model derivations +
  persistence + tests, *no DnD yet*. This S1 is a **prerequisite for
  `multitask-navigation` L2** (the `^N` mapping needs a real manual order). **S2 (UX)** —
  the long-press DnD gesture, live reorder, commit, CSS affordance.
- **Likely files:** `product-shell/state/{types,view-model}.ts` (+order arrays,
  ordered derivations, move reducer); persistence wiring; `left-rail/pinned-section.tsx`
  (one intermixed ordered list + drag handles); `left-rail/project-section.tsx`
  (project-folder drag handles); a shared `useRailDragReorder` hook/util; area CSS.
- Keep DnD logic in one hook; respect render-isolation (reorder re-renders only the
  rail column). A small dependency-free pointer DnD is preferred over a heavy library
  (performance budget).
