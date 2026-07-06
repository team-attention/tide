import { createRoot } from "react-dom/client";

import { TideProductShell } from "../../../adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import { AppErrorFallback, ErrorBoundary } from "../../../adapters/inbound/react-renderer/product-shell/support/error-boundary.tsx";
import { GlobalZoomIndicator } from "../../../adapters/inbound/react-renderer/product-shell/support/global-zoom.tsx";
import type {
  AgentChatBackendEvent,
} from "../../../application/domains/agent-chat/agent-chat.ts";
import type { ProductShellBackendCommand } from "../../../application/domains/product-shell/product-shell.ts";
import {
  CONTRACT_VERSION,
  sanitizeJsonValue,
  type BackendCommandEnvelope,
  type BackendEventEnvelope,
  type BrowserRuntimeRendererCommandDto,
  type BrowserRuntimeStageDto,
  type ThreadSummaryDto,
} from "../../../../shared/contracts/index.ts";
// Inter (OFL-1.1, self-hosted) is the canonical Figma typeface; load the weights
// the design uses (regular / medium / semibold) so the UI does not fall back to
// the platform system font.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@xterm/xterm/css/xterm.css";
import "../../../adapters/inbound/react-renderer/styles/index.css";
import { applyThemePreference, loadThemePreference, watchSystemTheme } from "../../../adapters/inbound/react-renderer/support/theme.ts";

// The inline script in index.html already set the boot theme to avoid a flash;
// re-apply from the source of truth and keep "auto" in sync with the OS.
applyThemePreference(loadThemePreference());
watchSystemTheme(loadThemePreference);

// Result of a structural FileTree mutation (mirrors WorkspaceFsResult in
// main/workspace-fs.ts; kept process-local per the preload convention).
type WorkspaceFsBridgeResult =
  | { ok: true; relativePath: string }
  | { ok: false; code: string; message: string };

export function createInitialRendererElement() {
  return (
    <>
    {/* Root safety net: any uncaught render/effect throw shows a recover card instead of a
        blank white screen (the renderer had no error boundary at all). Per-pane + background
        boundaries handle the workbench; this catches everything else (chat, rail, dialogs). */}
    <ErrorBoundary fallback={(error, reset) => <AppErrorFallback error={error} reset={reset} />}>
    <TideProductShell
      initialThreadList={window.tide?.initialThreadList?.threads}
      onBackendCommand={dispatchBackendCommand}
      onBackendEvent={subscribeBackendEvents}
      projectBridge={
        window.tide === undefined
          ? undefined
          : {
              openDirectory: () => window.tide!.openDirectory(),
              listProjects: () => window.tide!.listProjects(),
              registerProject: (cwd: string) => window.tide!.registerProject(cwd),
              unregisterProject: (cwd: string) => window.tide!.unregisterProject(cwd),
              renameProject: (cwd: string, name: string) => window.tide!.renameProject(cwd, name),
              revealInFinder: (cwd: string) => window.tide!.revealInFinder(cwd),
              createWorktree: (
                cwd: string,
                name: string,
                options?: { baseDirPattern?: string; copyFiles?: string[]; baseBranch?: string },
              ) => window.tide!.createWorktree(cwd, name, options),
              removeWorktree: (cwd: string) => window.tide!.removeWorktree(cwd),
              worktreeInfo: (cwd: string) => window.tide!.worktreeInfo(cwd),
              deleteWorktree: (cwd: string, options: { deleteBranch: boolean; force: boolean }) =>
                window.tide!.deleteWorktree(cwd, options),
              branchInfo: (cwd: string, branch: string) => window.tide!.branchInfo(cwd, branch),
              checkoutBranch: (cwd: string, branch: string) => window.tide!.checkoutBranch(cwd, branch),
              deleteBranch: (cwd: string, branch: string, options: { force: boolean }) =>
                window.tide!.deleteBranch(cwd, branch, options),
              gitContext: (cwd: string) => window.tide!.gitContext(cwd),
              gitChanges: (cwd: string) => window.tide!.gitChanges(cwd),
              gitFileDiff: (cwd: string, relPath: string) => window.tide!.gitFileDiff(cwd, relPath),
              gitStageFile: (cwd: string, relPath: string) => window.tide!.gitStageFile(cwd, relPath),
              gitUnstageFile: (cwd: string, relPath: string) => window.tide!.gitUnstageFile(cwd, relPath),
              gitDiscardFile: (cwd: string, relPath: string) => window.tide!.gitDiscardFile(cwd, relPath),
              gitApplyHunk: (cwd: string, relPath: string, patch: string, action: "stage" | "unstage" | "discard") =>
                window.tide!.gitApplyHunk(cwd, relPath, patch, action),
              gitGenerateCommitMessage: (cwd: string) => window.tide!.gitGenerateCommitMessage(cwd),
              gitCommit: (cwd: string, message: string) => window.tide!.gitCommit(cwd, message),
              gitPushTarget: (cwd: string) => window.tide!.gitPushTarget(cwd),
              gitPush: (cwd: string, remote: string, branch: string) => window.tide!.gitPush(cwd, remote, branch),
              runReview: (cwd, provider, target) => window.tide!.runReview(cwd, provider, target),
              listCommands: (cwd: string, agentId: string) => window.tide!.listCommands(cwd, agentId),
              fsCreateFile: (root: string, relativePath: string, content: string) =>
                window.tide!.fsCreateFile(root, relativePath, content),
              fsCreateFolder: (root: string, relativePath: string) =>
                window.tide!.fsCreateFolder(root, relativePath),
              fsMove: (root: string, fromRel: string, toRel: string) =>
                window.tide!.fsMove(root, fromRel, toRel),
              fsTrash: (root: string, relativePath: string) => window.tide!.fsTrash(root, relativePath),
            }
      }
    />
    </ErrorBoundary>
    <GlobalZoomIndicator />
    </>
  );
}

