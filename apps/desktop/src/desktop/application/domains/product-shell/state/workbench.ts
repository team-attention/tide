import type { ProductShellBrowserActionResult, ProductShellBrowserSnapshot, ProductShellEditorDraft, ProductShellState, ProductShellUpdateResult } from "./types.ts";
import { applyDrop, reconcileTree, setRatioAtPath } from "./workbench-split-tree.ts";
import type { DropZone } from "./workbench-split-tree.ts";
import { closeWorkbenchPane, focusWorkbenchPane, resizeWorkbenchTerminal, writeWorkbenchTerminalInput } from "../../app-chrome/app-chrome-state.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
import { shellTimestamp } from "./create.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

export function toggleProductShellWorkbench(state: ProductShellState): ProductShellState {
  return {
    ...state,
    workbenchOpen: !state.workbenchOpen,
    // Leaving/closing the workbench can't leave a dangling fullscreen.
    workbenchFullscreen: state.workbenchOpen ? false : state.workbenchFullscreen,
  };
}

// Visible workbench pane ids, in tab order — the live set the split tree is
// reconciled against.
function workbenchVisiblePaneIds(state: ProductShellState): string[] {
  return state.appChrome.workbenchPanes.filter((pane) => pane.visible).map((pane) => pane.paneId);
}

// Switch the workbench between tab-group and split (draggable tree) modes.
export function toggleProductShellWorkbenchLayoutMode(state: ProductShellState): ProductShellState {
  const enteringSplit = state.workbenchLayoutMode === "tabs";
  return {
    ...state,
    workbenchLayoutMode: enteringSplit ? "split" : "tabs",
    workbenchLayoutTree: enteringSplit
      ? reconcileTree(state.workbenchLayoutTree, workbenchVisiblePaneIds(state))
      : state.workbenchLayoutTree,
  };
}

// Re-arrange the split tree when a pane is dropped onto another pane's edge
// (split) or center (swap).
export function applyProductShellWorkbenchDrop(
  state: ProductShellState,
  draggedPaneId: string,
  targetPaneId: string,
  zone: DropZone,
): ProductShellState {
  const tree = reconcileTree(state.workbenchLayoutTree, workbenchVisiblePaneIds(state));
  if (tree === null) {
    return state;
  }
  return { ...state, workbenchLayoutTree: applyDrop(tree, draggedPaneId, targetPaneId, zone) };
}

// Resize a split after a divider drag (path = sequence of "a"/"b" to the split).
export function setProductShellWorkbenchSplitRatio(
  state: ProductShellState,
  path: ("a" | "b")[],
  ratio: number,
): ProductShellState {
  const tree = reconcileTree(state.workbenchLayoutTree, workbenchVisiblePaneIds(state));
  if (tree === null) {
    return state;
  }
  return { ...state, workbenchLayoutTree: setRatioAtPath(tree, path, ratio) };
}

// Expand the active workbench pane to fill the window (focus mode), or restore.
// Forces the workbench open when entering fullscreen.
export function toggleProductShellWorkbenchFullscreen(state: ProductShellState): ProductShellState {
  const next = !state.workbenchFullscreen;
  return {
    ...state,
    workbenchFullscreen: next,
    workbenchOpen: next ? true : state.workbenchOpen,
  };
}

export function toggleProductShellWorkbenchWithLauncher(
  state: ProductShellState,
): ProductShellUpdateResult {
  const nextState = toggleProductShellWorkbench(state);
  if (state.workbenchOpen || state.activeThreadId === null) {
    return { state: nextState, command: null };
  }

  const hasVisiblePane = state.appChrome.workbenchPanes.some((pane) => pane.visible);
  if (hasVisiblePane) {
    return { state: nextState, command: null };
  }

  return {
    state: nextState,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_launcher",
      },
    },
  };
}

// Opens the Workbench (if needed) and asks Backend to open the Launcher Pane,
// the entry point for creating Browser/Terminal/Editor/Diff Panes. This is the
// "New Pane" Tab Strip action; it never closes an already-open Workbench.
export function openProductShellWorkbenchLauncher(
  state: ProductShellState,
): ProductShellUpdateResult {
  if (state.activeThreadId === null) {
    return { state, command: null };
  }
  return {
    state: { ...state, workbenchOpen: true },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_launcher",
      },
    },
  };
}

