import {
  closeProductShellEditorPicker,
  editProductShellWorkbenchEditorPane,
  ensureComposerDraftThreadActive,
  goToProductShellEditorDefinition,
  goToProductShellEditorReferences,
  moveProductShellEditorCursor,
  newProductShellFile,
  openProductShellFileInEditor,
  saveProductShellWorkbenchEditorPane,
  selectProductShellEditorPickerFile,
  selectProductShellFileTreeEntry,
  setProductShellEditorPickerFilter,
  toggleProductShellFileTreeWithRefresh,
} from "../../../../../application/domains/product-shell/product-shell.ts";
// Extracted from product-shell.ts (entry-module rule follow-up).

import { deriveEditorRoot } from "../workbench/code-intel-mappers.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ProductShellHandlerContext } from "./context.ts";

export function createEditorHandlers(ctx: ProductShellHandlerContext): Pick<ProductShellHandlers, "onOpenFile" | "onEditorPickerFilter" | "onEditorPickerSelect" | "onEditorPickerCancel" | "onEditorDraftChange" | "onEditorCursorChange" | "onEditorSave" | "onEditorGoToDefinition" | "onEditorGoToReferences" | "onEditorCodeIntel" | "onFileTreeEntryOpen" | "onCreateFile" | "onFileTreeToggle"> {
  const { props, shellState, getShellState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, startColumnResize } = ctx;

  const ensureDraftForFilePane = (state: typeof shellState): ReturnType<typeof ensureComposerDraftThreadActive> => {
    if (state.activeThreadId !== null) {
      return { state, command: null };
    }
    return ensureComposerDraftThreadActive(state);
  };

  const fileTreeEntryKind = (
    state: typeof shellState,
    entryId: string,
  ): "file" | "folder" | undefined =>
    state.fileTree?.entries.find(
      (entry) => entry.id === entryId || entry.relativePath === entryId,
    )?.kind;

  return {
    onOpenFile: (path) => {
      const currentState = getShellState();
      if (currentState.activeThreadId === null) {
        const ensured = ensureDraftForFilePane(currentState);
        const result = openProductShellFileInEditor(ensured.state, path);
        setShellState(result.state);
        if (ensured.command !== null) dispatchBackendCommand(ensured.command);
        dispatchBackendCommand(result.command);
        return;
      }
      setShellState((state) => {
        const result = openProductShellFileInEditor(state, path);
        dispatchBackendCommand(result.command);
        return result.state;
      });
    },
    onEditorPickerFilter: (filter) =>
      setShellState((state) => setProductShellEditorPickerFilter(state, filter)),
    onEditorPickerSelect: (relativePath) =>
      setShellState((state) => {
        const result = selectProductShellEditorPickerFile(state, relativePath);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditorPickerCancel: () =>
      setShellState((state) => closeProductShellEditorPicker(state)),
    onEditorDraftChange: (paneId, content) =>
      setShellState((state) => editProductShellWorkbenchEditorPane(state, paneId, content)),
    onEditorCursorChange: (paneId, cursorOffset) =>
      setShellState((state) => moveProductShellEditorCursor(state, paneId, cursorOffset)),
    onEditorSave: (paneId) =>
      setShellState((state) => {
        const result = saveProductShellWorkbenchEditorPane(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditorGoToDefinition: (paneId, position) => {
      setShellState((state) => {
        const result = goToProductShellEditorDefinition(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      });
    },
    onEditorGoToReferences: (paneId, position) => {
      setShellState((state) => {
        const result = goToProductShellEditorReferences(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      });
    },
    // Query-style round-trip: posts workspace.codeIntel and hands the result
    // payload back to the caller. Deliberately NOT dispatchBackendCommand —
    // that would fold the response events into shell state and re-render the
    // shell on every keystroke/hover.
    onEditorCodeIntel: async (input) => {
      if (props.onBackendCommand === undefined) {
        return null;
      }
      const pane = shellState.appChrome.workbenchPanes.find(
        (candidate) => candidate.paneId === input.paneId && candidate.kind === "editor",
      );
      if (pane === undefined || pane.filePath === undefined) {
        return null;
      }
      const cwd = deriveEditorRoot(pane.filePath, pane.relativePath);
      const filePath = pane.filePath;
      const events = await props.onBackendCommand({
        kind: "workspace.codeIntel",
        payload: {
          cwd,
          path: filePath,
          kind: input.kind,
          content: input.content,
          line: input.line,
          character: input.character,
        },
      });
      if (!Array.isArray(events)) {
        return null;
      }
      const result = events.find((event) => event.kind === "workspace.codeIntelResult");
      if (result === undefined || result.payload.ok !== true) {
        return null;
      }
      return result.payload;
    },
    onFileTreeEntryOpen: (entryId) => {
      const currentState = getShellState();
      if (currentState.activeThreadId === null && fileTreeEntryKind(currentState, entryId) === "file") {
        const ensured = ensureDraftForFilePane(currentState);
        const result = selectProductShellFileTreeEntry(ensured.state, entryId);
        setShellState(result.state);
        if (ensured.command !== null) dispatchBackendCommand(ensured.command);
        dispatchBackendCommand(result.command);
        return;
      }
      setShellState((state) => {
        const result = selectProductShellFileTreeEntry(state, entryId);
        dispatchBackendCommand(result.command);
        return result.state;
      });
    },
    onCreateFile: (relativePath) => {
      const currentState = getShellState();
      if (currentState.activeThreadId === null) {
        const ensured = ensureDraftForFilePane(currentState);
        const result = newProductShellFile(ensured.state, relativePath);
        setShellState(result.state);
        if (ensured.command !== null) dispatchBackendCommand(ensured.command);
        dispatchBackendCommand(result.command);
        return;
      }
      setShellState((state) => {
        const result = newProductShellFile(state, relativePath);
        dispatchBackendCommand(result.command);
        return result.state;
      });
    },
    onFileTreeToggle: () =>
      setShellState((state) => {
        const result = toggleProductShellFileTreeWithRefresh(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
  };
}
