import { checkoutBranchForStart, execGitArgs, readProjectRegistry, repoRootForWorktree, runGit, writeProjectRegistry } from "./project-registry.ts";
import type { GitChangeFile, GitChanges, GitContext } from "./project-registry.ts";
import { backendProcess, ensureBackendProcess, nextEventId, postBackendCommand } from "./backend-bridge.ts";
import { maybeOfferMoveToApplications } from "./move-to-applications.ts";
import { installApplicationMenu } from "./app-menu.ts";
import { applyHostZoom } from "./zoom.ts";
import { createMainWindow } from "./main-window.ts";
import { registerNotificationBridge } from "./notifications.ts";
import { registerAutoUpdate, logUpdateEvent } from "./auto-update.ts";
import { readUiPrefs, saveUiPref } from "./ui-prefs.ts";
import { readInitialThreadListSnapshot } from "./thread-list-snapshot.ts";
import { registerProviderCommandIpc } from "./provider-command-ipc.ts";
import { browserRuntimeHost } from "./browser-runtime-host.ts";
import { registerBrowserRuntimeIpc } from "./browser-runtime-ipc.ts";
import { runProviderReview } from "./review-runner.ts";
import { applyGitHunk } from "./git-hunk-actions.ts";
import {
  commitGitChanges,
  discardGitFile,
  generateGitCommitMessage,
  getGitPushTarget,
  pushGitTarget,
  stageGitFile,
  unstageGitFile,
  type GitActionResult,
} from "./git-handoff-actions.ts";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  utilityProcess,
  type MenuItemConstructorOptions,
  type UtilityProcess,
} from "electron";

import { basename, dirname, join } from "node:path";

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";

import { existsSync } from "node:fs";

import { execFile } from "node:child_process";

import { fileURLToPath, pathToFileURL } from "node:url";

import {
  computeWorktreePath,
  worktreeBranchName,
  worktreeAddArgs,
  worktreeRemoveArgs,
  branchDeleteArgs,
  branchMergedArgs,
  worktreeRepoRootForCwd,
} from "../../../../shared/worktree/path.ts";

import {
  createFileInWorkspace,
  createFolderInWorkspace,
  moveInWorkspace,
  trashInWorkspace,
  type WorkspaceFsResult,
} from "./workspace-fs.ts";

import {
  CONTRACT_VERSION,
  createContractErrorEvent,
  createContractErrorPayload,
  type BackendCommandEnvelope,
  type BackendEventEnvelope,
  type BackendHandshake,
  validateBackendCommandEnvelope,
  validateBackendEventEnvelope,
  validateBackendHandshake,
} from "../../../../shared/contracts/index.ts";

registerBrowserRuntimeIpc(browserRuntimeHost);

