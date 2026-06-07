import type { ThreadRecord } from "../domains/thread/thread.ts";
import type { LauncherPaneState } from "../domains/workbench/workbench.ts";
import { launcherPaneActions } from "./workbench-snapshot.ts";

// Launcher Pane management for a Thread's Workbench. Pure functions over the
// thread's pane list (the launcher is the empty-workbench entry point that opens
// Browser/Editor/Terminal/Diff). Extracted from thread-runtime-service.ts.

const WORKBENCH_LAUNCHER_TITLE = "Workbench launcher";

export function activeLauncherPaneId(thread: ThreadRecord): string | undefined {
  const active = thread.workbench.panes.find(
    (pane) => pane.paneId === thread.workbench.activePaneId,
  );
  return active?.kind === "launcher" ? active.paneId : undefined;
}

export function removeLauncherPane(
  thread: ThreadRecord,
  paneId: string | undefined,
): void {
  if (paneId === undefined) {
    return;
  }
  const index = thread.workbench.panes.findIndex(
    (pane) => pane.paneId === paneId && pane.kind === "launcher",
  );
  if (index >= 0) {
    thread.workbench.panes.splice(index, 1);
  }
}

export function openWorkbenchLauncher(
  thread: ThreadRecord,
  idGenerator: () => string,
  clock: () => string,
): LauncherPaneState {
  const existingPane = thread.workbench.panes.find(
    (pane): pane is LauncherPaneState => pane.kind === "launcher",
  );
  if (existingPane !== undefined) {
    existingPane.visible = true;
    existingPane.title = WORKBENCH_LAUNCHER_TITLE;
    existingPane.actions = launcherPaneActions();
    existingPane.revision = idGenerator();
    existingPane.updatedAt = clock();
    return existingPane;
  }

  const pane: LauncherPaneState = {
    paneId: idGenerator(),
    kind: "launcher",
    title: WORKBENCH_LAUNCHER_TITLE,
    visible: true,
    revision: idGenerator(),
    updatedAt: clock(),
    actions: launcherPaneActions(),
  };
  thread.workbench.panes.push(pane);
  return pane;
}
