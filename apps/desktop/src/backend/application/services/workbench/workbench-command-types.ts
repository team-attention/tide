import type {
  ThreadId,
  ThreadSnapshot,
} from "../../domains/thread/thread.ts";
import type { WorkbenchSnapshot } from "../../domains/workbench/workbench.ts";
import type { WorkspaceCodeIntelligencePort } from "../../ports/outbound/workspace-code-intelligence-port.ts";
import type { WorkspaceCommandPort } from "../../ports/outbound/workspace-command-port.ts";
import type { WorkspaceFilePort } from "../../ports/outbound/workspace-file-port.ts";
import type { BrowserRuntimePort } from "../../ports/outbound/browser-runtime-port.ts";
import type { ThreadStore } from "../thread/thread-store.ts";
import type { WorkbenchFileOperations } from "./workbench-file-operations.ts";
import type { WorkbenchRuntime } from "./workbench-runtime.ts";

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
  browserRuntimePort?: BrowserRuntimePort;
}
