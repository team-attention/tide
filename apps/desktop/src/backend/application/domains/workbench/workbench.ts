export type WorkbenchPaneId = string;

export type WorkbenchPaneKind =
  | "browser"
  | "diff"
  | "editor"
  | "image"
  | "terminal"
  | "launcher"
  | "changes";

export type WorkbenchFocusOwner = "composer" | "workbench";

// Stacked = one active pane + flat tab strip; Split = the draggable binary
// split-tree. Per-Thread, backend-authoritative. v1 Terminal Context Surface parity.
export type WorkbenchLayoutMode = "stacked" | "split";

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
  | "tide_go_to_references"
  | "tide_open_terminal"
  | "tide_run_terminal_command"
  | "tide_focus_pane"
  | "tide_close_pane"
  | "tide_set_workbench_layout";

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
  "tide_go_to_references",
  "tide_open_terminal",
  "tide_run_terminal_command",
  "tide_focus_pane",
  "tide_close_pane",
  "tide_set_workbench_layout",
];

export interface WorkbenchPaneRef {
  paneId: WorkbenchPaneId;
  kind: WorkbenchPaneKind;
  title: string;
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
  revision: string;
  updatedAt: string;
  bodyTextPreview?: string;
  // Backend-authoritative computer-use driving state. agentDriving = the Agent is
  // operating this Pane via a computer-use turn; agentCursor = last pointer position
  // in screenshot-pixel space (for the on-screen cursor theater). Cleared on release
  // (user takeover) and turn end. See docs_v2/specs/browser-pane-agent-computer-use.md.
  agentDriving?: boolean;
  agentCursor?: { x: number; y: number };
  // Set when the USER took manual control of this Pane (the "Take control" button). While
  // set, the agent's tide_act_browser is softly refused so it yields + continues its turn
  // instead of re-driving or hitting a cryptic stale-reference; observe still works. Cleared
  // at turn end (spec: composer-prompt-browser-fixes / browser-pane-agent-computer-use).
  userControlled?: boolean;
  // Latest captured pixel-vision screenshot (filled by the renderer's capturePage).
  // Attached to observe output only for mode=screenshot|both; kept out of general
  // Workbench snapshots to avoid shipping the image on every state change.
  screenshot?: BrowserPaneScreenshot;
  // An in-flight, observe-driven pixel-capture request. Set when tide_observe_browser
  // (mode=screenshot|both) needs FRESH pixels: the renderer host watches this on the pane,
  // calls capturePage() for this captureId, and reports back via update_browser_capture_result.
  // Screenshots are pulled on demand at observe time — NOT eagerly on every page-load event —
  // so a mounted (incl. background) pane never PNG-encodes on the recurring load-event storm.
  // Spec: docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.
  pendingCapture?: { captureId: string; requestedAt: string };
  pendingAction?: BrowserPaneActionRequest;
  lastAction?: BrowserPaneActionResult;
  // The pane's revision immediately BEFORE its most recent settled act-completion re-mint,
  // kept so tide_act_browser can auto-retry one step of staleness from the agent's OWN prior
  // action (D5, spec browser-pane-live-pull-vision.md). Cleared on navigation so that a
  // post-navigation stale act is never auto-retried.
  priorRevision?: string;
}

export type BrowserPaneActionKind =
  | "click"
  | "type_text"
  | "move_to"
  | "click_at"
  | "scroll"
  | "key"
  | "type";

export type BrowserPaneButton = "left" | "right" | "middle";

export interface BrowserPaneActionRequest {
  actionId: string;
  kind: BrowserPaneActionKind;
  // Selector path (reliability fallback): set for "click" / "type_text".
  selector?: string;
  text?: string;
  // Coordinate computer-use path (screenshot-pixel space). See
  // docs_v2/specs/browser-pane-agent-computer-use.md.
  x?: number;
  y?: number;
  button?: BrowserPaneButton;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  keys?: string;
  requestedAt: string;
}

export interface BrowserPaneActionResult extends BrowserPaneActionRequest {
  status: "completed" | "failed";
  message: string;
  completedAt: string;
}