ipcMain.handle("tide:open-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle("tide:list-projects", async () => readProjectRegistry());

function sameProjectCwd(left: string, right: string): boolean {
  const normalizeCwd = (value: string): string => {
    const normalized = value.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
    return process.platform === "darwin" || process.platform === "win32"
      ? normalized.toLowerCase()
      : normalized;
  };
  return normalizeCwd(left) === normalizeCwd(right);
}

function removeProjectRegistryCwd(
  entries: { projectId: string; name: string; cwd: string }[],
  cwd: string,
): { projectId: string; name: string; cwd: string }[] {
  return entries.filter((entry) => !sameProjectCwd(entry.cwd, cwd));
}

ipcMain.handle("tide:register-project", async (_event, cwd: unknown) => {
  const current = await readProjectRegistry();
  if (typeof cwd !== "string" || cwd.length === 0) {
    return current;
  }
  // Dedupe by cwd; projectId/name derive from the folder basename.
  if (!current.some((entry) => sameProjectCwd(entry.cwd, cwd))) {
    const name = basename(cwd) || cwd;
    current.push({ projectId: name, name, cwd });
    await writeProjectRegistry(current);
  }
  return current;
});

// Remove a project from the registry (unregister only — never touches disk).
ipcMain.handle("tide:unregister-project", async (_event, cwd: unknown) => {
  const current = await readProjectRegistry();
  if (typeof cwd !== "string") {
    return current;
  }
  const next = removeProjectRegistryCwd(current, cwd);
  if (next.length !== current.length) {
    await writeProjectRegistry(next);
  }
  return next;
});

// Rename a project's display name; upserts so renaming a thread-derived project
// (not yet in the registry) persists the new name.
ipcMain.handle("tide:rename-project", async (_event, cwd: unknown, name: unknown) => {
  const current = await readProjectRegistry();
  if (typeof cwd !== "string" || typeof name !== "string" || name.trim().length === 0) {
    return current;
  }
  const trimmed = name.trim();
  const next = current.some((entry) => entry.cwd === cwd)
    ? current.map((entry) => (entry.cwd === cwd ? { ...entry, name: trimmed } : entry))
    : [...current, { projectId: basename(cwd) || cwd, name: trimmed, cwd }];
  await writeProjectRegistry(next);
  return next;
});

// Create a git worktree for a project and register it as a Project at the same
// level as others. One user-supplied name drives the branch + directory; the
// worktree lives in a `<repo>.worktree/<branch>` sibling (Tide v1 rule).
// See docs_v2/specs/worktree-creation.md.
ipcMain.handle("tide:create-worktree", async (_event, cwd: unknown, name: unknown, options: unknown) => {
  const current = await readProjectRegistry();
  if (typeof cwd !== "string" || cwd.length === 0) {
    return { entries: current, createdCwd: null };
  }
  const opts = (options ?? {}) as {
    baseDirPattern?: unknown;
    copyFiles?: unknown;
    baseBranch?: unknown;
  };
  const baseDirPattern = typeof opts.baseDirPattern === "string" && opts.baseDirPattern.length > 0
    ? opts.baseDirPattern
    : undefined;
  const copyFiles = Array.isArray(opts.copyFiles)
    ? opts.copyFiles.filter((entry): entry is string => typeof entry === "string")
    : [];
  const baseBranch = typeof opts.baseBranch === "string" ? opts.baseBranch : undefined;
  const rawName = typeof name === "string" ? name.trim() : "";
  const branch = worktreeBranchName(
    rawName.length > 0 ? rawName : `${basename(cwd) || "tide"}-wt`,
  );
  const worktreePath = computeWorktreePath(cwd, branch, { baseDirPattern });
  const created = await new Promise<boolean>((resolve) => {
    execFile(
      "git",
      worktreeAddArgs({ repoCwd: cwd, branch, worktreePath, baseBranch }),
      { maxBuffer: 4 * 1024 * 1024 },
      (error) => resolve(!error),
    );
  });
  if (!created) {
    return { entries: current, createdCwd: null };
  }
  // Copy configured files (repo-relative) from the source repo into the new
  // worktree (e.g. .env). Best-effort: skip missing sources, never fail the create.
  for (const rel of copyFiles) {
    const src = join(cwd, rel);
    const dst = join(worktreePath, rel);
    try {
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
    } catch {
      // Source missing or unreadable — skip.
    }
  }
  const entries = [...current, { projectId: worktreePath, name: branch, cwd: worktreePath }];
  await writeProjectRegistry(entries);
  return { entries, createdCwd: worktreePath };
});

// Remove a git worktree directory and unregister it as a Project. The branch is
// left intact (deleting branches is a separate, more destructive action). The
// repo root is derived from the `<repo>.worktree/<branch>` path rule.
ipcMain.handle("tide:remove-worktree", async (_event, cwd: unknown) => {
  const current = await readProjectRegistry();
  if (typeof cwd !== "string" || cwd.length === 0) {
    return { entries: current };
  }
  const repoRoot = worktreeRepoRootForCwd(cwd);
  let removed = false;
  if (repoRoot !== null) {
    removed = (await execGitArgs(worktreeRemoveArgs(repoRoot, cwd))).ok;
  } else {
    removed = true;
  }
  if (!removed && !existsSync(cwd)) {
    removed = true;
  }
  if (!removed) {
    return { entries: current };
  }
  const entries = removeProjectRegistryCwd(current, cwd);
  await writeProjectRegistry(entries);
  return { entries };
});

// Reveal a folder in Finder (read-only, opens the OS file browser).
ipcMain.handle("tide:reveal-in-finder", async (_event, cwd: unknown) => {
  if (typeof cwd === "string" && cwd.length > 0) {
    await shell.openPath(cwd);
  }
});

// Open a web URL in the user's default system browser (the "open external"
// affordance on the in-app Browser Pane). Restricted to http(s) so a renderer
// can't hand arbitrary schemes (file:, javascript:, …) to the OS.
ipcMain.handle("tide:open-external", async (_event, url: unknown) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
  }
});

