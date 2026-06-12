import type {
  ThreadId,
  ThreadSnapshot,
} from "../../domains/thread/thread.ts";
import type {
  WorkbenchFileTreeView,
  WorkbenchSnapshot,
} from "../../domains/workbench/workbench.ts";
import type {
  WorkspaceCodeCompletionItem,
  WorkspaceCodeDiagnostic,
  WorkspaceCodeHover,
  WorkspaceCodeIntelligencePort,
  WorkspaceCodeRange,
  WorkspaceCodeSignatureHelp,
} from "../../ports/outbound/workspace-code-intelligence-port.ts";
import type { WorkspaceCommandPort } from "../../ports/outbound/workspace-command-port.ts";
import type { WorkspaceFilePort } from "../../ports/outbound/workspace-file-port.ts";
import { arrayOfStrings } from "../support/record-helpers.ts";
import { failure, type ServiceResult } from "../support/service-result.ts";
import {
  fileByteLimit,
  fileTreeMaxDepth,
  fileTreeMaxEntries,
  numberFromData,
  optionalString,
} from "../support/service-value-helpers.ts";
import { cloneFileTreeView } from "../thread/thread-runtime-clone.ts";
import { snapshotThread, threadRoot } from "../thread/thread-snapshot.ts";
import type { ThreadStore } from "../thread/thread-store.ts";
import { openBrowserOutput } from "./workbench-browser-operations.ts";
import {
  browserPaneActionResultFromData,
  browserPaneSnapshotFromData,
  editorPanePositionFromData,
  editorPaneSaveFromData,
  providerSetupSurfaceActionFromData,
  providerSetupSurfaceInputFromData,
} from "./workbench-command-data.ts";
import type { WorkbenchFileOperations } from "./workbench-file-operations.ts";
import { openWorkbenchLauncher } from "./workbench-launcher.ts";
import type { WorkbenchRuntime } from "./workbench-runtime.ts";
import {
  firstVisiblePane,
  snapshotWorkbench,
  workbenchPaneById,
} from "./workbench-snapshot.ts";

export interface WorkbenchCommandInput {
  threadId: ThreadId;
  command: string;
  targetPaneId?: string;
  data?: Record<string, unknown>;
}

export interface WorkbenchCommandResult {
  handled: true;
  thread: ThreadSnapshot;
  workbench: WorkbenchSnapshot;
}

export interface ReadWorkspaceFileTreeInput {
  cwd: string;
  maxDepth?: number;
  maxEntries?: number;
}

export interface ReadWorkspaceFileTreeResult {
  cwd: string;
  fileTree: WorkbenchFileTreeView;
}

export interface SearchWorkspaceContentInput {
  cwd: string;
  query: string;
  maxResults?: number;
  maxFiles?: number;
}

export interface WorkspaceContentSearchMatch {
  relativePath: string;
  line: number;
  column: number;
  lineText: string;
}

export interface SearchWorkspaceContentResult {
  cwd: string;
  query: string;
  matches: WorkspaceContentSearchMatch[];
  fileCount: number;
  truncated: boolean;
}

export type QueryWorkspaceCodeIntelKind =
  | "completion"
  | "hover"
  | "highlights"
  | "signature"
  | "diagnostics";

export interface QueryWorkspaceCodeIntelInput {
  cwd: string;
  path: string;
  kind: QueryWorkspaceCodeIntelKind;
  content?: string;
  line?: number;
  character?: number;
}

// Engine misses (no language support for the file, no server on PATH) are a
// NORMAL answer (`available: false` + message), not a ServiceResult failure —
// the editor quietly shows nothing instead of surfacing contract errors per
// query. (`available` avoids colliding with ServiceResult's own `ok`.)
export interface QueryWorkspaceCodeIntelResult {
  kind: QueryWorkspaceCodeIntelKind;
  available: boolean;
  message?: string;
  completions?: WorkspaceCodeCompletionItem[];
  hover?: WorkspaceCodeHover | null;
  highlights?: WorkspaceCodeRange[];
  signature?: WorkspaceCodeSignatureHelp | null;
  diagnostics?: WorkspaceCodeDiagnostic[];
}

