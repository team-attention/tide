import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess, type UtilityProcess } from "electron";
import { basename, dirname, join } from "node:path";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import {
  discoverProviderCommands,
  type CommandFs,
} from "./provider-command-discovery.ts";
import { fileURLToPath } from "node:url";
import { computeWorktreePath, sanitizeWorktreeBranch } from "../../shared/worktree-path.ts";
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
} from "../../shared/contracts/index.ts";

export interface TideDesktopMainEntrypoint {
  productName: string;
  backendEntrypoint: string;
  rendererRoot: string;
}

export const tideDesktopMainEntrypoint: TideDesktopMainEntrypoint = {
  productName: "Tide",
  backendEntrypoint: "src/backend/infrastructure/node/backend-entrypoint.ts",
  rendererRoot: "src/desktop/renderer",
};

const mainDir = dirname(fileURLToPath(import.meta.url));
const backendEntrypointFile = "backend-entrypoint.js";
const backendHandshakeTimeoutMs = 8000;
const backendCommandTimeoutMs = parsePositiveIntegerEnv("TIDE_BACKEND_COMMAND_TIMEOUT_MS", 120000);

type BackendProcessMessage =
  | { kind: "backend.handshake"; payload: unknown }
  | { kind: "backend.event"; payload: unknown };

interface PendingBackendRequest {
  events: BackendEventEnvelope[];
  resolve: (events: BackendEventEnvelope[]) => void;
  timeout: ReturnType<typeof setTimeout>;
}

let backendProcess: UtilityProcess | null = null;
let backendHandshake: Promise<BackendHandshake> | null = null;
let resolveBackendHandshake: ((handshake: BackendHandshake) => void) | null = null;
let rejectBackendHandshake: ((error: Error) => void) | null = null;
const pendingBackendRequests = new Map<string, PendingBackendRequest>();
const deferredBackendBroadcastEvents: BackendEventEnvelope[] = [];
let deferredBackendBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

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

