import { dirname, join } from "node:path";
import { resolveAppDataRoot } from "./backend-bridge.ts";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { worktreeRepoRootForCwd } from "../../shared/worktree-path.ts";
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

export function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}

// Run git with explicit, prebuilt args (the worktree-path helpers already include
// `-C <repo>`), surfacing the exit status (needed for merge-base / branch -d).
export function execGitArgs(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, stdout: stdout ?? "" });
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
