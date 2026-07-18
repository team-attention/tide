import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContractErrorEvent, createContractErrorPayload, isBrowserRuntimeRequestEnvelope, validateBackendEventEnvelope, validateBackendHandshake } from "../../../../shared/contracts/index.ts";
import type { BackendCommandEnvelope, BackendEventEnvelope, BackendHandshake } from "../../../../shared/contracts/index.ts";
import { BrowserWindow, app, utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import { browserRuntimeHost } from "./browser-runtime-host.ts";
// Extracted from electron-main.ts (spec: navigable-source-structure).

export const mainDir = dirname(fileURLToPath(import.meta.url));

const backendEntrypointFile = "backend-entrypoint.js";

const backendHandshakeTimeoutMs = 8000;

const backendCommandTimeoutMs = parsePositiveIntegerEnv("TIDE_BACKEND_COMMAND_TIMEOUT_MS", 120000);

type BackendProcessMessage =
  | { kind: "backend.handshake"; payload: unknown }
  | { kind: "backend.event"; payload: unknown }
  | { kind: "backend.shutdown.complete"; requestId: string };

export interface PendingBackendRequest {
  events: BackendEventEnvelope[];
  resolve: (events: BackendEventEnvelope[]) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export let backendProcess: UtilityProcess | null = null;

let backendHandshake: Promise<BackendHandshake> | null = null;

let resolveBackendHandshake: ((handshake: BackendHandshake) => void) | null = null;

let rejectBackendHandshake: ((error: Error) => void) | null = null;

let pendingBackendShutdown: {
  requestId: string;
  promise: Promise<void>;
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
} | null = null;

export const pendingBackendRequests = new Map<string, PendingBackendRequest>();

const deferredBackendBroadcastEvents: BackendEventEnvelope[] = [];

let deferredBackendBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

export async function ensureBackendProcess(): Promise<BackendHandshake> {
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
    env: backendProcessEnvironment(),
    stdio: "pipe",
  });
  backendProcess.stdout?.on("data", (chunk: Buffer) => {
    if (
      process.env.TIDE_ELECTRON_SMOKE_COMMAND !== undefined ||
      process.env.TIDE_BACKEND_TRACE === "1"
    ) {
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
    settlePendingBackendShutdown();
    resetBackendProcess();
  });

  return backendHandshake;
}

export function postBackendCommand(command: BackendCommandEnvelope): Promise<BackendEventEnvelope[]> {
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

export function shutdownBackendProcess(timeoutMs = 7_000): Promise<void> {
  if (backendProcess === null) return Promise.resolve();
  if (pendingBackendShutdown !== null) return pendingBackendShutdown.promise;
  const requestId = `shutdown-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  const timeout = setTimeout(() => {
    const processToTerminate = backendProcess;
    settlePendingBackendShutdown();
    processToTerminate?.kill();
  }, timeoutMs);
  pendingBackendShutdown = { requestId, promise, resolve, timeout };
  backendProcess.postMessage({
    kind: "backend.shutdown.request",
    requestId,
    reason: "app_quit",
    deadlineAt: new Date(Date.now() + timeoutMs).toISOString(),
  });
  return promise;
}

function handleBackendProcessMessage(message: unknown): void {
  const payload = unwrapPortMessage(message);
  if (isBrowserRuntimeRequestEnvelope(payload)) {
    void browserRuntimeHost.handleRequest(payload).then((response) => {
      backendProcess?.postMessage(response);
    });
    return;
  }
  if (!isBackendProcessMessage(payload)) {
    return;
  }

  if (payload.kind === "backend.shutdown.complete") {
    if (pendingBackendShutdown?.requestId === payload.requestId) {
      settlePendingBackendShutdown();
    }
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

function settlePendingBackendShutdown(): void {
  const pending = pendingBackendShutdown;
  if (pending === null) return;
  pendingBackendShutdown = null;
  clearTimeout(pending.timeout);
  pending.resolve();
}

function backendProcessEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || isInheritedAgentOwnerEnv(key)) {
      continue;
    }
    env[key] = value;
  }
  env.TIDE_APP_DATA_ROOT = resolveAppDataRoot();
  // The node-capable runtime for Tide's MCP subprocess
  // (`ELECTRON_RUN_AS_NODE=1 $TIDE_BIN <script> mcp`). Inside the utility
  // process, process.execPath is the Electron HELPER binary, which is NOT
  // node-runnable — the MCP bridge spawned with it would never exit. The MAIN
  // process execPath is the real Electron binary, which is.
  env.TIDE_BIN = process.execPath;
  return env;
}

function isInheritedAgentOwnerEnv(key: string): boolean {
  return (
    key === "TIDE_APP_DATA_ROOT" ||
    key === "TIDE_BIN" ||
    key === "TIDE_SOCKET" ||
    key === "TIDE_MCP_ENTRYPOINT" ||
    key === "TIDE_BACKEND_INSTANCE_ID" ||
    key === "TIDE_THREAD_ID" ||
    key === "TIDE_RUNTIME_ID" ||
    key === "TIDE_AGENT_ID" ||
    key === "TIDE_PROCESS_OWNER_ID" ||
    key === "TIDE_PROCESS_OWNER_PID" ||
    key === "TIDE_PROCESS_RESOURCE_ID" ||
    key === "TIDE_PROCESS_OWNER_TOKEN" ||
    key === "TIDE_PANE" ||
    key === "TIDE_WINDOW" ||
    key === "TIDE_ELECTRON_SMOKE_COMMAND" ||
    key === "ELECTRON_RUN_AS_NODE"
  );
}

function resolveBackendEntrypointPath(): string {
  return join(mainDir, backendEntrypointFile);
}

function isBackendProcessMessage(value: unknown): value is BackendProcessMessage {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }

  const kind = (value as { kind?: unknown }).kind;
  if (kind === "backend.shutdown.complete") {
    return typeof (value as { requestId?: unknown }).requestId === "string";
  }
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

export function nextEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function resolveAppDataRoot(): string {
  return process.env.TIDE_APP_DATA_ROOT ?? app.getPath("userData");
}

export function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
