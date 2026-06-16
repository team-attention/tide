import type {
  ProductShellDraftPane,
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
// untitled tabs, the composer Launcher, and draft Browser/Changes panes are all
// renderer-local panes the view-model assembles around the backend snapshot. Spec:
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
    visible: true,
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
    visible: true,
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
// (no backend pane opened): a synthetic Launcher first, then the live draft Browser Panes,
// then the start-page editor and any untitled tabs. Once the user opens a backend pane the
// Composer's Draft Thread becomes the active thread and the view-model renders it through
// the normal active-thread path instead. See docs_v2/specs/composer-draft-thread.md.
export function composerWorkbenchAppChrome(
  appChrome: ProductShellState["appChrome"],
  draftPanes: ProductShellDraftPane[],
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
    (draftPanes.length === 0 && startFiles.length === 0 && untitled.length === 0);
  const panes: AppChromeWorkbenchPaneRef[] = [
    ...(showLauncher ? [composerLauncherPane()] : []),
    ...draftPanes.map(draftPaneRef),
    ...startFiles.map(startFileEditorPane),
    ...untitled.map(untitledEditorPane),
  ];
  const activeWorkbenchPaneId =
    draftActivePaneId !== null && panes.some((pane) => pane.paneId === draftActivePaneId)
      ? draftActivePaneId
      : panes[0]?.paneId;
  return { ...appChrome, workbenchPanes: panes, activeWorkbenchPaneId };
}

// The composer Launcher: every pane works pre-send. Browser opens a renderer-owned draft
// pane; Editor/Terminal/Diff open against the Composer's backend Draft Thread (created on
// first use), so a real Terminal PTY / Editor / git Changes view is live before send and
// carries into the Thread on send. See docs_v2/specs/composer-draft-thread.md.
function composerLauncherPane(): AppChromeWorkbenchPaneRef {
  return {
    paneId: COMPOSER_LAUNCHER_PANE_ID,
    kind: "launcher",
    title: "Launcher",
    visible: true,
    revision: COMPOSER_LAUNCHER_PANE_ID,
    updatedAt: shellTimestamp,
    actions: [
      { actionId: "open_browser", label: "Browser", description: "Open a Browser Pane", enabled: true },
      { actionId: "open_editor", label: "Editor", description: "Pick a file from the FileTree to edit", enabled: true },
      { actionId: "open_terminal", label: "Terminal", description: "Open a visible Terminal Pane", enabled: true },
      { actionId: "open_diff", label: "Diff", description: "View working-tree changes (git)", enabled: true },
    ],
  };
}

function draftPaneRef(pane: ProductShellDraftPane): AppChromeWorkbenchPaneRef {
  // The composer git Changes draft: a renderer-local Changes pane rendered purely from its
  // cwd (ChangesPanel self-fetches). Spec: git-changes-view (Composer pre-thread Changes).
  if (pane.kind === "changes") {
    return {
      paneId: pane.paneId,
      kind: "changes",
      title: pane.title,
      visible: true,
      revision: "draft",
      updatedAt: shellTimestamp,
      cwd: pane.cwd,
    };
  }
  return {
    paneId: pane.paneId,
    kind: "browser",
    title: pane.title,
    visible: true,
    // Stable revision: a draft Browser Pane is renderer-owned (its <webview> drives
    // itself); the revision only identifies the pane, it never gates a snapshot here.
    revision: "draft",
    updatedAt: shellTimestamp,
    url: pane.url,
    loading: false,
  };
}