// Global zoom (Cmd +/-/0). The +/- accelerators live on the application menu (so they
// fire over a focused webview); these two handle the renderer-side affordances: the
// zoom indicator's click resets to 100%, and a freshly (re)loaded renderer reads the
// current factor back since host webContents zoom persists across a reload but React
// state doesn't. `event.sender` is the host renderer that sent the message.
ipcMain.on("tide:reset-zoom", (event) => applyHostZoom(event.sender, 1));
ipcMain.handle("tide:get-zoom", (event) => event.sender.getZoomFactor());

// Structural FileTree mutations (new file/folder, rename/move, trash). Run here in
// Main — taking an absolute workspace `root` + relative path(s) from the renderer,
// like the git/worktree/reveal handlers — so trash can use shell.trashItem (the
// backend utility process has no Electron shell). Path safety lives in workspace-fs.
// Spec: docs_v2/specs/workbench-filetree-file-operations.md.
const invalidFsArgs: WorkspaceFsResult = {
  ok: false,
  code: "io_error",
  message: "Invalid file operation arguments.",
};

ipcMain.handle(
  "tide:fs-create-file",
  async (_event, root: unknown, relativePath: unknown, content: unknown): Promise<WorkspaceFsResult> =>
    typeof root === "string" && typeof relativePath === "string"
      ? createFileInWorkspace(root, relativePath, typeof content === "string" ? content : "")
      : invalidFsArgs,
);

ipcMain.handle(
  "tide:fs-create-folder",
  async (_event, root: unknown, relativePath: unknown): Promise<WorkspaceFsResult> =>
    typeof root === "string" && typeof relativePath === "string"
      ? createFolderInWorkspace(root, relativePath)
      : invalidFsArgs,
);

ipcMain.handle(
  "tide:fs-move",
  async (_event, root: unknown, fromRel: unknown, toRel: unknown): Promise<WorkspaceFsResult> =>
    typeof root === "string" && typeof fromRel === "string" && typeof toRel === "string"
      ? moveInWorkspace(root, fromRel, toRel)
      : invalidFsArgs,
);

ipcMain.handle(
  "tide:fs-trash",
  async (_event, root: unknown, relativePath: unknown): Promise<WorkspaceFsResult> =>
    typeof root === "string" && typeof relativePath === "string"
      ? trashInWorkspace(root, relativePath, (abs) => shell.trashItem(abs))
      : invalidFsArgs,
);

