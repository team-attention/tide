import type {
  BrowserPaneRef,
  BrowserPaneState,
  DiffPaneState,
  EditorPaneState,
  LauncherPaneState,
  TerminalPaneState,
  WorkbenchLayoutMode,
  WorkbenchPaneRef,
  WorkbenchPaneSnapshotRef,
  WorkbenchSnapshot,
  WorkbenchState,
} from "../../domains/workbench/workbench.ts";
import { TIDE_MCP_WORKBENCH_TOOL_NAMES } from "../../domains/workbench/workbench.ts";
import { cloneFileTreeView } from "../thread/thread-runtime-clone.ts";
import { cloneEnv } from "../support/record-helpers.ts";

// Maps Workbench domain state into snapshot/pane-ref shapes for Agent Session and
// Tide MCP observe output. Pure: depends only on domain types and leaf clone
// helpers. Extracted from thread-runtime-service.ts to keep the service focused
// on behavior.

export function snapshotWorkbench(workbench: WorkbenchState): WorkbenchSnapshot {
  return {
    panes: workbench.panes.map(workbenchSnapshotPaneRef),
    activePaneId: workbench.activePaneId,
    focusOwner: workbench.focusOwner,
    layoutMode: workbench.layoutMode,
    availableTools: [...TIDE_MCP_WORKBENCH_TOOL_NAMES],
    fileTree:
      workbench.fileTree === undefined
        ? undefined
        : cloneFileTreeView(workbench.fileTree),
  };
}

export function workbenchPaneRef(
  pane: WorkbenchState["panes"][number],
): WorkbenchPaneRef {
  return {
    paneId: pane.paneId,
    kind: pane.kind,
    title: pane.title,
    visible: pane.visible,
    revision: pane.revision,
    updatedAt: pane.updatedAt,
  };
}

export function browserPaneRef(pane: BrowserPaneState): BrowserPaneRef {
  return {
    ...workbenchPaneRef(pane),
    kind: "browser",
    url: pane.url,
    pageTitle: pane.pageTitle,
    loading: pane.loading,
    bodyTextPreview: pane.bodyTextPreview,
    agentDriving: pane.agentDriving ?? false,
    agentCursor: pane.agentCursor === undefined ? undefined : { ...pane.agentCursor },
    pendingAction:
      pane.pendingAction === undefined ? undefined : { ...pane.pendingAction },
    lastAction: pane.lastAction === undefined ? undefined : { ...pane.lastAction },
    stale: false,
    availableTools: [...TIDE_MCP_WORKBENCH_TOOL_NAMES],
  };
}

export function terminalPaneRef(pane: TerminalPaneState): WorkbenchPaneSnapshotRef {
  return {
    ...workbenchPaneRef(pane),
    kind: "terminal",
    command: pane.command,
    args: pane.args === undefined ? undefined : [...pane.args],
    env: cloneEnv(pane.env),
    cwd: pane.cwd,
    status: pane.status,
    expectedCompletion: pane.expectedCompletion,
    transcriptPreview: pane.transcriptPreview,
    exitCode: pane.exitCode,
    signal: pane.signal,
    timedOut: pane.timedOut,
    startedAt: pane.startedAt,
    completedAt: pane.completedAt,
  };
}

export function editorPaneRef(pane: EditorPaneState): WorkbenchPaneSnapshotRef {
  return {
    ...workbenchPaneRef(pane),
    kind: "editor",
    filePath: pane.filePath,
    relativePath: pane.relativePath,
    bodyText: pane.truncated ? undefined : pane.bodyText,
    bodyTextPreview: pane.bodyTextPreview,
    byteLength: pane.byteLength,
    truncated: pane.truncated,
    navigationTarget:
      pane.navigationTarget === undefined ? undefined : { ...pane.navigationTarget },
    references:
      pane.references === undefined
        ? undefined
        : {
            query: pane.references.query,
            truncated: pane.references.truncated,
            items: pane.references.items.map((item) => ({ ...item })),
          },
  };
}

export function diffPaneRef(pane: DiffPaneState): WorkbenchPaneSnapshotRef {
  return {
    ...workbenchPaneRef(pane),
    kind: "diff",
    filePath: pane.filePath,
    relativePath: pane.relativePath,
    diffText: pane.diffText,
    truncated: pane.truncated,
    beforeByteLength: pane.beforeByteLength,
    afterByteLength: pane.afterByteLength,
  };
}

