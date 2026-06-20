import type { ProductShellState, ProductShellUntitledFile, ProductShellUpdateResult } from "./types.ts";
import { untitledPaneId } from "./types.ts";
// VSCode-style untitled files: "New File" opens a blank buffer immediately and the
// name is chosen on save (Save As). The buffer is renderer-owned until it has a
// path, but it must be bound to a real thread (including the Composer Draft Thread)
// so saved files reopen through the backend Workbench. Spec:
// workbench-filetree-file-operations.

// The absolute workspace root the active context writes into: the project cwd of the
// active thread (or the composer's project on the start page), falling back to the
// loaded file-tree root. Null when there is no project directory (e.g. an unstarted
// scratch composer) — New File is a no-op then.
export function resolveActiveWorkspaceCwd(state: ProductShellState): string | null {
  if (state.activeThreadId === null) {
    return state.fileTree?.root ?? null;
  }
  if (state.activeThreadId === state.draftThreadId && state.agentChat.thread === null) {
    const scope = state.agentChat.composer.startOptions.scope;
    if (scope?.kind === "project" && scope.cwd.length > 0) {
      return scope.cwd;
    }
    if (scope?.kind === "scratch" && scope.scratchCwd.length > 0) {
      return scope.scratchCwd;
    }
  }
  const thread = state.threads.find((candidate) => candidate.threadId === state.activeThreadId);
  if (thread !== undefined) {
    if (thread.scope.kind === "project" && thread.scope.cwd.length > 0) {
      return thread.scope.cwd;
    }
    if (thread.scope.kind === "scratch" && thread.scope.scratchCwd.length > 0) {
      return thread.scope.scratchCwd;
    }
  }
  return state.fileTree?.root ?? null;
}

export function untitledFileForPane(
  state: ProductShellState,
  paneId: string,
): ProductShellUntitledFile | undefined {
  return state.untitledFiles.find((file) => file.id === paneId);
}

// Open a new blank untitled file bound to the active context, focus it, and open the
// Workbench. No-op when there is no workspace directory to eventually save into.
export function newProductShellUntitledFile(state: ProductShellState): ProductShellState {
  if (state.activeThreadId === null) {
    return state;
  }
  const scopeCwd = resolveActiveWorkspaceCwd(state);
  if (scopeCwd === null) {
    return state;
  }
  const sequence = state.untitledSequence + 1;
  const id = untitledPaneId(sequence);
  const file: ProductShellUntitledFile = {
    id,
    title: `Untitled-${sequence}`,
    draft: "",
    dirty: false,
    threadId: state.activeThreadId,
    scopeCwd,
  };
  return {
    ...state,
    untitledFiles: [...state.untitledFiles, file],
    untitledSequence: sequence,
    workbenchOpen: true,
    workbenchOpenByThreadId: {
      ...state.workbenchOpenByThreadId,
      [state.activeThreadId]: true,
    },
    draftActiveWorkbenchPaneId: id,
  };
}

// Update an untitled file's live buffer (the view-model re-derives its tab's content).
export function editProductShellUntitledFile(
  state: ProductShellState,
  paneId: string,
  content: string,
): ProductShellState {
  const file = untitledFileForPane(state, paneId);
  if (file === undefined) {
    return state;
  }
  return {
    ...state,
    untitledFiles: state.untitledFiles.map((candidate) =>
      candidate === file ? { ...candidate, draft: content, dirty: content.length > 0 } : candidate,
    ),
  };
}

// Cmd+S on an untitled pane: open its Save As name bar (an untitled always prompts,
// even when empty).
export function requestProductShellUntitledSaveAs(
  state: ProductShellState,
  paneId: string,
): ProductShellState {
  if (untitledFileForPane(state, paneId) === undefined) {
    return state;
  }
  return { ...state, untitledSaveAsPaneId: paneId, fileTreeNotice: null };
}

export function cancelProductShellUntitledSaveAs(state: ProductShellState): ProductShellState {
  if (state.untitledSaveAsPaneId === null) {
    return state;
  }
  return { ...state, untitledSaveAsPaneId: null };
}

// After the file is created on disk (handler did window.tide.fsCreateFile), drop the
// untitled and open the now-real file through the thread Workbench. Tree refresh is
// dispatched separately by the handler.
export function productShellUntitledSaved(
  state: ProductShellState,
  paneId: string,
  savedRelativePath: string,
): ProductShellUpdateResult {
  const file = untitledFileForPane(state, paneId);
  if (file === undefined) {
    return { state, command: null };
  }
  const cleared: ProductShellState = {
    ...state,
    untitledFiles: state.untitledFiles.filter((candidate) => candidate !== file),
    untitledSaveAsPaneId: state.untitledSaveAsPaneId === paneId ? null : state.untitledSaveAsPaneId,
    workbenchOpen: true,
  };

  if (file.threadId === null) {
    return { state: { ...cleared, draftActiveWorkbenchPaneId: null }, command: null };
  }
  return {
    state: { ...cleared, draftActiveWorkbenchPaneId: null },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: file.threadId,
        command: "open_editor",
        data: { path: savedRelativePath },
      },
    },
  };
}

// Close (discard) an untitled tab. Returns the next pane to focus if it was active.
export function removeProductShellUntitledFile(
  state: ProductShellState,
  paneId: string,
): ProductShellState {
  const file = untitledFileForPane(state, paneId);
  if (file === undefined) {
    return state;
  }
  const untitledFiles = state.untitledFiles.filter((candidate) => candidate !== file);
  return {
    ...state,
    untitledFiles,
    untitledSaveAsPaneId: state.untitledSaveAsPaneId === paneId ? null : state.untitledSaveAsPaneId,
    draftActiveWorkbenchPaneId:
      state.draftActiveWorkbenchPaneId === paneId ? null : state.draftActiveWorkbenchPaneId,
  };
}
