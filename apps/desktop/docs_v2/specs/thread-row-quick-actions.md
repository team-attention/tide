# Spec: Thread Row Quick Actions

> Status: **IMPLEMENTED**. Sibling of
> `multitask-navigation.md` / `left-rail-manual-ordering.md` (all touch the Thread Row's
> right side — see the precedence rule below).

## Scope

Thread Row hover quick-actions expose the row-local commands that fit safely in
the right slot: **Pin/unpin**, **Archive**, and, for worktree rows only,
**Delete worktree**. The row context menu remains available by right-click or
the `...` button, but it is a secondary utility menu, not a duplicate of the
hover actions. It contains non-row-slot actions such as review, rename, reveal,
and copy identifiers.

## Evidence

- **Before this slice the row's action area was only a `⋯` overflow:**
  `left-rail/thread-row.tsx:111–124` (`createIconButton("Thread menu",
  <MoreHorizontal/>, … )`). At rest the row showed attention/running dot + time;
  the only action was `⋯`.
- **That menu holds everything:** `left-rail/context-menu.tsx:61–84` — Pin/unpin,
  Archive, and (worktree threads) `Delete worktree (<branch>)…` in danger red.
- **Handlers already exist:** `onThreadPinToggle`, `onThreadArchiveIntent` (which enters
  the existing inline Confirm flow — `thread-row.tsx:93–101` `archiveConfirming` →
  `onThreadArchiveConfirm`), `onThreadDeleteWorktree`, `threadWorktreeBranch`.
- **Intended design:** `master-plan.md:120` — "Hover actions include pin and archive."
  Current state diverged from that intent (the user's screenshot shows Pin/unpin +
  Archive + Delete worktree all inside the `⋯` menu, so common actions cost an extra click).
- **Left Rail visual foundation:** Thread Rows are one-line navigation rows and do
  not render a default leading Thread icon. A leading status marker appears only
  for active state that needs attention: running spinner or attention dot.

## Decisions

1. **Direct hover quick-actions = Pin/unpin + Archive** (one click each), shown on row
   hover, matching `master-plan:120`.
   - Pin icon reflects state (pinned ↔ unpinned); label "Pin"/"Unpin".
   - Archive uses the **existing** inline Confirm flow (`onThreadArchiveIntent` →
     `archiveConfirming` → Confirm → `onThreadArchiveConfirm`); that flow is unchanged.
2. **Right-click opens a utility menu, not a duplicate action menu.** It includes
   View changes, Rename task, Reveal in Finder, Copy working directory, Copy
   session ID, and Copy thread ID. Pin/archive/delete stay in the hover slot.
3. **Delete worktree is direct only on worktree rows.** It uses the existing confirm
   dialog/safety path; non-worktree rows do not render the button.
4. **Right-side precedence** (the row's right edge is shared by three features):
   `Ctrl`-held `^N` badge (`multitask-navigation` L2) **>** hover quick-actions
   **>** at-rest (attention/running dot + time). I.e. at rest show dot+time; on hover
   show pin/archive/delete-when-available; while `Ctrl` held show the number badge.
5. **Row context is not a second hover popover.** Project/worktree/branch/status
   metadata stays out of the one-line row. Operational context is available
   through explicit menu actions and copied identifiers instead of an automatic
   flyout that competes with the real menu.
6. **No inert leading status slot.** Running keeps the spinner and attention/unread
   keeps the small dot, but idle, live-idle, and pinned rows render no placeholder
   circle or leading pin marker.

### Open Questions

- None.

## Out Of Scope

- Project-row actions (separate menu; unchanged).
- Rename (stays double-click).
- Changing the worktree delete confirmation/safety rules.

## Domain Model / Contracts

- **Renderer-only. No contract change.** Reuses existing handlers and the existing
  inline archive-confirm state. Thread utility menu data is derived from the
  renderer's current Thread view/state.

## Flow

1. Hover a Thread Row → quick-action icons appear on the right (pin/unpin,
   archive, and delete-worktree only for worktree rows); the time/dot hides.
2. Click **pin** → toggles immediately. Click **archive** → inline Confirm appears
   (existing flow). Click **delete worktree** → existing worktree delete confirmation.
3. Right-click or click `...` → utility menu. Copy actions write to the OS
   clipboard and close the menu. Reveal opens the Thread working directory in
   Finder when it has one.

## Invariants

- Common actions (pin/unpin, archive) are reachable in **one** click from hover (no menu
  step).
- Destructive Delete worktree is rendered only for worktree rows and still goes
  through the existing confirm path.
- Right-click always opens the utility menu.
- The utility menu does not repeat the visible hover actions.
- Quick-actions never overlap the `Ctrl`-held `^N` badge (precedence rule, Decision 4) —
  coordinate the right-slot rendering with `multitask-navigation` L2.
- Idle/live-idle/pinned rows do not reserve a leading status slot.

## Tests

- thread-row renders pin + archive quick-action buttons; pin → `onThreadPinToggle`;
  archive → `onThreadArchiveIntent` (enters confirm state).
- pinned thread shows an Unpin affordance; unpinned shows Pin.
- worktree thread renders Delete worktree; non-worktree does not.
- idle/live-idle/pinned rows do not render `thread-row__leading`; running and
  attention rows still do.
- context menu renders Review, Rename, Reveal, Copy working directory, Copy
  session ID, and Copy thread ID.
- Copy session ID uses the provider session ref when present and falls back to
  the Tide Thread id when no provider session has been bound yet.
- right-side precedence (badge vs hover vs time) — covered jointly when multitask L2 lands.

## Implementation Notes

- **Files:** `left-rail/thread-row.tsx` (actions area: pin + archive icon buttons,
  delete-worktree only for worktree rows; leading status only for running/attention);
  `left-rail/context-menu.tsx` (secondary thread utilities); handler helpers for
  resolving Thread cwd/session identifiers.
- The **only** coupling is the row right-slot precedence
  with `multitask-navigation` L2 (number badge) — land the time↔actions↔badge slot logic
  once, shared.
