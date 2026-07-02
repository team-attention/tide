import { fileURLToPath } from "node:url";

import {
  CONTRACT_VERSION,
  type BackendCommandEnvelope,
  type BackendEventEnvelope,
  type BackendHandshake,
} from "../../../../shared/contracts/index.ts";
import { createLiveBackendContractMessageAdapter } from "../live/live-backend.ts";
import { createMainProcessBrowserRuntimePort } from "../../../adapters/outbound/browser-runtime/main-process-browser-runtime-port.ts";
import { reapOrphanedTideAgentProcesses } from "../live/reap-orphaned-agents.ts";
import {
  runAgentReaperGuardianFromEnv,
  spawnAgentReaperGuardian,
} from "../live/agent-reaper-guardian.ts";
import { resolveAugmentedEnvironment } from "../live/resolve-shell-path.ts";
import { runTideMcpStdioBridgeFromEnv } from "./tide-mcp-stdio-entrypoint.ts";

// A Finder/Dock-launched packaged app only inherits the minimal launchd env, so
// provider runtimes miss both CLI search paths and exported shell variables that
// terminal-launched agents see (tokens, SSH_AUTH_SOCK, asdf/mise/nvm/direnv vars,
// project cloud env, etc.). Restore the user's shell environment before anything
// resolves or spawns a provider.
for (const [key, value] of Object.entries(resolveAugmentedEnvironment())) {
  if (value !== undefined) {
    process.env[key] = value;
  }
}

// Guardian mode: the detached watchdog the backend spawns below. It outlives a
// hard-killed backend and reaps its orphaned agents the moment that backend dies,
// closing the gap before the next launch's startup sweep. It MUST short-circuit here —
// never falling through to (and never re-spawning) the backend wiring.
if (process.argv.includes("guardian")) {
  try {
    await runAgentReaperGuardianFromEnv();
  } catch {
    // A watchdog must exit cleanly even on an unexpected error — never leave an
    // unhandled rejection or a lingering process behind.
  }
  process.exit(0);
}

// Reap any agent orphaned by a previous hard kill (force quit / crash / power loss)
// before this session spawns anything — a force-quit can skip the PTY watchdog and
// leave a CPU-spinning orphan from the last run.
reapOrphanedTideAgentProcesses();

type ElectronParentPort = {
  postMessage: (message: unknown) => void;
  on: (event: "message", listener: (message: unknown) => void) => void;
};

export interface TideBackendEntrypoint {
  transport: "message_port";
  ownsAgentRuntime: true;
}

export const tideBackendEntrypoint: TideBackendEntrypoint = {
  transport: "message_port",
  ownsAgentRuntime: true,
};

const backendInstanceId = `backend-${Date.now()}-${Math.random().toString(36).slice(2)}`;

if (process.argv.includes("mcp")) {
  const exitCode = await runTideMcpStdioBridgeFromEnv();
  process.exit(exitCode);
}

// Launch the detached force-quit guardian for THIS backend session. Mirrors the MCP
// bridge self-relaunch recipe: the Tide binary runs this same entrypoint as Node
// (ELECTRON_RUN_AS_NODE) in `guardian` mode, watching this pid. Only the real backend
// reaches here — the mcp and guardian branches above both exit first.
spawnAgentReaperGuardian({
  entrypointPath: fileURLToPath(import.meta.url),
  targetPid: process.pid,
});

const parentPort = await loadElectronParentPort();
const browserRuntime = createMainProcessBrowserRuntimePort(parentPort);
const adapter = createLiveBackendContractMessageAdapter({
  onEvent: postOrBufferBackendEvent,
  browserRuntimePort: browserRuntime.port,
});
let activeParentCommandCount = 0;
const bufferedBackendEvents: BackendEventEnvelope[] = [];

// On a clean quit Electron sends SIGTERM to the utilityProcess. Flush the
// coalesced conversation-cache writes so the trailing debounce window is never
// lost, then exit. (A hard kill skips this — acceptable for a best-effort cache.)
let shuttingDown = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void adapter
      .flushPendingPersists()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

export const backendHandshake: BackendHandshake = {
  contractVersion: CONTRACT_VERSION,
  backendInstanceId,
  startedAt: new Date().toISOString(),
  supportedTransports: ["message_port"],
};

if (parentPort !== undefined) {
  parentPort.postMessage({
    kind: "backend.handshake",
    payload: backendHandshake,
  });

  parentPort.on("message", (message: unknown) => {
    const payload = unwrapPortMessage(message);
    if (browserRuntime.handleParentMessage(payload)) {
      return;
    }
    void handleParentMessage(payload);
  });
}

async function handleParentMessage(message: unknown): Promise<void> {
  traceBackendEntrypoint(`received ${(message as { kind?: unknown })?.kind ?? "unknown"} command`);
  activeParentCommandCount += 1;
  const events = await adapter.handleMessage(message as BackendCommandEnvelope).finally(() => {
    activeParentCommandCount -= 1;
  });
  traceBackendEntrypoint(
    `completed ${(message as { kind?: unknown })?.kind ?? "unknown"} command events=${events
      .map((event) => event.kind)
      .join(",")}`,
  );
  for (const event of events) {
    postBackendEvent(event);
  }
  flushBufferedBackendEvents();
}

function postOrBufferBackendEvent(event: BackendEventEnvelope): void {
  if (
    activeParentCommandCount > 0 &&
    event.requestId === undefined &&
    !isImmediateDuringCommandEvent(event)
  ) {
    bufferedBackendEvents.push(event);
    return;
  }
  postBackendEvent(event);
}

function isImmediateDuringCommandEvent(event: BackendEventEnvelope): boolean {
  return event.kind === "agentSessionBlock.upserted" &&
    (event.payload as { block?: { kind?: unknown } })?.block?.kind === "user_message";
}

function flushBufferedBackendEvents(): void {
  const events = bufferedBackendEvents.splice(0);
  for (const event of events) {
    postBackendEvent(event);
  }
}

function postBackendEvent(event: BackendEventEnvelope): void {
  if (parentPort === undefined) {
    return;
  }
  parentPort.postMessage({
    kind: "backend.event",
    payload: event,
  });
}

async function loadElectronParentPort(): Promise<ElectronParentPort | undefined> {
  const processParentPort = (process as NodeJS.Process & {
    parentPort?: ElectronParentPort;
  }).parentPort;
  if (processParentPort !== undefined) {
    return processParentPort;
  }

  const electron = (await import("electron")) as {
    parentPort?: ElectronParentPort;
    default?: { parentPort?: ElectronParentPort };
  };
  return electron.parentPort ?? electron.default?.parentPort;
}

function traceBackendEntrypoint(message: string): void {
  if (process.env.TIDE_BACKEND_TRACE !== "1") {
    return;
  }
  process.stdout.write(`[tide-backend-entrypoint] ${message}\n`);
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