export interface WorkbenchCommandHandlerDeps {
  threads: ThreadStore;
  clock: () => string;
  idGenerator: () => string;
  defaultWorkbenchTerminalCommand: string;
  workbenchRuntime: WorkbenchRuntime;
  workbenchFileOps: WorkbenchFileOperations;
  workspaceFilePort: WorkspaceFilePort;
  workspaceCommandPort: WorkspaceCommandPort;
  workspaceCodeIntelligencePort: WorkspaceCodeIntelligencePort;
}

// Dispatches visible Workbench commands (open/close panes, terminal input/resize,
// editor save, navigation, file-tree refresh) to the pane operation collaborators
// and WorkbenchRuntime. Field names mirror the former service so the command
// bodies are unchanged. Extracted from thread-runtime-service.ts.
export class WorkbenchCommandHandler {
  private readonly threads: ThreadStore;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly defaultWorkbenchTerminalCommand: string;
  private readonly workbenchRuntime: WorkbenchRuntime;
  private readonly workbenchFileOps: WorkbenchFileOperations;
  private readonly workspaceFilePort: WorkspaceFilePort;
  private readonly workspaceCommandPort: WorkspaceCommandPort;
  private readonly workspaceCodeIntelligencePort: WorkspaceCodeIntelligencePort;

  constructor(deps: WorkbenchCommandHandlerDeps) {
    this.threads = deps.threads;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator;
    this.defaultWorkbenchTerminalCommand = deps.defaultWorkbenchTerminalCommand;
    this.workbenchRuntime = deps.workbenchRuntime;
    this.workbenchFileOps = deps.workbenchFileOps;
    this.workspaceFilePort = deps.workspaceFilePort;
    this.workspaceCommandPort = deps.workspaceCommandPort;
    this.workspaceCodeIntelligencePort = deps.workspaceCodeIntelligencePort;
  }

