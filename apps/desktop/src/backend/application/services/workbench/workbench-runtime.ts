import type { ThreadId, ThreadRecord } from "../../domains/thread/thread.ts";
import type {
  BrowserPaneState,
  TerminalPaneState,
} from "../../domains/workbench/workbench.ts";
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
  terminalLaunchPreview,
} from "../support/service-value-helpers.ts";
import { snapshotThread } from "../thread/thread-snapshot.ts";
import type { ThreadRuntimeAsyncEvent } from "../thread/thread-runtime-events.ts";
import type { ThreadStore } from "../thread/thread-store.ts";

export interface WorkbenchTerminalOpenInput {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  title?: string;
  terminalRole?: TerminalPaneState["terminalRole"];
  expectedCompletion?: TerminalPaneState["expectedCompletion"];
}

export interface WorkbenchTerminalCommandRunInput {
  thread: ThreadRecord;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  byteLimit: number;
  startedAt: string;
}

export interface WorkbenchTerminalCommandRun {
  pane: TerminalPaneState;
  command: string;
  args: string[];
  cwd: string;
  status: "completed" | "failed";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  transcript: string;
  truncated: boolean;
  timedOut: boolean;
}

export interface WorkbenchRuntimeDeps {
  store: ThreadStore;
  workbenchTerminalPort?: WorkbenchTerminalPort;
  clock: () => string;
  idGenerator: () => string;
  emitAsyncEvent: (event: ThreadRuntimeAsyncEvent) => void;
  // Provider readiness terminal completion with retry_preflight triggers
  // pending-input replay.
  // Injected so this collaborator never calls back into the lifecycle facade.
  onProviderReadinessTerminalComplete: (
    thread: ThreadRecord,
    pane: TerminalPaneState,
  ) => Promise<void>;
}

// Owns visible Workbench Terminal pane lifecycle:
// creating the panes, starting/stopping their PTY-backed processes, streaming
// output, and recording completion. Shared by the workbench-command and Tide MCP
// paths. Extracted from thread-runtime-service.ts behind one lifecycle callback
// for readiness retry. See docs_v2/specs/thread-runtime-service-decomposition.md.
export class WorkbenchRuntime {
  private readonly store: ThreadStore;
  private readonly workbenchTerminalPort?: WorkbenchTerminalPort;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly emitAsyncEvent: (event: ThreadRuntimeAsyncEvent) => void;
  private readonly onProviderReadinessTerminalComplete: (
    thread: ThreadRecord,
    pane: TerminalPaneState,
  ) => Promise<void>;

  private readonly workbenchTerminalHandles = new Map<
    string,
    WorkbenchTerminalHandle
  >();

  constructor(deps: WorkbenchRuntimeDeps) {
    this.store = deps.store;
    this.workbenchTerminalPort = deps.workbenchTerminalPort;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator;
    this.emitAsyncEvent = deps.emitAsyncEvent;
    this.onProviderReadinessTerminalComplete = deps.onProviderReadinessTerminalComplete;
  }

