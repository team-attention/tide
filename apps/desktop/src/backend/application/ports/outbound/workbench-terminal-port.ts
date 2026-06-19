import type { ThreadId } from "../../domains/thread/thread.ts";
import type { WorkbenchPaneId } from "../../domains/workbench/workbench.ts";

export interface WorkbenchTerminalOutput {
  source: "stdout" | "stderr";
  body: string;
}

export interface WorkbenchTerminalExit {
  exitCode: number | null;
  signal: string | null;
}

export interface WorkbenchTerminalStartInput {
  threadId: ThreadId;
  paneId: WorkbenchPaneId;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  onOutput?: (output: WorkbenchTerminalOutput) => void;
  onExit?: (exit: WorkbenchTerminalExit) => Promise<void> | void;
}

export interface WorkbenchTerminalHandle {
  terminalRuntimeId: string;
  write(data: string): Promise<void> | void;
  resize?(cols: number, rows: number): void;
  stop(): Promise<void> | void;
}

export interface WorkbenchTerminalPort {
  start(input: WorkbenchTerminalStartInput): Promise<WorkbenchTerminalHandle>;
}
