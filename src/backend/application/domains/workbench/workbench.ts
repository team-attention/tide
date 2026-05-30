export type WorkbenchPaneId = string;

export type WorkbenchPaneKind =
  | "browser"
  | "diff"
  | "editor"
  | "terminal"
  | "launcher";

export type WorkbenchFocusOwner = "composer" | "workbench";

export type TideMcpToolName =
  | "tide_observe_thread"
  | "tide_observe_workbench"
  | "tide_open_browser"
  | "tide_observe_browser"
  | "tide_act_browser"
  | "tide_read_file"
  | "tide_open_file"
  | "tide_edit_file"
  | "tide_go_to_definition"
  | "tide_open_terminal"
  | "tide_run_terminal_command";

export const TIDE_MCP_WORKBENCH_TOOL_NAMES: TideMcpToolName[] = [
  "tide_observe_thread",
  "tide_observe_workbench",
  "tide_open_browser",
  "tide_observe_browser",
  "tide_act_browser",
  "tide_read_file",
  "tide_open_file",
  "tide_edit_file",
  "tide_go_to_definition",
  "tide_open_terminal",
  "tide_run_terminal_command",
];

export interface WorkbenchPaneRef {
  paneId: WorkbenchPaneId;
  kind: WorkbenchPaneKind;
  title: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
}

export interface BrowserPaneState {
  paneId: WorkbenchPaneId;
  kind: "browser";
  title: string;
  url?: string;
  pageTitle?: string;
  loading: boolean;
  visible: boolean;
  revision: string;
  updatedAt: string;
  bodyTextPreview?: string;
  pendingAction?: BrowserPaneActionRequest;
  lastAction?: BrowserPaneActionResult;
}

export type BrowserPaneActionKind = "click" | "type_text";

export interface BrowserPaneActionRequest {
  actionId: string;
  kind: BrowserPaneActionKind;
  selector: string;
  text?: string;
  requestedAt: string;
}

export interface BrowserPaneActionResult extends BrowserPaneActionRequest {
  status: "completed" | "failed";
  message: string;
  completedAt: string;
}

export interface TerminalPaneState {
  paneId: WorkbenchPaneId;
  kind: "terminal";
  title: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  status: "ready" | "running" | "completed" | "failed";
  expectedCompletion?: "process_exit" | "retry_preflight";
  transcriptPreview?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  startedAt?: string;
  completedAt?: string;
}

export interface EditorPaneState {
  paneId: WorkbenchPaneId;
  kind: "editor";
  title: string;
  filePath: string;
  relativePath: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
  bodyText: string;
  bodyTextPreview: string;
  byteLength: number;
  truncated: boolean;
  navigationTarget?: WorkbenchEditorNavigationTarget;
}

export interface WorkbenchEditorNavigationTarget {
  line: number;
  character: number;
  length?: number;
  label?: string;
  sourcePaneId?: WorkbenchPaneId;
}

export interface DiffPaneState {
  paneId: WorkbenchPaneId;
  kind: "diff";
  title: string;
  filePath: string;
  relativePath: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
  diffText: string;
  truncated: boolean;
  beforeByteLength: number;
  afterByteLength: number;
}

export interface LauncherPaneAction {
  actionId:
    | "open_browser"
    | "open_editor"
    | "open_terminal"
    | "open_diff"
    | "open_file_tree";
  label: string;
  description: string;
  enabled: boolean;
}

export interface LauncherPaneState {
  paneId: WorkbenchPaneId;
  kind: "launcher";
  title: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
  actions: LauncherPaneAction[];
}

export type WorkbenchPaneState =
  | BrowserPaneState
  | TerminalPaneState
  | EditorPaneState
  | DiffPaneState
  | LauncherPaneState;

export interface BrowserPaneRef extends WorkbenchPaneRef {
  kind: "browser";
  url?: string;
  pageTitle?: string;
  loading: boolean;
  bodyTextPreview?: string;
  pendingAction?: BrowserPaneActionRequest;
  lastAction?: BrowserPaneActionResult;
  stale: boolean;
  availableTools: TideMcpToolName[];
}

export interface NonBrowserWorkbenchPaneRef extends WorkbenchPaneRef {
  kind: "diff" | "editor" | "terminal";
  filePath?: string;
  relativePath?: string;
  bodyText?: string;
  bodyTextPreview?: string;
  byteLength?: number;
  truncated?: boolean;
  navigationTarget?: WorkbenchEditorNavigationTarget;
  diffText?: string;
  beforeByteLength?: number;
  afterByteLength?: number;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  status?: "ready" | "running" | "completed" | "failed";
  expectedCompletion?: "process_exit" | "retry_preflight";
  transcriptPreview?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  startedAt?: string;
  completedAt?: string;
}

export interface LauncherPaneRef extends WorkbenchPaneRef {
  kind: "launcher";
  actions: LauncherPaneAction[];
}

export type WorkbenchPaneSnapshotRef =
  | BrowserPaneRef
  | NonBrowserWorkbenchPaneRef
  | LauncherPaneRef;

export interface WorkbenchFileTreeEntry {
  id: string;
  name: string;
  relativePath: string;
  depth: number;
  kind: "folder" | "file";
  active?: boolean;
}

export interface WorkbenchFileTreeView {
  root: string;
  cwdLabel: string;
  revision: string;
  updatedAt: string;
  entries: WorkbenchFileTreeEntry[];
  truncated: boolean;
}

export interface WorkbenchState {
  panes: WorkbenchPaneState[];
  activePaneId?: WorkbenchPaneId;
  focusOwner: WorkbenchFocusOwner;
  fileTree?: WorkbenchFileTreeView;
}

export interface WorkbenchSnapshot {
  panes: WorkbenchPaneSnapshotRef[];
  activePaneId?: WorkbenchPaneId;
  focusOwner: WorkbenchFocusOwner;
  availableTools: TideMcpToolName[];
  fileTree?: WorkbenchFileTreeView;
}

export interface TideMcpToolDefinition {
  name: TideMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}