ipcMain.handle("tide:git-context", async (_event, cwd: unknown): Promise<GitContext> => {
  const empty: GitContext = { isGitRepo: false, currentBranch: null, branches: [], worktrees: [] };
  if (typeof cwd !== "string" || cwd.length === 0) {
    return empty;
  }
  const inside = (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (inside !== "true") {
    return empty;
  }
  const currentBranch = (await runGit(cwd, ["branch", "--show-current"])).trim() || null;
  // Local then remote branches (skip the "origin/HEAD -> ..." alias line).
  const refLines = (await runGit(cwd, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith("/HEAD"));
  const branches = refLines.map((ref) => {
    const isRemote = ref.startsWith("refs/remotes/");
    const name = ref.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, "");
    return { name, kind: isRemote ? ("remote" as const) : ("local" as const), current: name === currentBranch };
  });
  // Worktrees via porcelain output.
  const worktrees: GitContext["worktrees"] = [];
  let pending: { path: string; branch: string | null } | null = null;
  for (const line of (await runGit(cwd, ["worktree", "list", "--porcelain"])).split("\n")) {
    if (line.startsWith("worktree ")) {
      if (pending) worktrees.push({ ...pending, current: pending.path === cwd });
      pending = { path: line.slice("worktree ".length).trim(), branch: null };
    } else if (line.startsWith("branch ") && pending) {
      pending.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    }
  }
  if (pending) worktrees.push({ ...pending, current: pending.path === cwd });
  return { isGitRepo: true, currentBranch, branches, worktrees };
});

// Read-only uncommitted changes (working tree vs HEAD) for the Changes view.
ipcMain.handle("tide:git-changes", async (_event, cwd: unknown): Promise<GitChanges> => {
  const empty: GitChanges = { isGitRepo: false, files: [] };
  if (typeof cwd !== "string" || cwd.length === 0) {
    return empty;
  }
  const inside = (await runGit(cwd, ["rev-parse", "--is-inside-work-tree"])).trim();
  if (inside !== "true") {
    return empty;
  }
  // Run everything from the repo top level so paths (and the numstat keys below) are
  // consistently repo-root-relative regardless of the thread's cwd.
  const root = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim() || cwd;
  // Porcelain v1, renames split into delete+add so the path column is a single path.
  const out = await runGit(root, ["-c", "core.quotepath=false", "status", "--porcelain=v1", "--no-renames"]);
  const files: GitChangeFile[] = [];
  for (const line of out.split("\n")) {
    if (line.length < 4) {
      continue;
    }
    const x = line[0];
    const y = line[1];
    let path = line.slice(3);
    if (path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1);
    }
    const status: GitChangeFile["status"] =
      x === "?"
        ? "untracked"
        : x === "D" || y === "D"
          ? "deleted"
          : x === "A" || y === "A"
            ? "added"
            : "modified";
    files.push({ path, status });
  }
  // Per-file added/removed line counts (vs HEAD). Tracked changes come from one numstat;
  // untracked/new files aren't in it, so count their lines via --no-index. "-" = binary.
  const numstat = await runGit(root, ["-c", "core.quotepath=false", "diff", "--numstat", "--no-renames", "HEAD"]);
  const tracked = new Map<string, { additions?: number; deletions?: number }>();
  for (const line of numstat.split("\n")) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (match !== null) {
      tracked.set(match[3], {
        additions: match[1] === "-" ? undefined : Number(match[1]),
        deletions: match[2] === "-" ? undefined : Number(match[2]),
      });
    }
  }
  for (const file of files) {
    if (file.status === "untracked") {
      // A single file failing to diff (concurrent delete, permissions) must not fail the
      // whole status read — count what we can, skip the rest.
      try {
        const ns = await execGitArgs([
          "-c",
          "core.quotepath=false",
          "-C",
          root,
          "diff",
          "--numstat",
          "--no-index",
          "--",
          "/dev/null",
          file.path,
        ]);
        const match = /^(\d+|-)\t(\d+|-)/.exec(ns.stdout.split("\n").find((l) => l.includes("\t")) ?? "");
        if (match !== null && match[1] !== "-") {
          file.additions = Number(match[1]);
          file.deletions = 0;
        }
      } catch {
        // Leave additions/deletions undefined for this file.
      }
    } else {
      const stat = tracked.get(file.path);
      if (stat !== undefined) {
        file.additions = stat.additions;
        file.deletions = stat.deletions;
      }
    }
  }
  return { isGitRepo: true, files };
});

// The unified diff of a single changed file (working tree vs HEAD). Untracked/new
// files have no HEAD entry, so fall back to --no-index (whole file as added).
ipcMain.handle("tide:git-file-diff", async (_event, cwd: unknown, relPath: unknown): Promise<string> => {
  if (typeof cwd !== "string" || typeof relPath !== "string" || cwd.length === 0 || relPath.length === 0) {
    return "";
  }
  // `git status --porcelain` paths are relative to the repo top level, but a diff
  // pathspec is resolved relative to the run dir — so run diffs from the top level, or
  // a thread whose cwd is a SUBDIRECTORY of the repo gets an empty (wrong-path) diff.
  const root = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim() || cwd;
  const tracked = await runGit(root, ["-c", "core.quotepath=false", "diff", "--no-color", "HEAD", "--", relPath]);
  if (tracked.trim().length > 0) {
    return tracked;
  }
  // --no-index exits 1 when files differ (not an error), so read stdout via execGitArgs.
  const untracked = await execGitArgs([
    "-c",
    "core.quotepath=false",
    "-C",
    root,
    "diff",
    "--no-color",
    "--no-index",
    "--",
    "/dev/null",
    relPath,
  ]);
  return untracked.stdout;
});

