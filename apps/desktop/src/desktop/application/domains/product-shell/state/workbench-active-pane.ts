import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";

export function resolveProductShellActiveWorkbenchPaneId(
  panes: AppChromeWorkbenchPaneRef[],
  paneId: string | undefined,
): string | undefined {
  return paneId !== undefined && panes.some((pane) => pane.paneId === paneId)
    ? paneId
    : panes[0]?.paneId;
}