  async handleWorkbenchCommand(
    input: WorkbenchCommandInput,
  ): Promise<ServiceResult<WorkbenchCommandResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    switch (input.command) {
      case "open_launcher": {
        const pane = openWorkbenchLauncher(thread, this.idGenerator, this.clock);
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "open_browser": {
        // Don't consume the launcher: it stays as its own pane so the user can
        // fan out (launcher → browser → editor → terminal) with all panes
        // coexisting as tabs/splits.
        const opened = openBrowserOutput(thread, input.data, this.idGenerator, this.clock);
        const pane = workbenchPaneById(thread.workbench, opened.pane.paneId);
        if (pane !== undefined) {
          pane.visible = true;
          thread.workbench.activePaneId = pane.paneId;
        }
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "update_browser_snapshot": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "browser") {
          return failure(
            "workbench_target_not_found",
            "Browser Pane target was not found.",
          );
        }
        const snapshot = browserPaneSnapshotFromData(input.data);
        if (snapshot === undefined) {
          return failure(
            "invalid_workbench_command",
            "Browser Pane snapshot requires revision.",
          );
        }
        if (snapshot.revision !== pane.revision) {
          return failure(
            "workbench_stale_reference",
            "Browser Pane revision is stale.",
          );
        }

        pane.pageTitle = snapshot.pageTitle;
        if (snapshot.url !== undefined) {
          pane.url = snapshot.url;
        }
        pane.bodyTextPreview = snapshot.bodyTextPreview;
        pane.loading = snapshot.loading ?? false;
        pane.revision = this.idGenerator();
        pane.updatedAt = this.clock();
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "update_browser_action_result": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "browser") {
          return failure(
            "workbench_target_not_found",
            "Browser Pane target was not found.",
          );
        }
        const result = browserPaneActionResultFromData(input.data);
        if (result === undefined) {
          return failure(
            "invalid_workbench_command",
            "Browser Pane action result requires revision, action id, status, and message.",
          );
        }
        if (
          result.revision !== pane.revision ||
          pane.pendingAction?.actionId !== result.actionId
        ) {
          return failure(
            "workbench_stale_reference",
            "Browser Pane action result is stale.",
          );
        }

        const completedAt = this.clock();
        pane.lastAction = {
          ...pane.pendingAction,
          status: result.status,
          message: result.message,
          completedAt,
        };
        delete pane.pendingAction;
        if (result.pageTitle !== undefined) {
          pane.pageTitle = result.pageTitle;
        }
        if (result.url !== undefined) {
          pane.url = result.url;
        }
        if (result.bodyTextPreview !== undefined) {
          pane.bodyTextPreview = result.bodyTextPreview;
        }
        pane.loading = result.loading ?? false;
        pane.revision = this.idGenerator();
        pane.updatedAt = completedAt;
        thread.updatedAt = completedAt;
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "open_editor": {
        const opened = await this.workbenchFileOps.openFileOutput(thread, input.data);
        if (!opened.ok) {
          return failure(opened.error.code, opened.error.message);
        }
        const pane = workbenchPaneById(thread.workbench, opened.value.pane.paneId);
        if (pane !== undefined) {
          pane.visible = true;
          thread.workbench.activePaneId = pane.paneId;
        }
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "open_terminal": {
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_command_unavailable",
            "Thread does not have an Execution Context root for Terminal Pane.",
          );
        }
        const resolvedCwd = await this.workspaceCommandPort.resolveCwd({
          root,
          cwd: optionalString(input.data?.cwd),
        });
        if (!resolvedCwd.ok) {
          return failure(resolvedCwd.error.code, resolvedCwd.error.message);
        }
        const command = optionalString(input.data?.command) ?? this.defaultWorkbenchTerminalCommand;
        const args = arrayOfStrings(input.data?.args);
        const pane = this.workbenchRuntime.openWorkbenchTerminal(thread, {
          command,
          args,
          cwd: resolvedCwd.cwd.cwd,
        });
        await this.workbenchRuntime.ensureWorkbenchTerminalRunning(thread, pane);
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "open_provider_setup_surface": {
        const setup = providerSetupSurfaceActionFromData(input.data);
        if (setup === undefined) {
          return failure(
            "invalid_workbench_command",
            "Provider Setup Surface command requires setup data.",
          );
        }
        const pane = this.workbenchRuntime.openProviderSetupSurface(thread, setup);
        await this.workbenchRuntime.ensureProviderSetupSurfaceRunning(thread, pane);
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "write_terminal_input": {
        const bytes = providerSetupSurfaceInputFromData(input.data);
        if (bytes === undefined) {
          return failure(
            "invalid_workbench_command",
            "Terminal input command requires input bytes.",
          );
        }
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "terminal") {
          return failure(
            "workbench_target_not_found",
            "Terminal Pane target was not found.",
          );
        }
        const setupHandle = this.workbenchRuntime.setupSurfaceHandle(pane.paneId);
        if (setupHandle !== undefined && pane.status === "running") {
          await setupHandle.write(bytes);
          pane.updatedAt = this.clock();
          thread.workbench.activePaneId = pane.paneId;
          thread.workbench.focusOwner = "workbench";
          thread.updatedAt = this.clock();
          return {
            ok: true,
            handled: true,
            thread: snapshotThread(thread),
            workbench: snapshotWorkbench(thread.workbench),
          };
        }
        const terminalHandle = this.workbenchRuntime.terminalHandle(pane.paneId);
        if (terminalHandle === undefined || pane.status !== "running") {
          return failure(
            "agent_runtime_unavailable",
            "Terminal Pane is not running.",
          );
        }
        await terminalHandle.write(bytes);
        pane.updatedAt = this.clock();
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "resize_terminal": {
        const cols = numberFromData(input.data, "cols");
        const rows = numberFromData(input.data, "rows");
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "terminal") {
          return failure("workbench_target_not_found", "Terminal Pane target was not found.");
        }
        if (cols !== undefined && rows !== undefined) {
          this.workbenchRuntime.terminalHandle(pane.paneId)?.resize?.(cols, rows);
        }
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "focus_pane": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined) {
          return failure(
            "workbench_target_not_found",
            "Workbench Pane target was not found.",
          );
        }
        pane.visible = true;
        pane.updatedAt = this.clock();
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "close_pane": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined) {
          return failure(
            "workbench_target_not_found",
            "Workbench Pane target was not found.",
          );
        }
        if (pane.kind === "terminal") {
          await this.workbenchRuntime.stopTerminalPane(pane);
        }
        pane.visible = false;
        if (pane.kind === "terminal" && pane.status === "running") {
          pane.status = "completed";
        }
        pane.updatedAt = this.clock();
        if (thread.workbench.activePaneId === pane.paneId) {
          thread.workbench.activePaneId = firstVisiblePane(thread.workbench)?.paneId;
        }
        thread.workbench.focusOwner =
          thread.workbench.activePaneId === undefined ? "composer" : thread.workbench.focusOwner;
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "save_editor_file": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "editor") {
          return failure(
            "workbench_target_not_found",
            "Editor Pane target was not found.",
          );
        }
        const save = editorPaneSaveFromData(input.data);
        if (save === undefined) {
          return failure(
            "invalid_workbench_command",
            "Editor Pane save requires baseRevision and content.",
          );
        }
        if (save.baseRevision !== pane.revision) {
          return failure(
            "workbench_stale_reference",
            "Editor Pane revision is stale.",
          );
        }
        if (pane.truncated) {
          return failure(
            "workspace_file_edit_conflict",
            "Truncated Editor Panes are read-only.",
          );
        }
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_file_unavailable",
            "Thread does not have an Execution Context root for Editor Pane save.",
          );
        }
        const byteLimit = fileByteLimit(input.data?.byteLimit);
        if (save.content.length > byteLimit) {
          return failure(
            "workspace_file_too_large",
            "Editor Pane content exceeds the bounded save size.",
          );
        }
        const written = await this.workspaceFilePort.writeTextFile({
          root,
          path: pane.filePath,
          content: save.content,
          byteLimit,
        });
        if (!written.ok) {
          return failure(written.error.code, written.error.message);
        }
        this.workbenchFileOps.refreshEditorPaneAfterWrite(thread, pane, written.file);
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "go_to_definition": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "editor") {
          return failure(
            "workbench_target_not_found",
            "Editor Pane target was not found.",
          );
        }
        const position = editorPanePositionFromData(input.data);
        if (position === undefined) {
          return failure(
            "invalid_workbench_command",
            "Go to definition requires line and character.",
          );
        }
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_code_intelligence_unavailable",
            "Thread does not have an Execution Context root for code navigation.",
          );
        }
        // The live (possibly unsaved) buffer, so navigation matches the screen.
        const draftContent = optionalString(input.data?.content);
        const definition = await this.workspaceCodeIntelligencePort.findDefinition({
          root,
          path: pane.filePath,
          line: position.line,
          character: position.character,
          ...(draftContent === undefined ? {} : { content: draftContent }),
        });
        if (!definition.ok) {
          return failure(definition.error.code, definition.error.message);
        }
        const opened = await this.workbenchFileOps.openFileOutput(thread, {
          path: definition.location.relativePath,
        });
        if (!opened.ok) {
          return failure(opened.error.code, opened.error.message);
        }
        const targetPane = workbenchPaneById(thread.workbench, opened.value.pane.paneId);
        if (targetPane !== undefined && targetPane.kind === "editor") {
          targetPane.navigationTarget = {
            line: definition.location.line,
            character: definition.location.character,
            length: definition.location.length,
            label: definition.location.label,
            sourcePaneId: pane.paneId,
          };
          targetPane.visible = true;
          thread.workbench.activePaneId = targetPane.paneId;
        }
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "go_to_references": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "editor") {
          return failure(
            "workbench_target_not_found",
            "Editor Pane target was not found.",
          );
        }
        const position = editorPanePositionFromData(input.data);
        if (position === undefined) {
          return failure(
            "invalid_workbench_command",
            "Go to references requires line and character.",
          );
        }
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_code_intelligence_unavailable",
            "Thread does not have an Execution Context root for code navigation.",
          );
        }
        const draftContent = optionalString(input.data?.content);
        const references = await this.workspaceCodeIntelligencePort.findReferences({
          root,
          path: pane.filePath,
          line: position.line,
          character: position.character,
          ...(draftContent === undefined ? {} : { content: draftContent }),
        });
        if (!references.ok) {
          return failure(references.error.code, references.error.message);
        }
        pane.references = {
          query: pane.relativePath,
          truncated: references.truncated,
          items: references.locations.map((location) => ({
            relativePath: location.relativePath,
            line: location.line,
            character: location.character,
            length: location.length,
            label: location.label,
          })),
        };
        pane.visible = true;
        pane.revision = this.idGenerator();
        pane.updatedAt = this.clock();
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "refresh_file_tree": {
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_file_unavailable",
            "Thread does not have an Execution Context root for FileTree View.",
          );
        }
        // Full tree: load the whole source tree once (heavy dirs are skipped by
        // the workspace file port). Folders are collapsed by default in the UI,
        // so the DOM stays light even though every entry is loaded upfront.
        const listed = await this.workspaceFilePort.listTree({
          root,
          maxDepth: fileTreeMaxDepth(input.data?.maxDepth),
          maxEntries: fileTreeMaxEntries(input.data?.maxEntries),
        });
        if (!listed.ok) {
          return failure(listed.error.code, listed.error.message);
        }
        thread.workbench.fileTree = cloneFileTreeView(listed.fileTree);
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      default:
        return failure(
          "invalid_workbench_command",
          "Workbench command is not supported.",
        );
    }
  }

  async readWorkspaceFileTree(
    input: ReadWorkspaceFileTreeInput,
  ): Promise<ServiceResult<ReadWorkspaceFileTreeResult>> {
    // Thread-independent file tree read (the start page shows the composer-selected
    // project's files before any thread exists). Same workspace file port + limits
    // as refresh_file_tree, just keyed by an explicit cwd instead of a thread root.
    const listed = await this.workspaceFilePort.listTree({
      root: input.cwd,
      maxDepth: fileTreeMaxDepth(input.maxDepth),
      maxEntries: fileTreeMaxEntries(input.maxEntries),
    });
    if (!listed.ok) {
      return failure(listed.error.code, listed.error.message);
    }
    return {
      ok: true,
      cwd: input.cwd,
      fileTree: cloneFileTreeView(listed.fileTree),
    };
  }

  async queryWorkspaceCodeIntel(
    input: QueryWorkspaceCodeIntelInput,
  ): Promise<ServiceResult<QueryWorkspaceCodeIntelResult>> {
    const query = {
      root: input.cwd,
      path: input.path,
      line: input.line ?? 0,
      character: input.character ?? 0,
      content: input.content,
    };
    const miss = (message: string): ServiceResult<QueryWorkspaceCodeIntelResult> => ({
      ok: true,
      kind: input.kind,
      available: false,
      message,
    });
    switch (input.kind) {
      case "completion": {
        const result = await this.workspaceCodeIntelligencePort.getCompletions(query);
        return result.ok
          ? { ok: true, kind: input.kind, available: true, completions: result.completions }
          : miss(result.error.message);
      }
      case "hover": {
        const result = await this.workspaceCodeIntelligencePort.getHover(query);
        return result.ok
          ? { ok: true, kind: input.kind, available: true, hover: result.hover }
          : miss(result.error.message);
      }
      case "highlights": {
        const result = await this.workspaceCodeIntelligencePort.getDocumentHighlights(query);
        return result.ok
          ? { ok: true, kind: input.kind, available: true, highlights: result.highlights }
          : miss(result.error.message);
      }
      case "signature": {
        const result = await this.workspaceCodeIntelligencePort.getSignatureHelp(query);
        return result.ok
          ? { ok: true, kind: input.kind, available: true, signature: result.signature }
          : miss(result.error.message);
      }
      case "diagnostics": {
        const result = await this.workspaceCodeIntelligencePort.getDiagnostics({
          root: query.root,
          path: query.path,
          content: query.content,
        });
        return result.ok
          ? { ok: true, kind: input.kind, available: true, diagnostics: result.diagnostics }
          : miss(result.error.message);
      }
      default:
        return failure("invalid_workbench_command", "Unknown code intelligence query kind.");
    }
  }

  async searchWorkspaceContent(
    input: SearchWorkspaceContentInput,
  ): Promise<ServiceResult<SearchWorkspaceContentResult>> {
    const searched = await this.workspaceFilePort.searchContent({
      root: input.cwd,
      query: input.query,
      maxResults: Math.min(Math.max(input.maxResults ?? 500, 1), 2000),
      maxFiles: Math.min(Math.max(input.maxFiles ?? 2000, 1), 8000),
    });
    if (!searched.ok) {
      return failure(searched.error.code, searched.error.message);
    }
    return {
      ok: true,
      cwd: input.cwd,
      query: searched.search.query,
      matches: searched.search.matches.map((match) => ({ ...match })),
      fileCount: searched.search.fileCount,
      truncated: searched.search.truncated,
    };
  }
}
