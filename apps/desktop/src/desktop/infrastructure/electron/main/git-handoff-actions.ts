import { execFile } from "node:child_process";
import { basename, join } from "node:path";

export type GitActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type GitGeneratedCommitMessageResult =
  | { ok: true; message: string; source: "staged" | "working_tree"; files: string[] }
  | { ok: false; message: string };

export type GitPushTargetResult =
  | {
      ok: true;
      currentBranch: string;
      remote: string;
      branch: string;
      upstream: string | null;
      label: string;
    }
  | { ok: false; message: string };

type GitMessageChange = {
  status: string;
  path: string;
};

const invalidGitAction: GitActionResult = { ok: false, message: "Invalid git action." };

export async function stageGitFile(input: { cwd: unknown; relPath: unknown }): Promise<GitActionResult> {
  const root = await gitActionRoot(input.cwd);
  const path = safeGitRelativePath(input.relPath);
  if (root === null || path === null) {
    return invalidGitAction;
  }
  const result = await execGitArgs(["-C", root, "add", "--", path]);
  return gitActionMessage(result, `Staged ${path}.`);
}

export async function unstageGitFile(input: { cwd: unknown; relPath: unknown }): Promise<GitActionResult> {
  const root = await gitActionRoot(input.cwd);
  const path = safeGitRelativePath(input.relPath);
  if (root === null || path === null) {
    return invalidGitAction;
  }
  const result = await execGitArgs(["-C", root, "restore", "--staged", "--", path]);
  return gitActionMessage(result, `Unstaged ${path}.`);
}

export async function discardGitFile(
  input: { cwd: unknown; relPath: unknown },
  trashItem: (path: string) => Promise<void>,
): Promise<GitActionResult> {
  const root = await gitActionRoot(input.cwd);
  const path = safeGitRelativePath(input.relPath);
  if (root === null || path === null) {
    return invalidGitAction;
  }
  const status = await runGit(root, ["-c", "core.quotepath=false", "status", "--porcelain=v1", "--", path]);
  if (status.startsWith("??")) {
    try {
      await trashItem(join(root, path));
      return { ok: true, message: `Moved ${path} to Trash.` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Failed to trash untracked file." };
    }
  }
  const result = await execGitArgs(["-C", root, "restore", "--staged", "--worktree", "--", path]);
  return gitActionMessage(result, `Discarded ${path}.`);
}

export async function commitGitChanges(input: { cwd: unknown; message: unknown }): Promise<GitActionResult> {
  const root = await gitActionRoot(input.cwd);
  const commitMessage = typeof input.message === "string" ? input.message.trim() : "";
  if (root === null || commitMessage.length === 0) {
    return invalidGitAction;
  }
  const result = await execGitArgs(["-C", root, "commit", "-m", commitMessage]);
  return gitActionMessage(result, "Committed changes.");
}

export async function generateGitCommitMessage(cwd: unknown): Promise<GitGeneratedCommitMessageResult> {
  const root = await gitActionRoot(cwd);
  if (root === null) {
    return { ok: false, message: "Invalid git repository." };
  }

  const staged = parseNameStatus(
    await runGit(root, ["-c", "core.quotepath=false", "diff", "--cached", "--name-status", "--find-renames", "--"]),
  );
  if (staged.length > 0) {
    return commitMessageResult(staged, "staged");
  }

  const tracked = parseNameStatus(
    await runGit(root, ["-c", "core.quotepath=false", "diff", "--name-status", "--find-renames", "HEAD", "--"]),
  );
  const untracked = (await runGit(root, ["ls-files", "--others", "--exclude-standard"]))
    .split("\n")
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .map((path) => ({ status: "A", path }));
  const workingTree = dedupeChanges([...tracked, ...untracked]);
  if (workingTree.length === 0) {
    return { ok: false, message: "No staged or working-tree changes found." };
  }
  return commitMessageResult(workingTree, "working_tree");
}

export async function getGitPushTarget(cwd: unknown): Promise<GitPushTargetResult> {
  const root = await gitActionRoot(cwd);
  if (root === null) {
    return { ok: false, message: "Invalid git repository." };
  }
  const currentBranch = (await runGit(root, ["branch", "--show-current"])).trim();
  if (currentBranch.length === 0) {
    return { ok: false, message: "Cannot push a detached HEAD from Tide." };
  }

  const upstream = (await runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])).trim();
  const parsedUpstream = parseUpstream(upstream);
  if (parsedUpstream !== null) {
    return pushTargetResult(currentBranch, parsedUpstream.remote, parsedUpstream.branch, upstream);
  }

  const remotes = await gitRemotes(root);
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  if (remote === undefined) {
    return { ok: false, message: "No git remote configured." };
  }
  return pushTargetResult(currentBranch, remote, currentBranch, null);
}

