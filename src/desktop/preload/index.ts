import { contextBridge, ipcRenderer } from "electron";
import type {
  BackendCommandEnvelope,
  BackendEventEnvelope,
} from "../../shared/contracts/index.ts";

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

export interface ProviderCommandSuggestion {
  name: string;
  description: string;
  trigger: "/" | "$";
  source: "project" | "user" | "builtin";
  agentId: "codex" | "claude" | "antigravity";
}

export interface TidePreloadSurface {
  contractVersion: 1;
  transport: "message_port";
  sendBackendCommand(command: BackendCommandEnvelope): Promise<BackendEventEnvelope[]>;
  onBackendEvent(listener: (event: BackendEventEnvelope) => void): () => void;
  // Native folder picker + persisted project registry (Main-owned).
  openDirectory(): Promise<string | null>;
  listProjects(): Promise<ProjectRegistryEntry[]>;
  registerProject(cwd: string): Promise<ProjectRegistryEntry[]>;
  unregisterProject(cwd: string): Promise<ProjectRegistryEntry[]>;
  renameProject(cwd: string, name: string): Promise<ProjectRegistryEntry[]>;
  revealInFinder(cwd: string): Promise<void>;
  createWorktree(cwd: string): Promise<{ entries: ProjectRegistryEntry[]; createdCwd: string | null }>;
  gitContext(cwd: string): Promise<GitContext>;
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
  createWorktree(cwd) {
    return ipcRenderer.invoke("tide:create-worktree", cwd) as Promise<{
      entries: ProjectRegistryEntry[];
      createdCwd: string | null;
    }>;
  },
  gitContext(cwd) {
    return ipcRenderer.invoke("tide:git-context", cwd) as Promise<GitContext>;
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
