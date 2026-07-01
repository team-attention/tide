import { dirname, join } from "node:path";
import { resolveAppDataRoot } from "./backend-bridge.ts";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { branchCheckoutArgs, worktreeRepoRootForCwd } from "../../../../shared/worktree/path.ts";
// Extracted from electron-main.ts (spec: navigable-source-structure).

// --- Persisted project registry (Codex-style "open folder") ---
// Lives under the app data root, owned by Main (supervisor) since it is a
// Desktop/Left-UI concern, not agent-runtime domain.
interface ProjectRegistryEntry {
  projectId: string;
  name: string;
  cwd: string;
}

function projectRegistryPath(): string {
  return join(resolveAppDataRoot(), "project-registry.json");
}

export async function readProjectRegistry(): Promise<ProjectRegistryEntry[]> {
  try {
    const parsed = JSON.parse(await readFile(projectRegistryPath(), "utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (entry): entry is ProjectRegistryEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as ProjectRegistryEntry).cwd === "string",
    );
  } catch {
    return [];
  }
}

export async function writeProjectRegistry(entries: ProjectRegistryEntry[]): Promise<void> {
  await writeFile(projectRegistryPath(), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

// --- Git context for the Worktree/Branch menus (read-only) ---
export interface GitContext {
  isGitRepo: boolean;
  currentBranch: string | null;
  branches: { name: string; kind: "local" | "remote"; current: boolean }[];
  worktrees: { path: string; branch: string | null; current: boolean }[];
}

// Uncommitted working-tree changes (vs HEAD), for the read-only Changes view.
export type GitChangeStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface GitChangeFile {
  path: string; // repo-relative
  status: GitChangeStatus;
  // Added/removed line counts (vs HEAD). Undefined for binary files.
  additions?: number;
  deletions?: number;
}

export interface GitChanges {
  isGitRepo: boolean;
  files: GitChangeFile[];
}

export function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}

// Run git with explicit, prebuilt args (the worktree-path helpers already include
// `-C <repo>`), surfacing the exit status (needed for merge-base / branch -d).
export function execGitArgs(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

// The repo's main worktree root for any worktree cwd: fast path via the Tide
// default rule, else derive from git's common dir (handles custom path patterns).
export async function repoRootForWorktree(cwd: string): Promise<string | null> {
  const byRule = worktreeRepoRootForCwd(cwd);
  if (byRule !== null) {
    return byRule;
  }
  const common = (await runGit(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
  if (common.length === 0) {
    return null;
  }
  return dirname(common.replace(/\/+$/, ""));
}

export async function checkoutBranchForStart(cwd: unknown, branch: unknown): Promise<{
  checkedOut: boolean;
  currentBranch: string | null;
  error?: string;
}> {
  const fail = (error: string, currentBranch: string | null = null) => ({
    checkedOut: false,
    currentBranch,
    error,
  });
  if (typeof cwd !== "string" || cwd.length === 0 || typeof branch !== "string" || branch.trim().length === 0) {
    return fail("Invalid branch checkout request.");
  }
  const requestedBranch = branch.trim();
  const currentBranch = (await runGit(cwd, ["branch", "--show-current"])).trim() || null;
  const localRef = (await runGit(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${requestedBranch}`])).trim();
  if (localRef.length === 0) {
    return fail(`Branch "${requestedBranch}" is not a local branch in this folder.`, currentBranch);
  }
  if (currentBranch === requestedBranch) {
    return { checkedOut: true, currentBranch };
  }
  const result = await execGitArgs(branchCheckoutArgs(cwd, requestedBranch));
  const nextBranch = (await runGit(cwd, ["branch", "--show-current"])).trim() || null;
  if (!result.ok || nextBranch !== requestedBranch) {
    return fail(result.stderr.trim() || `Git refused to switch to "${requestedBranch}".`, nextBranch);
  }
  return { checkedOut: true, currentBranch: nextBranch };
}