// Pixel vision: a captured raster image of the rendered <webview> page, surfaced to the
// Agent as an MCP image content block via tide_observe_browser mode=screenshot|both.
// data is base64; coordinates the agent picks are viewport CSS px (devicePixelRatio
// reports the pixel-to-CSS ratio). See docs_v2/specs/browser-pane-agent-computer-use.md.
export interface BrowserPaneScreenshot {
  data: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface TerminalPaneState {
  paneId: WorkbenchPaneId;
  kind: "terminal";
  terminalRole?: "session" | "command_result" | "provider_readiness";
  title: string;
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
  revision: string;
  updatedAt: string;
  bodyText: string;
  bodyTextPreview: string;
  byteLength: number;
  truncated: boolean;
  navigationTarget?: WorkbenchEditorNavigationTarget;
  references?: WorkbenchEditorReferenceList;
}

export interface ImagePaneState {
  paneId: WorkbenchPaneId;
  kind: "image";
  title: string;
  root: string;
  filePath: string;
  relativePath: string;
  revision: string;
  updatedAt: string;
  mimeType: string;
  dataBase64: string;
  byteLength: number;
}

export interface WorkbenchEditorNavigationTarget {
  line: number;
  character: number;
  length?: number;
  label?: string;
  sourcePaneId?: WorkbenchPaneId;
}

export interface WorkbenchEditorReference {
  relativePath: string;
  line: number;
  character: number;
  length?: number;
  label?: string;
}

export interface WorkbenchEditorReferenceList {
  query?: string;
  items: WorkbenchEditorReference[];
  truncated: boolean;
}

export interface DiffPaneState {
  paneId: WorkbenchPaneId;
  kind: "diff";
  title: string;
  filePath: string;
  relativePath: string;
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
  revision: string;
  updatedAt: string;
  actions: LauncherPaneAction[];
}

// Read-only git "Changes" pane (working tree vs HEAD). A first-class, SINGLETON pane —
// only one per workbench. It carries just the repo cwd; the renderer fetches the file
// list + per-file diffs (Main-process git) on demand. Spec: git-changes-view.
export interface ChangesPaneState {
  paneId: WorkbenchPaneId;
  kind: "changes";
  title: string;
  revision: string;
  updatedAt: string;
  cwd: string;
}

export type WorkbenchPaneState =
  | BrowserPaneState
  | TerminalPaneState
  | EditorPaneState
  | ImagePaneState
  | DiffPaneState
  | LauncherPaneState
  | ChangesPaneState;

export interface BrowserPaneRef extends WorkbenchPaneRef {
  kind: "browser";
  url?: string;
  pageTitle?: string;
  loading: boolean;
  bodyTextPreview?: string;
  agentDriving: boolean;
  agentCursor?: { x: number; y: number };
  screenshot?: BrowserPaneScreenshot;
  pendingCapture?: { captureId: string; requestedAt: string };
  pendingAction?: BrowserPaneActionRequest;
  lastAction?: BrowserPaneActionResult;
  stale: boolean;
  availableTools: TideMcpToolName[];
}

export interface NonBrowserWorkbenchPaneRef extends WorkbenchPaneRef {
  kind: "diff" | "editor" | "image" | "terminal" | "changes";
  root?: string;
  filePath?: string;
  relativePath?: string;
  bodyText?: string;
  bodyTextPreview?: string;
  dataBase64?: string;
  mimeType?: string;
  byteLength?: number;
  truncated?: boolean;
  navigationTarget?: WorkbenchEditorNavigationTarget;
  references?: WorkbenchEditorReferenceList;
  diffText?: string;
  beforeByteLength?: number;
  afterByteLength?: number;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  terminalRole?: "session" | "command_result" | "provider_readiness";
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
  // Stacked/Split presentation, default "stacked" (v1 parity). Mutated by the
  // set_layout_mode Workbench command and the tide_set_workbench_layout MCP tool.
  layoutMode: WorkbenchLayoutMode;
  fileTree?: WorkbenchFileTreeView;
}

export interface WorkbenchSnapshot {
  panes: WorkbenchPaneSnapshotRef[];
  activePaneId?: WorkbenchPaneId;
  focusOwner: WorkbenchFocusOwner;
  layoutMode: WorkbenchLayoutMode;
  availableTools: TideMcpToolName[];
  fileTree?: WorkbenchFileTreeView;
}

export interface TideMcpToolDefinition {
  name: TideMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}
