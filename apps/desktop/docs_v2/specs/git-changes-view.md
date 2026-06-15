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
