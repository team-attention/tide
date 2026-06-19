import type { ThreadId, ThreadRecord } from "../../domains/thread/thread.ts";
import type {
  BrowserPaneState,
  TerminalPaneState,
} from "../../domains/workbench/workbench.ts";
import type {
  ProviderSetupSurfaceExit,
  ProviderSetupSurfaceHandle,
  ProviderSetupSurfaceOutput,
  ProviderSetupSurfaceTerminalPort,
} from "../../ports/outbound/provider-setup-surface-terminal-port.ts";
import type {
  WorkbenchTerminalExit,
  WorkbenchTerminalHandle,
  WorkbenchTerminalOutput,
  WorkbenchTerminalPort,
} from "../../ports/outbound/workbench-terminal-port.ts";
import { cloneEnv, shallowRecordEqual } from "../support/record-helpers.ts";
import {
  boundedTranscriptPreview,
  commandName,
  errorMessage,
  setupLaunchPreview,
} from "../support/service-value-helpers.ts";
import { snapshotThread } from "../thread/thread-snapshot.ts";
import type { ThreadRuntimeAsyncEvent } from "../thread/thread-runtime-events.ts";
import type { ProviderSetupSurfaceActionInput } from "./workbench-command-data.ts";
import type { ThreadStore } from "../thread/thread-store.ts";

export interface WorkbenchTerminalOpenInput {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface WorkbenchRuntimeDeps {
  store: ThreadStore;
  workbenchTerminalPort?: WorkbenchTerminalPort;
  providerSetupSurfaceTerminalPort?: ProviderSetupSurfaceTerminalPort;
  clock: () => string;
  idGenerator: () => string;
  emitAsyncEvent: (event: ThreadRuntimeAsyncEvent) => void;
  // Setup surface completion with retry_preflight triggers pending-input replay.
  // Injected so this collaborator never calls back into the lifecycle facade.
  onProviderSetupReady: (
    thread: ThreadRecord,
    pane: TerminalPaneState,
  ) => Promise<void>;
}

// Owns the Workbench Terminal + Provider Setup Surface pane lifecycle:
// creating the panes, starting/stopping their PTY-backed processes, streaming
// output, and recording completion. Shared by the workbench-command and Tide MCP
// paths. Extracted from thread-runtime-service.ts behind one lifecycle callback
// (onProviderSetupReady). See docs_v2/specs/thread-runtime-service-decomposition.md.
export class WorkbenchRuntime {
  private readonly store: ThreadStore;
  private readonly workbenchTerminalPort?: WorkbenchTerminalPort;
  private readonly providerSetupSurfaceTerminalPort?: ProviderSetupSurfaceTerminalPort;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly emitAsyncEvent: (event: ThreadRuntimeAsyncEvent) => void;
  private readonly onProviderSetupReady: (
    thread: ThreadRecord,
    pane: TerminalPaneState,
  ) => Promise<void>;

  private readonly providerSetupSurfaceHandles = new Map<
    string,
    ProviderSetupSurfaceHandle
  >();
  private readonly workbenchTerminalHandles = new Map<
    string,
    WorkbenchTerminalHandle
  >();

  constructor(deps: WorkbenchRuntimeDeps) {
    this.store = deps.store;
    this.workbenchTerminalPort = deps.workbenchTerminalPort;
    this.providerSetupSurfaceTerminalPort = deps.providerSetupSurfaceTerminalPort;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator;
    this.emitAsyncEvent = deps.emitAsyncEvent;
    this.onProviderSetupReady = deps.onProviderSetupReady;
  }

  openProviderSetupSurface(
    thread: ThreadRecord,
    setup: ProviderSetupSurfaceActionInput,
  ): TerminalPaneState {
    const existing = thread.workbench.panes.find(
      (pane): pane is TerminalPaneState =>
        pane.kind === "terminal" &&
        pane.command === setup.command &&
        shallowRecordEqual(pane.env, setup.env) &&
        pane.cwd === setup.cwd,
    );
    if (existing !== undefined) {
      existing.terminalRole = "provider_setup";
      existing.status = "ready";
      existing.args = [...setup.args];
      existing.env = cloneEnv(setup.env);
      existing.expectedCompletion = setup.expectedCompletion;
      existing.revision = this.idGenerator();
      existing.updatedAt = this.clock();
      return existing;
    }

    const pane: TerminalPaneState = {
      paneId: this.idGenerator(),
      kind: "terminal",
      terminalRole: "provider_setup",
      title: `Provider setup: ${commandName(setup.command)}`,
      revision: this.idGenerator(),
      updatedAt: this.clock(),
      command: setup.command,
      args: [...setup.args],
      env: cloneEnv(setup.env),
      cwd: setup.cwd,
      status: "ready",
      expectedCompletion: setup.expectedCompletion,
    };
    thread.workbench.panes.push(pane);
    return pane;
  }