export async function pushGitTarget(input: {
  cwd: unknown;
  remote: unknown;
  branch: unknown;
}): Promise<GitActionResult> {
  const root = await gitActionRoot(input.cwd);
  const remote = safeGitRemote(input.remote);
  const branch = typeof input.branch === "string" ? input.branch.trim() : "";
  if (root === null || remote === null || branch.length === 0) {
    return invalidGitAction;
  }
  const remotes = await gitRemotes(root);
  if (!remotes.includes(remote)) {
    return { ok: false, message: `Remote ${remote} is not configured.` };
  }
  const branchCheck = await execGitArgs(["-C", root, "check-ref-format", "--branch", branch]);
  if (!branchCheck.ok) {
    return { ok: false, message: branchCheck.stderr.trim() || "Invalid branch name." };
  }
  const currentBranch = (await runGit(root, ["branch", "--show-current"])).trim();
  const result = await execGitArgs(["-C", root, "push", "-u", remote, `HEAD:refs/heads/${branch}`]);
  const fallback =
    currentBranch.length > 0
      ? `Pushed ${currentBranch} to ${remote}/${branch}.`
      : `Pushed HEAD to ${remote}/${branch}.`;
  return gitActionMessage(result, fallback);
}

async function gitActionRoot(cwd: unknown): Promise<string | null> {
  if (typeof cwd !== "string" || cwd.length === 0) {
    return null;
  }
  const inside = (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (inside !== "true") {
    return null;
  }
  return (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim() || cwd;
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}

function execGitArgs(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function safeGitRelativePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("..")) {
    return null;
  }
  return value;
}

function safeGitRemote(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const remote = value.trim();
  return remote.length > 0 && !remote.startsWith("-") && !/[\s\0-\x1f]/.test(remote) ? remote : null;
}

function gitActionMessage(result: { ok: boolean; stdout: string; stderr: string }, fallback: string): GitActionResult {
  if (result.ok) {
    const message = result.stdout.trim() || fallback;
    return { ok: true, message };
  }
  return { ok: false, message: result.stderr.trim() || "Git command failed." };
}

function parseNameStatus(output: string): GitMessageChange[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line): GitMessageChange | null => {
      const parts = line.split("\t");
      const status = parts[0]?.charAt(0) ?? "";
      const path = parts[parts.length - 1] ?? "";
      return status.length > 0 && path.length > 0 ? { status, path } : null;
    })
    .filter((change): change is GitMessageChange => change !== null);
}

function dedupeChanges(changes: GitMessageChange[]): GitMessageChange[] {
  const seen = new Set<string>();
  const result: GitMessageChange[] = [];
  for (const change of changes) {
    if (!seen.has(change.path)) {
      seen.add(change.path);
      result.push(change);
    }
  }
  return result;
}

function commitMessageResult(
  changes: GitMessageChange[],
  source: "staged" | "working_tree",
): GitGeneratedCommitMessageResult {
  return {
    ok: true,
    message: buildCommitMessage(changes),
    source,
    files: changes.map((change) => change.path),
  };
}

function buildCommitMessage(changes: GitMessageChange[]): string {
  const verbs = changes.map((change) => commitVerb(change.status));
  const firstVerb = verbs[0] ?? "Update";
  const sameVerb = verbs.every((verb) => verb === firstVerb);
  if (changes.length === 1) {
    return `${firstVerb} ${commitMessagePath(changes[0]?.path ?? "file")}`;
  }
  return sameVerb ? `${firstVerb} ${changes.length} files` : `Update ${changes.length} files`;
}

function commitVerb(status: string): "Add" | "Remove" | "Rename" | "Update" {
  switch (status.charAt(0)) {
    case "A":
    case "?":
      return "Add";
    case "D":
      return "Remove";
    case "R":
      return "Rename";
    default:
      return "Update";
  }
}

function commitMessagePath(path: string): string {
  return path.length <= 48 ? path : basename(path);
}

function parseUpstream(upstream: string): { remote: string; branch: string } | null {
  const slash = upstream.indexOf("/");
  if (slash <= 0 || slash === upstream.length - 1) {
    return null;
  }
  return { remote: upstream.slice(0, slash), branch: upstream.slice(slash + 1) };
}

async function gitRemotes(root: string): Promise<string[]> {
  return (await runGit(root, ["remote"]))
    .split("\n")
    .map((remote) => remote.trim())
    .filter((remote) => remote.length > 0);
}

function pushTargetResult(
  currentBranch: string,
  remote: string,
  branch: string,
  upstream: string | null,
): GitPushTargetResult {
  return {
    ok: true,
    currentBranch,
    remote,
    branch,
    upstream,
    label: `${remote}/${branch}`,
  };
}
