import { contextBridge, ipcRenderer } from "electron";
import type {
  BackendCommandEnvelope,
  BackendEventEnvelope,
  ThreadSummaryDto,
} from "../../../../shared/contracts/index.ts";

export interface ProjectRegistryEntry {
  projectId: string;
  name: string;
  cwd: string;
}

export interface GitContext {
  isGitRepo: boolean;
  currentBranch: string | null;
  branches: { name: string; kind: "local" | "remote"; current: boolean }[];
  worktrees: { path: string; branch: string | null; current: boolean }[];
}

export type GitChangeStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface GitChanges {
  isGitRepo: boolean;
  files: { path: string; status: GitChangeStatus; additions?: number; deletions?: number }[];
}

// Result of a structural FileTree mutation (new file/folder, rename/move, trash),
// performed by Main. Mirrors WorkspaceFsResult in main/workspace-fs.ts (kept
// process-local per the preload convention). Spec: workbench-filetree-file-operations.
export type WorkspaceFsResult =
  | { ok: true; relativePath: string }
  | { ok: false; code: string; message: string };

export interface ProviderCommandSuggestion {
  name: string;
  description: string;
  trigger: "/" | "$";
  source: "project" | "user" | "builtin";
  agentId: "codex" | "claude";
}

// A native-notification request from the renderer (delivered by Main). Mirrors
// TideNotificationRequest in main/notifications.ts (kept process-local per the existing
// preload convention). See specs/focus-aware-notifications.md.
export interface TideNotificationRequest {
  kind: "agent_finished" | "needs_attention" | "agent_update";
  threadId: string | null;
  title: string;
  body: string;
  isActiveThread: boolean;
}

// App self-update status pushed from Main (mirrors AppUpdateStatus in
// main/auto-update-status.ts, kept process-local per the preload convention).
// See specs/version-management.md.
export type AppUpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "ready"; version: string; notes?: string }
  | { phase: "upToDate"; currentVersion: string }
  | { phase: "error"; message: string };

// Read the UI prefs from Main synchronously at preload time (sendSync). This hits the Main
// process — which reads the small JSON file via Node fs, instantly — NOT the renderer's
// localStorage, whose first sync access at boot stalls ~3.8s while the bundle loads. The
// value is ready before any page script runs, so the inline theme script reads it flash-free.
// See main/ui-prefs.ts.
function readUiPrefsSync(): Record<string, string> {
  try {
    const prefs = ipcRenderer.sendSync("tide:get-ui-prefs") as unknown;
    if (prefs !== null && typeof prefs === "object") {
      return prefs as Record<string, string>;
    }
  } catch {
    // main handler not ready / failed — fall back to empty (renderer uses defaults)
  }
  return {};
}

function readInitialThreadListSync(): { threads: ThreadSummaryDto[] } | null {
  try {
    const snapshot = ipcRenderer.sendSync("tide:get-initial-thread-list") as unknown;
    if (
      snapshot !== null &&
      typeof snapshot === "object" &&
      Array.isArray((snapshot as { threads?: unknown }).threads)
    ) {
      return snapshot as { threads: ThreadSummaryDto[] };
    }
  } catch {
    // main handler not ready / failed — fall back to the normal async thread.list.
  }
  return null;
}

