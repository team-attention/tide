import {
  CONTRACT_VERSION,
  type BackendCommandEnvelope,
  type BackendEventEnvelope,
  type BackendHandshake,
} from "../../../shared/contracts/index.ts";
import { createLiveBackendContractMessageAdapter } from "./live-backend.ts";
import { runTideMcpStdioBridgeFromEnv } from "./tide-mcp-stdio-entrypoint.ts";

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

const parentPort = await loadElectronParentPort();
const adapter = createLiveBackendContractMessageAdapter({
  onEvent: postOrBufferBackendEvent,
});
let activeParentCommandCount = 0;
const bufferedBackendEvents: BackendEventEnvelope[] = [];

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
    void handleParentMessage(unwrapPortMessage(message));
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
  if (activeParentCommandCount > 0 && event.requestId === undefined) {
    bufferedBackendEvents.push(event);
    return;
  }
  postBackendEvent(event);
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
