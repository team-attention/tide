# Spec: Thread Row Quick Actions

> Status: **IMPLEMENTED**. Sibling of
> `multitask-navigation.md` / `left-rail-manual-ordering.md` (all touch the Thread Row's
> right side — see the precedence rule below).

## Scope

Thread Row hover quick-actions expose the row-local commands that fit safely in
the right slot: **Pin/unpin**, **Archive**, and, for worktree rows only,
**Delete worktree**. The full menu remains available by right-click. Row metadata
such as Project, Worktree, Branch, and Status stays out of the row and lives in
the hover/focus context popover.

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
2. **Right-click keeps the full menu** (Pin/Archive/Delete worktree) for parity and
   secondary discoverability.
3. **Delete worktree is direct only on worktree rows.** It uses the existing confirm
   dialog/safety path; non-worktree rows do not render the button.
4. **Right-side precedence** (the row's right edge is shared by three features):
   `Ctrl`-held `^N` badge (`multitask-navigation` L2) **>** hover quick-actions
   **>** at-rest (attention/running dot + time). I.e. at rest show dot+time; on hover
   show pin/archive/delete-when-available; while `Ctrl` held show the number badge.
5. **Row context is not inline metadata.** Project/worktree/branch/status context is
   mounted as a hidden hover/focus popover for every thread row, then measured and
   shown as a fixed flyout when opened.
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
  inline archive-confirm state. `context-menu.tsx` is unchanged (menu stays full).

## Flow

1. Hover a Thread Row → quick-action icons fade in on the right (pin/unpin,
   archive, and delete-worktree only for worktree rows); the time/dot hides.
2. Hover/focus also opens the fixed context popover. Moving from row to popover keeps
   it open briefly so long worktree/branch names can be inspected.
3. Click **pin** → toggles immediately. Click **archive** → inline Confirm appears
   (existing flow). Click **delete worktree** → existing worktree delete confirmation.
   Right-click → full menu.

## Invariants

- Common actions (pin/unpin, archive) are reachable in **one** click from hover (no menu
  step).
- Destructive Delete worktree is rendered only for worktree rows and still goes
  through the existing confirm path.
- Right-click always opens the full menu (unchanged behavior).
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
- worktree/project context appears in the hidden hover/focus popover, not as inline
  row text.
- right-side precedence (badge vs hover vs time) — covered jointly when multitask L2 lands.

## Implementation Notes

- **Files:** `left-rail/thread-row.tsx` (actions area: add pin + archive icon buttons,
  delete-worktree only for worktree rows; leading status only for running/attention);
  area CSS for hover reveal + the time/badge/actions precedence.
- The **only** coupling is the row right-slot precedence
  with `multitask-navigation` L2 (number badge) — land the time↔actions↔badge slot logic
  once, shared.
