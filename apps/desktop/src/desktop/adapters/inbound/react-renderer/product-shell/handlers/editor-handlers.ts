import { applyStartPageEditorDefinition, applyStartPageEditorReferences, editProductShellWorkbenchEditorPane, goToProductShellEditorDefinition, goToProductShellEditorReferences, isStartFilePaneId, moveProductShellEditorCursor, openProductShellFileInEditor, saveProductShellWorkbenchEditorPane, selectProductShellEditorPickerFile, selectProductShellFileTreeEntry, setProductShellEditorPickerFilter, startFilePaneId, toggleProductShellFileTreeWithRefresh } from "../../../../../application/domains/product-shell/product-shell.ts";
// Extracted from product-shell.ts (entry-module rule follow-up).

import { deriveEditorRoot } from "../workbench/code-intel-mappers.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ProductShellHandlerContext } from "./context.ts";

// A resolved code location parsed out of the (loosely-typed) IPC codeIntelResult.
interface CodeLocation {
  relativePath: string;
  line: number;
  character: number;
  length?: number;
  label?: string;
}

function coerceCodeLocation(value: unknown): CodeLocation | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.relativePath !== "string" ||
    typeof record.line !== "number" ||
    typeof record.character !== "number"
  ) {
    return null;
  }
  return {
    relativePath: record.relativePath,
    line: record.line,
    character: record.character,
    length: typeof record.length === "number" ? record.length : undefined,
    label: typeof record.label === "string" ? record.label : undefined,
  };
}

function coerceReferences(value: unknown): { items: CodeLocation[]; truncated: boolean } | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.items)) {
    return null;
  }
  return {
    items: record.items.flatMap((item) => {
      const location = coerceCodeLocation(item);
      return location === null ? [] : [location];
    }),
    truncated: record.truncated === true,
  };
}

export function createEditorHandlers(ctx: ProductShellHandlerContext): Pick<ProductShellHandlers, "onOpenFile" | "onEditorPickerFilter" | "onEditorPickerSelect" | "onEditorDraftChange" | "onEditorCursorChange" | "onEditorSave" | "onEditorGoToDefinition" | "onEditorGoToReferences" | "onEditorCodeIntel" | "onFileTreeEntryOpen" | "onFileTreeToggle"> {
  const { props, shellState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, startColumnResize } = ctx;

  // Go-to-definition / find-references for the THREAD-LESS start-page editor.
  // The thread-bound workbench command stores its result on a thread pane; here
  // there is no thread, so we run the same query thread-independently
  // (workspace.codeIntel) and apply the result to startPageFile. `position` comes
  // from the editor (the start-page cursor isn't tracked in shell state).
  const runStartPageCodeNav = async (
    kind: "definition" | "references",
    paneId: string,
    position?: { line: number; character: number },
  ): Promise<void> => {
    const file = shellState.startPageFiles.find((open) => startFilePaneId(open.relativePath) === paneId);
    if (file === undefined || position === undefined || props.onBackendCommand === undefined) {
      return;
    }
    const events = await props.onBackendCommand({
      kind: "workspace.codeIntel",
      payload: {
        cwd: file.cwd,
        path: `${file.cwd.replace(/\/+$/, "")}/${file.relativePath}`,
        kind,
        content: file.draft ?? file.content,
        line: position.line,
        character: position.character,
      },
    });
    if (!Array.isArray(events)) {
      return;
    }
    const result = events.find((event) => event.kind === "workspace.codeIntelResult");
    if (result === undefined || result.payload.ok !== true) {
      return;
    }
    if (kind === "definition") {
      const location = coerceCodeLocation(result.payload.definition);
      if (location === null) {
        return;
      }
      setShellState((state) => {
        const applied = applyStartPageEditorDefinition(state, paneId, location);
        dispatchBackendCommand(applied.command);
        return applied.state;
      });
    } else {
      const references = coerceReferences(result.payload.references);
      if (references === null) {
        return;
      }
      setShellState((state) => applyStartPageEditorReferences(state, paneId, references));
    }
  };

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
    onEditorGoToDefinition: (paneId, position) => {
      if (isStartFilePaneId(paneId)) {
        void runStartPageCodeNav("definition", paneId, position);
        return;
      }
      setShellState((state) => {
        const result = goToProductShellEditorDefinition(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      });
    },
    onEditorGoToReferences: (paneId, position) => {
      if (isStartFilePaneId(paneId)) {
        void runStartPageCodeNav("references", paneId, position);
        return;
      }
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
      // workspace.codeIntel is thread-independent (keyed by cwd), so it serves the
      // start-page editor too — resolve its cwd/path from startPageFile (the
      // synthetic pane isn't in appChrome.workbenchPanes). Other panes resolve
      // from their pane's filePath.
      let cwd: string;
      let filePath: string;
      if (isStartFilePaneId(input.paneId)) {
        const file = shellState.startPageFiles.find(
          (open) => startFilePaneId(open.relativePath) === input.paneId,
        );
        if (file === undefined) {
          return null;
        }
        cwd = file.cwd;
        filePath = `${file.cwd.replace(/\/+$/, "")}/${file.relativePath}`;
      } else {
        const pane = shellState.appChrome.workbenchPanes.find(
          (candidate) => candidate.paneId === input.paneId && candidate.kind === "editor",
        );
        if (pane === undefined || pane.filePath === undefined) {
          return null;
        }
        cwd = deriveEditorRoot(pane.filePath, pane.relativePath);
        filePath = pane.filePath;
      }
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