  openWorkbenchTerminal(
    thread: ThreadRecord,
    input: WorkbenchTerminalOpenInput,
  ): TerminalPaneState {
    const terminalRole = input.terminalRole ?? "session";
    const title = input.title ?? defaultTerminalTitle(terminalRole, input.command);
    const existing =
      terminalRole === "session" || terminalRole === "provider_readiness"
        ? undefined
        : thread.workbench.panes.find(
            (pane): pane is TerminalPaneState =>
              pane.kind === "terminal" &&
              terminalPaneStoredRole(pane) === terminalRole &&
              pane.command === input.command &&
              shallowRecordEqual(pane.env ?? {}, input.env ?? {}) &&
              pane.cwd === input.cwd,
          );
    if (existing !== undefined) {
      existing.terminalRole = terminalRole;
      existing.title = title;
      existing.args = [...input.args];
      existing.env = cloneEnv(input.env);
      existing.expectedCompletion = input.expectedCompletion;
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
      terminalRole,
      title,
      revision: this.idGenerator(),
      updatedAt: this.clock(),
      command: input.command,
      args: [...input.args],
      env: cloneEnv(input.env),
      cwd: input.cwd,
      status: "ready",
      expectedCompletion: input.expectedCompletion,
    };
    thread.workbench.panes.push(pane);
    return pane;
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
    pane.transcriptPreview =
      terminalPaneStoredRole(pane) === "provider_readiness"
        ? pane.transcriptPreview ?? terminalLaunchPreview(pane.command, pane.args ?? [], pane.cwd)
        : "";
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
      this.retainRunningTerminalHandle(pane, handle);
    } catch (error) {
      pane.status = "failed";
      pane.transcriptPreview = boundedTranscriptPreview(
        `${pane.transcriptPreview ?? ""}\n${errorMessage(error)}`,
      );
      pane.revision = this.idGenerator();
      pane.updatedAt = this.clock();
      this.emitAsyncEvent({
        kind: "workbench_changed",
        thread: snapshotThread(thread),
      });
    }
  }

  async runTerminalCommand(
    input: WorkbenchTerminalCommandRunInput,
  ): Promise<WorkbenchTerminalCommandRun> {
    const pane: TerminalPaneState = {
      paneId: this.idGenerator(),
      kind: "terminal",
      terminalRole: "command_result",
      title: `Command: ${commandName(input.command)}`,
      revision: this.idGenerator(),
      updatedAt: input.startedAt,
      command: input.command,
      args: [...input.args],
      cwd: input.cwd,
      status: "running",
      transcriptPreview: commandTranscriptPrefix(input),
      startedAt: input.startedAt,
    };
    input.thread.workbench.panes.push(pane);
    input.thread.workbench.activePaneId = pane.paneId;
    input.thread.workbench.focusOwner = "composer";
    input.thread.updatedAt = input.startedAt;
    this.emitAsyncEvent({
      kind: "workbench_changed",
      thread: snapshotThread(input.thread),
    });

    let stdout = "";
    let stderr = "";
    let transcript = commandTranscriptPrefix(input);
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let handle: WorkbenchTerminalHandle | undefined;

    const appendOutput = (output: WorkbenchTerminalOutput): void => {
      if (output.source === "stdout") {
        const next = appendBounded(stdout, output.body, input.byteLimit);
        stdout = next.value;
        truncated ||= next.truncated;
      } else {
        const next = appendBounded(stderr, output.body, input.byteLimit);
        stderr = next.value;
        truncated ||= next.truncated;
      }
      const nextTranscript = appendBounded(transcript, output.body, input.byteLimit);
      transcript = nextTranscript.value;
      truncated ||= nextTranscript.truncated;
      this.appendWorkbenchTerminalOutput(
        input.thread.threadId,
        pane.paneId,
        output,
      );
    };

    const complete = (exit: WorkbenchTerminalExit): WorkbenchTerminalCommandRun => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      settled = true;
      this.workbenchTerminalHandles.delete(pane.paneId);
      const completedAt = this.clock();
      const exitText = `[exit ${exit.exitCode ?? exit.signal ?? "unknown"}]\n`;
      const finalTranscript = appendBounded(transcript, exitText, input.byteLimit);
      transcript = finalTranscript.value;
      truncated ||= finalTranscript.truncated;
      const status = commandResultStatus(exit, timedOut);

      pane.status = status;
      pane.transcriptPreview = boundedTranscriptPreview(
        `${pane.transcriptPreview ?? ""}${exitText}`,
      );
      pane.exitCode = exit.exitCode;
      pane.signal = exit.signal;
      pane.timedOut = timedOut;
      pane.completedAt = completedAt;
      pane.revision = this.idGenerator();
      pane.updatedAt = completedAt;
      input.thread.updatedAt = completedAt;
      this.emitAsyncEvent({
        kind: "workbench_changed",
        thread: snapshotThread(input.thread),
      });

      return {
        pane,
        command: input.command,
        args: [...input.args],
        cwd: input.cwd,
        status,
        exitCode: exit.exitCode,
        signal: exit.signal,
        stdout,
        stderr,
        transcript,
        truncated,
        timedOut,
      };
    };

    try {
      const result = await new Promise<WorkbenchTerminalCommandRun>((resolve) => {
        const finish = (exit: WorkbenchTerminalExit): void => {
          if (!settled) {
            resolve(complete(exit));
          }
        };
        void (async () => {
          try {
            handle = await this.workbenchTerminalPort?.start({
              threadId: input.thread.threadId,
              paneId: pane.paneId,
              command: input.command,
              args: input.args,
              cwd: input.cwd,
              onOutput: appendOutput,
              onExit: finish,
            });
            if (handle === undefined) {
              finish({ exitCode: null, signal: "unavailable" });
              return;
            }
            if (pane.status !== "running") {
              this.stopDetachedTerminalHandle(handle);
              return;
            }
            this.workbenchTerminalHandles.set(pane.paneId, handle);
            timeout = setTimeout(() => {
              timedOut = true;
              void Promise.resolve(handle?.stop()).finally(() => {
                finish({ exitCode: null, signal: "SIGTERM" });
              });
            }, input.timeoutMs);
          } catch (error) {
            appendOutput({
              source: "stderr",
              body: `${errorMessage(error)}\n`,
            });
            finish({ exitCode: null, signal: null });
          }
        })();
      });
      return result;
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private retainRunningTerminalHandle(
    pane: TerminalPaneState,
    handle: WorkbenchTerminalHandle,
  ): void {
    if (pane.status === "running") {
      this.workbenchTerminalHandles.set(pane.paneId, handle);
      return;
    }
    this.stopDetachedTerminalHandle(handle);
  }

  private stopDetachedTerminalHandle(handle: WorkbenchTerminalHandle): void {
    void Promise.resolve(handle.stop()).catch(() => {});
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
    const exitLabel =
      terminalPaneStoredRole(pane) === "provider_readiness" ? "readiness terminal" : "terminal";
    pane.transcriptPreview = boundedTranscriptPreview(
      `${pane.transcriptPreview ?? ""}\n[${exitLabel} exited ${exit.exitCode ?? exit.signal ?? "unknown"}]\n`,
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

    if (
      terminalPaneStoredRole(pane) === "provider_readiness" &&
      pane.expectedCompletion === "retry_preflight"
    ) {
      await this.onProviderReadinessTerminalComplete(thread, pane);
    }
  }

  // Handle accessors for the workbench-command path (terminal input / resize),
  // which interleaves handle use with pane-status checks the caller owns.
  terminalHandle(paneId: string): WorkbenchTerminalHandle | undefined {
    return this.workbenchTerminalHandles.get(paneId);
  }

  async stopTerminalPane(
    pane: BrowserPaneState | TerminalPaneState,
  ): Promise<void> {
    if (pane.kind !== "terminal") {
      return;
    }

    const terminalHandle = this.workbenchTerminalHandles.get(pane.paneId);
    if (terminalHandle !== undefined) {
      this.workbenchTerminalHandles.delete(pane.paneId);
      try {
        await terminalHandle.stop();
      } catch {
        // Pane close is UI-first; a process that already exited should not keep a
        // removed pane alive or reject the close command.
      }
    }
  }
}

function defaultTerminalTitle(
  role: NonNullable<TerminalPaneState["terminalRole"]>,
  command: string,
): string {
  if (role === "provider_readiness") {
    return `Provider readiness: ${commandName(command)}`;
  }
  if (role === "command_result") {
    return `Command: ${commandName(command)}`;
  }
  return "Terminal";
}

function terminalPaneStoredRole(
  pane: TerminalPaneState,
): NonNullable<TerminalPaneState["terminalRole"]> {
  if (pane.terminalRole !== undefined) {
    return pane.terminalRole;
  }
  return pane.expectedCompletion === undefined ? "session" : "provider_readiness";
}

function commandResultStatus(
  exit: WorkbenchTerminalExit,
  timedOut: boolean,
): "completed" | "failed" {
  if (exit.exitCode === 0 && exit.signal === null && !timedOut) {
    return "completed";
  }
  return "failed";
}

function commandTranscriptPrefix(input: {
  command: string;
  args: string[];
  cwd: string;
}): string {
  return `$ cd ${input.cwd}\n$ ${[input.command, ...input.args].join(" ")}\n`;
}

function appendBounded(
  current: string,
  chunk: string,
  byteLimit: number,
): { value: string; truncated: boolean } {
  const next = `${current}${chunk}`;
  if (next.length <= byteLimit) {
    return { value: next, truncated: false };
  }
  return {
    value: next.slice(0, byteLimit),
    truncated: true,
  };
}