export function selectProductShellLauncherAction(
  state: ProductShellState,
  actionId: string,
): ProductShellUpdateResult {
  if (state.activeThreadId === null) {
    return { state, command: null };
  }
  const launcher = state.appChrome.workbenchPanes.find(
    (pane) => pane.kind === "launcher" && pane.visible,
  );
  const action = launcher?.actions?.find((candidate) => candidate.actionId === actionId);
  // The EMPTY-workbench launcher is a synthetic, frontend-only pane (no backend
  // launcher pane), so `launcher`/`action` are undefined — but its action buttons
  // are the standard set. Allow the known launcher commands to fire even without a
  // real launcher pane (else clicking them on an empty workbench silently no-ops).
  const KNOWN_LAUNCHER_COMMANDS = ["open_terminal", "open_browser", "open_editor"];
  const enabledOnRealLauncher = action !== undefined && action.enabled;
  const knownOnSyntheticLauncher = launcher === undefined && KNOWN_LAUNCHER_COMMANDS.includes(actionId);
  if (!enabledOnRealLauncher && !knownOnSyntheticLauncher) {
    return { state, command: null };
  }
  if (actionId === "open_terminal") {
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "open_terminal",
        },
      },
    };
  }
  if (actionId === "open_browser") {
    return {
      state,
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "open_browser",
        },
      },
    };
  }
  if (actionId === "open_editor") {
    // The Editor launcher entry turns the Launcher pad into an in-pane file picker
    // (a searchable file list right where you clicked). Load the tree behind it; the
    // picker reads it, and choosing a file opens it in the Editor (consuming the
    // launcher). The FileTree column is NOT forced open.
    return {
      state: { ...state, editorPickerFilter: "" },
      command: {
        kind: "workbench.command",
        payload: {
          threadId: state.activeThreadId,
          command: "refresh_file_tree",
          data: { maxDepth: 12, maxEntries: 4000 },
        },
      },
    };
  }
  return { state, command: null };
}

// Update the in-pane editor file-picker's filter text.
export function setProductShellEditorPickerFilter(
  state: ProductShellState,
  filter: string,
): ProductShellState {
  if (state.editorPickerFilter === null) {
    return state;
  }
  return { ...state, editorPickerFilter: filter };
}

// Pick a file from the in-pane editor picker: open it in an Editor Pane (which
// consumes the launcher) and close the picker.
export function selectProductShellEditorPickerFile(
  state: ProductShellState,
  relativePath: string,
): ProductShellUpdateResult {
  if (state.activeThreadId === null) {
    return { state: { ...state, editorPickerFilter: null }, command: null };
  }
  return {
    state: { ...state, editorPickerFilter: null, workbenchOpen: true },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_editor",
        data: { path: relativePath },
      },
    },
  };
}

// Opens an arbitrary file path (e.g. a Read tool's file chip) in the Workbench
// editor, opening the Workbench column if needed.
export function openProductShellFileInEditor(
  state: ProductShellState,
  path: string,
): ProductShellUpdateResult {
  if (state.activeThreadId === null || path.length === 0) {
    return { state, command: null };
  }
  return {
    state: { ...state, workbenchOpen: true },
    command: {
      kind: "workbench.command",
      payload: { threadId: state.activeThreadId, command: "open_editor", data: { path } },
    },
  };
}

// Opens an http(s) link (clicked in a chat message) in the Workbench Browser
// Pane, opening the Workbench column if needed — the default destination for a
// chat link, so it never replaces the app window. The pane's own toolbar offers
// "open in external browser" for when the user wants their system browser.
export function openProductShellBrowserAtUrl(
  state: ProductShellState,
  url: string,
): ProductShellUpdateResult {
  if (state.activeThreadId === null || url.length === 0) {
    return { state, command: null };
  }
  return {
    state: { ...state, workbenchOpen: true },
    command: {
      kind: "workbench.command",
      payload: { threadId: state.activeThreadId, command: "open_browser", data: { url } },
    },
  };
}

export function focusProductShellWorkbenchPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const result = focusWorkbenchPane(state.appChrome, paneId);
  return {
    state: {
      ...state,
      appChrome: result.state,
    },
    command: result.command,
  };
}

export function closeProductShellWorkbenchPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const result = closeWorkbenchPane(state.appChrome, paneId);
  return {
    state: {
      ...state,
      appChrome: result.state,
    },
    command: result.command,
  };
}

export function writeProductShellTerminalInput(
  state: ProductShellState,
  paneId: string,
  bytes: string,
): ProductShellUpdateResult {
  const result = writeWorkbenchTerminalInput(state.appChrome, paneId, bytes);
  return {
    state: {
      ...state,
      appChrome: result.state,
    },
    command: result.command,
  };
}

export function resizeProductShellTerminal(
  state: ProductShellState,
  paneId: string,
  cols: number,
  rows: number,
): ProductShellUpdateResult {
  const result = resizeWorkbenchTerminal(state.appChrome, paneId, cols, rows);
  return {
    state: { ...state, appChrome: result.state },
    command: result.command,
  };
}

export function editProductShellWorkbenchEditorPane(
  state: ProductShellState,
  paneId: string,
  content: string,
): ProductShellState {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (pane === undefined || pane.truncated === true) {
    return state;
  }
  const baseContent = pane.bodyText ?? pane.bodyTextPreview ?? "";
  return {
    ...state,
    editorDrafts: {
      ...state.editorDrafts,
      [paneId]: {
        paneId,
        baseRevision: pane.revision,
        content,
        dirty: content !== baseContent,
        cursorOffset: Math.min(
          state.editorDrafts[paneId]?.cursorOffset ?? content.length,
          content.length,
        ),
      },
    },
  };
}

export function moveProductShellEditorCursor(
  state: ProductShellState,
  paneId: string,
  cursorOffset: number,
): ProductShellState {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (pane === undefined || pane.truncated === true) {
    return state;
  }
  const currentDraft = state.editorDrafts[paneId];
  const content = currentDraft?.content ?? pane.bodyText ?? pane.bodyTextPreview ?? "";
  const boundedOffset = Math.max(0, Math.min(Math.floor(cursorOffset), content.length));

  return {
    ...state,
    editorDrafts: {
      ...state.editorDrafts,
      [paneId]: {
        paneId,
        baseRevision: currentDraft?.baseRevision ?? pane.revision,
        content,
        dirty: currentDraft?.dirty ?? false,
        cursorOffset: boundedOffset,
      },
    },
  };
}

export function goToProductShellEditorDefinition(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (state.activeThreadId === null || pane === undefined || pane.truncated === true) {
    return { state, command: null };
  }
  const draft = state.editorDrafts[paneId];
  const content = draft?.content ?? pane.bodyText ?? pane.bodyTextPreview ?? "";
  const position = offsetToLineCharacter(content, draft?.cursorOffset ?? 0);

  return {
    state: {
      ...state,
      appChrome: {
        ...state.appChrome,
        activeWorkbenchPaneId: paneId,
      },
    },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "go_to_definition",
        targetPaneId: paneId,
        // A dirty draft rides along so the backend resolves against what's on
        // screen, not the stale on-disk file.
        data: draft?.dirty === true ? { ...position, content } : position,
      },
    },
  };
}

export function goToProductShellEditorReferences(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  if (state.activeThreadId === null || pane === undefined || pane.truncated === true) {
    return { state, command: null };
  }
  const draft = state.editorDrafts[paneId];
  const content = draft?.content ?? pane.bodyText ?? pane.bodyTextPreview ?? "";
  const position = offsetToLineCharacter(content, draft?.cursorOffset ?? 0);

  return {
    state: {
      ...state,
      appChrome: {
        ...state.appChrome,
        activeWorkbenchPaneId: paneId,
      },
    },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "go_to_references",
        targetPaneId: paneId,
        // Same dirty-buffer ride-along as go_to_definition.
        data: draft?.dirty === true ? { ...position, content } : position,
      },
    },
  };
}

export function updateProductShellBrowserSnapshot(
  state: ProductShellState,
  paneId: string,
  snapshot: ProductShellBrowserSnapshot,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "browser",
  );
  if (
    state.activeThreadId === null ||
    pane === undefined ||
    snapshot.revision !== pane.revision
  ) {
    return { state, command: null };
  }

  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "update_browser_snapshot",
        targetPaneId: paneId,
        data: snapshot,
      },
    },
  };
}