  openWorkbenchTerminal(
    thread: ThreadRecord,
    input: WorkbenchTerminalOpenInput,
  ): TerminalPaneState {
    const existing = thread.workbench.panes.find(
      (pane): pane is TerminalPaneState =>
        pane.kind === "terminal" &&
        pane.expectedCompletion === undefined &&
        pane.command === input.command &&
        pane.cwd === input.cwd,
    );
    if (existing !== undefined) {
      existing.terminalRole = "session";
      existing.title = "Terminal";
      existing.args = [...input.args];
      existing.env = cloneEnv(input.env);
      existing.status = this.workbenchTerminalHandles.has(existing.paneId)
        ? "running"
        : "ready";
      existing.revision = this.idGenerator();
      existing.updatedAt = this.clock();
      return existing;
    }

    const pane: TerminalPaneState = {
      paneId: this.idGenerator(),
      kind: "terminal",
      terminalRole: "session",
      title: "Terminal",
      revision: this.idGenerator(),
      updatedAt: this.clock(),
      command: input.command,
      args: [...input.args],
      env: cloneEnv(input.env),
      cwd: input.cwd,
      status: "ready",
    };
    thread.workbench.panes.push(pane);
    return pane;
  }

  async ensureProviderSetupSurfaceRunning(
    thread: ThreadRecord,
    pane: TerminalPaneState,
  ): Promise<void> {
    if (
      this.providerSetupSurfaceTerminalPort === undefined ||
      pane.command === undefined ||
      pane.cwd === undefined
    ) {
      return;
    }
    if (this.providerSetupSurfaceHandles.has(pane.paneId)) {
      pane.status = "running";
      return;
    }

    pane.status = "running";
    pane.transcriptPreview = setupLaunchPreview(pane.command, pane.args ?? [], pane.cwd);
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();

    try {
      const handle = await this.providerSetupSurfaceTerminalPort.start({
        threadId: thread.threadId,
        paneId: pane.paneId,
        command: pane.command,
        args: pane.args ?? [],
        env: cloneEnv(pane.env),
        cwd: pane.cwd,
        onOutput: (output) =>
          this.appendProviderSetupSurfaceOutput(thread.threadId, pane.paneId, output),
        onExit: (exit) =>
          this.completeProviderSetupSurface(thread.threadId, pane.paneId, exit),
      });
      this.providerSetupSurfaceHandles.set(pane.paneId, handle);
    } catch (error) {
      pane.status = "failed";
      pane.transcriptPreview = boundedTranscriptPreview(
        `${pane.transcriptPreview ?? ""}\n${errorMessage(error)}`,
      );
      pane.revision = this.idGenerator();
      pane.updatedAt = this.clock();
    }
  }

  async ensureWorkbenchTerminalRunning(
    thread: ThreadRecord,
    pane: TerminalPaneState,
  ): Promise<void> {
    if (
      this.workbenchTerminalPort === undefined ||
      pane.command === undefined ||
      pane.cwd === undefined
    ) {
      return;
    }
    if (this.workbenchTerminalHandles.has(pane.paneId)) {
      pane.status = "running";
      return;
    }

    pane.status = "running";
    // The PTY spawns the shell directly in `cwd`; don't seed a synthetic
    // `$ cd ...\n$ <shell>` banner — the live xterm should show only real output.
    pane.transcriptPreview = "";
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();

    try {
      const handle = await this.workbenchTerminalPort.start({
        threadId: thread.threadId,
        paneId: pane.paneId,
        command: pane.command,
        args: pane.args ?? [],
        env: cloneEnv(pane.env),
        cwd: pane.cwd,
        onOutput: (output) =>
          this.appendWorkbenchTerminalOutput(thread.threadId, pane.paneId, output),
        onExit: (exit) =>
          this.completeWorkbenchTerminal(thread.threadId, pane.paneId, exit),
      });
      this.workbenchTerminalHandles.set(pane.paneId, handle);
    } catch (error) {
      pane.status = "failed";
      pane.transcriptPreview = boundedTranscriptPreview(
        `${pane.transcriptPreview ?? ""}\n${errorMessage(error)}`,
      );
      pane.revision = this.idGenerator();
      pane.updatedAt = this.clock();
    }
  }

