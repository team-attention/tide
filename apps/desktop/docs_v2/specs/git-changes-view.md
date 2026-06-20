# Spec: Git Changes View (branch + uncommitted diff)

> Status: **IMPLEMENTED** (branch `desktop-multitask-polish`). Read-only git awareness
> for the active thread's repo/worktree: current branch, whether there are uncommitted
> changes, and a diff view of those changes.

## Scope

While working in a thread whose cwd is a git repo/worktree, the user can:
1. **See the current branch** — a badge in the top-right window cluster.
2. **See whether there are changes** — the badge shows a dot + count of uncommitted files.
3. **View the diff** — clicking the badge opens a read-only **Changes** overlay: the
   changed files on the left, the selected file's working-tree diff (vs HEAD) on the right.

**Read-only** — no staging / commit / discard / push (deferred). Decided with the user.

## Current state & gap (before this change)

- Branch was known to the backend (`GitContext.currentBranch`) and shown in the composer
  branch chip, but **not** surfaced for the active thread.
- **No dirty/changes info** at all — `GitContext` had branches + worktrees only.
- The only diff view was `WorkbenchDiffPane`, which renders a single **agent-edited**
  file's before/after — there was no view of the repo's uncommitted `git diff`.

## Design

- **Backend (main process)** — `project-registry.ts` adds `GitChanges`/`GitChangeFile`;
  `electron-main.ts` adds two IPC handlers:
  - `tide:git-changes` → `git status --porcelain=v1 --no-renames`, parsed into
    `{ path, status: modified|added|deleted|renamed|untracked }[]`.
  - `tide:git-file-diff` → `git diff HEAD -- <path>` (tracked); falls back to
    `git diff --no-index -- /dev/null <path>` for untracked/new files.
  - Exposed via preload (`gitChanges`, `gitFileDiff`) → `window.tide` → `projectBridge`.
- **Renderer** — `useGitState` (in `support/use-shell-effects.ts`) consolidates the git
  fetch: one pass per cwd-change / manual refresh feeds the composer pickers
  (`gitContext` → shell state) **and** the badge + Changes view (`gitChanges` → gitInfo).
- **Top-bar badge** — added to `createWindowChromeToggles` (chrome.tsx): `⎇ branch ● N`,
  opens the overlay. Hidden when the cwd isn't a git repo.
- **Changes overlay** — `workbench/changes-panel.tsx` (`ChangesPanel`): file list (status
  letter + name + dir) → on select, loads `gitFileDiff` and renders it with the existing
  `createDiffView` (exported from `diff-pane.tsx`). Refresh + close; Escape closes.

## Verification

- Unit: `tests/git-changes-view.test.tsx` — the panel lists files with status classes +
  branch + count, and shows the clean empty state.
- Live: in a dirty repo thread, the badge shows the branch + change count; clicking opens
  the Changes overlay; selecting a file shows its diff; editing files + Refresh updates it;
  a clean repo shows the branch with no count and "Working tree clean".

## Composer (pre-thread) Changes — draft pane

> Slice (added 0.1.55+): the badge opens the Changes view on the **New Thread / composer
> page** too (`activeThreadId === null`), not only inside a thread.

### Gap

The badge already renders on the composer page whenever the selected scope's cwd is a git
repo (it shows `⎇ branch +adds −dels`), but clicking it was a **silent no-op**:
`onOpenChanges` early-returned when `activeThreadId === null`, because the backend Changes
pane is a per-thread Workbench singleton and `open_diff` needs a `threadId`. So the badge
looked actionable but did nothing pre-thread.

### Decision

Open Changes pre-thread the **same way the composer Browser does** — a renderer-local
**draft pane** (no backend, no thread). The data layer is already thread-independent
(`onGitChanges(cwd)` / `onGitFileDiff(cwd, path)` take a cwd) and `pane-content` already
renders a `kind:"changes"` pane purely from `pane.cwd`, so a draft pane with
`kind:"changes"` + the composer's `activeProjectCwd` renders the identical `ChangesPanel`.
**No backend change.**

### Domain / Contracts