export function mountTideRenderer(rootElement: HTMLElement | null): void {
  if (rootElement === null) {
    throw new Error("Missing Tide renderer root element.");
  }

  createRoot(rootElement).render(createInitialRendererElement());
}

mountTideRenderer(document.getElementById("root"));

declare global {
  interface Window {
    tide?: {
      contractVersion: 1;
      transport: "message_port";
      sendBackendCommand(command: BackendCommandEnvelope): Promise<BackendEventEnvelope[]>;
      onBackendEvent(listener: (event: BackendEventEnvelope) => void): () => void;
      onCloseIntent(listener: () => void): () => void;
      onFindIntent(listener: () => void): () => void;
      // BrowserRuntime owns Browser Pane popup handling and forwards http(s)
      // popup URLs here so the renderer drives the backend open_browser path.
      onOpenBrowserPane(listener: (url: string, newPane: boolean) => void): () => void;
      setBrowserRuntimeStage(stage: BrowserRuntimeStageDto): void;
      browserRuntimeCommand(command: BrowserRuntimeRendererCommandDto): Promise<void>;
      onBrowserRuntimeReleaseControl(listener: (threadId: string, paneId: string) => void): () => void;
      // View-menu panel toggles (Cmd+B / Cmd+E / Cmd+J), routed from the app menu.
      onTogglePanel(listener: (panel: "leftRail" | "fileTree" | "workbench") => void): () => void;
      // Global zoom (Cmd +/-/0): Main broadcasts the factor so the renderer mirrors it
      // onto <webview> guests and shows the indicator; resetZoom → 100%; getZoom seeds it.
      onZoomChanged(listener: (factor: number) => void): () => void;
      resetZoom(): void;
      getZoom(): Promise<number>;
      // Request a native OS notification (delivered + focus-gated by Main).
      notify(request: {
        kind: "agent_finished" | "needs_attention" | "agent_update";
        threadId: string | null;
        title: string;
        body: string;
        isActiveThread: boolean;
      }): void;
      // Main asks the renderer to activate a thread (a clicked notification).
      onActivateThread(listener: (threadId: string) => void): () => void;
      // App self-update (packaged only; inert otherwise). Main pushes status as it
      // checks/downloads; applyAppUpdate triggers quitAndInstall on the user's click.
      onAppUpdateChanged(
        listener: (
          status:
            | { phase: "idle" }
            | { phase: "checking" }
            | { phase: "available"; version: string }
            | { phase: "downloading"; version: string; percent: number }
            | { phase: "ready"; version: string; notes?: string }
            | { phase: "upToDate"; currentVersion: string }
            | { phase: "error"; message: string },
        ) => void,
      ): () => void;
      downloadAppUpdate(): void;
      applyAppUpdate(): void;
      checkForAppUpdate(): void;
      getAppVersion(): Promise<string>;
      uiPrefs: Record<string, string>;
      initialThreadList: { threads: ThreadSummaryDto[] } | null;
      saveUiPref(key: string, value: string): void;
      openDirectory(): Promise<string | null>;
      listProjects(): Promise<{ projectId: string; name: string; cwd: string }[]>;
      registerProject(cwd: string): Promise<{ projectId: string; name: string; cwd: string }[]>;
      unregisterProject(cwd: string): Promise<{ projectId: string; name: string; cwd: string }[]>;
      renameProject(cwd: string, name: string): Promise<{ projectId: string; name: string; cwd: string }[]>;
      revealInFinder(cwd: string): Promise<void>;
      openExternal(url: string): Promise<void>;
      createWorktree(cwd: string, name: string, options?: { baseDirPattern?: string; copyFiles?: string[]; baseBranch?: string }): Promise<{ entries: { projectId: string; name: string; cwd: string }[]; createdCwd: string | null }>;
      removeWorktree(cwd: string): Promise<{ entries: { projectId: string; name: string; cwd: string }[] }>;
      worktreeInfo(cwd: string): Promise<{ repoRoot: string | null; branch: string | null; branchMerged: boolean; isWorktree: boolean }>;
      deleteWorktree(cwd: string, options: { deleteBranch: boolean; force: boolean }): Promise<{ entries: { projectId: string; name: string; cwd: string }[]; worktreeRemoved: boolean; branch: string | null; branchDeleted: boolean }>;
      branchInfo(cwd: string, branch: string): Promise<{ exists: boolean; merged: boolean }>;
      checkoutBranch(cwd: string, branch: string): Promise<{ checkedOut: boolean; currentBranch: string | null; error?: string }>;
      deleteBranch(cwd: string, branch: string, options: { force: boolean }): Promise<{ deleted: boolean; branch: string | null }>;
      gitContext(cwd: string): Promise<{
        isGitRepo: boolean;
        currentBranch: string | null;
        branches: { name: string; kind: "local" | "remote"; current: boolean }[];
        worktrees: { path: string; branch: string | null; current: boolean }[];
      }>;
      gitChanges(cwd: string): Promise<{
        isGitRepo: boolean;
        files: {
          path: string;
          status: "modified" | "added" | "deleted" | "renamed" | "untracked";
          additions?: number;
          deletions?: number;
        }[];
      }>;
      gitFileDiff(cwd: string, relPath: string): Promise<string>;
      gitStageFile(cwd: string, relPath: string): Promise<{ ok: boolean; message: string }>;
      gitUnstageFile(cwd: string, relPath: string): Promise<{ ok: boolean; message: string }>;
      gitDiscardFile(cwd: string, relPath: string): Promise<{ ok: boolean; message: string }>;
      gitApplyHunk(cwd: string, relPath: string, patch: string, action: "stage" | "unstage" | "discard"): Promise<{ ok: boolean; message: string }>;
      gitGenerateCommitMessage(cwd: string): Promise<
        | { ok: true; message: string; source: "staged" | "working_tree"; files: string[] }
        | { ok: false; message: string }
      >;
      gitCommit(cwd: string, message: string): Promise<{ ok: boolean; message: string }>;
      gitPushTarget(cwd: string): Promise<
        | {
            ok: true;
            currentBranch: string;
            remote: string;
            branch: string;
            upstream: string | null;
            label: string;
          }
        | { ok: false; message: string }
      >;
      gitPush(cwd: string, remote: string, branch: string): Promise<{ ok: boolean; message: string }>;
      runReview(
        cwd: string,
        provider: "codex" | "claude" | "opencode",
        target:
          | { kind: "uncommitted" }
          | { kind: "base_branch"; baseBranch: string }
          | { kind: "commit"; sha: string; title?: string }
          | { kind: "custom"; instructions: string; diff?: string },
      ): Promise<{
        ok: boolean;
        provider: "codex" | "claude" | "opencode";
        source: "codex_cli" | "claude_ultrareview" | "claude_prompt" | "opencode_prompt";
        target:
          | { kind: "uncommitted" }
          | { kind: "base_branch"; baseBranch: string }
          | { kind: "commit"; sha: string; title?: string }
          | { kind: "custom"; instructions: string; diff?: string };
        cwd: string;
        command: string;
        startedAt: string;
        completedAt: string;
        rawText: string;
        findings: {
          findingId: string;
          severity?: "critical" | "high" | "medium" | "low" | "info";
          file?: string;
          line?: number;
          title: string;
          body: string;
          confidence?: "high" | "medium" | "low";
        }[];
        stderr?: string;
        exitCode?: number | null;
        signal?: string | null;
        message?: string;
      }>;
      listCommands(cwd: string, agentId: string): Promise<{
        name: string;
        description: string;
        trigger: "/" | "$";
        source: "project" | "user" | "builtin";
        agentId: "codex" | "claude";
      }[]>;
      // Structural FileTree mutations (Main-owned). `root` is the absolute workspace
      // root; paths are workspace-relative. Trash is the recoverable OS Trash.
      fsCreateFile(root: string, relativePath: string, content: string): Promise<WorkspaceFsBridgeResult>;
      fsCreateFolder(root: string, relativePath: string): Promise<WorkspaceFsBridgeResult>;
      fsMove(root: string, fromRel: string, toRel: string): Promise<WorkspaceFsBridgeResult>;
      fsTrash(root: string, relativePath: string): Promise<WorkspaceFsBridgeResult>;
    };
  }
}