ipcMain.handle("tide:git-stage-file", async (_event, cwd: unknown, relPath: unknown): Promise<GitActionResult> =>
  stageGitFile({ cwd, relPath }),
);

ipcMain.handle("tide:git-unstage-file", async (_event, cwd: unknown, relPath: unknown): Promise<GitActionResult> =>
  unstageGitFile({ cwd, relPath }),
);

ipcMain.handle("tide:git-discard-file", async (_event, cwd: unknown, relPath: unknown): Promise<GitActionResult> =>
  discardGitFile({ cwd, relPath }, (path) => shell.trashItem(path)),
);

ipcMain.handle("tide:git-apply-hunk", async (_event, cwd: unknown, relPath: unknown, patch: unknown, action: unknown) =>
  applyGitHunk({ cwd, relPath, patch, action }),
);

ipcMain.handle("tide:git-generate-commit-message", async (_event, cwd: unknown) =>
  generateGitCommitMessage(cwd),
);

ipcMain.handle("tide:git-commit", async (_event, cwd: unknown, message: unknown): Promise<GitActionResult> =>
  commitGitChanges({ cwd, message }),
);

ipcMain.handle("tide:git-push-target", async (_event, cwd: unknown) => getGitPushTarget(cwd));

ipcMain.handle(
  "tide:git-push",
  async (_event, cwd: unknown, remote: unknown, branch: unknown): Promise<GitActionResult> =>
    pushGitTarget({ cwd, remote, branch }),
);

ipcMain.handle("tide:run-review", async (_event, cwd: unknown, provider: unknown, target: unknown) =>
  runProviderReview({ cwd, provider, target }),
);

// Read-only facts for the worktree delete dialog (branch + whether it's merged).
// See docs_v2/specs/worktree-branch-deletion.md.
ipcMain.handle("tide:worktree-info", async (_event, cwd: unknown) => {
  const info = { repoRoot: null as string | null, branch: null as string | null, branchMerged: false, isWorktree: false };
  if (typeof cwd !== "string" || cwd.length === 0) {
    return info;
  }
  const repoRoot = await repoRootForWorktree(cwd);
  info.repoRoot = repoRoot;
  info.isWorktree = repoRoot !== null && repoRoot !== cwd.replace(/\/+$/, "");
  const branch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  info.branch = branch.length > 0 && branch !== "HEAD" ? branch : null;
  if (repoRoot !== null && info.branch !== null) {
    info.branchMerged = (await execGitArgs(branchMergedArgs(repoRoot, info.branch))).ok;
  }
  return info;
});

// Remove a worktree directory and, when requested, delete its branch. The branch
// is deleted only after the worktree is gone (it can't be deleted while checked
// out), and force (`-D`) is used only when the caller acknowledged unmerged loss.
ipcMain.handle("tide:delete-worktree", async (_event, cwd: unknown, options: unknown) => {
  const current = await readProjectRegistry();
  const fail = { entries: current, worktreeRemoved: false, branch: null as string | null, branchDeleted: false };
  if (typeof cwd !== "string" || cwd.length === 0) {
    return fail;
  }
  const opts = (options ?? {}) as { deleteBranch?: unknown; force?: unknown };
  const deleteBranch = opts.deleteBranch === true;
  const force = opts.force === true;
  const repoRoot = await repoRootForWorktree(cwd);
  if (repoRoot === null) {
    return fail;
  }
  const rawBranch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const branch = rawBranch.length > 0 && rawBranch !== "HEAD" ? rawBranch : null;
  const removed = await execGitArgs(worktreeRemoveArgs(repoRoot, cwd));
  let branchDeleted = false;
  if (removed.ok && deleteBranch && branch !== null) {
    branchDeleted = (await execGitArgs(branchDeleteArgs(repoRoot, branch, force))).ok;
  }
  const entries = removed.ok ? removeProjectRegistryCwd(current, cwd) : current;
  if (removed.ok) {
    await writeProjectRegistry(entries);
  }
  return { entries, worktreeRemoved: removed.ok, branch, branchDeleted };
});

