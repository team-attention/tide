import {
  createBackendConnectionChangedEvent,
  createContractErrorEvent,
  type BackendEventEnvelope,
  type BackendHandshake,
  type ConnectionState,
  type ContractErrorPayload,
  type RendererHandshake,
  validateBackendHandshake,
  validateRendererHandshake,
} from "../../../shared/contracts/index.ts";

export interface BackendProcessExit {
  reason: "exited" | "crashed" | "killed";
  exitCode?: number;
}

export interface BackendProcessHandle {
  readHandshake(): Promise<BackendHandshake>;
  postMessage(message: unknown): void;
  requestSnapshot(handshake: RendererHandshake): Promise<BackendEventEnvelope[]>;
  shutdownGracefully(): Promise<void>;
  terminate(): void;
  onExit(listener: (exit: BackendProcessExit) => void): () => void;
  markRuntimeHandlesLost?(): void;
}

export interface BackendProcessLauncher {
  spawn(): BackendProcessHandle;
}

export type BackendProcessSupervisorStartResult =
  | { ok: true; handshake: BackendHandshake }
  | { ok: false; error: ContractErrorPayload };

export interface BackendProcessSupervisor {
  readonly state: ConnectionState;
  start(): Promise<BackendProcessSupervisorStartResult>;
  connectRenderer(handshake: RendererHandshake): Promise<BackendEventEnvelope[]>;
  disconnectRenderer(): void;
  shutdownApp(options?: { timeoutMs?: number }): Promise<void>;
  onEvent(listener: (event: BackendEventEnvelope) => void): () => void;
}

export interface CreateBackendProcessSupervisorInput {
  launcher: BackendProcessLauncher;
  clock?: () => string;
  idGenerator?: () => string;
}

export function createBackendProcessSupervisor(
  input: CreateBackendProcessSupervisorInput,
): BackendProcessSupervisor {
  return new DefaultBackendProcessSupervisor(input);
}

class DefaultBackendProcessSupervisor implements BackendProcessSupervisor {
  private readonly launcher: BackendProcessLauncher;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private listeners: ((event: BackendEventEnvelope) => void)[] = [];
  private process: BackendProcessHandle | null = null;
  private handshake: BackendHandshake | null = null;
  private unsubscribeExit: (() => void) | null = null;
  private connectionState: ConnectionState = "backend_disconnected";

  constructor(input: CreateBackendProcessSupervisorInput) {
    this.launcher = input.launcher;
    this.clock = input.clock ?? defaultClock;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  async start(): Promise<BackendProcessSupervisorStartResult> {
    this.emitConnectionChanged("starting");
    const process = this.launcher.spawn();
    this.process = process;

    this.emitConnectionChanged("handshaking");
    const handshake = await process.readHandshake();
    const validated = validateBackendHandshake(handshake);
    if (!validated.ok) {
      this.emit(
        createContractErrorEvent({
          eventId: this.nextEventId(),
          emittedAt: this.clock(),
          error: validated.error,
        }),
      );
      this.emitConnectionChanged("backend_disconnected", {
        backendInstanceId: handshake.backendInstanceId,
        reason: validated.error,
      });
      return { ok: false, error: validated.error };
    }

    this.handshake = validated.value;
    this.unsubscribeExit = process.onExit((exit) => this.handleBackendExit(exit));
    this.emitConnectionChanged("connected", {
      backendInstanceId: validated.value.backendInstanceId,
    });

    return { ok: true, handshake: validated.value };
  }

  async connectRenderer(
    handshake: RendererHandshake,
  ): Promise<BackendEventEnvelope[]> {
    const validated = validateRendererHandshake(handshake);
    if (!validated.ok) {
      const event = createContractErrorEvent({
        eventId: this.nextEventId(),
        emittedAt: this.clock(),
        error: validated.error,
      });
      this.emit(event);
      return [event];
    }

    if (this.process === null) {
      const event = this.connectionChangedEvent("backend_disconnected", {
        reason: createDisconnectedError(),
      });
      this.emit(event);
      return [event];
    }

    this.emitConnectionChanged("renderer_reconnecting", {
      backendInstanceId: this.handshake?.backendInstanceId,
    });
    const events = await this.process.requestSnapshot(validated.value);
    for (const event of events) {
      this.emit(event);
    }
    this.emitConnectionChanged("connected", {
      backendInstanceId: this.handshake?.backendInstanceId,
    });

    return events;
  }

  disconnectRenderer(): void {
    if (this.process === null) {
      return;
    }
    this.emitConnectionChanged("renderer_reconnecting", {
      backendInstanceId: this.handshake?.backendInstanceId,
    });
  }

  async shutdownApp(options: { timeoutMs?: number } = {}): Promise<void> {
    if (this.process === null) {
      return;
    }

    this.emitConnectionChanged("shutting_down", {
      backendInstanceId: this.handshake?.backendInstanceId,
    });
    const shutdownCompleted = await waitForShutdown(
      this.process.shutdownGracefully(),
      options.timeoutMs,
    );
    if (!shutdownCompleted) {
      this.process.terminate();
    }
  }

  onEvent(listener: (event: BackendEventEnvelope) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((current) => current !== listener);
    };
  }

  private handleBackendExit(_exit: BackendProcessExit): void {
    this.process?.markRuntimeHandlesLost?.();
    this.unsubscribeExit?.();
    this.unsubscribeExit = null;
    this.emitConnectionChanged("backend_disconnected", {
      backendInstanceId: this.handshake?.backendInstanceId,
    });
  }

  private emitConnectionChanged(
    state: ConnectionState,
    options: {
      backendInstanceId?: string;
      reason?: ContractErrorPayload;
    } = {},
  ): void {
    const event = this.connectionChangedEvent(state, options);
    this.emit(event);
  }

  private connectionChangedEvent(
    state: ConnectionState,
    options: {
      backendInstanceId?: string;
      reason?: ContractErrorPayload;
    } = {},
  ): BackendEventEnvelope<"backend.connectionChanged"> {
    this.connectionState = state;
    return createBackendConnectionChangedEvent({
      eventId: this.nextEventId(),
      emittedAt: this.clock(),
      state,
      backendInstanceId: options.backendInstanceId,
      reason: options.reason,
    });
  }

  private emit(event: BackendEventEnvelope): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private nextEventId(): string {
    return this.idGenerator();
  }
}

async function waitForShutdown(
  shutdown: Promise<void>,
  timeoutMs: number | undefined,
): Promise<boolean> {
  if (timeoutMs === undefined) {
    await shutdown;
    return true;
  }

  return Promise.race([
    shutdown.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
}

function createDisconnectedError(): ContractErrorPayload {
  return {
    code: "internal_error",
    message: "Backend process is not connected.",
    severity: "error",
    retryable: true,
  };
}

function defaultClock(): string {
  return new Date().toISOString();
}

function defaultIdGenerator(): string {
  return `evt-${Math.random().toString(36).slice(2)}`;
}
