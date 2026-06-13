import type { ProductShellEditorDraft, ProductShellState, ProductShellUpdateResult } from "./types.ts";
import { START_FILE_PANE_ID } from "./types.ts";
import type { AppChromeEditorNavigationTarget, AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";
// Editor + start-page-editor reducers, split out of workbench.ts (spec:
// workbench-dock-parity / navigable-source-structure). The Workbench shell, layout,
// launcher, and browser reducers stay in workbench.ts; this file owns the in-pane
// file picker, the editor buffer/cursor/save, and code navigation (definition /
// references) for both thread Editor Panes and the thread-independent start-page editor.

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

export function editProductShellWorkbenchEditorPane(
  state: ProductShellState,
  paneId: string,
  content: string,
): ProductShellState {
  // Start-page editor: the open file lives in startPageFile (there is no
  // thread-bound pane before a thread exists). Track edits there; the view-model
  // re-derives the editor's buffer from it.
  if (paneId === START_FILE_PANE_ID) {
    const file = state.startPageFile;
    if (state.activeThreadId !== null || file === null || file.truncated) {
      return state;
    }
    return {
      ...state,
      startPageFile: { ...file, draft: content, dirty: content !== file.content },
    };
  }
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

// Apply a thread-independent go-to-definition result to the start-page editor.
// Same-file targets scroll in place; a different-file target opens that file
// first (workspace.readFile) and rides in via startPagePendingNavigation, which
// the workspace.fileLoaded reducer applies once the content lands.
export function applyStartPageEditorDefinition(
  state: ProductShellState,
  location: { relativePath: string; line: number; character: number; length?: number; label?: string },
): ProductShellUpdateResult {
  const file = state.startPageFile;
  if (state.activeThreadId !== null || file === null) {
    return { state, command: null };
  }
  const target: AppChromeEditorNavigationTarget = {
    line: location.line,
    character: location.character,
    length: location.length,
    label: location.label,
    sourcePaneId: START_FILE_PANE_ID,
  };
  if (location.relativePath === file.relativePath) {
    return {
      state: { ...state, startPageFile: { ...file, navigationTarget: target } },
      command: null,
    };
  }
  return {
    state: {
      ...state,
      startPagePendingNavigation: { relativePath: location.relativePath, target },
    },
    command: {
      kind: "workspace.readFile",
      payload: { cwd: file.cwd, path: location.relativePath },
    },
  };
}

// Apply a thread-independent find-references result to the start-page editor's
// references panel.
export function applyStartPageEditorReferences(
  state: ProductShellState,
  references: {
    items: Array<{ relativePath: string; line: number; character: number; length?: number; label?: string }>;
    truncated: boolean;
  },
): ProductShellState {
  const file = state.startPageFile;
  if (state.activeThreadId !== null || file === null) {
    return state;
  }
  return {
    ...state,
    startPageFile: {
      ...file,
      references: {
        query: file.relativePath,
        truncated: references.truncated,
        items: references.items.map((item) => ({
          relativePath: item.relativePath,
          line: item.line,
          character: item.character,
          length: item.length,
          label: item.label,
        })),
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

export function saveProductShellWorkbenchEditorPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUpdateResult {
  // Start-page editor save: there is no thread to host save_editor_file, so write
  // the file thread-independently under the composer cwd (spec:
  // start-page-file-viewer). The fileSaved event re-bases the editor.
  if (paneId === START_FILE_PANE_ID) {
    const file = state.startPageFile;
    if (
      state.activeThreadId !== null ||
      file === null ||
      file.truncated ||
      file.dirty !== true ||
      file.draft === undefined
    ) {
      return { state, command: null };
    }
    return {
      state,
      command: {
        kind: "workspace.writeFile",
        payload: { cwd: file.cwd, path: file.relativePath, content: file.draft },
      },
    };
  }
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
