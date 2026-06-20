import type {
  ProductShellEditorDraft,
  ProductShellState,
  ProductShellUntitledFile,
} from "./types.ts";
import { COMPOSER_LAUNCHER_PANE_ID, isUntitledPaneId } from "./types.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { shellTimestamp } from "./create.ts";
// Renderer-derived Workbench panes for the composer (New Thread) page and untitled
// files — split out of view-model.ts (file-size ratchet). The composer Launcher is
// the only pre-Draft pane. Files, Browser, Terminal, and Diff first create the
// Composer Draft Thread and then render as backend-owned Workbench panes. Spec:
// workbench-dock-parity / workbench-filetree-file-operations.

// A VSCode-style untitled (blank, not-yet-saved) file as a Workbench editor pane.
// No backing file yet, so the saved base is empty and there is no filePath (code
// intelligence is skipped). The live buffer rides in the editor draft below.
function untitledEditorPane(file: ProductShellUntitledFile): AppChromeWorkbenchPaneRef {
  return {
    paneId: file.id,
    kind: "editor",
    title: file.title,
    revision: file.id,
    updatedAt: shellTimestamp,
    relativePath: file.title,
    filePath: undefined,
    bodyText: "",
    truncated: false,
  };
}

export function untitledEditorDraft(file: ProductShellUntitledFile): ProductShellEditorDraft {
  return {
    paneId: file.id,
    baseRevision: file.id,
    content: file.draft,
    dirty: file.dirty,
    cursorOffset: 0,
  };
}

// Inside a thread the Workbench is backend-authoritative; untitled tabs are appended
// onto (never stored in) that snapshot, so the next backend update can't clobber
// them. A renderer-local active override (draftActivePaneId pointing at an untitled
// tab) wins so a just-created untitled is focused.
export function appendUntitledPanes(
  appChrome: ProductShellState["appChrome"],
  untitled: ProductShellUntitledFile[],
  draftActivePaneId: string | null,
): ProductShellState["appChrome"] {
  if (untitled.length === 0) {
    return appChrome;
  }
  const panes = [...appChrome.workbenchPanes, ...untitled.map(untitledEditorPane)];
  const activeWorkbenchPaneId =
    draftActivePaneId !== null &&
    isUntitledPaneId(draftActivePaneId) &&
    panes.some((pane) => pane.paneId === draftActivePaneId)
      ? draftActivePaneId
      : appChrome.activeWorkbenchPaneId;
  return { ...appChrome, workbenchPanes: panes, activeWorkbenchPaneId };
}

// Build the composer (New Thread) page Workbench view when no Draft Thread is active yet:
// a synthetic Launcher only. Once the user opens any real pane, the Composer's Draft
// Thread becomes the active thread and the view-model renders it through the normal
// active-thread path instead. See docs_v2/specs/composer-draft-thread.md.
export function composerWorkbenchAppChrome(
  appChrome: ProductShellState["appChrome"],
  untitled: ProductShellUntitledFile[],
  draftActivePaneId: string | null,
): ProductShellState["appChrome"] {
  // The Launcher is a PLACEHOLDER (v1 parity): show it only when it's the active
  // intent (the user pressed + / just opened the Workbench) or the composer
  // Workbench is otherwise empty. Picking an action adds the real pane and
  // activates it, so the placeholder drops out — i.e. the Launcher is "resolved"
  // into the chosen pane rather than persisting beside it.
  const showLauncher =
    draftActivePaneId === COMPOSER_LAUNCHER_PANE_ID ||
    untitled.length === 0;
  const panes: AppChromeWorkbenchPaneRef[] = [
    ...(showLauncher ? [composerLauncherPane()] : []),
    ...untitled.map(untitledEditorPane),
  ];
  const activeWorkbenchPaneId =
    draftActivePaneId !== null && panes.some((pane) => pane.paneId === draftActivePaneId)
      ? draftActivePaneId
      : panes[0]?.paneId;
  return { ...appChrome, workbenchPanes: panes, activeWorkbenchPaneId };
}

// The composer Launcher: every pane works pre-send by creating the Composer's backend
// Draft Thread on first use, so Browser/Editor/Terminal/Diff are real Thread Workbench
// panes before send and carry into the Thread on send. See docs_v2/specs/composer-draft-thread.md.
function composerLauncherPane(): AppChromeWorkbenchPaneRef {
  return {
    paneId: COMPOSER_LAUNCHER_PANE_ID,
    kind: "launcher",
    title: "Launcher",
    revision: COMPOSER_LAUNCHER_PANE_ID,
    updatedAt: shellTimestamp,
    actions: [
      { actionId: "open_browser", label: "Browser", description: "Open a Browser Pane", enabled: true },
      { actionId: "open_editor", label: "Editor", description: "Pick a file from the FileTree to edit", enabled: true },
      { actionId: "open_terminal", label: "Terminal", description: "Open a Terminal Pane", enabled: true },
      { actionId: "open_diff", label: "Diff", description: "View working-tree changes (git)", enabled: true },
    ],
  };
}