  private appendWorkbenchTerminalOutput(
    threadId: ThreadId,
    paneId: string,
    output: WorkbenchTerminalOutput,
  ): void {
    const thread = this.store.get(threadId);
    const pane = thread?.workbench.panes.find(
      (candidate): candidate is TerminalPaneState =>
        candidate.kind === "terminal" && candidate.paneId === paneId,
    );
    if (thread === undefined || pane === undefined) {
      return;
    }

    pane.transcriptPreview = boundedTranscriptPreview(
      `${pane.transcriptPreview ?? ""}${output.body}`,
    );
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    // Stream the delta chunk so a live terminal renderer can write it directly,
    // preserving escape sequences and cursor state (the bounded transcript
    // preview remains a fallback snapshot).
    this.emitAsyncEvent({
      kind: "workbench_terminal_output",
      threadId,
      paneId,
      source: output.source,
      chunk: output.body,
    });
    this.emitAsyncEvent({
      kind: "workbench_changed",
      thread: snapshotThread(thread),
    });
  }

  private async completeWorkbenchTerminal(
    threadId: ThreadId,
    paneId: string,
    exit: WorkbenchTerminalExit,
  ): Promise<void> {
    const thread = this.store.get(threadId);
    const pane = thread?.workbench.panes.find(
      (candidate): candidate is TerminalPaneState =>
        candidate.kind === "terminal" && candidate.paneId === paneId,
    );
    if (thread === undefined || pane === undefined) {
      return;
    }

    this.workbenchTerminalHandles.delete(paneId);
    pane.status = exit.exitCode === 0 ? "completed" : "failed";
    pane.transcriptPreview = boundedTranscriptPreview(
      `${pane.transcriptPreview ?? ""}\n[terminal exited ${exit.exitCode ?? exit.signal ?? "unknown"}]\n`,
    );
    pane.exitCode = exit.exitCode;
    pane.signal = exit.signal;
    pane.completedAt = this.clock();
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    thread.updatedAt = this.clock();
    this.emitAsyncEvent({
      kind: "workbench_changed",
      thread: snapshotThread(thread),
    });
  }

  private appendProviderSetupSurfaceOutput(
    threadId: ThreadId,
    paneId: string,
    output: ProviderSetupSurfaceOutput,
  ): void {
    const thread = this.store.get(threadId);
    const pane = thread?.workbench.panes.find(
      (candidate): candidate is TerminalPaneState =>
        candidate.kind === "terminal" && candidate.paneId === paneId,
    );
    if (thread === undefined || pane === undefined) {
      return;
    }

    pane.transcriptPreview = boundedTranscriptPreview(
      `${pane.transcriptPreview ?? ""}${output.body}`,
    );
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    this.emitAsyncEvent({
      kind: "workbench_changed",
      thread: snapshotThread(thread),
    });
  }

  private async completeProviderSetupSurface(
    threadId: ThreadId,
    paneId: string,
    exit: ProviderSetupSurfaceExit,
  ): Promise<void> {
    const thread = this.store.get(threadId);
    const pane = thread?.workbench.panes.find(
      (candidate): candidate is TerminalPaneState =>
        candidate.kind === "terminal" && candidate.paneId === paneId,
    );
    if (thread === undefined || pane === undefined) {
      return;
    }

    this.providerSetupSurfaceHandles.delete(paneId);
    pane.status = exit.exitCode === 0 ? "completed" : "failed";
    pane.transcriptPreview = boundedTranscriptPreview(
      `${pane.transcriptPreview ?? ""}\n[setup exited ${exit.exitCode ?? exit.signal ?? "unknown"}]\n`,
    );
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    thread.updatedAt = this.clock();
    this.emitAsyncEvent({
      kind: "workbench_changed",
      thread: snapshotThread(thread),
    });

    if (pane.expectedCompletion === "retry_preflight") {
      await this.onProviderSetupReady(thread, pane);
    }
  }

  // Handle accessors for the workbench-command path (terminal input / resize),
  // which interleaves handle use with pane-status checks the caller owns.
  setupSurfaceHandle(paneId: string): ProviderSetupSurfaceHandle | undefined {
    return this.providerSetupSurfaceHandles.get(paneId);
  }

  terminalHandle(paneId: string): WorkbenchTerminalHandle | undefined {
    return this.workbenchTerminalHandles.get(paneId);
  }

  async stopTerminalPane(
    pane: BrowserPaneState | TerminalPaneState,
  ): Promise<void> {
    if (pane.kind !== "terminal") {
      return;
    }

    const setupHandle = this.providerSetupSurfaceHandles.get(pane.paneId);
    if (setupHandle !== undefined) {
      await setupHandle.stop();
      this.providerSetupSurfaceHandles.delete(pane.paneId);
    }
    const terminalHandle = this.workbenchTerminalHandles.get(pane.paneId);
    if (terminalHandle !== undefined) {
      await terminalHandle.stop();
      this.workbenchTerminalHandles.delete(pane.paneId);
    }
  }
}
