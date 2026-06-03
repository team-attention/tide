import type { ThreadId } from "../../domains/thread/thread.ts";
import type { WorkbenchPaneId } from "../../domains/workbench/workbench.ts";

export interface ProviderSetupSurfaceOutput {
  source: "stdout" | "stderr";
  body: string;
}

export interface ProviderSetupSurfaceExit {
  exitCode: number | null;
  signal: string | null;
}

export interface ProviderSetupSurfaceStartInput {
  threadId: ThreadId;
  paneId: WorkbenchPaneId;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
  onOutput?: (output: ProviderSetupSurfaceOutput) => void;
  onExit?: (exit: ProviderSetupSurfaceExit) => Promise<void> | void;
}

export interface ProviderSetupSurfaceHandle {
  surfaceRuntimeId: string;
  write(data: string): Promise<void> | void;
  stop(): Promise<void> | void;
}

export interface ProviderSetupSurfaceTerminalPort {
  start(input: ProviderSetupSurfaceStartInput): Promise<ProviderSetupSurfaceHandle>;
}
