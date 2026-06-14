import type { WorkbenchPaneId } from "./ids.ts";

// Stacked = one active pane + flat tab strip; Split = the draggable binary
// split-tree. Per-Thread, backend-authoritative (so the agent can observe + set
// it). Mirrors the v1 Tide Terminal "Terminal Context Surface" presentation.
export type WorkbenchLayoutModeDto = "stacked" | "split";

// A pane to seed into a NEW Thread's Workbench at thread.start — a pane the user
// opened on the composer (New Thread) screen, adopted by the Thread the first send
// creates. browser carries an optional url; editor a workspace-relative path.
export interface WorkbenchSeedPaneDto {
  kind: "browser" | "editor";
  url?: string;
  path?: string;
  title?: string;
}

export interface BaseWorkbenchPaneRefDto {
  paneId: WorkbenchPaneId;
  kind: "browser" | "diff" | "editor" | "terminal" | "launcher";
  title: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
}

export interface BrowserPaneRefDto extends BaseWorkbenchPaneRefDto {
  kind: "browser";
  url?: string;
  pageTitle?: string;
  bodyTextPreview?: string;
  loading: boolean;
  // Backend-authoritative computer-use driving state (see
  // docs_v2/specs/browser-pane-agent-computer-use.md). agentDriving = the Agent is
  // operating this Pane via a computer-use turn; agentCursor = last pointer position
  // in screenshot-pixel space for the on-screen cursor theater.
  agentDriving: boolean;
  agentCursor?: { x: number; y: number };
  pendingAction?: BrowserPaneActionDto;
  lastAction?: BrowserPaneActionResultDto;
}

export type BrowserPaneActionKindDto =
  | "click"
  | "type_text"
  | "move_to"
  | "click_at"
  | "scroll"
  | "key"
  | "type";

export type BrowserPaneButtonDto = "left" | "right" | "middle";

export interface BrowserPaneActionDto {
  actionId: string;
  kind: BrowserPaneActionKindDto;
  // Selector path (reliability fallback): set for "click" / "type_text".
  selector?: string;
  text?: string;
  // Coordinate computer-use path (screenshot-pixel space): "move_to"/"click_at"/"scroll"
  // carry x/y; "scroll" adds deltaX/deltaY; "click_at" adds button/clickCount; "key"
  // carries keys; "type" carries text (typed into the focused element).
  x?: number;
  y?: number;
  button?: BrowserPaneButtonDto;
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  keys?: string;
  requestedAt: string;
}

export interface BrowserPaneActionResultDto extends BrowserPaneActionDto {
  status: "completed" | "failed";
  message: string;
  completedAt: string;
}

export interface NonBrowserWorkbenchPaneRefDto extends BaseWorkbenchPaneRefDto {
  kind: "diff" | "editor" | "terminal";
  filePath?: string;
  relativePath?: string;
  bodyText?: string;
  bodyTextPreview?: string;
  byteLength?: number;
  truncated?: boolean;
  navigationTarget?: WorkbenchEditorNavigationTargetDto;
  references?: WorkbenchEditorReferenceListDto;
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

export interface WorkbenchEditorNavigationTargetDto {
  line: number;
  character: number;
  length?: number;
  label?: string;
  sourcePaneId?: WorkbenchPaneId;
}

export interface WorkbenchEditorReferenceDto {
  relativePath: string;
  line: number;
  character: number;
  length?: number;
  label?: string;
}

export interface WorkbenchEditorReferenceListDto {
  query?: string;
  items: WorkbenchEditorReferenceDto[];
  truncated: boolean;
}

export interface LauncherPaneActionDto {
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

export interface LauncherPaneRefDto extends BaseWorkbenchPaneRefDto {
  kind: "launcher";
  actions: LauncherPaneActionDto[];
}

export type WorkbenchPaneRefDto =
  | BrowserPaneRefDto
  | NonBrowserWorkbenchPaneRefDto
  | LauncherPaneRefDto;

export interface WorkbenchFileTreeEntryDto {
  id: string;
  name: string;
  relativePath: string;
  depth: number;
  kind: "folder" | "file";
  active?: boolean;
}

export interface WorkbenchFileTreeDto {
  root: string;
  cwdLabel: string;
  revision: string;
  updatedAt: string;
  entries: WorkbenchFileTreeEntryDto[];
  truncated: boolean;
}