- `ProductShellDraftPane.kind`: `"browser"` → `"browser" | "changes"`; add `cwd?: string`.
- `useGitState`'s `gitBadge` gains `cwd: string` (it already fetches per cwd).
- `ProductShellHandlers.onOpenChanges`: `() => void` → `(cwd?: string) => void`.

### Flow

1. Badge click → `onOpenChanges(gitBadge.cwd)`.
2. `onOpenChanges`: `activeThreadId !== null` → unchanged backend `open_diff`. Else, with a
   cwd → `openProductShellDraftChanges(state, cwd)`.
3. `openProductShellDraftChanges`: **singleton** — reveal/activate the existing draft
   `changes` pane, or create one (`kind:"changes"`, `cwd`); set `workbenchOpen: true`.
4. `composerWorkbenchAppChrome` maps a draft pane by kind: a `changes` draft →
   `{ kind:"changes", cwd }` ref → `ChangesPanel`.

### Invariants

- At most one draft `changes` pane (singleton), mirroring the backend pane.
- A draft `changes` pane is **not adopted on send**: `composer-bridge` seeds only
  `kind:"browser"` drafts into `thread.start`. A started thread owns its own backend
  Changes pane (re-openable via the badge); the draft is dropped, never mis-adopted as an
  empty Browser Pane.
- Inside a thread the path is unchanged (backend `open_diff` singleton).

### Tests (`tests/git-changes-view.test.tsx`)

- composer + `onOpenChanges(cwd)` → one draft `changes` pane, `workbenchOpen`, active.
- idempotent: two calls → still one draft `changes` pane.
- view-model: a draft `changes` pane → `AppChromeWorkbenchPaneRef` `kind:"changes"` + cwd.
- in-thread `onOpenChanges()` still dispatches backend `open_diff` (no regression).
- adoption: a draft `changes` pane is excluded from `initialWorkbenchPanes` on send.

## Changes panel layout — resizable + collapsible file list

> Slice (added 0.1.55+): the file list ate a fixed 260px and the diff was capped/cramped
> (long lines wrapped to near-vertical) with no way to widen it. Mirror GitHub's
> Files-changed file tree: resizable + collapsible.

### Gap

- `.changes-panel__body` was `grid-template-columns: 260px 1fr` — file list fixed width,
  not resizable, not collapsible.
- The reused `.workbench-diff` is `max-height: 420px`, so inside the full-height Changes
  pane the diff was capped and couldn't fill the pane.
- `.workbench-diff-row__text` wraps (`pre-wrap` + `break-word`); in a narrow column long
  lines (URLs, prose) wrapped to ~one char per line — unreadable.

### Decision (GitHub Files-changed parity)

- **Resizable file list**: a drag handle between the list and the diff sets the list width
  (component state, clamped 140–520px).
- **Collapsible file list**: a header toggle hides the list so the diff uses the full pane
  width ("view the diff in full"); toggles back.
- **Full-height diff**: in the Changes pane the reused diff fills the pane height
  (`max-height` lifted, chrome border/radius dropped — the pane is the frame).
- **Long lines scroll, not wrap**: in the Changes pane, diff rows keep their line and the
  diff scrolls horizontally (GitHub behavior), so URLs/prose stay readable.
- Scoped to `.changes-panel__diff` so the standalone `WorkbenchDiffPane` is untouched.

### Tests

- The Changes panel renders a file-list collapse toggle when there are files.
- (resize drag + horizontal scroll are CSS/pointer behavior — live-verified.)

## Git badge freshness

> Slice: a committed or externally changed worktree made the top-bar git badge stale:
> the badge could still show `+N −N` while the Changes pane, refreshed on open, correctly
> showed a clean working tree.

### Decision

The top-bar git badge is a live summary of the same uncommitted working-tree data used by
the Changes pane. While an active Project/worktree cwd is selected, the renderer refreshes
that git context periodically and on focus/visibility return. A failed refresh clears the
badge instead of preserving old `+N −N` counts, because a missing badge is less misleading
than a false dirty signal.

### Tests

- `git_badge_refreshes_after_working_tree_becomes_clean`
