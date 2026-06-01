// Pure rule for a new git worktree's branch + path, mirroring Tide v1's
// compute_worktree_path. Process-agnostic (used by Electron Main).
// See docs_v2/specs/worktree-creation.md.

export interface WorktreePathSettings {
  // Pattern with {repo_root} and {branch} placeholders. When unset, the default
  // sibling rule `{repo_root}.worktree/{branch}` is used.
  baseDirPattern?: string;
}

// A single name drives the worktree branch + directory: slashes and whitespace
// become dashes so it is a safe branch + path segment.
export function sanitizeWorktreeBranch(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/\//g, "-");
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