async function readProjectRegistry(): Promise<ProjectRegistryEntry[]> {
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

async function writeProjectRegistry(entries: ProjectRegistryEntry[]): Promise<void> {
  await writeFile(projectRegistryPath(), `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

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
  const opts = (options ?? {}) as { baseDirPattern?: unknown; copyFiles?: unknown };
  const baseDirPattern = typeof opts.baseDirPattern === "string" && opts.baseDirPattern.length > 0
    ? opts.baseDirPattern
    : undefined;
  const copyFiles = Array.isArray(opts.copyFiles)
    ? opts.copyFiles.filter((entry): entry is string => typeof entry === "string")
    : [];
  const rawName = typeof name === "string" ? name.trim() : "";
  const branch = sanitizeWorktreeBranch(
    rawName.length > 0 ? rawName : `${basename(cwd) || "tide"}-wt`,
  );
  const worktreePath = computeWorktreePath(cwd, branch, { baseDirPattern });
  const created = await new Promise<boolean>((resolve) => {
    execFile(
      "git",
      ["-C", cwd, "worktree", "add", "-b", branch, worktreePath],
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

// Reveal a folder in Finder (read-only, opens the OS file browser).
ipcMain.handle("tide:reveal-in-finder", async (_event, cwd: unknown) => {
  if (typeof cwd === "string" && cwd.length > 0) {
    await shell.openPath(cwd);
  }
});

// --- Git context for the Worktree/Branch menus (read-only) ---
interface GitContext {
  isGitRepo: boolean;
  currentBranch: string | null;
  branches: { name: string; kind: "local" | "remote"; current: boolean }[];
  worktrees: { path: string; branch: string | null; current: boolean }[];
}

function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", ["-C", cwd, ...args], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}

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

async function ensureBackendProcess(): Promise<BackendHandshake> {
  if (backendProcess !== null && backendHandshake !== null) {
    return backendHandshake;
  }

  backendHandshake = new Promise<BackendHandshake>((resolve, reject) => {
    resolveBackendHandshake = resolve;
    rejectBackendHandshake = reject;
  });
  const handshakeTimeout = setTimeout(() => {
    rejectBackendHandshake?.(new Error("Backend handshake timed out."));
    resetBackendProcess();
  }, backendHandshakeTimeoutMs);

  backendHandshake = backendHandshake.finally(() => {
    clearTimeout(handshakeTimeout);
  });

  backendProcess = utilityProcess.fork(resolveBackendEntrypointPath(), [], {
    env: {
      ...process.env,
      TIDE_APP_DATA_ROOT: resolveAppDataRoot(),
    },
    stdio: "pipe",
  });
  backendProcess.stdout?.on("data", (chunk: Buffer) => {
    if (process.env.TIDE_ELECTRON_SMOKE_COMMAND !== undefined) {
      console.log(`[tide-backend] ${chunk.toString("utf8").trimEnd()}`);
    }
  });
  backendProcess.stderr?.on("data", (chunk: Buffer) => {
    console.error(`[tide-backend] ${chunk.toString("utf8").trimEnd()}`);
  });
  backendProcess.on("message", handleBackendProcessMessage);
  backendProcess.on("exit", (exitCode) => {
    const message = `Backend process exited with code ${exitCode} before completing the command.`;
    rejectBackendHandshake?.(new Error(message));
    failPendingRequests(message);
    resetBackendProcess();
  });

  return backendHandshake;
}

function postBackendCommand(command: BackendCommandEnvelope): Promise<BackendEventEnvelope[]> {
  if (backendProcess === null) {
    return Promise.resolve([
      createContractErrorEvent({
        eventId: nextEventId(),
        requestId: command.requestId,
        emittedAt: new Date().toISOString(),
        error: createContractErrorPayload({
          code: "agent_runtime_unavailable",
          message: "Backend process is not running.",
          severity: "error",
          retryable: true,
        }),
      }),
    ]);
  }

  const process = backendProcess;
  return new Promise<BackendEventEnvelope[]>((resolve) => {
    const timeout = setTimeout(() => {
      pendingBackendRequests.delete(command.requestId);
      resolve([
        createContractErrorEvent({
          eventId: nextEventId(),
          requestId: command.requestId,
          emittedAt: new Date().toISOString(),
          error: createContractErrorPayload({
            code: "agent_runtime_unavailable",
            message: "Backend command timed out before completion.",
            severity: "error",
            retryable: true,
          }),
        }),
      ]);
      scheduleDeferredBackendBroadcastFlush();
    }, backendCommandTimeoutMs);

    pendingBackendRequests.set(command.requestId, {
      events: [],
      resolve,
      timeout,
    });
    process.postMessage(command);
  });
}

function handleBackendProcessMessage(message: unknown): void {
  const payload = unwrapPortMessage(message);
  if (!isBackendProcessMessage(payload)) {
    return;
  }

  if (payload.kind === "backend.handshake") {
    const validated = validateBackendHandshake(payload.payload);
    if (!validated.ok) {
      rejectBackendHandshake?.(new Error(validated.error.message));
      resetBackendProcess();
      return;
    }

    resolveBackendHandshake?.(validated.value);
    return;
  }

  const validatedEvent = validateBackendEventEnvelope(payload.payload);
  if (!validatedEvent.ok) {
    return;
  }
  handleBackendEvent(validatedEvent.value);
}

function handleBackendEvent(event: BackendEventEnvelope): void {
  if (event.requestId === undefined) {
    if (pendingBackendRequests.size > 0) {
      deferBackendEventBroadcast(event);
      return;
    }
    broadcastBackendEvent(event);
    return;
  }

  const pending = pendingBackendRequests.get(event.requestId);
  if (pending === undefined) {
    broadcastBackendEvent(event);
    return;
  }

  pending.events.push(event);
  if (event.kind === "command.completed" || event.kind === "contract.error") {
    clearTimeout(pending.timeout);
    pendingBackendRequests.delete(event.requestId);
    pending.resolve(pending.events);
    scheduleDeferredBackendBroadcastFlush();
  }
}

function broadcastBackendEvent(event: BackendEventEnvelope): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("tide:backend-event", event);
  }
}

function deferBackendEventBroadcast(event: BackendEventEnvelope): void {
  deferredBackendBroadcastEvents.push(event);
}

function scheduleDeferredBackendBroadcastFlush(): void {
  if (deferredBackendBroadcastEvents.length === 0 || deferredBackendBroadcastTimer !== null) {
    return;
  }

  deferredBackendBroadcastTimer = setTimeout(() => {
    deferredBackendBroadcastTimer = null;
    const events = deferredBackendBroadcastEvents.splice(0);
    for (const event of events) {
      broadcastBackendEvent(event);
    }
  }, 0);
}

function failPendingRequests(message: string): void {
  for (const [requestId, pending] of pendingBackendRequests) {
    clearTimeout(pending.timeout);
    pending.resolve([
      ...pending.events,
      createContractErrorEvent({
        eventId: nextEventId(),
        requestId,
        emittedAt: new Date().toISOString(),
        error: createContractErrorPayload({
          code: "agent_runtime_unavailable",
          message,
          severity: "error",
          retryable: true,
        }),
      }),
    ]);
  }
  pendingBackendRequests.clear();
  scheduleDeferredBackendBroadcastFlush();
}

function resetBackendProcess(): void {
  backendProcess?.removeAllListeners();
  backendProcess = null;
  backendHandshake = null;
  resolveBackendHandshake = null;
  rejectBackendHandshake = null;
}

function resolveBackendEntrypointPath(): string {
  return join(mainDir, backendEntrypointFile);
}

function isBackendProcessMessage(value: unknown): value is BackendProcessMessage {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }

  const kind = (value as { kind?: unknown }).kind;
  return kind === "backend.handshake" || kind === "backend.event";
}

function unwrapPortMessage(message: unknown): unknown {
  if (
    typeof message === "object" &&
    message !== null &&
    "data" in message
  ) {
    return (message as { data: unknown }).data;
  }
  return message;
}

function nextEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resolveAppDataRoot(): string {
  return process.env.TIDE_APP_DATA_ROOT ?? app.getPath("userData");
}

function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: tideDesktopMainEntrypoint.productName,
    // Frameless: no native title bar so the app's own top row is the chrome.
    // Keep the native traffic lights (functional) and place them inside the
    // Left UI Top Row to match the canonical Figma (one set of controls, not two).
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 19, y: 19 },
    webPreferences: {
      preload: join(mainDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // Tell the renderer when native fullscreen hides the macOS traffic lights, so
  // the Left UI top row can reclaim the space they normally reserve.
  const sendFullscreen = (isFullscreen: boolean) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tide:fullscreen-changed", isFullscreen);
    }
  };
  mainWindow.on("enter-full-screen", () => sendFullscreen(true));
  mainWindow.on("leave-full-screen", () => sendFullscreen(false));

  const rendererLoaded =
    process.env.ELECTRON_RENDERER_URL !== undefined
      ? mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
      : mainWindow.loadFile(join(mainDir, "../renderer/index.html"));

  void rendererLoaded.then(() => runElectronRuntimeSmoke(mainWindow));

  return mainWindow;
}

async function runElectronRuntimeSmoke(mainWindow: BrowserWindow): Promise<void> {
  const commandJson = process.env.TIDE_ELECTRON_SMOKE_COMMAND;
  if (commandJson === undefined) {
    return;
  }

  const timeoutMs = parsePositiveIntegerEnv("TIDE_ELECTRON_SMOKE_TIMEOUT_MS", 75000);
  const pollMs = parsePositiveIntegerEnv("TIDE_ELECTRON_SMOKE_POLL_MS", 1000);
  const token = process.env.TIDE_ELECTRON_SMOKE_TOKEN ?? "";
  const expectPushedAgentOutput =
    process.env.TIDE_ELECTRON_SMOKE_EXPECT_PUSHED_AGENT_OUTPUT === "1";
  const openSetupSurface = process.env.TIDE_ELECTRON_SMOKE_OPEN_SETUP_SURFACE === "1";

  try {
    const result = await mainWindow.webContents.executeJavaScript(
      electronRuntimeSmokeScript({
        commandJson,
        timeoutMs,
        pollMs,
        token,
        expectPushedAgentOutput,
        openSetupSurface,
      }),
      true,
    );
    console.log(`TIDE_ELECTRON_SMOKE_RESULT ${JSON.stringify(result)}`);
    app.exit(0);
  } catch (error) {
    console.error(
      `TIDE_ELECTRON_SMOKE_ERROR ${error instanceof Error ? error.message : String(error)}`,
    );
    app.exit(1);
  }
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function electronRuntimeSmokeScript(input: {
  commandJson: string;
  timeoutMs: number;
  pollMs: number;
  token: string;
  expectPushedAgentOutput: boolean;
  openSetupSurface: boolean;
}): string {
  return `
    (async () => {
      const command = JSON.parse(${JSON.stringify(input.commandJson)});
      const token = ${JSON.stringify(input.token)};
      const expectPushedAgentOutput = ${JSON.stringify(input.expectPushedAgentOutput)};
      const openSetupSurface = ${JSON.stringify(input.openSetupSurface)};
      if (window.tide === undefined) {
        throw new Error("window.tide is unavailable.");
      }

      const pushedEvents = [];
      const unsubscribe = window.tide.onBackendEvent((event) => {
        pushedEvents.push(event);
      });
      const startEvents = await window.tide.sendBackendCommand(command);
      const readiness = startEvents.find((event) => event.kind === "providerReadiness.changed");
      if (readiness !== undefined) {
        let setupSurface = undefined;
        if (openSetupSurface) {
          setupSurface = await openProviderSetupSurface(readiness);
        }
        unsubscribe();
        return {
          ok: false,
          phase: "provider-not-ready",
          threadId: readiness.payload.threadId,
          readiness: readiness.payload.readiness,
          setupSurface,
          startEventKinds: eventKinds(startEvents),
          pushedCount: pushedEvents.length,
          pushedEventKinds: eventKinds(pushedEvents),
        };
      }

      const started = startEvents.find((event) => event.kind === "thread.started");
      if (started === undefined) {
        unsubscribe();
        return {
          ok: false,
          phase: "not-started",
          startEventKinds: eventKinds(startEvents),
          pushedCount: pushedEvents.length,
          pushedEventKinds: eventKinds(pushedEvents),
        };
      }

      const threadId = started.payload.thread.threadId;
      const deadline = Date.now() + ${input.timeoutMs};
      let hydrateEvents = [];
      let agentOutputFound = false;
      let pushedAgentOutputFound = false;
      while (Date.now() <= deadline) {
        hydrateEvents = await window.tide.sendBackendCommand({
          contractVersion: command.contractVersion,
          requestId: command.requestId + "-hydrate-" + Date.now(),
          kind: "thread.hydrate",
          issuedAt: new Date().toISOString(),
          payload: { threadId },
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        pushedAgentOutputFound = agentOutputContainsToken(pushedEvents, token);
        agentOutputFound = agentOutputContainsToken(
          [...startEvents, ...pushedEvents, ...hydrateEvents],
          token,
        );
        if (
          token.length === 0 ||
          (agentOutputFound && (!expectPushedAgentOutput || pushedAgentOutputFound))
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, ${input.pollMs}));
      }

      const hydrated = [...hydrateEvents, ...pushedEvents]
        .find((event) => event.kind === "thread.hydrated");
      unsubscribe();
      return {
        ok: true,
        threadId,
        agent: started.payload.thread.agentBinding.agentId,
        runtimeSource: started.payload.thread.agentBinding.runtimeSource,
        launchOptions: started.payload.thread.launchOptions,
        hydratedAgent: hydrated?.payload.thread.agentBinding.agentId,
        hydratedLaunchOptions: hydrated?.payload.thread.launchOptions,
        blockCount: hydrated?.payload.blocks?.length ?? 0,
        agentOutputFound,
        pushedAgentOutputFound,
        pushedCount: pushedEvents.length,
        startEventKinds: eventKinds(startEvents),
        pushedEventKinds: eventKinds(pushedEvents),
        hydrateEventKinds: eventKinds(hydrateEvents),
      };

      function eventKinds(events) {
        return events.map((event) => event.kind);
      }

      async function openProviderSetupSurface(readinessEvent) {
        const setup = (readinessEvent.payload.readiness.blockers ?? [])
          .find((blocker) => blocker.setup)?.setup;
        if (setup === undefined) {
          return { opened: false, error: "missing_setup_action" };
        }

        const setupEvents = await window.tide.sendBackendCommand({
          contractVersion: command.contractVersion,
          requestId: command.requestId + "-open-setup-" + Date.now(),
          kind: "workbench.command",
          issuedAt: new Date().toISOString(),
          payload: {
            threadId: readinessEvent.payload.threadId,
            command: "open_provider_setup_surface",
            data: { setup },
          },
        });
        const workbenchChanged = setupEvents
          .find((event) => event.kind === "workbench.changed");
        const pane = workbenchChanged?.payload.panes
          ?.find((candidate) => candidate.kind === "terminal");
        return {
          opened: pane !== undefined,
          paneId: pane?.paneId,
          title: pane?.title,
          status: pane?.status,
          command: pane?.command,
          expectedCompletion: pane?.expectedCompletion,
          eventKinds: eventKinds(setupEvents),
        };
      }

      function agentOutputContainsToken(events, expectedToken) {
        if (expectedToken.length === 0) {
          return false;
        }
        for (const event of events) {
          if (event.kind === "agentSessionBlock.upserted") {
            if (blockContainsToken(event.payload.block, expectedToken)) {
              return true;
            }
          }
          if (event.kind === "thread.hydrated") {
            for (const block of event.payload.blocks ?? []) {
              if (blockContainsToken(block, expectedToken)) {
                return true;
              }
            }
          }
        }
        return false;
      }

      function blockContainsToken(block, expectedToken) {
        if (block?.role !== "agent") {
          return false;
        }
        return String(block.body ?? "").includes(expectedToken) ||
          String(block.rawFallback ?? "").includes(expectedToken);
      }
    })()
  `;
}

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

void app.whenReady().then(() => {
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  backendProcess?.kill();
});