export function updateProductShellBrowserActionResult(
  state: ProductShellState,
  paneId: string,
  result: ProductShellBrowserActionResult,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "browser",
  );
  if (
    state.activeThreadId === null ||
    pane === undefined ||
    result.revision !== pane.revision ||
    pane.pendingAction?.actionId !== result.actionId
  ) {
    return { state, command: null };
  }

  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "update_browser_action_result",
        targetPaneId: paneId,
        data: result,
      },
    },
  };
}

// Background (non-active thread) variants: route the snapshot/action result to the
// pane's OWN thread, looked up by threadId, so an offscreen Browser Pane driven by a
// background agent updates the correct thread instead of the active one.
export function updateProductShellBackgroundBrowserSnapshot(
  state: ProductShellState,
  threadId: string,
  paneId: string,
  snapshot: ProductShellBrowserSnapshot,
): ProductShellUpdateResult {
  const pane = state.threads
    .find((thread) => thread.threadId === threadId)
    ?.workbenchPanes.find(
      (candidate) => candidate.paneId === paneId && candidate.kind === "browser",
    );
  if (pane === undefined || snapshot.revision !== pane.revision) {
    return { state, command: null };
  }
  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId,
        command: "update_browser_snapshot",
        targetPaneId: paneId,
        data: snapshot,
      },
    },
  };
}

export function updateProductShellBackgroundBrowserActionResult(
  state: ProductShellState,
  threadId: string,
  paneId: string,
  result: ProductShellBrowserActionResult,
): ProductShellUpdateResult {
  const pane = state.threads
    .find((thread) => thread.threadId === threadId)
    ?.workbenchPanes.find(
      (candidate) => candidate.paneId === paneId && candidate.kind === "browser",
    );
  if (
    pane === undefined ||
    result.revision !== pane.revision ||
    pane.pendingAction?.actionId !== result.actionId
  ) {
    return { state, command: null };
  }
  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId,
        command: "update_browser_action_result",
        targetPaneId: paneId,
        data: result,
      },
    },
  };
}

export function saveProductShellWorkbenchEditorPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  const pane = state.appChrome.workbenchPanes.find(
    (candidate) => candidate.paneId === paneId && candidate.kind === "editor",
  );
  const draft = state.editorDrafts[paneId];
  if (
    state.activeThreadId === null ||
    pane === undefined ||
    pane.truncated === true ||
    draft === undefined ||
    !draft.dirty
  ) {
    return { state, command: null };
  }
  return {
    state,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "save_editor_file",
        targetPaneId: paneId,
        data: {
          baseRevision: draft.baseRevision,
          content: draft.content,
        },
      },
    },
  };
}

export function reconcileEditorDrafts(
  drafts: Record<string, ProductShellEditorDraft>,
  panes: AppChromeWorkbenchPaneRef[],
): Record<string, ProductShellEditorDraft> {
  const next: Record<string, ProductShellEditorDraft> = {};
  for (const pane of panes) {
    if (pane.kind !== "editor" || pane.visible === false || pane.truncated === true) {
      continue;
    }
    const draft = drafts[pane.paneId];
    if (draft === undefined) {
      continue;
    }
    const baseContent = pane.bodyText ?? pane.bodyTextPreview ?? "";
    if (draft.baseRevision === pane.revision) {
      next[pane.paneId] = draft;
      continue;
    }
    if (draft.content !== baseContent) {
      next[pane.paneId] = {
        paneId: pane.paneId,
        baseRevision: pane.revision,
        content: baseContent,
        dirty: false,
        cursorOffset: 0,
      };
    }
  }
  return next;
}

function offsetToLineCharacter(
  content: string,
  offset: number,
): { line: number; character: number } {
  const boundedOffset = Math.max(0, Math.min(Math.floor(offset), content.length));
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < boundedOffset; index += 1) {
    if (content[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return {
    line,
    character: boundedOffset - lineStart,
  };
}

export function workbenchPane(
  paneId: string,
  kind: AppChromeWorkbenchPaneRef["kind"],
  title: string,
): AppChromeWorkbenchPaneRef {
  return {
    paneId,
    kind,
    title,
    visible: true,
    revision: "preview-1",
    updatedAt: shellTimestamp,
  };
}
