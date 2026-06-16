# Spec: Delete a Branch from the Composer Branch Picker

## Scope

Let a user delete a stale local branch directly from the Composer's **Branch**
picker (the Execution Context dropdown), the way the **Worktree** picker already
lets them delete a worktree. Today the branch menu is select-only: branches like
`codex/*`, `archive-main`, `backup-*` pile up with no way to remove them anywhere
in the UI — worktree deletion only covers branches that back a worktree.

In scope:
- A **trailing trash control on each safe-to-delete branch row** in the Composer
  branch menu, mirroring the worktree-menu trash affordance.
- A confirm dialog that **deletes the local branch** (`git branch -d`, or `-D`
  after an explicit unmerged-loss acknowledgment).
- The picker refreshes from git on success so the deleted branch disappears.

Out of scope: deleting remote branches (`git push --delete`); deleting a branch
that backs a worktree (use the worktree delete flow); creating/renaming branches;
a Left-Rail entry point. This is the **safe-only** cut (user choice).

## Decisions

### D1. Trash only on safe-to-delete branches (`branchDeletableFromPicker`)
A branch row gets a trash control only when git would actually let us delete it:
it is **local** (not a `remote` ref), **not the current** (checked-out) branch,
and **not checked out in any worktree** (its name is absent from
`availableWorktrees[].branch`). All other rows stay select-only — no trash. This
is exactly the set `git branch -d/-D` can remove, so the action never silently
no-ops.

### D2. Unmerged needs explicit force (safety default)
`branchInfo(cwd, branch)` (read-only) reports `merged`. A merged branch deletes
with `-d`; an unmerged one shows a red "unmerged commits will be lost" warning and
deletes with `-D` only after the user confirms. `branchDeleteRequest` maps
`{ branchMerged }` → `{ force: !branchMerged }`.

### D3. Confirm dialog, no "keep" choice
Unlike the worktree dialog there is no "Keep branch" checkbox — the branch *is*
the thing being deleted. The dialog shows a "Deleting…" spinner while git runs and,
on failure, stays open with an explanation so the user can retry or cancel.

### D4. Refresh from git on success
After a successful delete the renderer re-reads `gitContext(cwd)` and applies it
(`setProductShellGitContext`), so the row vanishes immediately. The trash never
shows on the current branch — the default execution-context selection — so the
selected branch is never the one removed.

## Contracts (Main IPC / preload)

```ts
// Read-only: drives the dialog's unmerged warning.
branchInfo(cwd: string, branch: string): Promise<{ exists: boolean; merged: boolean }>;
// Deletes the local branch; force = -D (only after the unmerged acknowledgment).
deleteBranch(cwd: string, branch: string, options: { force: boolean }):
  Promise<{ deleted: boolean; branch: string | null }>;
```

`tide:branch-info` runs `rev-parse --verify --quiet refs/heads/<branch>` (exists)
and `merge-base --is-ancestor <branch> HEAD` (merged). `tide:delete-branch` runs
`git branch -d|-D <branch>` (shared `branchDeleteArgs`).

## Flow

1. `branchMenuRows` attaches `action = { rowId: "delete-branch:<name>", icon:
   "trash" }` to each `branchDeletableFromPicker` row.
2. Clicking the trash routes `onChoiceSurfaceRowSelect("branch_menu",
   "delete-branch:<name>")`; the composer handler derives the scope cwd and calls
   `openBranchDeleteByName(cwd, name)`.
3. `openBranchDeleteByName` reads `branchInfo`, opens `BranchDeleteDialog`.
4. `confirmBranchDelete` calls `deleteBranch` with `branchDeleteRequest`, then
   refreshes `gitContext` and closes (or shows an error and stays open).

## Verification

- Unit: `branchDeletableFromPicker` admits a plain local branch and rejects the
  current branch, a remote ref, and a worktree-backed branch
  (`composer_branch_menu_offers_delete_on_safe_local_branches_only`).
- Unit: `branchDeleteRequest` forces only for unmerged
  (`branch_delete_request_forces_only_for_unmerged_branch`).
- LIVE: create a throwaway branch (`git branch tmp-del`), open the picker, click
  its trash, confirm → the branch disappears from the menu and from `git branch`.
