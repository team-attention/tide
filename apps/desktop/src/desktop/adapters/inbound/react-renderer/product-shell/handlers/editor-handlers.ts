import { closeProductShellStartPageFile, editProductShellWorkbenchEditorPane, goToProductShellEditorDefinition, goToProductShellEditorReferences, moveProductShellEditorCursor, openProductShellFileInEditor, saveProductShellWorkbenchEditorPane, selectProductShellEditorPickerFile, selectProductShellFileTreeEntry, setProductShellEditorPickerFilter, toggleProductShellFileTreeWithRefresh } from "../../../../../application/domains/product-shell/product-shell.ts";
// Extracted from product-shell.ts (entry-module rule follow-up).

import { deriveEditorRoot } from "../workbench/code-intel-mappers.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ProductShellHandlerContext } from "./context.ts";

export function createEditorHandlers(ctx: ProductShellHandlerContext): Pick<ProductShellHandlers, "onOpenFile" | "onEditorPickerFilter" | "onEditorPickerSelect" | "onEditorDraftChange" | "onEditorCursorChange" | "onEditorSave" | "onEditorGoToDefinition" | "onEditorGoToReferences" | "onEditorCodeIntel" | "onStartPageFileClose" | "onFileTreeEntryOpen" | "onFileTreeToggle"> {
  const { props, shellState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, startColumnResize } = ctx;
  return {
    onOpenFile: (path) =>
      setShellState((state) => {
        const result = openProductShellFileInEditor(state, path);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditorPickerFilter: (filter) =>
      setShellState((state) => setProductShellEditorPickerFilter(state, filter)),
    onEditorPickerSelect: (relativePath) =>
      setShellState((state) => {
        const result = selectProductShellEditorPickerFile(state, relativePath);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
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
    onEditorGoToDefinition: (paneId) =>
      setShellState((state) => {
        const result = goToProductShellEditorDefinition(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditorGoToReferences: (paneId) =>
      setShellState((state) => {
        const result = goToProductShellEditorReferences(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    // Query-style round-trip: posts workspace.codeIntel and hands the result
    // payload back to the caller. Deliberately NOT dispatchBackendCommand —
    // that would fold the response events into shell state and re-render the
    // shell on every keystroke/hover.
    onEditorCodeIntel: async (input) => {
      const pane = shellState.appChrome.workbenchPanes.find(
        (candidate) => candidate.paneId === input.paneId && candidate.kind === "editor",
      );
      const filePath = pane?.filePath;
      if (pane === undefined || filePath === undefined || props.onBackendCommand === undefined) {
        return null;
      }
      const events = await props.onBackendCommand({
        kind: "workspace.codeIntel",
        payload: {
          cwd: deriveEditorRoot(filePath, pane.relativePath),
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
    onStartPageFileClose: () =>
      setShellState((state) => closeProductShellStartPageFile(state)),
    onFileTreeEntryOpen: (entryId) =>
      setShellState((state) => {
        const result = selectProductShellFileTreeEntry(state, entryId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onFileTreeToggle: () =>
      setShellState((state) => {
        const result = toggleProductShellFileTreeWithRefresh(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
  };
}
