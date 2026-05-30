import type { WorkbenchPaneId } from "./ids.ts";

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
  pendingAction?: BrowserPaneActionDto;
  lastAction?: BrowserPaneActionResultDto;
}

export type BrowserPaneActionKindDto = "click" | "type_text";

export interface BrowserPaneActionDto {
  actionId: string;
  kind: BrowserPaneActionKindDto;
  selector: string;
  text?: string;
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
