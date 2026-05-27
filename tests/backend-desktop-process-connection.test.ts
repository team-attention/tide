// Spec: docs_v2/specs/backend-desktop-process-connection.md

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createBackendContractMessageAdapter } from "../src/backend/adapters/inbound/contract-message-adapter/backend-contract-message-adapter.ts";
import {
  createThreadRuntimeService,
  type AgentRuntimeHandle,
  type AgentRuntimePort,
  type AgentRuntimeResumeInput,
  type AgentRuntimeStartInput,
  type ProviderReadinessCheckInput,
  type ProviderReadinessPort,
  type ProviderReadinessResult,
  type PtyTranscriptPort,
  type RawAgentFrame,
  type TerminalInput,
  type ThreadSeed,
} from "../src/backend/application/services/thread-runtime-service.ts";
import { createMessagePortBackendClient } from "../src/desktop/adapters/outbound/backend-client/message-port-backend-client.ts";
import {
  createBackendProcessSupervisor,
  type BackendProcessExit,
  type BackendProcessHandle,
  type BackendProcessLauncher,
} from "../src/desktop/infrastructure/electron/backend-process-supervisor.ts";
import {
  CONTRACT_VERSION,
  type BackendCommandEnvelope,
  type BackendCommandKind,
  type BackendCommandPayloadByKind,
  type BackendEventEnvelope,
  type BackendHandshake,
  type RendererHandshake,
} from "../src/shared/contracts/index.ts";

const now = "2026-05-27T00:00:00.000Z";
const later = "2026-05-27T00:00:01.000Z";

