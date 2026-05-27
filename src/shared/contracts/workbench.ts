import type { WorkbenchPaneId } from "./ids.ts";

export interface BaseWorkbenchPaneRefDto {
  paneId: WorkbenchPaneId;
  kind: "browser" | "diff" | "editor" | "terminal";
  title: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
}

export interface BrowserPaneRefDto extends BaseWorkbenchPaneRefDto {
  kind: "browser";
  url?: string;
  pageTitle?: string;
  loading: boolean;
}

export interface NonBrowserWorkbenchPaneRefDto extends BaseWorkbenchPaneRefDto {
  kind: "diff" | "editor" | "terminal";
}

export type WorkbenchPaneRefDto =
  | BrowserPaneRefDto
  | NonBrowserWorkbenchPaneRefDto;