export interface TidePreloadSurface {
  contractVersion: 1;
  transport: "message_port";
  sendBackendCommand(command: BackendCommandEnvelope): Promise<BackendEventEnvelope[]>;
  onBackendEvent(listener: (event: BackendEventEnvelope) => void): () => void;
  // Cmd+W "close intent" from the application menu — the renderer decides what to
  // close (a focused Workbench pane, else the active thread → start composer).
  onCloseIntent(listener: () => void): () => void;
  // Cmd/Ctrl+F from the application menu, routed through the host renderer so
  // Browser Pane <webview> focus cannot swallow in-pane search.
  onFindIntent(listener: () => void): () => void;
  // A Browser Pane link asked to open elsewhere. Main denies ordinary popup windows
  // and forwards the URL so the renderer drives the backend open_browser path: `newPane`
  // true (Cmd/Ctrl/middle-click) opens a new Browser Pane; false (a plain target=_blank
  // click) navigates the active Browser Pane in place. HTTPS `new-window` popups may be
  // preserved as native child windows by Main.
  onOpenBrowserPane(listener: (url: string, newPane: boolean) => void): () => void;
  // View-menu panel toggles (Cmd+B left rail / Cmd+E file tree / Cmd+J workbench),
  // routed from the application menu so they fire regardless of focus (webview/terminal).
  onTogglePanel(listener: (panel: "leftRail" | "fileTree" | "workbench") => void): () => void;
  // Global zoom (Cmd +/-/0). Main sets the host window's zoom and broadcasts the factor
  // (1 = 100%) so the renderer mirrors it onto Browser Pane <webview> guests (which
  // don't inherit host zoom) and shows a zoom indicator. resetZoom returns to 100%;
  // getZoom reads the current host factor to seed the indicator on mount. Zoom is NOT
  // persisted — the window opens at 100% each launch (main resets it on load).
  onZoomChanged(listener: (factor: number) => void): () => void;
  resetZoom(): void;
  getZoom(): Promise<number>;
  // Request a native OS notification (delivered from Main). Fire-and-forget: Main applies
  // the window-focus gate and decides whether to show it.
  notify(request: TideNotificationRequest): void;
  // Main asks the renderer to activate a thread (a clicked notification routes through
  // the same user-action path as a left-rail click).
  onActivateThread(listener: (threadId: string) => void): () => void;
  // App self-update (packaged builds only; otherwise inert). Main pushes status as it
  // checks; downloadAppUpdate starts the download on the user's click (autoDownload is
  // off); applyAppUpdate triggers quitAndInstall once downloaded; checkForAppUpdate forces
  // a re-check; getAppVersion reads the running version.
  onAppUpdateChanged(listener: (status: AppUpdateStatus) => void): () => void;
  downloadAppUpdate(): void;
  applyAppUpdate(): void;
  checkForAppUpdate(): void;
  getAppVersion(): Promise<string>;
  // Renderer UI prefs (theme, rail order, list/worktree settings, start composer), read
  // synchronously from Main at preload (sync IPC) so the renderer never touches localStorage
  // on the boot path (that first sync access stalls ~3.8s). Raw string values keyed by the
  // legacy storage key. saveUiPref persists a change to the Main-owned file. See ui-prefs.ts.
  uiPrefs: Record<string, string>;
  saveUiPref(key: string, value: string): void;
  // Last persisted thread list from Main's lightweight index. Used only for first
  // paint; the backend's authoritative thread.listed still refreshes it immediately.
  initialThreadList: { threads: ThreadSummaryDto[] } | null;
  // Native folder picker + persisted project registry (Main-owned).
  openDirectory(): Promise<string | null>;
  listProjects(): Promise<ProjectRegistryEntry[]>;
  registerProject(cwd: string): Promise<ProjectRegistryEntry[]>;
  unregisterProject(cwd: string): Promise<ProjectRegistryEntry[]>;
  renameProject(cwd: string, name: string): Promise<ProjectRegistryEntry[]>;
  revealInFinder(cwd: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  // Structural FileTree mutations (Main-owned). `root` is the absolute workspace
  // root; paths are workspace-relative. Trash is the recoverable OS Trash.
  fsCreateFile(root: string, relativePath: string, content: string): Promise<WorkspaceFsResult>;
  fsCreateFolder(root: string, relativePath: string): Promise<WorkspaceFsResult>;
  fsMove(root: string, fromRel: string, toRel: string): Promise<WorkspaceFsResult>;
  fsTrash(root: string, relativePath: string): Promise<WorkspaceFsResult>;
  createWorktree(
    cwd: string,
    name: string,
    options?: { baseDirPattern?: string; copyFiles?: string[]; baseBranch?: string },
  ): Promise<{ entries: ProjectRegistryEntry[]; createdCwd: string | null }>;
  removeWorktree(cwd: string): Promise<{ entries: ProjectRegistryEntry[] }>;
  worktreeInfo(cwd: string): Promise<{
    repoRoot: string | null;
    branch: string | null;
    branchMerged: boolean;
    isWorktree: boolean;
  }>;
  deleteWorktree(
    cwd: string,
    options: { deleteBranch: boolean; force: boolean },
  ): Promise<{
    entries: ProjectRegistryEntry[];
    worktreeRemoved: boolean;
    branch: string | null;
    branchDeleted: boolean;
  }>;
  branchInfo(cwd: string, branch: string): Promise<{ exists: boolean; merged: boolean }>;
  deleteBranch(
    cwd: string,
    branch: string,
    options: { force: boolean },
  ): Promise<{ deleted: boolean; branch: string | null }>;
  gitContext(cwd: string): Promise<GitContext>;
  // Read-only uncommitted changes + a single file's diff, for the Changes view.
  gitChanges(cwd: string): Promise<GitChanges>;
  gitFileDiff(cwd: string, relPath: string): Promise<string>;
  listCommands(cwd: string, agentId: string): Promise<ProviderCommandSuggestion[]>;
}

export const tidePreloadSurface: TidePreloadSurface = {
  contractVersion: 1,
  transport: "message_port",
  sendBackendCommand(command) {
    return ipcRenderer.invoke("tide:backend-command", command) as Promise<BackendEventEnvelope[]>;
  },
  onBackendEvent(listener) {
    const wrappedListener = (_event: unknown, event: BackendEventEnvelope) => {
      listener(event);
    };
    ipcRenderer.on("tide:backend-event", wrappedListener);
    return () => {
      ipcRenderer.removeListener("tide:backend-event", wrappedListener);
    };
  },
  onCloseIntent(listener) {
    const wrapped = () => listener();
    ipcRenderer.on("tide:close-intent", wrapped);
    return () => {
      ipcRenderer.removeListener("tide:close-intent", wrapped);
    };
  },
  onFindIntent(listener) {
    const wrapped = () => listener();
    ipcRenderer.on("tide:find-intent", wrapped);
    return () => {
      ipcRenderer.removeListener("tide:find-intent", wrapped);
    };
  },
  onOpenBrowserPane(listener) {
    const wrapped = (_event: unknown, url: string, newPane: boolean) => listener(url, newPane);
    ipcRenderer.on("tide:open-browser-pane", wrapped);
    return () => {
      ipcRenderer.removeListener("tide:open-browser-pane", wrapped);
    };
  },
  onTogglePanel(listener) {
    const wrapped = (_event: unknown, panel: "leftRail" | "fileTree" | "workbench") => listener(panel);
    ipcRenderer.on("tide:toggle-panel", wrapped);
    return () => {
      ipcRenderer.removeListener("tide:toggle-panel", wrapped);
    };
  },
  onZoomChanged(listener) {
    const wrapped = (_event: unknown, factor: number) => listener(factor);
    ipcRenderer.on("tide:zoom-changed", wrapped);
    return () => {
      ipcRenderer.removeListener("tide:zoom-changed", wrapped);
    };
  },
  resetZoom() {
    ipcRenderer.send("tide:reset-zoom");
  },
  getZoom() {
    return ipcRenderer.invoke("tide:get-zoom") as Promise<number>;
  },
  notify(request) {
    ipcRenderer.send("tide:notify", request);
  },
  onActivateThread(listener) {
    const wrapped = (_event: unknown, threadId: string) => listener(threadId);
    ipcRenderer.on("tide:activate-thread", wrapped);
    return () => {
      ipcRenderer.removeListener("tide:activate-thread", wrapped);
    };
  },
  onAppUpdateChanged(listener) {
    const wrapped = (_event: unknown, status: AppUpdateStatus) => listener(status);
    ipcRenderer.on("tide:app-update-changed", wrapped);
    return () => {
      ipcRenderer.removeListener("tide:app-update-changed", wrapped);
    };
  },
  downloadAppUpdate() {
    void ipcRenderer.invoke("tide:app-update-download");
  },
  uiPrefs: readUiPrefsSync(),
  initialThreadList: readInitialThreadListSync(),
  saveUiPref(key: string, value: string) {
    void ipcRenderer.invoke("tide:save-ui-pref", key, value);
  },
  applyAppUpdate() {
    void ipcRenderer.invoke("tide:app-update-apply");
  },
  checkForAppUpdate() {
    void ipcRenderer.invoke("tide:app-update-check");
  },
  getAppVersion() {
    return ipcRenderer.invoke("tide:app-version") as Promise<string>;
  },
  openDirectory() {
    return ipcRenderer.invoke("tide:open-directory") as Promise<string | null>;
  },
  listProjects() {
    return ipcRenderer.invoke("tide:list-projects") as Promise<ProjectRegistryEntry[]>;
  },
  registerProject(cwd) {
    return ipcRenderer.invoke("tide:register-project", cwd) as Promise<ProjectRegistryEntry[]>;
  },
  unregisterProject(cwd) {
    return ipcRenderer.invoke("tide:unregister-project", cwd) as Promise<ProjectRegistryEntry[]>;
  },
  renameProject(cwd, name) {
    return ipcRenderer.invoke("tide:rename-project", cwd, name) as Promise<ProjectRegistryEntry[]>;
  },
  revealInFinder(cwd) {
    return ipcRenderer.invoke("tide:reveal-in-finder", cwd) as Promise<void>;
  },
  openExternal(url) {
    return ipcRenderer.invoke("tide:open-external", url) as Promise<void>;
  },
  fsCreateFile(root, relativePath, content) {
    return ipcRenderer.invoke("tide:fs-create-file", root, relativePath, content) as Promise<WorkspaceFsResult>;
  },
  fsCreateFolder(root, relativePath) {
    return ipcRenderer.invoke("tide:fs-create-folder", root, relativePath) as Promise<WorkspaceFsResult>;
  },
  fsMove(root, fromRel, toRel) {
    return ipcRenderer.invoke("tide:fs-move", root, fromRel, toRel) as Promise<WorkspaceFsResult>;
  },
  fsTrash(root, relativePath) {
    return ipcRenderer.invoke("tide:fs-trash", root, relativePath) as Promise<WorkspaceFsResult>;
  },
  createWorktree(cwd, name, options) {
    return ipcRenderer.invoke("tide:create-worktree", cwd, name, options) as Promise<{
      entries: ProjectRegistryEntry[];
      createdCwd: string | null;
    }>;
  },
  removeWorktree(cwd) {
    return ipcRenderer.invoke("tide:remove-worktree", cwd) as Promise<{
      entries: ProjectRegistryEntry[];
    }>;
  },
  worktreeInfo(cwd) {
    return ipcRenderer.invoke("tide:worktree-info", cwd) as Promise<{
      repoRoot: string | null;
      branch: string | null;
      branchMerged: boolean;
      isWorktree: boolean;
    }>;
  },
  deleteWorktree(cwd, options) {
    return ipcRenderer.invoke("tide:delete-worktree", cwd, options) as Promise<{
      entries: ProjectRegistryEntry[];
      worktreeRemoved: boolean;
      branch: string | null;
      branchDeleted: boolean;
    }>;
  },
  branchInfo(cwd, branch) {
    return ipcRenderer.invoke("tide:branch-info", cwd, branch) as Promise<{
      exists: boolean;
      merged: boolean;
    }>;
  },
  deleteBranch(cwd, branch, options) {
    return ipcRenderer.invoke("tide:delete-branch", cwd, branch, options) as Promise<{
      deleted: boolean;
      branch: string | null;
    }>;
  },
  gitContext(cwd) {
    return ipcRenderer.invoke("tide:git-context", cwd) as Promise<GitContext>;
  },
  gitChanges(cwd) {
    return ipcRenderer.invoke("tide:git-changes", cwd) as Promise<GitChanges>;
  },
  gitFileDiff(cwd, relPath) {
    return ipcRenderer.invoke("tide:git-file-diff", cwd, relPath) as Promise<string>;
  },
  listCommands(cwd, agentId) {
    return ipcRenderer.invoke("tide:list-commands", cwd, agentId) as Promise<ProviderCommandSuggestion[]>;
  },
};

contextBridge.exposeInMainWorld("tide", tidePreloadSurface);

// Reflect native fullscreen onto the document so CSS can collapse the reserved
// traffic-light space (the macOS lights are hidden in fullscreen).
ipcRenderer.on("tide:fullscreen-changed", (_event, isFullscreen: boolean) => {
  document.documentElement.classList.toggle("tide-fullscreen", isFullscreen === true);
});
