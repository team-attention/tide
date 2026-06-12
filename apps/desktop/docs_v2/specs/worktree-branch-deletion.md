# Spec: Seamless Worktree & Branch Deletion

## Scope

Make deleting a git worktree (and, by default, its branch) reachable and safe from
where worktrees now live after the grouping redesign. Today "Delete worktree"
sits only on a worktree's top-level Project context menu — which the
`worktree-start-experience` grouping change folds away, leaving deletion
unreachable for grouped worktrees.

In scope:
- A **delete affordance in two places**: (1) the Left UI worktree **Thread row**
  context menu, and (2) the Composer **Worktree menu** (a trash control on each
  existing worktree row).
- **Worktree + branch deleted together by default**, with a "Keep branch"
  checkbox to remove only the directory.
- **Safety**: a branch with unmerged commits requires an explicit force
  confirmation (no silent commit loss); deletion is blocked while an agent is
  running in the worktree.

Out of scope: deleting the main worktree / repo; multi-worktree batch delete;
pruning stale worktrees automatically; renaming.

## Evidence

- `tide:remove-worktree(cwd)` runs `git worktree remove --force <cwd>` and
  unregisters the Project, **keeping the branch** (`electron-main.ts`,
  message "The branch is kept.").
- The delete entry is `onProjectDeleteWorktree` on the **Project** context menu,
  gated by `isProjectWorktree(projectId)` (`tide-product-shell.ts` ~5447). With
  `groupWorktreesByRepo` now default-on (`worktree-start-experience.md`), the
  worktree Project row is folded into its repo and no longer rendered top-level,
  so this entry is effectively unreachable.
- Thread rows currently show only Pin/Archive in their context menu.
- `worktreeRepoRootForCwd(cwd)` recovers the repo root from a
  `<repo>.worktree/<branch>` cwd; `tide:git-context` already returns each
  worktree's branch.
- A worktree Thread now carries `worktreeBranch` on its view
  (`product-shell-state.ts` `toThreadView`).

## Decisions

### D1. Two seamless entry points (user choice)
- **Thread row**: a "Delete worktree (branch X)…" item in the worktree Thread
  row's context menu (and the same target the row hover ⋯ opens).
- **Composer Worktree menu**: each existing-worktree row gets a trailing trash
  control. (The "current folder" / main worktree row has none.)

### D2. Worktree + branch deleted together, opt-out checkbox (user choice)
The confirm dialog deletes both the worktree directory and its branch by default;
a **"Keep branch <X>"** checkbox removes only the directory (the old behavior).

### D3. Unmerged branch needs explicit force (safety default)
If the branch is not merged into the repo's current HEAD, the dialog shows a red
"unmerged commits will be lost" warning and the confirm deletes the branch with
`git branch -D` only after that acknowledgment. Merged branches use `git branch -d`.
Keeping the branch (D2) skips this entirely.

### D4. Blocked while running (safety default)
If any Thread in the worktree is actively running (`thread.running`), deletion is
blocked with "Stop the running agent first" — the agent process holds the cwd.
Idle/waiting Threads in the worktree are allowed; they become unavailable after
deletion (their history is kept), matching today's behavior.

### D5. Read-only preview drives the dialog
A `tide:worktree-info(cwd)` IPC returns `{ repoRoot, branch, branchMerged,
isWorktree }` (read-only git) so the dialog can show the branch and the unmerged
warning before any mutation. Threads-here / running are computed in the renderer
from state.

## Contracts (Main IPC / preload)

```ts
// Read-only: drives the delete dialog.
worktreeInfo(cwd: string): Promise<{
  repoRoot: string | null;
  branch: string | null;
  branchMerged: boolean;   // branch's commits all reachable from repo HEAD
  isWorktree: boolean;     // cwd is a `<repo>.worktree/<branch>` worktree
}>;

// Mutating: remove the worktree dir; optionally delete its branch.
deleteWorktree(
  cwd: string,
  options: { deleteBranch: boolean; force: boolean },
): Promise<{
  entries: ProjectRegistryEntry[];
  worktreeRemoved: boolean;
  branch: string | null;
  branchDeleted: boolean;
}>;
```

