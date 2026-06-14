# Spec: Thread Row Quick Actions (restore direct Pin / Archive)

> Status: **PLAN ONLY** (no code/tests yet, by request). Sibling of
> `multitask-navigation.md` / `left-rail-manual-ordering.md` (all touch the Thread Row's
> right side — see the precedence rule below).

## Scope

Restore direct, one-click **Pin/unpin** and **Archive** on a Thread Row (hover
quick-actions), and keep the rare/destructive **Delete worktree** behind the `⋯`
overflow + right-click menu. Reverses the regression where adding Delete-worktree
collapsed *all* actions (incl. the common Pin/Archive) into a single `⋯` "more" button.

## Evidence

- **Today the row's action area is only a `⋯` overflow:** `left-rail/thread-row.tsx:111–124`
  (`createIconButton("Thread menu", <MoreHorizontal/>, … )`). At rest the row shows
  attention/running dot + time; the only action is `⋯`.
- **That menu holds everything:** `left-rail/context-menu.tsx:61–84` — Pin/unpin,
  Archive, and (worktree threads) `Delete worktree (<branch>)…` in danger red.
- **Handlers already exist:** `onThreadPinToggle`, `onThreadArchiveIntent` (which enters
  the existing inline Confirm flow — `thread-row.tsx:93–101` `archiveConfirming` →
  `onThreadArchiveConfirm`), `onThreadDeleteWorktree`, `threadWorktreeBranch`.
- **Intended design:** `master-plan.md:120` — "Hover actions include pin and archive."
  Current state diverged from that intent (the user's screenshot shows Pin/unpin +
  Archive + Delete worktree all inside the `⋯` menu, so common actions cost an extra click).

## Decisions

1. **Direct hover quick-actions = Pin/unpin + Archive** (one click each), shown on row
   hover, matching `master-plan:120`.
   - Pin icon reflects state (pinned ↔ unpinned); label "Pin"/"Unpin".
   - Archive uses the **existing** inline Confirm flow (`onThreadArchiveIntent` →
     `archiveConfirming` → Confirm → `onThreadArchiveConfirm`); that flow is unchanged.
2. **`⋯` overflow + right-click keep the FULL menu** (Pin/Archive/Delete worktree) for
   discoverability and right-click parity. Common actions are now *also* direct; nothing
   is removed from the menu. (Default: keep `⋯` on every row for consistency.)
3. **Delete worktree stays menu-only** — never a direct quick-action (it's destructive;
   avoids accidental one-click deletion).
4. **Right-side precedence** (the row's right edge is shared by three features):
   `Ctrl`-held `^N` badge (`multitask-navigation` L2) **>** hover quick-actions + `⋯`
   **>** at-rest (attention/running dot + time). I.e. at rest show dot+time; on hover
   show pin+archive+`⋯`; while `Ctrl` held show the number badge.

### Open Questions

- Whether to **hide `⋯` on non-worktree rows** (where the menu would only duplicate the
  quick-actions). Default = keep `⋯` always (consistent + right-click parity); hiding is
  a minor alternative.

## Out Of Scope

- Project-row actions (separate menu; unchanged).
- Rename (stays double-click).
- Making Delete worktree a direct action.

## Domain Model / Contracts

- **Renderer-only. No contract change.** Reuses existing handlers and the existing
  inline archive-confirm state. `context-menu.tsx` is unchanged (menu stays full).

## Flow

1. Hover a Thread Row → quick-action icons fade in on the right (pin/unpin, archive) +
   `⋯`, using the existing floated-hover-actions pattern; the time slides under/hides.
2. Click **pin** → toggles immediately. Click **archive** → inline Confirm appears
   (existing flow). Click **`⋯`** or **right-click** → full menu (incl. Delete worktree
   on worktree threads).

## Invariants

- Common actions (pin/unpin, archive) are reachable in **one** click from hover (no menu
  step).
- Destructive Delete worktree is reachable only via the menu (≥2 steps).
- Right-click always opens the full menu (unchanged behavior).
- Quick-actions never overlap the `Ctrl`-held `^N` badge (precedence rule, Decision 4) —
  coordinate the right-slot rendering with `multitask-navigation` L2.

## Tests (to write at implementation time — not now)

- thread-row renders pin + archive quick-action buttons; pin → `onThreadPinToggle`;
  archive → `onThreadArchiveIntent` (enters confirm state); `⋯` → opens menu.
- pinned thread shows an Unpin affordance; unpinned shows Pin.
- worktree thread's menu includes Delete worktree; non-worktree's does not.
- right-side precedence (badge vs hover vs time) — covered jointly when multitask L2 lands.

## Implementation Notes (later slice — do not implement now)

- **Files:** `left-rail/thread-row.tsx` (actions area: add pin + archive icon buttons,
  keep `⋯`); area CSS for hover reveal + the time/badge/actions precedence.
  `context-menu.tsx` unchanged.
- Tiny, mostly independent slice. The **only** coupling is the row right-slot precedence
  with `multitask-navigation` L2 (number badge) — land the time↔actions↔badge slot logic
  once, shared.
