import { contextBridge, ipcRenderer } from "electron";
import type {
  BackendCommandEnvelope,
  BackendEventEnvelope,
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

export interface TidePreloadSurface {
  contractVersion: 1;
  transport: "message_port";
  sendBackendCommand(command: BackendCommandEnvelope): Promise<BackendEventEnvelope[]>;
  onBackendEvent(listener: (event: BackendEventEnvelope) => void): () => void;
  // Cmd+W "close intent" from the application menu — the renderer decides what to
  // close (a focused Workbench pane, else the active thread → start composer).
  onCloseIntent(listener: () => void): () => void;
  // A Browser Pane link asked to open elsewhere. Main denies the stray popup window and
  // forwards the URL so the renderer drives the backend open_browser path: `newPane`
  // true (Cmd/Ctrl/middle-click, window.open) opens a new Browser Pane; false (a plain
  // target=_blank click) navigates the active Browser Pane in place.
  onOpenBrowserPane(listener: (url: string, newPane: boolean) => void): () => void;
  // View-menu panel toggles (Cmd+B left rail / Cmd+E file tree / Cmd+J workbench),
  // routed from the application menu so they fire regardless of focus (webview/terminal).
  onTogglePanel(listener: (panel: "leftRail" | "fileTree" | "workbench") => void): () => void;
  // Request a native OS notification (delivered from Main). Fire-and-forget: Main applies
  // the window-focus gate and decides whether to show it.
  notify(request: TideNotificationRequest): void;
  // Main asks the renderer to activate a thread (a clicked notification routes through
  // the same user-action path as a left-rail click).
  onActivateThread(listener: (threadId: string) => void): () => void;
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