`tide:remove-worktree` stays for back-compat (delete-dir-only = `deleteWorktree`
with `deleteBranch:false`); the renderer routes through `deleteWorktree`.

Pure git-arg helpers (in `src/shared/worktree-path.ts`, unit-tested):
```ts
worktreeRemoveArgs(repoCwd: string, worktreePath: string): string[];      // worktree remove --force
branchDeleteArgs(repoCwd: string, branch: string, force: boolean): string[]; // branch -d|-D
branchMergedArgs(repoCwd: string, branch: string): string[];              // merge-base --is-ancestor <branch> HEAD
```

## Flow

### UC-1: Delete worktree + branch from a Thread row
1. Right-click / ⋯ a worktree Thread row → "Delete worktree (branch X)…".
2. Renderer calls `worktreeInfo(cwd)`; computes threads-here + anyRunning.
3. If anyRunning → dialog blocks with "Stop the running agent first".
4. Else dialog: branch name, threads-here count, **"Keep branch X"** checkbox
   (unchecked by default), and — if `!branchMerged` and keep-branch unchecked — a
   red unmerged warning.
5. Confirm → `deleteWorktree(cwd, { deleteBranch: !keepBranch, force: !branchMerged })`.
6. Registry updates; the worktree's Threads drop out of the repo group.

### UC-2: Delete from the Composer Worktree menu
1. Open the Worktree menu; each existing worktree row shows a trash control.
2. Clicking it opens the same dialog (UC-1 from step 2).

### UC-3: Keep branch
1. Tick "Keep branch X" → only `git worktree remove --force` runs; the branch and
   its commits stay. No unmerged warning applies.

## Invariants
1. Deletion never silently loses commits — an unmerged branch is only removed
   after an explicit force acknowledgment (D3).
2. A worktree with a running agent is never deleted (D4).
3. git branch/worktree names are used verbatim from git (no re-derivation).
4. The main worktree / repo is never deletable through this affordance.
5. Removing the worktree dir always precedes branch deletion (the branch can't be
   deleted while checked out in its worktree).

## Tests

| UC | Rule | Test |
|----|------|------|
| D2 | delete-branch arg picks -d when merged, -D when forced | `branch_delete_args_use_force_flag_only_when_forced` |
| D1 | worktree remove args | `worktree_remove_args_force_remove_the_path` |
| D3 | merged-check arg shape | `branch_merged_args_test_ancestor_of_head` |
| D2 | dialog default deletes branch; checkbox keeps it | `worktree_delete_dialog_defaults_to_deleting_branch` (renderer state) |
| D4 | running worktree blocks delete | `worktree_delete_blocked_while_a_thread_runs` (renderer state) |
| D1 | worktree thread row exposes delete | `worktree_thread_row_offers_delete_worktree` (view model) |

## Implementation Notes

Slices:
- **E1 — delete contract (pure + main)**: git-arg helpers + `tide:worktree-info`
  + `tide:delete-worktree` (merged-check, ordered remove-then-branch). Pure helpers
  unit-tested.
- **E2 — sidebar dialog + thread-row menu**: a `WorktreeDeleteDialog` modal
  (keep-branch checkbox, unmerged warning, running guard) + thread-row context-menu
  item carrying the worktree cwd/branch.
- **E3 — composer worktree-menu trash**: trailing delete control on existing
  worktree rows opening the same dialog.

Keep the dialog renderer-local; the running/threads-here facts come from product
shell state, the branch/merged facts from `worktreeInfo`.

## Location
- `src/shared/worktree-path.ts`
- `src/desktop/infrastructure/electron/main/electron-main.ts`, `src/desktop/infrastructure/electron/preload/index.ts`
- `src/desktop/application/domains/product-shell/product-shell-state.ts`
- `src/desktop/application/domains/agent-chat/agent-chat-shell-state.ts` (composer row trash)
- `src/desktop/adapters/inbound/react-renderer/tide-product-shell.ts`, `renderer-entry.ts`
- `src/desktop/adapters/inbound/react-renderer/tide-product-shell.css`