function dispatchBackendCommand(
  command: ProductShellBackendCommand,
): Promise<AgentChatBackendEvent[]> | AgentChatBackendEvent[] | undefined {
  if (window.tide === undefined) {
    return [
      {
        kind: "contract.error",
        payload: {
          code: "backend_transport_unavailable",
          message:
            "Backend transport unavailable. Run Tide through the Electron app to start Agents.",
          failedBackendCommand: command.kind,
        },
      },
    ];
  }

  const envelope: BackendCommandEnvelope = {
    contractVersion: CONTRACT_VERSION,
    requestId: `renderer-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: command.kind,
    issuedAt: new Date().toISOString(),
    // Strip undefined/non-finite values so the envelope is a strict JsonObject.
    // Builders set optional fields (e.g. launchOptions on threads with no saved
    // options, like adopted-from-history threads) to undefined, which would fail
    // the backend's isJsonObject envelope check ("invalid_command") and silently
    // mark the turn failed before it ever reaches the runtime.
    payload: (sanitizeJsonValue(command.payload) ?? {}) as BackendCommandEnvelope["payload"],
  };

  return window.tide.sendBackendCommand(envelope).then((events) =>
    events.map((event) => {
      const payload = event.payload as Record<string, unknown>;
      return {
        kind: event.kind,
        payload:
          event.kind === "contract.error"
            ? { ...payload, failedBackendCommand: command.kind }
            : payload,
      };
    }),
  );
}

function subscribeBackendEvents(
  listener: (event: AgentChatBackendEvent) => void,
): (() => void) | undefined {
  if (window.tide === undefined) {
    return undefined;
  }

  return window.tide.onBackendEvent((event) => {
    listener({
      kind: event.kind,
      payload: event.payload as Record<string, unknown>,
    });
  });
}
