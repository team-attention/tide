import type { AgentRuntimeState } from "../domains/agent-runtime/agent-runtime.ts";
import type { AgentId, ThreadId } from "../domains/thread/thread.ts";
import type {
  BrowserPaneActionRequest,
  BrowserPaneRef,
  TideMcpToolName,
  WorkbenchPaneId,
  WorkbenchPaneSnapshotRef,
  WorkbenchSnapshot,
} from "../domains/workbench/workbench.ts";

// Tide MCP tool output shapes — the typed results the Tide MCP tool surface
// returns for observe/open/act/read/edit/navigate/terminal operations. Pure
// product DTOs. Extracted from thread-runtime-service.ts so the workbench
// operation builders and Tide MCP handler can produce them without the facade.

export type TideMcpToolOutput =
  | TideObserveThreadOutput
  | TideObserveWorkbenchOutput
  | TideOpenBrowserOutput
  | TideObserveBrowserOutput
  | TideActBrowserOutput
  | TideReadFileOutput
  | TideOpenFileOutput
  | TideEditFileOutput
  | TideGoToDefinitionOutput
  | TideGoToReferencesOutput
  | TideOpenTerminalOutput
  | TideRunTerminalCommandOutput;

export interface TideObserveThreadOutput {
  kind: "observe_thread";
  threadId: ThreadId;
  agentId: AgentId;
  agentChatState: AgentRuntimeState;
  promptActive: boolean;
  workbenchOpen: boolean;
  availableTools: TideMcpToolName[];
}

export interface TideObserveWorkbenchOutput extends WorkbenchSnapshot {
  kind: "observe_workbench";
  threadId: ThreadId;
}

export interface TideOpenBrowserOutput {
  kind: "open_browser";
  threadId: ThreadId;
  pane: BrowserPaneRef;
  visibleSideEffect: "created" | "revealed" | "navigated";
}

export interface TideObserveBrowserOutput {
  kind: "observe_browser";
  threadId: ThreadId;
  pane: BrowserPaneRef;
}

export interface TideActBrowserOutput {
  kind: "act_browser";
  threadId: ThreadId;
  pane: BrowserPaneRef;
  action: BrowserPaneActionRequest;
  status: "pending";
}

export interface TideReadFileOutput {
  kind: "read_file";
  threadId: ThreadId;
  root: string;
  path: string;
  relativePath: string;
  content: string;
  byteLength: number;
  truncated: boolean;
}

export interface TideOpenFileOutput {
  kind: "open_file";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "editor" };
  root: string;
  path: string;
  relativePath: string;
  byteLength: number;
  truncated: boolean;
  visibleSideEffect: "created" | "revealed";
}

export interface TideEditFileOutput {
  kind: "edit_file";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "diff" };
  root: string;
  path: string;
  relativePath: string;
  replacementCount: number;
  beforeByteLength: number;
  afterByteLength: number;
  afterContent: string;
  truncated: boolean;
  diff: string;
  visibleSideEffect: "created" | "refreshed";
}

export interface TideGoToDefinitionOutput {
  kind: "go_to_definition";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "editor" };
  sourcePaneId: WorkbenchPaneId;
  target: {
    line: number;
    character: number;
    length?: number;
    label?: string;
  };
}

export interface TideGoToReferencesOutput {
  kind: "go_to_references";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "editor" };
  sourcePaneId: WorkbenchPaneId;
  references: {
    relativePath: string;
    line: number;
    character: number;
    length?: number;
    label?: string;
  }[];
  truncated: boolean;
}

export interface TideOpenTerminalOutput {
  kind: "open_terminal";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "terminal" };
  command: string;
  args: string[];
  cwd: string;
  visibleSideEffect: "created" | "revealed";
}

export interface TideRunTerminalCommandOutput {
  kind: "run_terminal_command";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "terminal" };
  command: string;
  args: string[];
  cwd: string;
  status: "completed" | "failed";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  transcript: string;
  truncated: boolean;
  timedOut: boolean;
}