// Read-only facts for the standalone branch-delete dialog (does the branch exist,
// is it merged into the cwd's HEAD). See docs_v2/specs/branch-deletion-from-picker.md.
ipcMain.handle("tide:branch-info", async (_event, cwd: unknown, branch: unknown) => {
  const info = { exists: false, merged: false };
  if (typeof cwd !== "string" || cwd.length === 0 || typeof branch !== "string" || branch.length === 0) {
    return info;
  }
  info.exists = (await runGit(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).trim().length > 0;
  if (info.exists) {
    info.merged = (await execGitArgs(branchMergedArgs(cwd, branch))).ok;
  }
  return info;
});

// Switch the selected local folder to a local branch before starting a Local
// Thread. Never force-switch: dirty-file conflicts or "checked out elsewhere"
// failures keep the Composer draft intact in the renderer.
ipcMain.handle("tide:checkout-branch", async (_event, cwd: unknown, branch: unknown) =>
  checkoutBranchForStart(cwd, branch),
);

// Delete a local branch (`git branch -d`, or `-D` when the caller acknowledged
// unmerged loss). The renderer only ever offers this for safe branches — local,
// not checked out in the repo or any worktree — so `-d` succeeds without force in
// the common case. See docs_v2/specs/branch-deletion-from-picker.md.
ipcMain.handle("tide:delete-branch", async (_event, cwd: unknown, branch: unknown, options: unknown) => {
  if (typeof cwd !== "string" || cwd.length === 0 || typeof branch !== "string" || branch.length === 0) {
    return { deleted: false, branch: null as string | null };
  }
  const force = (((options ?? {}) as { force?: unknown }).force) === true;
  const deleted = (await execGitArgs(branchDeleteArgs(cwd, branch, force))).ok;
  return { deleted, branch };
});

registerProviderCommandIpc();

ipcMain.handle("tide:backend-command", async (_event, command: BackendCommandEnvelope) => {
  const validatedCommand = validateBackendCommandEnvelope(command);
  if (!validatedCommand.ok) {
    return [
      createContractErrorEvent({
        eventId: nextEventId(),
        requestId: command?.requestId,
        emittedAt: new Date().toISOString(),
        error: validatedCommand.error,
      }),
    ];
  }

  try {
    await ensureBackendProcess();
  } catch (error) {
    return [
      createContractErrorEvent({
        eventId: nextEventId(),
        requestId: validatedCommand.value.requestId,
        emittedAt: new Date().toISOString(),
        error: createContractErrorPayload({
          code: "agent_runtime_unavailable",
          message: error instanceof Error ? error.message : "Backend process failed to start.",
          severity: "error",
          retryable: true,
        }),
      }),
    ];
  }

  return postBackendCommand(validatedCommand.value);
});

// Native OS notifications (focus-aware): the renderer requests one per agent-finished /
// needs-input / update event, main delivers it through the window-focus gate and routes
// a click to thread activation. See specs/focus-aware-notifications.md.
registerNotificationBridge(() => BrowserWindow.getAllWindows()[0]);

// App self-update (packaged builds only): check the GitHub release feed in the
// background and push status to the renderer's "Update & Restart" pill; the click
// applies it. Inert in dev / unpackaged / test. See specs/version-management.md.
registerAutoUpdate(() => BrowserWindow.getAllWindows()[0]);

// The renderer reads its UI prefs synchronously at preload time over this channel. NOT
// localStorage (the renderer's first sync localStorage access stalls ~3.8s at boot while
// the bundle loads) and NOT process argv (keeps a structured object off the launch command
// line). Main reads the small JSON file (Node fs, instant) and returns it. See ui-prefs.ts.
ipcMain.on("tide:get-ui-prefs", (event) => {
  event.returnValue = readUiPrefs();
});

// First-paint thread list snapshot, read synchronously from the lightweight thread
// index. If unavailable, the renderer falls back to the skeleton until thread.listed.
ipcMain.on("tide:get-initial-thread-list", (event) => {
  event.returnValue = readInitialThreadListSnapshot();
});

// Persist a renderer UI pref to the Main-owned prefs file (read back at the next boot). See ui-prefs.ts.
ipcMain.handle("tide:save-ui-pref", (_event, key: unknown, value: unknown) => {
  if (typeof key === "string" && typeof value === "string") {
    saveUiPref(key, value);
  }
});

// Keep a stray error from hard-aborting the main process (SIGTRAP/brk). Log it
// instead so the app survives and the cause is diagnosable.
process.on("uncaughtException", (error) => {
  console.error("[tide-main] uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("[tide-main] unhandledRejection:", reason);
});

app.on("render-process-gone", (_event, _webContents, details) => {
  console.error("[tide-main] render-process-gone:", details.reason, details.exitCode);
});

app.on("child-process-gone", (_event, details) => {
  console.error("[tide-main] child-process-gone:", details.type, details.reason, details.exitCode);
});

// Tide doesn't use Electron safeStorage; the only keychain access is Chromium's
// automatic cookie/OSCrypt encryption, which pops a "<app> wants to use
// confidential information…" macOS Keychain prompt on every (re-signed) launch.
// `use-mock-keychain` makes Chromium use an in-memory key instead of the macOS
// Keychain, so it never prompts. (`password-store=basic` is a Linux-only flag and
// has no effect on macOS — keep it for Linux parity.)
app.commandLine.appendSwitch("use-mock-keychain");

app.commandLine.appendSwitch("password-store", "basic");

// Single-instance lock: a second launch (double-clicked dock icon, second
// `electron .`) must NOT start a second backend against the same data root +
// MCP socket — two backends tangle the shared provider-signal spool and socket
// and corrupt turns. The second instance focuses the existing window and quits.
// (The dev `npm start` kills the old instance first, so it always gets the new
// build; this lock is the safety net for the packaged app.)
//
// Verification harnesses that intentionally run several isolated instances must
// opt in explicitly. An inherited TIDE_APP_DATA_ROOT from an agent shell must not
// be enough to start a second app/backend against the same owner state.
if (process.env.TIDE_ALLOW_MULTI_INSTANCE !== "1") {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  // Breadcrumb for the post-update relaunch: a Squirrel-relaunched instance that loses
  // this race logs `lock = false` right before quitting. See auto-update.ts.
  logUpdateEvent(`startup: single-instance lock = ${gotSingleInstanceLock}`);
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      const [existing] = BrowserWindow.getAllWindows();
      if (existing !== undefined) {
        if (existing.isMinimized()) {
          existing.restore();
        }
        existing.focus();
      }
    });
  }
}

void app.whenReady().then(() => {
  if (maybeOfferMoveToApplications()) {
    return; // relaunching from /Applications
  }
  installApplicationMenu();
  // Dev (`electron .`) shows the default Electron dock icon; point it at the
  // brand icon. The packaged app uses the bundle icon (electron-builder) instead.
  try {
    const brandIcon = join(app.getAppPath(), "build", "icon.png");
    if (process.platform === "darwin" && existsSync(brandIcon)) {
      app.dock?.setIcon(brandIcon);
    }
  } catch {
    // Icon optional — never block startup.
  }
  // Warm the backend in parallel with the window/renderer load. It used to be forked
  // lazily on the renderer's FIRST command (thread.list), so its utilityProcess
  // cold-start + handshake ran serially AFTER the renderer mounted — the Left Rail
  // skeleton sat there for that whole spawn. Forking here overlaps it with the bundle
  // load so the backend is (near) ready when thread.list arrives. ensureBackendProcess
  // is idempotent, so the lazy call stays a safety net. See
  // docs_v2/specs/thread-list-metadata-first-restore.md.
  void ensureBackendProcess().catch(() => undefined);
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  browserRuntimeHost.closeAll("app_quit");
  backendProcess?.kill();
});
