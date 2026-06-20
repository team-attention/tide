import type { ProductShellEditorDraft, ProductShellState, ProductShellUpdateResult } from "./types.ts";
import { isUntitledPaneId } from "./types.ts";
import { editProductShellUntitledFile, requestProductShellUntitledSaveAs } from "./untitled-files.ts";
import type { AppChromeWorkbenchPaneRef } from "../../app-chrome/app-chrome-state.ts";

// Editor reducers, split out of workbench.ts (spec: workbench-dock-parity /
// navigable-source-structure). The Workbench shell, layout, launcher, and browser
// reducers stay in workbench.ts; this file owns the in-pane file picker, editor
// buffer/cursor/save, and code navigation for backend-owned thread Editor Panes.

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

export function closeProductShellEditorPicker(
  state: ProductShellState,
): ProductShellState {
  return state.editorPickerFilter === null
    ? state
    : { ...state, editorPickerFilter: null };
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
  // Untitled (blank, not-yet-saved) file: the buffer lives in untitledFiles, shown
  // in both thread and start contexts.
  if (isUntitledPaneId(paneId)) {
    return editProductShellUntitledFile(state, paneId, content);
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
  // Untitled (blank) file: Cmd+S opens the Save As name bar instead of writing — the
  // file has no name/path on disk yet. The handler resolves the typed name.
  if (isUntitledPaneId(paneId)) {
    return { state: requestProductShellUntitledSaveAs(state, paneId), command: null };
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
    if (pane.kind !== "editor" || pane.truncated === true) {
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
