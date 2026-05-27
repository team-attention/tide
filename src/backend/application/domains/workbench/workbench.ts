export type WorkbenchPaneId = string;

export type WorkbenchPaneKind = "browser" | "diff" | "editor" | "terminal";

export type WorkbenchFocusOwner = "composer" | "workbench";

export type TideMcpToolName =
  | "tide_observe_thread"
  | "tide_observe_workbench"
  | "tide_open_browser"
  | "tide_observe_browser";

export const TIDE_MCP_WORKBENCH_TOOL_NAMES: TideMcpToolName[] = [
  "tide_observe_thread",
  "tide_observe_workbench",
  "tide_open_browser",
  "tide_observe_browser",
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
}

export type WorkbenchPaneState = BrowserPaneState;

export interface BrowserPaneRef extends WorkbenchPaneRef {
  kind: "browser";
  url?: string;
  pageTitle?: string;
  loading: boolean;
  bodyTextPreview?: string;
  stale: boolean;
  availableTools: TideMcpToolName[];
}

export interface NonBrowserWorkbenchPaneRef extends WorkbenchPaneRef {
  kind: "diff" | "editor" | "terminal";
}

export type WorkbenchPaneSnapshotRef =
  | BrowserPaneRef
  | NonBrowserWorkbenchPaneRef;

export interface WorkbenchState {
  panes: WorkbenchPaneState[];
  activePaneId?: WorkbenchPaneId;
  focusOwner: WorkbenchFocusOwner;
}

export interface WorkbenchSnapshot {
  panes: WorkbenchPaneSnapshotRef[];
  activePaneId?: WorkbenchPaneId;
  focusOwner: WorkbenchFocusOwner;
  availableTools: TideMcpToolName[];
}

export interface TideMcpToolDefinition {
  name: TideMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}
