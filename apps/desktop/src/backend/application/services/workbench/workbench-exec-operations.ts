import type { ThreadRecord } from "../../domains/thread/thread.ts";
import type {
  TerminalPaneState,
  WorkbenchLayoutMode,
  WorkbenchPaneSnapshotRef,
} from "../../domains/workbench/workbench.ts";
import type { WorkspaceCodeIntelligencePort } from "../../ports/outbound/workspace-code-intelligence-port.ts";
import type {
  WorkspaceCommandPort,
  WorkspaceCommandRun,
} from "../../ports/outbound/workspace-command-port.ts";
import { arrayOfStrings } from "../support/record-helpers.ts";
import { failure, type ServiceResult } from "../support/service-result.ts";
import {
  boundedTranscriptPreview,
  commandByteLimit,
  commandName,
  commandTimeoutMs,
  optionalString,
} from "../support/service-value-helpers.ts";
import { threadRoot } from "../thread/thread-snapshot.ts";
import type {
  TideClosePaneOutput,
  TideFocusPaneOutput,
  TideGoToDefinitionOutput,
  TideGoToReferencesOutput,
  TideOpenTerminalOutput,
  TideRunTerminalCommandOutput,
  TideSetWorkbenchLayoutOutput,
} from "../tide-mcp/tide-mcp-output.ts";
import { editorPanePositionFromData, workbenchLayoutModeFromValue } from "./workbench-command-data.ts";
import type { WorkbenchFileOperations } from "./workbench-file-operations.ts";
import type { WorkbenchRuntime } from "./workbench-runtime.ts";
import {
  closeWorkbenchPaneState,
  editorPaneRef,
  focusWorkbenchPaneState,
  setWorkbenchLayoutModeState,
  snapshotWorkbench,
  terminalPaneRef,
  workbenchPaneById,
} from "./workbench-snapshot.ts";

// Code-navigation (go-to-definition / references) and terminal (run command /
// open Terminal Pane) operations for the Workbench. Depends on the code
// intelligence + command ports, and collaborates with WorkbenchRuntime (live
// terminals) and WorkbenchFileOperations (open the definition's file). Shared by
// the workbench-command and Tide MCP paths. Extracted from thread-runtime-service.ts.
export interface WorkbenchExecOperationsDeps {
  workspaceCommandPort: WorkspaceCommandPort;
  workspaceCodeIntelligencePort: WorkspaceCodeIntelligencePort;
  workbenchRuntime: WorkbenchRuntime;
  workbenchFileOps: WorkbenchFileOperations;
  defaultWorkbenchTerminalCommand: string;
  clock: () => string;
  idGenerator: () => string;
}

export class WorkbenchExecOperations {
  private readonly workspaceCommandPort: WorkspaceCommandPort;
  private readonly workspaceCodeIntelligencePort: WorkspaceCodeIntelligencePort;
  private readonly workbenchRuntime: WorkbenchRuntime;
  private readonly workbenchFileOps: WorkbenchFileOperations;
  private readonly defaultWorkbenchTerminalCommand: string;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;

  constructor(deps: WorkbenchExecOperationsDeps) {
    this.workspaceCommandPort = deps.workspaceCommandPort;
    this.workspaceCodeIntelligencePort = deps.workspaceCodeIntelligencePort;
    this.workbenchRuntime = deps.workbenchRuntime;
    this.workbenchFileOps = deps.workbenchFileOps;
    this.defaultWorkbenchTerminalCommand = deps.defaultWorkbenchTerminalCommand;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator;
  }

