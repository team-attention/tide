import type {
  ProductShellEditorDraft,
  ProductShellStartPageFile,
  ProductShellState,
  ProductShellUntitledFile,
} from "./types.ts";
import { COMPOSER_LAUNCHER_PANE_ID, isUntitledPaneId, startFilePaneId } from "./types.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { shellTimestamp } from "./create.ts";
// Renderer-derived Workbench panes for the composer (New Thread) page and untitled
// files — split out of view-model.ts (file-size ratchet). The start-page editor,
// untitled tabs, and the composer Launcher are renderer-local panes the view-model
// assembles before a backend Draft Thread exists. Spec:
// workbench-dock-parity / workbench-filetree-file-operations.

// A start (New Thread) page open file, as a Workbench editor pane. There is no
// thread/backend pane before a thread exists, so each pane is derived from a
// startPageFiles entry each render under a per-file id; the editor's draft/save/
// close handlers special-case start-file panes. A truncated read stays read-only.
function startFileEditorPane(file: ProductShellStartPageFile): AppChromeWorkbenchPaneRef {
  const name = file.relativePath.slice(file.relativePath.lastIndexOf("/") + 1);
  const paneId = startFilePaneId(file.relativePath);
  return {
    paneId,
    kind: "editor",
    title: name,
    // Stable: the editor is value-controlled, so the revision only identifies the
    // pane; it never drives a remount here.
    revision: paneId,
    updatedAt: shellTimestamp,
    relativePath: file.relativePath,
    filePath: `${file.cwd.replace(/\/+$/, "")}/${file.relativePath}`,
    bodyText: file.content,
    truncated: file.truncated,
    navigationTarget: file.navigationTarget,
    references: file.references,
  };
}

export function startFileEditorDraft(file: ProductShellStartPageFile): ProductShellEditorDraft {
  const paneId = startFilePaneId(file.relativePath);
  return {
    paneId,
    baseRevision: paneId,
    content: file.draft ?? file.content,
    dirty: file.dirty ?? false,
    cursorOffset: 0,
  };
}

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

// Build the composer (New Thread) page Workbench view when no Draft Thread is active yet
// (no backend pane opened): a synthetic Launcher first, then the start-page editor and
// any untitled tabs. Once the user opens a backend pane the Composer's Draft Thread
// becomes the active thread and the view-model renders it through the normal active-thread
// path instead. See docs_v2/specs/composer-draft-thread.md.
export function composerWorkbenchAppChrome(
  appChrome: ProductShellState["appChrome"],
  startFiles: ProductShellStartPageFile[],
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
    (startFiles.length === 0 && untitled.length === 0);
  const panes: AppChromeWorkbenchPaneRef[] = [
    ...(showLauncher ? [composerLauncherPane()] : []),
    ...startFiles.map(startFileEditorPane),
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
