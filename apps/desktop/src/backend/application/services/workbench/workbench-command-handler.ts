import type {
  ThreadId,
  ThreadSnapshot,
} from "../../domains/thread/thread.ts";
import type {
  ChangesPaneState,
  WorkbenchFileTreeView,
  WorkbenchSnapshot,
} from "../../domains/workbench/workbench.ts";
import type { WorkspaceCodeIntelligencePort } from "../../ports/outbound/workspace-code-intelligence-port.ts";
import type { WorkspaceCommandPort } from "../../ports/outbound/workspace-command-port.ts";
import type { WorkspaceFilePort } from "../../ports/outbound/workspace-file-port.ts";
import { failure, type ServiceResult } from "../support/service-result.ts";
import {
  commandName,
  fileByteLimit,
  fileTreeExpandedPaths,
  fileTreeMaxDepth,
  fileTreeMaxEntries,
  numberFromData,
  optionalString,
  terminalLaunchPreview,
} from "../support/service-value-helpers.ts";
import { cloneFileTreeView } from "../thread/thread-runtime-clone.ts";
import { snapshotThread, threadRoot } from "../thread/thread-snapshot.ts";
import type { ThreadStore } from "../thread/thread-store.ts";
import {
  openBrowserOutput,
  releaseAgentBrowserControl,
} from "./workbench-browser-operations.ts";
import {
  browserPaneActionResultFromData,
  browserPaneCaptureResultFromData,
  browserPaneSnapshotFromData,
  editorPanePositionFromData,
  editorPaneSaveFromData,
  terminalInputFromData,
  workbenchTerminalCommandFromData,
  workbenchLayoutModeFromValue,
} from "./workbench-command-data.ts";
import { BrowserCaptureCoordinator } from "./browser-capture-coordinator.ts";
import { providerReadinessTerminalInput } from "./provider-readiness-terminal-input.ts";
import type { WorkbenchFileOperations } from "./workbench-file-operations.ts";
import { activeLauncherPaneId, openWorkbenchLauncher, removeLauncherPane } from "./workbench-launcher.ts";
import type { WorkbenchRuntime } from "./workbench-runtime.ts";
import {
  closeWorkbenchPaneState,
  focusWorkbenchPaneState,
  setWorkbenchLayoutModeState,
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

export interface WorkbenchCommandHandlerDeps {
  threads: ThreadStore;
  clock: () => string;
  idGenerator: () => string;
  defaultWorkbenchTerminalCommand: string;
  defaultWorkbenchTerminalArgs: string[];
  workbenchRuntime: WorkbenchRuntime;
  workbenchFileOps: WorkbenchFileOperations;
  workspaceFilePort: WorkspaceFilePort;
  workspaceCommandPort: WorkspaceCommandPort;
  workspaceCodeIntelligencePort: WorkspaceCodeIntelligencePort;
  browserCapture: BrowserCaptureCoordinator;
}

// Dispatches Workbench commands (open/close panes, terminal input/resize,
// editor save, navigation, file-tree refresh) to the pane operation collaborators
// and WorkbenchRuntime. Field names mirror the former service so the command
// bodies are unchanged. Extracted from thread-runtime-service.ts.
export class WorkbenchCommandHandler {
  private readonly threads: ThreadStore;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly defaultWorkbenchTerminalCommand: string;
  private readonly defaultWorkbenchTerminalArgs: string[];
  private readonly workbenchRuntime: WorkbenchRuntime;
  private readonly workbenchFileOps: WorkbenchFileOperations;
  private readonly workspaceFilePort: WorkspaceFilePort;
  private readonly workspaceCommandPort: WorkspaceCommandPort;
  private readonly workspaceCodeIntelligencePort: WorkspaceCodeIntelligencePort;
  private readonly browserCapture: BrowserCaptureCoordinator;

  constructor(deps: WorkbenchCommandHandlerDeps) {
    this.threads = deps.threads;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator;
    this.defaultWorkbenchTerminalCommand = deps.defaultWorkbenchTerminalCommand;
    this.defaultWorkbenchTerminalArgs = [...deps.defaultWorkbenchTerminalArgs];
    this.workbenchRuntime = deps.workbenchRuntime;
    this.workbenchFileOps = deps.workbenchFileOps;
    this.workspaceFilePort = deps.workspaceFilePort;
    this.workspaceCommandPort = deps.workspaceCommandPort;
    this.workspaceCodeIntelligencePort = deps.workspaceCodeIntelligencePort;
    this.browserCapture = deps.browserCapture;
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
        // The Launcher is a PLACEHOLDER: picking Browser RESOLVES it in place — a
        // new Browser Pane takes the Launcher's slot and the Launcher is removed
        // (v1 dock-placeholder: resolve_launcher / replace_pane). Multiple browsers
        // come from opening multiple launchers (+ → launcher → resolve), not from a
        // persistent launcher. With no active launcher (agent open, chat link) the
        // input disposition (reuse / new) applies as before.
        const launcherToReplace = activeLauncherPaneId(thread);
        const browserData =
          launcherToReplace === undefined
            ? input.data
            : { ...input.data, disposition: "new_browser_pane" };
        const opened = openBrowserOutput(thread, browserData, this.idGenerator, this.clock);
        const pane = workbenchPaneById(thread.workbench, opened.pane.paneId);
        if (pane !== undefined) {
          thread.workbench.activePaneId = pane.paneId;
        }
        removeLauncherPane(thread, launcherToReplace);
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

        const previousUrl = pane.url;
        pane.pageTitle = snapshot.pageTitle;
        if (snapshot.url !== undefined) {
          pane.url = snapshot.url;
        }
        pane.bodyTextPreview = snapshot.bodyTextPreview;
        pane.interactiveElements = snapshot.interactiveElements;
        if (snapshot.screenshot !== undefined) {
          pane.screenshot = snapshot.screenshot;
        }
        pane.loading = snapshot.loading ?? false;
        // D1 (spec: browser-pane-action-revision-race): re-mint the revision ONLY on a
        // real navigation (the resolved URL changed). did-finish-load/did-stop-loading
        // fire repeatedly on a live page, each emitting a SAME-URL snapshot; bumping the
        // token on those churned an agent's observed revision out from under its next
        // act (workbench_stale_reference) even though the page never moved. A same-page
        // content refresh still updates title/body/screenshot/loading but KEEPS the
        // revision, so an observe→act with no navigation between survives the CAS; a
        // genuine navigation still re-mints, preserving the staleness guard.
        if (snapshot.url !== undefined && snapshot.url !== previousUrl) {
          pane.revision = this.idGenerator();
          // A navigation invalidates the act auto-retry window (D5): the agent's prior
          // revision was for a different page, so it must re-observe — never auto-retry a
          // stale act across a navigation.
          delete pane.priorRevision;
        }
        pane.updatedAt = this.clock();
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "update_browser_capture_result": {
        // The renderer's reply to an observe-time pixel-capture pull (pendingCapture). Resolve
        // the awaiting observe call and refresh the fallback cache. A capture never changes the
        // page, so the revision is NOT re-minted. A late/duplicate report (captureId no longer
        // pending) is ignored. Spec: docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "browser") {
          return failure(
            "workbench_target_not_found",
            "Browser Pane target was not found.",
          );
        }
        const result = browserPaneCaptureResultFromData(input.data);
        if (result === undefined) {
          return failure(
            "invalid_workbench_command",
            "Browser Pane capture result requires a capture id.",
          );
        }
        if (pane.pendingCapture?.captureId === result.captureId) {
          delete pane.pendingCapture;
        }
        if (result.screenshot !== undefined) {
          pane.screenshot = result.screenshot;
        }
        this.browserCapture.resolve(result.captureId, result.screenshot);
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
        if (result.interactiveElements !== undefined) {
          pane.interactiveElements = result.interactiveElements;
        }
        pane.loading = result.loading ?? false;
        // D5 (spec: browser-pane-live-pull-vision.md): remember the pre-completion revision
        // so the agent's NEXT act, if it still carries this just-settled token, is auto-retried
        // once instead of failing the CAS (the close/reopen thrash).
        pane.priorRevision = pane.revision;
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
      case "release_agent_browser_control": {
        // User takeover (D5): the Take control button releases agent driving on a
        // foregrounded driven Browser Pane and cancels any queued agent input.
        const released = releaseAgentBrowserControl(
          thread,
          input.targetPaneId,
          this.idGenerator,
          this.clock,
        );
        if (!released.ok) {
          return failure(released.error.code, released.error.message);
        }
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "open_editor": {
        // Resolve the Launcher placeholder in place (the Editor takes its slot).
        const launcherToReplace = activeLauncherPaneId(thread);
        const opened = await this.workbenchFileOps.openFileOutput(thread, input.data);
        if (!opened.ok) {
          return failure(opened.error.code, opened.error.message);
        }
        const pane = workbenchPaneById(thread.workbench, opened.value.pane.paneId);
        if (pane !== undefined) {
          thread.workbench.activePaneId = pane.paneId;
        }
        removeLauncherPane(thread, launcherToReplace);
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
        const terminalInput = workbenchTerminalCommandFromData(input.data);
        const terminalRole = terminalInput.terminalRole ?? "session";
        const isProviderReadiness = terminalRole === "provider_readiness";
        let command: string;
        let args: string[];
        let env: Record<string, string> | undefined;
        let cwd: string;
        let providerReadinessInput: string | undefined;
        let providerReadinessPreview: string | undefined;
        let title = terminalInput.title;
        if (isProviderReadiness) {
          if (
            terminalInput.command === undefined ||
            terminalInput.cwd === undefined ||
            terminalInput.expectedCompletion === undefined
          ) {
            return failure(
              "invalid_workbench_command",
              "Provider readiness terminal command requires command, cwd, and expectedCompletion.",
            );
          }
          command = this.defaultWorkbenchTerminalCommand;
          args = [...this.defaultWorkbenchTerminalArgs];
          env = terminalInput.env;
          cwd = terminalInput.cwd;
          providerReadinessInput = providerReadinessTerminalInput({
            command: terminalInput.command,
            args: terminalInput.args ?? [],
            shellCommand: command,
          });
          providerReadinessPreview = terminalLaunchPreview(terminalInput.command, terminalInput.args ?? [], cwd);
          title ??= `Provider readiness: ${commandName(terminalInput.command)}`;
        } else {
          const root = threadRoot(thread);
          if (root === undefined) {
            return failure(
              "workspace_command_unavailable",
              "Thread does not have an Execution Context root for Terminal Pane.",
            );
          }
          const resolvedCwd = await this.workspaceCommandPort.resolveCwd({
            root,
            cwd: terminalInput.cwd,
          });
          if (!resolvedCwd.ok) {
            return failure(resolvedCwd.error.code, resolvedCwd.error.message);
          }
          command = terminalInput.command ?? this.defaultWorkbenchTerminalCommand;
          args = terminalInput.args ?? [...this.defaultWorkbenchTerminalArgs];
          env = terminalInput.env;
          cwd = resolvedCwd.cwd.cwd;
        }
        // Resolve the Launcher placeholder in place (the Terminal takes its slot).
        const launcherToReplace = activeLauncherPaneId(thread);
        const pane = this.workbenchRuntime.openWorkbenchTerminal(thread, {
          command,
          args,
          env,
          cwd,
          title,
          terminalRole,
          expectedCompletion: terminalInput.expectedCompletion,
        });
        if (isProviderReadiness) {
          pane.transcriptPreview = providerReadinessPreview;
          await this.workbenchRuntime.ensureWorkbenchTerminalRunning(thread, pane);
          const terminalHandle = this.workbenchRuntime.terminalHandle(pane.paneId);
          if (terminalHandle !== undefined && providerReadinessInput !== undefined) {
            await terminalHandle.write(providerReadinessInput);
          }
        } else {
          void this.workbenchRuntime.ensureWorkbenchTerminalRunning(thread, pane).catch(() => undefined);
        }
        thread.workbench.activePaneId = pane.paneId;
        removeLauncherPane(thread, launcherToReplace);
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "open_diff": {
        // The read-only git Changes pane — a first-class SINGLETON pane (one per
        // workbench). Reveal the existing one or create it; the renderer fetches the
        // file list + diffs (Main-process git) from the pane's cwd. Spec: git-changes-view.
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_command_unavailable",
            "Thread does not have an Execution Context root for the Changes pane.",
          );
        }
        const launcherToReplace = activeLauncherPaneId(thread);
        let pane = thread.workbench.panes.find(
          (candidate): candidate is ChangesPaneState => candidate.kind === "changes",
        );
        if (pane === undefined) {
          pane = {
            paneId: this.idGenerator(),
            kind: "changes",
            title: "Changes",
            revision: this.idGenerator(),
            updatedAt: this.clock(),
            cwd: root,
          };
          thread.workbench.panes.push(pane);
        }
        pane.cwd = root;
        pane.updatedAt = this.clock();
        thread.workbench.activePaneId = pane.paneId;
        removeLauncherPane(thread, launcherToReplace);
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
        const bytes = terminalInputFromData(input.data);
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
        const pane = focusWorkbenchPaneState(thread.workbench, input.targetPaneId, this.clock);
        if (pane === undefined) {
          return failure(
            "workbench_target_not_found",
            "Workbench Pane target was not found.",
          );
        }
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
        // PTY teardown is the command handler's job (it owns the runtime); pane
        // removal + active reassignment is the shared helper.
        if (pane.kind === "terminal") {
          void this.workbenchRuntime.stopTerminalPane(pane);
        }
        closeWorkbenchPaneState(thread.workbench, pane.paneId, this.clock);
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "set_layout_mode": {
        const mode = workbenchLayoutModeFromValue(input.data?.mode);
        if (mode === undefined) {
          return failure(
            "invalid_workbench_command",
            "set_layout_mode requires mode 'stacked' or 'split'.",
          );
        }
        setWorkbenchLayoutModeState(thread.workbench, mode);
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
        // Lazy listing: with `expandedPaths` present, the port lists the root plus
        // only the expanded subtrees — a collapsed folder (e.g. a pnpm store) is
        // listed but never walked. Quick Open omits `expandedPaths` and passes
        // `maxDepth` for the depth-bounded full walk. Heavy dirs are skipped either
        // way by the workspace file port.
        const listed = await this.workspaceFilePort.listTree({
          root,
          maxEntries: fileTreeMaxEntries(input.data?.maxEntries),
          expandedPaths: fileTreeExpandedPaths(input.data?.expandedPaths),
          maxDepth: fileTreeMaxDepth(input.data?.maxDepth),
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
}