  // tide_focus_pane: reveal + activate a pane the agent already opened, so the
  // user is looking at the right pane when the agent narrates it.
  focusPaneOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): ServiceResult<{ value: TideFocusPaneOutput }> {
    const paneId = optionalString(input?.paneId);
    if (paneId === undefined) {
      return failure("invalid_workbench_command", "tide_focus_pane requires paneId.");
    }
    const pane = focusWorkbenchPaneState(thread.workbench, paneId, this.clock);
    if (pane === undefined) {
      return failure("workbench_target_not_found", "Workbench Pane target was not found.");
    }
    thread.updatedAt = this.clock();
    return {
      ok: true,
      value: {
        kind: "focus_pane",
        threadId: thread.threadId,
        paneId: pane.paneId,
        ...snapshotWorkbench(thread.workbench),
      },
    };
  }

  // tide_close_pane: remove a pane (and stop its PTY when it's a Terminal Pane).
  async closePaneOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideClosePaneOutput }>> {
    const paneId = optionalString(input?.paneId);
    if (paneId === undefined) {
      return failure("invalid_workbench_command", "tide_close_pane requires paneId.");
    }
    const target = workbenchPaneById(thread.workbench, paneId);
    if (target === undefined) {
      return failure("workbench_target_not_found", "Workbench Pane target was not found.");
    }
    if (target.kind === "terminal") {
      await this.workbenchRuntime.stopTerminalPane(target);
    }
    closeWorkbenchPaneState(thread.workbench, paneId, this.clock);
    thread.updatedAt = this.clock();
    return {
      ok: true,
      value: {
        kind: "close_pane",
        threadId: thread.threadId,
        paneId,
        closed: true,
        ...snapshotWorkbench(thread.workbench),
      },
    };
  }

  // tide_set_workbench_layout: switch the Workbench between Stacked and Split.
  setWorkbenchLayoutOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): ServiceResult<{ value: TideSetWorkbenchLayoutOutput }> {
    const mode = workbenchLayoutModeFromValue(input?.mode);
    if (mode === undefined) {
      return failure(
        "invalid_workbench_command",
        "tide_set_workbench_layout requires mode 'stacked' or 'split'.",
      );
    }
    setWorkbenchLayoutModeState(thread.workbench, mode);
    thread.workbench.focusOwner = "workbench";
    thread.updatedAt = this.clock();
    return {
      ok: true,
      value: {
        kind: "set_workbench_layout",
        threadId: thread.threadId,
        ...snapshotWorkbench(thread.workbench),
      },
    };
  }

  async goToDefinitionOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideGoToDefinitionOutput }>> {
    const paneId = optionalString(input?.paneId);
    const position = editorPanePositionFromData(input);
    if (paneId === undefined || position === undefined) {
      return failure(
        "invalid_workbench_command",
        "Go to definition requires paneId, line, and character.",
      );
    }
    const sourcePane = workbenchPaneById(thread.workbench, paneId);
    if (sourcePane === undefined || sourcePane.kind !== "editor") {
      return failure("workbench_target_not_found", "Editor Pane target was not found.");
    }
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_code_intelligence_unavailable",
        "Thread does not have an Execution Context root for code navigation.",
      );
    }

    const definition = await this.workspaceCodeIntelligencePort.findDefinition({
      root,
      path: sourcePane.filePath,
      line: position.line,
      character: position.character,
    });
    if (!definition.ok) {
      return failure(definition.error.code, definition.error.message);
    }

    const opened = await this.workbenchFileOps.openFileOutput(thread, {
      path: definition.location.relativePath,
    });
    if (!opened.ok) {
      return opened;
    }
    const targetPane = workbenchPaneById(thread.workbench, opened.value.pane.paneId);
    if (targetPane === undefined || targetPane.kind !== "editor") {
      return failure(
        "workbench_target_not_found",
        "Definition target Editor Pane was not found.",
      );
    }

    targetPane.navigationTarget = {
      line: definition.location.line,
      character: definition.location.character,
      length: definition.location.length,
      label: definition.location.label,
      sourcePaneId: sourcePane.paneId,
    };
    thread.workbench.activePaneId = targetPane.paneId;
    thread.updatedAt = this.clock();

    return {
      ok: true,
      value: {
        kind: "go_to_definition",
        threadId: thread.threadId,
        pane: editorPaneRef(targetPane) as WorkbenchPaneSnapshotRef & { kind: "editor" },
        sourcePaneId: sourcePane.paneId,
        target: {
          line: definition.location.line,
          character: definition.location.character,
          length: definition.location.length,
          label: definition.location.label,
        },
      },
    };
  }

  async goToReferencesOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideGoToReferencesOutput }>> {
    const paneId = optionalString(input?.paneId);
    const position = editorPanePositionFromData(input);
    if (paneId === undefined || position === undefined) {
      return failure(
        "invalid_workbench_command",
        "Go to references requires paneId, line, and character.",
      );
    }
    const sourcePane = workbenchPaneById(thread.workbench, paneId);
    if (sourcePane === undefined || sourcePane.kind !== "editor") {
      return failure("workbench_target_not_found", "Editor Pane target was not found.");
    }
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_code_intelligence_unavailable",
        "Thread does not have an Execution Context root for code navigation.",
      );
    }

    const references = await this.workspaceCodeIntelligencePort.findReferences({
      root,
      path: sourcePane.filePath,
      line: position.line,
      character: position.character,
    });
    if (!references.ok) {
      return failure(references.error.code, references.error.message);
    }

    const items = references.locations.map((location) => ({
      relativePath: location.relativePath,
      line: location.line,
      character: location.character,
      length: location.length,
      label: location.label,
    }));
    sourcePane.references = {
      query: sourcePane.relativePath,
      truncated: references.truncated,
      items,
    };
    sourcePane.revision = this.idGenerator();
    sourcePane.updatedAt = this.clock();
    thread.workbench.activePaneId = sourcePane.paneId;
    thread.updatedAt = this.clock();

    return {
      ok: true,
      value: {
        kind: "go_to_references",
        threadId: thread.threadId,
        pane: editorPaneRef(sourcePane) as WorkbenchPaneSnapshotRef & { kind: "editor" },
        sourcePaneId: sourcePane.paneId,
        references: items,
        truncated: references.truncated,
      },
    };
  }

  async runTerminalCommandOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideRunTerminalCommandOutput }>> {
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_command_unavailable",
        "Thread does not have an Execution Context root for command tools.",
      );
    }

    const command = optionalString(input?.command);
    if (command === undefined) {
      return failure("workspace_command_invalid", "Command is required.");
    }
    const args = arrayOfStrings(input?.args);
    const resolvedCwd = await this.workspaceCommandPort.resolveCwd({
      root,
      cwd: optionalString(input?.cwd),
    });
    if (!resolvedCwd.ok) {
      return failure(resolvedCwd.error.code, resolvedCwd.error.message);
    }

    const startedAt = this.clock();
    const result = await this.workspaceCommandPort.run({
      command,
      args,
      cwd: resolvedCwd.cwd.cwd,
      timeoutMs: commandTimeoutMs(input?.timeoutMs),
      byteLimit: commandByteLimit(input?.byteLimit),
      startedAt,
    });
    if (!result.ok) {
      return failure(result.error.code, result.error.message);
    }

    const run = result.run;
    const status = commandRunStatus(run);
    const pane: TerminalPaneState = {
      paneId: this.idGenerator(),
      kind: "terminal",
      title: `Command: ${commandName(run.command)}`,
      revision: this.idGenerator(),
      updatedAt: run.completedAt,
      command: run.command,
      args: [...run.args],
      cwd: run.cwd,
      status,
      transcriptPreview: boundedTranscriptPreview(run.transcript),
      exitCode: run.exitCode,
      signal: run.signal,
      timedOut: run.timedOut,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };
    thread.workbench.panes.push(pane);
    thread.workbench.activePaneId = pane.paneId;
    thread.workbench.focusOwner = "composer";
    thread.updatedAt = run.completedAt;

    return {
      ok: true,
      value: {
        kind: "run_terminal_command",
        threadId: thread.threadId,
        pane: terminalPaneRef(pane) as WorkbenchPaneSnapshotRef & { kind: "terminal" },
        command: run.command,
        args: [...run.args],
        cwd: run.cwd,
        status,
        exitCode: run.exitCode,
        signal: run.signal,
        stdout: run.stdout,
        stderr: run.stderr,
        transcript: run.transcript,
        truncated: run.truncated,
        timedOut: run.timedOut,
      },
    };
  }

  async openTerminalOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideOpenTerminalOutput }>> {
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_command_unavailable",
        "Thread does not have an Execution Context root for Terminal Pane.",
      );
    }

    const resolvedCwd = await this.workspaceCommandPort.resolveCwd({
      root,
      cwd: optionalString(input?.cwd),
    });
    if (!resolvedCwd.ok) {
      return failure(resolvedCwd.error.code, resolvedCwd.error.message);
    }

    const command = optionalString(input?.command) ?? this.defaultWorkbenchTerminalCommand;
    const args = arrayOfStrings(input?.args);
    const existingPane = thread.workbench.panes.find(
      (pane): pane is TerminalPaneState =>
        pane.kind === "terminal" &&
        pane.expectedCompletion === undefined &&
        pane.command === command &&
        pane.cwd === resolvedCwd.cwd.cwd,
    );
    const pane = this.workbenchRuntime.openWorkbenchTerminal(thread, {
      command,
      args,
      cwd: resolvedCwd.cwd.cwd,
    });
    await this.workbenchRuntime.ensureWorkbenchTerminalRunning(thread, pane);
    thread.workbench.activePaneId = pane.paneId;
    thread.workbench.focusOwner = "composer";
    thread.updatedAt = this.clock();

    return {
      ok: true,
      value: {
        kind: "open_terminal",
        threadId: thread.threadId,
        pane: terminalPaneRef(pane) as WorkbenchPaneSnapshotRef & { kind: "terminal" },
        command,
        args,
        cwd: resolvedCwd.cwd.cwd,
        visibleSideEffect: existingPane === undefined ? "created" : "revealed",
      },
    };
  }
}

function commandRunStatus(run: WorkspaceCommandRun): "completed" | "failed" {
  if (run.exitCode === 0 && run.signal === null && !run.timedOut) {
    return "completed";
  }
  return "failed";
}
