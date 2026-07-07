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

## Composer (pre-send) Changes — Draft Thread Workbench pane

> Slice (added 0.1.55+): the badge opens the Changes view on the **New Thread / composer
> page** too (`activeThreadId === null`), not only inside a thread.

### Gap

The badge already renders on the composer page whenever the selected scope's cwd is a git
repo (it shows `⎇ branch +adds −dels`), but clicking it was a **silent no-op**:
`onOpenChanges` early-returned when `activeThreadId === null`, because the backend Changes
pane is a per-thread Workbench singleton and `open_diff` needs a `threadId`. So the badge
looked actionable but did nothing pre-thread.

### Decision

Open Changes pre-send the same way every Composer Workbench launcher action works now:
first create/activate the Composer Draft Thread, then issue the normal backend
`workbench.command(threadId=draft, command="open_diff")`. The pane is owned by the Draft
Thread Workbench before send and remains on that same Thread when send starts it in place.

### Domain / Contracts

- `ProductShellHandlers.onOpenChanges`: `() => void` → `(cwd?: string) => void`.
- `useGitState`'s `gitBadge` gains `cwd: string` (it already fetches per cwd).
- No `initialWorkbenchPanes` adoption: panes opened before send already belong to the
  Draft Thread.

### Flow

1. Badge click → `onOpenChanges(gitBadge.cwd)`.
2. `onOpenChanges`: `activeThreadId !== null` → unchanged backend `open_diff`. Else, with a
   cwd → `ensureComposerDraftThreadActive(state)` + `thread.createDraft`.
3. Dispatch `workbench.command { threadId: draftThreadId, command: "open_diff" }`.
4. Backend creates/reveals the singleton `changes` pane in the Draft Thread Workbench.

### Invariants

- At most one `changes` pane per Draft/started Thread (backend singleton).
- A pre-send `changes` pane is not adopted or re-created on send. It already belongs to
  the Draft Thread, and send starts that Thread in place.
- Inside a thread the path is unchanged (backend `open_diff` singleton).

### Tests (`tests/git-changes-view.test.tsx`)

- composer + `onOpenChanges(cwd)` → `thread.createDraft` + backend `open_diff` for that
  draft thread.
- in-thread `onOpenChanges()` still dispatches backend `open_diff` (no regression).

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

## Inline diff indicators in FileTree and Editor

> Slice: the user wants Codex-App-style working-tree awareness in the everyday
> inspection surfaces, not only inside the dedicated Changes pane.

### Scope

- Show active git working-tree file status in the right-side FileTree.
- Show deleted tracked files as synthetic, non-editable FileTree rows so removals are
  visible even though the file no longer exists on disk.
- Show the active Editor Pane's current-file diff as subtle line decorations in
  CodeMirror.

### Decisions

- Reuse the existing renderer-side git polling (`useGitState`) and Main-process
  `gitChanges`/`gitFileDiff` bridge. Do not add a Backend or Shared Contract field
  for this renderer-local inspection layer.
- FileTree rows show compact status badges: `M`, `A`, `D`, `R`, `U`.
- Folder rows show an aggregate changed-descendant count when their subtree contains
  changed files.
- Deleted synthetic rows open the existing Changes pane instead of trying to open a
  missing Editor file.
- Editor inline markers are read-only diff evidence. They do not replace the full
  Changes pane and do not implement accept/revert/stage controls.

### Invariants

- Inline indicators are hidden when the git data cwd does not match the rendered
  FileTree root.
- FileTree filtering includes synthetic deleted rows.
- FileTree git rows preserve the tree's parent-before-child pre-order.
- Deleted files remain visible even when their deleted parent folders are absent
  from the filesystem-backed FileTree payload.
- Editor line markers refresh when the active file's git status or diff changes.
- Editor line markers keep the current file's previous diff visible while a
  refresh for the same file is in flight.
- Editor line markers never block editing or saving.

### Tests

- `file_tree_renders_git_status_badges_and_deleted_rows`
- `file_tree_git_entries_preserve_tree_order_and_missing_deleted_folders`
- `parse_unified_diff_line_markers_maps_added_changed_and_deleted_lines`
- `workbench_editor_pane_renders_git_diff_line_decorations`
- `workbench_editor_pane_keeps_existing_git_diff_while_refreshing`

## Default handoff actions

> Slice: the Changes pane should read as a normal developer handoff flow first,
> not as a low-level patch editor. Partial staging remains available, but it is
> not the primary mental model.

### Scope

- Put the primary flow in the toolbar: generate a commit message, commit, amend
  the previous commit, push, and create a pull request.
- Keep file-level stage/unstage/discard available.
- Move hunk-level actions behind a compact "partial changes" disclosure and do
  not expose the word "hunk" in the UI.

### Decisions

- `Amend` runs `git commit --amend`. If the commit message input is empty it
  uses `--no-edit`; otherwise it replaces the previous commit message with the
  input value.
- `Create PR` runs through Main-process IPC and shells out to `gh pr create
  --fill` with prompts disabled. It expects the user to have GitHub CLI
  installed and authenticated; failures surface as normal Git action notices.
- Partial staging remains implemented internally as diff hunks, because git
  patch application needs those boundaries. The user-facing label is "change
  block" / "partial changes".

### Invariants

- The default toolbar never requires the user to understand hunk terminology.
- `Create PR` is local Main-process infrastructure, not an Agent Runtime action.
- Amend and PR creation return structured action results so the Changes pane can
  clear busy state and show failures without blocking the rest of the pane.
