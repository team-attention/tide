import type { WorkbenchPaneId } from "./ids.ts";

export interface WorkbenchPaneRefDto {
  paneId: WorkbenchPaneId;
  kind: "browser" | "diff" | "editor" | "terminal";
  title: string;
  visible: boolean;
  updatedAt: string;
}