export function launcherPaneRef(pane: LauncherPaneState): WorkbenchPaneSnapshotRef {
  return {
    ...workbenchPaneRef(pane),
    kind: "launcher",
    actions: pane.actions.map((action) => ({ ...action })),
  };
}

export function workbenchSnapshotPaneRef(
  pane: WorkbenchState["panes"][number],
): WorkbenchPaneSnapshotRef {
  if (pane.kind === "browser") {
    return browserPaneRef(pane);
  }
  if (pane.kind === "editor") {
    return editorPaneRef(pane);
  }
  if (pane.kind === "diff") {
    return diffPaneRef(pane);
  }
  if (pane.kind === "launcher") {
    return launcherPaneRef(pane);
  }
  return terminalPaneRef(pane);
}

export function launcherPaneActions(): LauncherPaneState["actions"] {
  return [
    {
      actionId: "open_browser",
      label: "Browser",
      description: "Open a Browser Pane",
      enabled: true,
    },
    {
      actionId: "open_editor",
      label: "Editor",
      description: "Pick a file from the FileTree to edit",
      enabled: true,
    },
    {
      actionId: "open_terminal",
      label: "Terminal",
      description: "Open a visible Terminal Pane",
      enabled: true,
    },
    {
      actionId: "open_diff",
      label: "Diff",
      description: "Available after a file edit or review target",
      enabled: false,
    },
  ];
}

export function firstBrowserPane(
  workbench: WorkbenchState,
): BrowserPaneState | undefined {
  // Only a VISIBLE browser pane is reusable. close_pane merely hides a pane
  // (visible=false) rather than removing it; without this filter, opening a
  // browser after closing one reused the hidden pane with its stale URL/page
  // instead of starting fresh.
  const activePane = workbench.panes.find(
    (pane): pane is BrowserPaneState =>
      pane.kind === "browser" && pane.paneId === workbench.activePaneId && pane.visible,
  );
  return (
    activePane ??
    workbench.panes.find((pane): pane is BrowserPaneState => pane.kind === "browser" && pane.visible)
  );
}

export function workbenchPaneById(
  workbench: WorkbenchState,
  paneId: string | undefined,
): WorkbenchState["panes"][number] | undefined {
  if (paneId === undefined) {
    return undefined;
  }
  return workbench.panes.find((pane) => pane.paneId === paneId);
}

export function firstVisiblePane(
  workbench: WorkbenchState,
): WorkbenchState["panes"][number] | undefined {
  return workbench.panes.find((pane) => pane.visible);
}

// Reveal + activate a pane. Mutates the workbench; returns the pane (or undefined
// if absent). Shared by the focus_pane Workbench command and tide_focus_pane.
export function focusWorkbenchPaneState(
  workbench: WorkbenchState,
  paneId: string | undefined,
  clock: () => string,
): WorkbenchState["panes"][number] | undefined {
  const pane = workbenchPaneById(workbench, paneId);
  if (pane === undefined) {
    return undefined;
  }
  pane.visible = true;
  pane.updatedAt = clock();
  workbench.activePaneId = pane.paneId;
  workbench.focusOwner = "workbench";
  return pane;
}

// Hide a pane and reassign the active pane / focus owner. Mutates the workbench;
// returns the pane (or undefined if absent). PTY teardown for a terminal pane is
// the caller's responsibility (it owns the runtime). Shared by the close_pane
// Workbench command and tide_close_pane.
export function closeWorkbenchPaneState(
  workbench: WorkbenchState,
  paneId: string | undefined,
  clock: () => string,
): WorkbenchState["panes"][number] | undefined {
  const pane = workbenchPaneById(workbench, paneId);
  if (pane === undefined) {
    return undefined;
  }
  pane.visible = false;
  if (pane.kind === "terminal" && pane.status === "running") {
    pane.status = "completed";
  }
  pane.updatedAt = clock();
  if (workbench.activePaneId === pane.paneId) {
    workbench.activePaneId = firstVisiblePane(workbench)?.paneId;
  }
  workbench.focusOwner =
    workbench.activePaneId === undefined ? "composer" : workbench.focusOwner;
  return pane;
}

// Set the Stacked/Split presentation. Shared by the set_layout_mode Workbench
// command and tide_set_workbench_layout.
export function setWorkbenchLayoutModeState(
  workbench: WorkbenchState,
  mode: WorkbenchLayoutMode,
): void {
  workbench.layoutMode = mode;
}
