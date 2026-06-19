// Pure rule for a new git worktree's branch + path, mirroring Tide v1's
// compute_worktree_path. Process-agnostic (used by Electron Main).
// See docs_v2/specs/worktree-creation.md.

export interface WorktreePathSettings {
  // Pattern with {repo_root} and {branch} placeholders. When unset, the default
  // sibling rule `{repo_root}.worktree/{branch}` is used.
  baseDirPattern?: string;
}

const DEFAULT_WORKTREE_BRANCH_PREFIX = "tide";

// A single name drives the worktree branch + directory: slashes and whitespace
// become dashes so it is a safe branch + path segment.
export function sanitizeWorktreeBranch(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/\//g, "-");
}

// Git branch name for Tide-created worktrees. The branch is namespaced as
// `tide/<name>`, while the worktree directory still uses sanitizeWorktreeBranch.
export function worktreeBranchName(name: string): string {
  const raw = name.trim();
  const prefix = `${DEFAULT_WORKTREE_BRANCH_PREFIX}/`;
  const unprefixed = raw.toLowerCase().startsWith(prefix) ? raw.slice(prefix.length) : raw;
  const sanitized = sanitizeWorktreeBranch(unprefixed).replace(/^-+|-+$/g, "");
  return `${prefix}${sanitized.length > 0 ? sanitized : "worktree"}`;
}

export function computeWorktreePath(
  repoRoot: string,
  branch: string,
  settings?: WorktreePathSettings,
): string {
  const sanitized = sanitizeWorktreeBranch(branch);
  const pattern = settings?.baseDirPattern;
  if (pattern !== undefined && pattern.length > 0) {
    return pattern
      .replace("{repo_root}", repoRoot)
      .replace("{branch}", sanitized);
  }
  // Default mirrors v1: a `<repo>.worktree/` sibling dir, one subdir per branch.
  const trimmedRoot = repoRoot.replace(/\/+$/, "");
  return `${trimmedRoot}.worktree/${sanitized}`;
}

// Inverse of the default rule: given a cwd, return the repo root it is a worktree
// of (`<repo>.worktree/<branch>` -> `<repo>`), or null if it is not a Tide
// default-rule worktree path. Used to group worktree Projects under their repo.
export function worktreeRepoRootForCwd(cwd: string): string | null {
  const match = cwd.replace(/\/+$/, "").match(/^(.*)\.worktree\/[^/]+$/);
  return match === null ? null : match[1];
}

// Args for `git worktree add` (run with execFile, no shell): create a new branch
// `branch` at `worktreePath`, optionally based off `baseBranch` (defaults to the
// repo's current HEAD when unset). See docs_v2/specs/worktree-start-experience.md.
export function worktreeAddArgs(input: {
  repoCwd: string;
  branch: string;
  worktreePath: string;
  baseBranch?: string;
}): string[] {
  const args = ["-C", input.repoCwd, "worktree", "add", "-b", input.branch, input.worktreePath];
  const base = input.baseBranch?.trim();
  if (base !== undefined && base.length > 0) {
    args.push(base);
  }
  return args;
}

// Args for deleting a worktree + its branch (run with execFile, no shell). See
// docs_v2/specs/worktree-branch-deletion.md. Remove the worktree dir before the
// branch — a branch can't be deleted while checked out in its worktree.
export function worktreeRemoveArgs(repoCwd: string, worktreePath: string): string[] {
  return ["-C", repoCwd, "worktree", "remove", "--force", worktreePath];
}

// `git branch -d|-D <branch>`: force (`-D`) is required for an unmerged branch and
// is only used after an explicit user acknowledgment (no silent commit loss).
export function branchDeleteArgs(repoCwd: string, branch: string, force: boolean): string[] {
  return ["-C", repoCwd, "branch", force ? "-D" : "-d", branch];
}

// Tests whether `branch`'s commits are all reachable from the repo's HEAD (i.e.
// merged). `merge-base --is-ancestor` exits 0 when merged, 1 when not.
export function branchMergedArgs(repoCwd: string, branch: string): string[] {
  return ["-C", repoCwd, "merge-base", "--is-ancestor", branch, "HEAD"];
}

// Maps the delete dialog's choice to deleteWorktree options. The branch is
// deleted unless "Keep branch" is ticked; force (`-D`) is requested ONLY when
// deleting an unmerged branch — never otherwise, so commits are never lost
// silently. See docs_v2/specs/worktree-branch-deletion.md.
export function worktreeDeleteRequest(input: {
  keepBranch: boolean;
  branchMerged: boolean;
}): { deleteBranch: boolean; force: boolean } {
  const deleteBranch = !input.keepBranch;
  return { deleteBranch, force: deleteBranch && !input.branchMerged };
}

// Maps the standalone branch-delete dialog's facts to deleteBranch options. There
// is no "keep" choice (the branch IS the thing being deleted); force (`-D`) is
// requested ONLY for an unmerged branch, after the user acknowledged the warning.
// See docs_v2/specs/branch-deletion-from-picker.md.
export function branchDeleteRequest(input: {
  branchMerged: boolean;
}): { force: boolean } {
  return { force: !input.branchMerged };
}
