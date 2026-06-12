import { execGitArgs, readProjectRegistry, repoRootForWorktree, runGit, writeProjectRegistry } from "./project-registry.ts";
import type { GitContext } from "./project-registry.ts";
import { backendProcess, ensureBackendProcess, nextEventId, postBackendCommand } from "./backend-bridge.ts";
import { maybeOfferMoveToApplications } from "./move-to-applications.ts";
import { installApplicationMenu } from "./app-menu.ts";
import { appRendererUrl, createMainWindow } from "./main-window.ts";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell, utilityProcess, type MenuItemConstructorOptions, type UtilityProcess } from "electron";

import { basename, dirname, join } from "node:path";

import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";

import { readdirSync, readFileSync, existsSync } from "node:fs";

import { execFile } from "node:child_process";

import {
  discoverProviderCommands,
  type CommandFs,
} from "./provider-command-discovery.ts";

import { fileURLToPath, pathToFileURL } from "node:url";

import {
  computeWorktreePath,
  sanitizeWorktreeBranch,
  worktreeAddArgs,
  worktreeRemoveArgs,
  branchDeleteArgs,
  branchMergedArgs,
  worktreeRepoRootForCwd,
} from "../../../../shared/worktree/path.ts";

import { classifyTopLevelNavigation } from "./window-navigation-policy.ts";

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

ipcMain.handle("tide:open-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle("tide:list-projects", async () => readProjectRegistry());

ipcMain.handle("tide:register-project", async (_event, cwd: unknown) => {
  const current = await readProjectRegistry();
  if (typeof cwd !== "string" || cwd.length === 0) {
    return current;
  }
  // Dedupe by cwd; projectId/name derive from the folder basename.
  if (!current.some((entry) => entry.cwd === cwd)) {
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
  const next = current.filter((entry) => entry.cwd !== cwd);
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
  const branch = sanitizeWorktreeBranch(
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
  if (repoRoot !== null) {
    await new Promise<void>((resolve) => {
      execFile(
        "git",
        ["-C", repoRoot, "worktree", "remove", "--force", cwd],
        { maxBuffer: 4 * 1024 * 1024 },
        () => resolve(),
      );
    });
  }
  const entries = current.filter((entry) => entry.cwd !== cwd);
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
  const entries = removed.ok ? current.filter((entry) => entry.cwd !== cwd) : current;
  if (removed.ok) {
    await writeProjectRegistry(entries);
  }
  return { entries, worktreeRemoved: removed.ok, branch, branchDeleted };
});

// Real provider slash-commands/skills for a cwd, read from the providers' files
// (no provider spawn). See docs_v2/specs/provider-command-discovery.md.
const commandDiscoveryFs: CommandFs = {
  listFiles: (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  },
  listDirs: (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  },
  readText: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
};

ipcMain.handle("tide:list-commands", (_event, cwd: unknown, agentId: unknown) => {
  if (typeof cwd !== "string" || cwd.length === 0 || typeof agentId !== "string") {
    return [];
  }
  return discoverProviderCommands({
    cwd,
    homeDir: app.getPath("home"),
    agentId,
    fs: commandDiscoveryFs,
  });
});

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
// Skipped when TIDE_APP_DATA_ROOT is set — that override is ONLY used by the
// headless test/verification harnesses, which intentionally run several isolated
// instances at once (each with its own temp data root); the lock is keyed by
// Electron userData, not the data root, so without this they would collide.
if (process.env.TIDE_APP_DATA_ROOT === undefined) {
  if (!app.requestSingleInstanceLock()) {
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
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("web-contents-created", (_event, contents) => {
  // A page inside a Browser Pane <webview> that opens a popup (target=_blank,
  // window.open) would otherwise spawn a blank top-level BrowserWindow. Deny the
  // popup and navigate the originating webview in place instead, so links stay
  // in the pane and never produce a stray empty window.
  if (contents.getType() === "webview") {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void contents.loadURL(url).catch(() => undefined);
      }
      return { action: "deny" };
    });
    return;
  }

  // The MAIN host renderer (the React app). Its top-level webContents must never
  // navigate off-app: a chat markdown link is a plain <a href>, and a default
  // click would replace the whole app with the external page with no way back
  // (the "window freezes on the linked site" bug). Off-app links open in the
  // system browser; window.open / target=_blank never spawns a window.
  const guard = (event: { preventDefault: () => void }, url: string): void => {
    const verdict = classifyTopLevelNavigation(url, appRendererUrl());
    if (verdict === "allow") {
      return;
    }
    event.preventDefault();
    if (verdict === "open_external") {
      void shell.openExternal(url).catch(() => undefined);
    }
  };
  contents.on("will-navigate", guard);
  contents.on("will-redirect", guard);
  contents.setWindowOpenHandler(({ url }) => {
    if (classifyTopLevelNavigation(url, appRendererUrl()) === "open_external") {
      void shell.openExternal(url).catch(() => undefined);
    }
    return { action: "deny" };
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  backendProcess?.kill();
});