test("main_starts_backend_and_brokers_contract_handshake", async () => {
  const backend = new FakeBackendProcess();
  const launcher = new FakeBackendProcessLauncher(backend);
  const supervisor = createBackendProcessSupervisor({
    launcher,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const events = collectSupervisorEvents(supervisor);

  const result = await supervisor.start();

  assert.equal(result.ok, true);
  assert.equal(launcher.spawnCount, 1);
  assert.equal(result.ok && result.handshake.backendInstanceId, "backend-process-1");
  assert.deepEqual(
    events.map((event) => event.payload.state),
    ["starting", "handshaking", "connected"],
  );
});

test("unsupported_contract_version_fails_handshake_before_command_handling", async () => {
  const backend = new FakeBackendProcess({
    handshake: {
      contractVersion: 2 as 1,
      backendInstanceId: "backend-process-2",
      startedAt: now,
      supportedTransports: ["message_port"],
    },
  });
  const supervisor = createBackendProcessSupervisor({
    launcher: new FakeBackendProcessLauncher(backend),
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const events = collectSupervisorEvents(supervisor);

  const result = await supervisor.start();

  assert.equal(result.ok, false);
  assert.equal(backend.receivedMessages.length, 0);
  assert.equal(events.at(-2)?.kind, "contract.error");
  assert.equal(events.at(-2)?.payload.code, "unsupported_contract_version");
  assert.equal(events.at(-1)?.kind, "backend.connectionChanged");
  assert.equal(events.at(-1)?.payload.state, "backend_disconnected");
});

test("message_port_backend_client_rejects_non_envelope_payloads", () => {
  const port = new FakeMessagePort();
  const client = createMessagePortBackendClient({ port });

  const result = client.postCommandEnvelope({
    kind: "composer.sendInput",
    payload: { threadId: "thread-process", input: "continue" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.error.code, "invalid_command");
  assert.deepEqual(port.postedMessages, []);
});

test("renderer_command_reaches_backend_adapter_and_returns_backend_events", async () => {
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
    initialThreads: [threadSeed("thread-process")],
  });
  const adapter = createBackendContractMessageAdapter({
    service,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const port = new LoopbackMessagePort(async (message) =>
    adapter.handleMessage(message),
  );
  const received: BackendEventEnvelope[] = [];
  const client = createMessagePortBackendClient({
    port,
    onEvent: (event) => received.push(event),
  });

  const result = client.postCommandEnvelope(
    commandEnvelope("thread.hydrate", { threadId: "thread-process" }),
  );
  await port.flush();

  assert.equal(result.ok, true);
  assert.deepEqual(
    received.map((event) => event.kind),
    ["command.accepted", "thread.hydrated", "command.completed"],
  );
  assert.deepEqual(
    received.map((event) => event.requestId),
    ["req-thread.hydrate", "req-thread.hydrate", "req-thread.hydrate"],
  );
  assert.equal(received[1].payload.thread.threadId, "thread-process");
});

test("renderer_reconnect_receives_active_thread_snapshot", async () => {
  const backend = new FakeBackendProcess();
  const supervisor = createBackendProcessSupervisor({
    launcher: new FakeBackendProcessLauncher(backend),
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const events = collectSupervisorEvents(supervisor);

  await supervisor.start();
  const reconnectEvents = await supervisor.connectRenderer({
    contractVersion: CONTRACT_VERSION,
    rendererInstanceId: "renderer-reload-1",
    activeThreadId: "thread-process",
  });

  assert.deepEqual(
    reconnectEvents.map((event) => event.kind),
    ["backend.snapshotRequested", "thread.hydrated", "backend.snapshotReady"],
  );
  assert.deepEqual(backend.snapshotRequests, ["thread-process"]);
  assert.equal(
    events.some(
      (event) =>
        event.kind === "backend.connectionChanged" &&
        event.payload.state === "renderer_reconnecting",
    ),
    true,
  );
});

test("backend_keeps_runtime_events_while_renderer_is_disconnected", async () => {
  const backend = new FakeBackendProcess();
  const supervisor = createBackendProcessSupervisor({
    launcher: new FakeBackendProcessLauncher(backend),
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });

  await supervisor.start();
  supervisor.disconnectRenderer();
  backend.observeRuntimeEvent("output collected while renderer was gone");

  const reconnectEvents = await supervisor.connectRenderer({
    contractVersion: CONTRACT_VERSION,
    rendererInstanceId: "renderer-reload-2",
    activeThreadId: "thread-process",
  });

  assert.equal(backend.runtimeObservations.length, 1);
  assert.equal(reconnectEvents[1].kind, "thread.hydrated");
  assert.equal(reconnectEvents[1].payload.blocks?.[0]?.body, "output collected while renderer was gone");
});

test("backend_crash_emits_disconnected_state_without_survived_runtime_claim", async () => {
  const backend = new FakeBackendProcess();
  const supervisor = createBackendProcessSupervisor({
    launcher: new FakeBackendProcessLauncher(backend),
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });
  const events = collectSupervisorEvents(supervisor);

  await supervisor.start();
  backend.emitExit({ reason: "crashed", exitCode: 9 });

  assert.equal(backend.runtimeHandlesLost, true);
  assert.equal(events.at(-1)?.kind, "backend.connectionChanged");
  assert.equal(events.at(-1)?.payload.state, "backend_disconnected");
});

test("app_close_requests_backend_shutdown_before_terminate_path", async () => {
  const backend = new FakeBackendProcess({ neverResolveShutdown: true });
  const supervisor = createBackendProcessSupervisor({
    launcher: new FakeBackendProcessLauncher(backend),
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("evt"),
  });

  await supervisor.start();
  await supervisor.shutdownApp({ timeoutMs: 1 });

  assert.deepEqual(backend.lifecycleActions, ["shutdown", "terminate"]);
});

test("desktop_main_supervisor_does_not_import_provider_or_pty_modules", () => {
  const source = readRepoFile(
    "src/desktop/infrastructure/electron/backend-process-supervisor.ts",
  );

  assert.doesNotMatch(source, /node-pty|pty-port|agent-integrations|AgentRuntimePort/);
  assert.doesNotMatch(source, /backend\/application\/services/);
  assert.doesNotMatch(source, /backend\/adapters\/outbound/);
});

function collectSupervisorEvents(
  supervisor: ReturnType<typeof createBackendProcessSupervisor>,
): BackendEventEnvelope[] {
  const events: BackendEventEnvelope[] = [];
  supervisor.onEvent((event) => events.push(event));
  return events;
}

function commandEnvelope<TKind extends BackendCommandKind>(
  kind: TKind,
  payload: BackendCommandPayloadByKind[TKind],
): BackendCommandEnvelope<TKind> {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: `req-${kind}`,
    kind,
    issuedAt: now,
    payload,
  };
}

function threadSeed(
  threadId: string,
  overrides: Partial<ThreadSeed> = {},
): ThreadSeed {
  return {
    threadId,
    title: "Process connection thread",
    agentBinding: {
      agentId: "codex",
    },
    scope: { kind: "scratch", scratchCwd: `/tmp/${threadId}` },
    lifecycleState: "open",
    runtimeState: "idle",
    lastKnownState: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createFakes(options: { readiness?: ProviderReadinessResult } = {}) {
  const runtime = new FakeAgentRuntimePort();
  const readiness = new FakeProviderReadinessPort(
    options.readiness ?? {
      ready: true,
      agentId: "codex",
      blockers: [],
    },
  );
  const transcript = new FakePtyTranscriptPort();

  return {
    runtime,
    readiness,
    transcript,
    ports: {
      agentRuntimePort: runtime,
      providerReadinessPort: readiness,
      ptyTranscriptPort: transcript,
    },
  };
}

class FakeAgentRuntimePort implements AgentRuntimePort {
  writes: { handle: AgentRuntimeHandle; input: TerminalInput }[] = [];

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    return {
      runtimeId: "runtime-start-1",
      threadId: input.threadId,
      agentId: input.agentBinding.agentId,
    };
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    return {
      runtimeId: "runtime-resume-1",
      threadId: input.threadId,
      agentId: input.agentBinding.agentId,
    };
  }

  async writeInput(
    handle: AgentRuntimeHandle,
    input: TerminalInput,
  ): Promise<void> {
    this.writes.push({ handle, input });
  }

  async stop(_handle: AgentRuntimeHandle): Promise<void> {}
}

class FakeProviderReadinessPort implements ProviderReadinessPort {
  private readonly result: ProviderReadinessResult;

  constructor(result: ProviderReadinessResult) {
    this.result = result;
  }

  async check(
    input: ProviderReadinessCheckInput,
  ): Promise<ProviderReadinessResult> {
    return {
      ...this.result,
      agentId: input.agentId,
    };
  }
}

class FakePtyTranscriptPort implements PtyTranscriptPort {
  frames: RawAgentFrame[] = [];

  async append(frame: RawAgentFrame): Promise<void> {
    this.frames.push(frame);
  }
}

class FakeMessagePort {
  postedMessages: unknown[] = [];
  private listeners: ((event: { data: unknown }) => void)[] = [];

  postMessage(message: unknown): void {
    this.postedMessages.push(message);
  }

  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void {
    if (type === "message") {
      this.listeners.push(listener);
    }
  }

  removeEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void {
    if (type === "message") {
      this.listeners = this.listeners.filter((current) => current !== listener);
    }
  }

  emit(message: unknown): void {
    for (const listener of this.listeners) {
      listener({ data: message });
    }
  }
}

class LoopbackMessagePort extends FakeMessagePort {
  private pending: Promise<void>[] = [];
  private readonly dispatch: (message: unknown) => Promise<BackendEventEnvelope[]>;

  constructor(dispatch: (message: unknown) => Promise<BackendEventEnvelope[]>) {
    super();
    this.dispatch = dispatch;
  }

  override postMessage(message: unknown): void {
    super.postMessage(message);
    this.pending.push(
      this.dispatch(message).then((events) => {
        for (const event of events) {
          this.emit(event);
        }
      }),
    );
  }

  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }
}

class FakeBackendProcessLauncher implements BackendProcessLauncher {
  spawnCount = 0;
  private readonly process: FakeBackendProcess;

  constructor(process: FakeBackendProcess) {
    this.process = process;
  }

  spawn(): BackendProcessHandle {
    this.spawnCount += 1;
    return this.process;
  }
}

class FakeBackendProcess implements BackendProcessHandle {
  readonly handshake: BackendHandshake;
  readonly neverResolveShutdown: boolean;
  receivedMessages: unknown[] = [];
  snapshotRequests: (string | undefined)[] = [];
  runtimeObservations: string[] = [];
  runtimeHandlesLost = false;
  lifecycleActions: string[] = [];
  private exitListeners: ((exit: BackendProcessExit) => void)[] = [];

  constructor(input: {
    handshake?: BackendHandshake;
    neverResolveShutdown?: boolean;
  } = {}) {
    this.handshake =
      input.handshake ?? {
        contractVersion: CONTRACT_VERSION,
        backendInstanceId: "backend-process-1",
        startedAt: now,
        supportedTransports: ["message_port"],
      };
    this.neverResolveShutdown = input.neverResolveShutdown ?? false;
  }

  async readHandshake(): Promise<BackendHandshake> {
    return this.handshake;
  }

  postMessage(message: unknown): void {
    this.receivedMessages.push(message);
  }

  onExit(listener: (exit: BackendProcessExit) => void): () => void {
    this.exitListeners.push(listener);
    return () => {
      this.exitListeners = this.exitListeners.filter((current) => current !== listener);
    };
  }

  async requestSnapshot(
    handshake: RendererHandshake,
  ): Promise<BackendEventEnvelope[]> {
    this.snapshotRequests.push(handshake.activeThreadId);
    const activeThreadId = handshake.activeThreadId ?? "thread-process";

    return [
      backendEvent("backend.snapshotRequested", {
        activeThreadId,
      }),
      backendEvent("thread.hydrated", {
        thread: {
          threadId: activeThreadId,
          title: "Process connection thread",
          agentBinding: { agentId: "codex" },
          scope: { kind: "scratch", scratchCwd: `/tmp/${activeThreadId}` },
          createdAt: now,
          updatedAt: later,
          pinned: false,
          archived: false,
          lastKnownState: "idle",
        },
        blocks: this.runtimeObservations.map((body, index) => ({
          blockId: `runtime-observation-${index + 1}`,
          threadId: activeThreadId,
          agentId: "codex",
          kind: "raw_fallback",
          role: "runtime",
          status: "complete",
          body,
          updatedAt: later,
        })),
        runtimeState: "idle",
      }),
      backendEvent("backend.snapshotReady", {
        activeThreadId,
      }),
    ];
  }

  observeRuntimeEvent(body: string): void {
    this.runtimeObservations.push(body);
  }

  markRuntimeHandlesLost(): void {
    this.runtimeHandlesLost = true;
  }

  async shutdownGracefully(): Promise<void> {
    this.lifecycleActions.push("shutdown");
    if (this.neverResolveShutdown) {
      return new Promise(() => {});
    }
  }

  terminate(): void {
    this.lifecycleActions.push("terminate");
  }

  emitExit(exit: BackendProcessExit): void {
    for (const listener of this.exitListeners) {
      listener(exit);
    }
  }
}

function backendEvent<TKind extends BackendEventEnvelope["kind"]>(
  kind: TKind,
  payload: Extract<BackendEventEnvelope, { kind: TKind }>["payload"],
): BackendEventEnvelope<TKind> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: `evt-${kind}`,
    kind,
    emittedAt: later,
    payload,
  } as BackendEventEnvelope<TKind>;
}

function fixedClock(): string {
  return now;
}

function sequentialIdGenerator(prefix: string): () => string {
  let nextId = 1;
  return () => `${prefix}-${nextId++}`;
}

function readRepoFile(relativePath: string): string {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}
