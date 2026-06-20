import type { ProductShellBackendCommand, ProductShellFileTreeEntryView, ProductShellFileTreeMenu, ProductShellFileTreeView, ProductShellState, ProductShellTreeEdit, ProductShellUpdateResult } from "./types.ts";
import { startFilePaneId } from "./types.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

export function toggleProductShellFileTree(state: ProductShellState): ProductShellState {
  return {
    ...state,
    fileTreeOpen: !state.fileTreeOpen,
  };
}

export function toggleProductShellFileTreeWithRefresh(
  state: ProductShellState,
): ProductShellUpdateResult {
  const nextState = toggleProductShellFileTree(state);
  // Closing: nothing to load.
  if (state.fileTreeOpen) {
    return { state: nextState, command: null };
  }
  // Opening on the start (New Thread) page: show the composer-selected project's
  // file tree at the root level (no thread yet).
  if (state.activeThreadId === null) {
    const command = fileTreeLazyRefreshCommand(state, []);
    return {
      state: command === null ? nextState : { ...nextState, fileTree: null, expandedFolderPaths: [] },
      command,
    };
  }
  // Opening for an active thread: refresh that thread's tree at the currently
  // expanded set (root level on a fresh open).
  return {
    state: nextState,
    command: fileTreeLazyRefreshCommand(state, state.expandedFolderPaths),
  };
}

// A lazy FileTree listing: Backend lists the root plus only the `expandedPaths`
// subtrees (a collapsed folder is one entry, never walked). Routes to the active
// thread's workbench, or — on the start (New Thread) page — to the composer's
// project cwd. A scratch scope has no directory yet, so there is nothing to list.
function fileTreeLazyRefreshCommand(
  state: ProductShellState,
  expandedPaths: string[],
): ProductShellBackendCommand | null {
  if (state.activeThreadId !== null) {
    return {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "refresh_file_tree",
        data: { expandedPaths, maxEntries: 4000 },
      },
    };
  }
  const scope = state.agentChat.composer.startOptions.scope;
  if (scope?.kind === "project" && scope.cwd.length > 0) {
    return {
      kind: "workspace.readFileTree",
      payload: { cwd: scope.cwd, expandedPaths, maxEntries: 4000 },
    };
  }
  return null;
}

// True when the loaded entries already contain a direct child of `folderPath`, so
// re-expanding it reveals from the cache with no Backend round-trip.
function fileTreeChildrenLoaded(
  state: ProductShellState,
  folderPath: string,
): boolean {
  const prefix = `${folderPath}/`;
  return (state.fileTree?.entries ?? []).some(
    (entry) =>
      entry.relativePath.startsWith(prefix) &&
      !entry.relativePath.slice(prefix.length).includes("/"),
  );
}

// Reload the current tree (same expanded set) after a filesystem mutation, so the
// new/renamed/moved/deleted entry is reflected. Null when the tree is closed or has
// no directory to list.
export function refreshProductShellFileTreeCommand(
  state: ProductShellState,
): ProductShellBackendCommand | null {
  if (!state.fileTreeOpen) {
    return null;
  }
  return fileTreeLazyRefreshCommand(state, state.expandedFolderPaths);
}

// When the start-page composer scope changes while the file tree is open, reload the
// tree for the new directory. Returns null when not on the start page / tree closed.
export function refreshStartPageFileTree(
  state: ProductShellState,
): ProductShellBackendCommand | null {
  if (state.activeThreadId !== null || !state.fileTreeOpen) {
    return null;
  }
  // Scope changed to a different project: re-list at the root level. The
  // workspace.fileTreeLoaded reducer resets expansion when the root changes.
  return fileTreeLazyRefreshCommand(state, []);
}

export function selectProductShellFileTreeEntry(
  state: ProductShellState,
  entryId: string,
): ProductShellUpdateResult {
  if (state.fileTree === null) {
    return { state, command: null };
  }
  const entry = state.fileTree.entries.find(
    (candidate) => candidate.id === entryId || candidate.relativePath === entryId,
  );
  if (entry === undefined) {
    return { state, command: null };
  }

  // Folders toggle expansion. Collapsing, and re-expanding a folder whose children
  // are already loaded, are client-side only (no Backend round-trip). Expanding a
  // not-yet-loaded folder marks it loading (the UI shows a skeleton child row) and
  // lazily fetches children via a refresh carrying the new expanded set. Works on
  // the START PAGE too (the lazy refresh routes to the composer cwd when there is
  // no thread).
  if (entry.kind === "folder") {
    const expanded = new Set(state.expandedFolderPaths);
    if (expanded.has(entry.relativePath)) {
      expanded.delete(entry.relativePath);
      return { state: { ...state, expandedFolderPaths: [...expanded] }, command: null };
    }
    expanded.add(entry.relativePath);
    const nextExpanded = [...expanded];
    if (fileTreeChildrenLoaded(state, entry.relativePath)) {
      return { state: { ...state, expandedFolderPaths: nextExpanded }, command: null };
    }
    const command = fileTreeLazyRefreshCommand(state, nextExpanded);
    return {
      state: {
        ...state,
        expandedFolderPaths: nextExpanded,
        fileTree:
          command === null || state.fileTree === null
            ? state.fileTree
            : { ...state.fileTree, loadingFolderPath: entry.relativePath },
      },
      command,
    };
  }

  // Start page: no thread yet, so there is no thread-bound workbench to open an
  // Editor Pane in. Read the file thread-independently; the view-model renders it
  // as a read/write editor pane in the Workbench column (spec:
  // start-page-file-viewer). Open the workbench now so the column animates in
  // immediately instead of after the read round-trip.
  if (state.activeThreadId === null) {
    const scope = state.agentChat.composer.startOptions.scope;
    if (scope?.kind !== "project" || scope.cwd.length === 0) {
      return { state, command: null };
    }
    // Already open as a tab → just focus it (don't re-read, which would discard an
    // unsaved draft). A new file reads in and opens its OWN tab (the fileLoaded
    // reducer appends it), rather than replacing the current editor.
    const alreadyOpen = state.startPageFiles.some(
      (file) => file.cwd === scope.cwd && file.relativePath === entry.relativePath,
    );
    if (alreadyOpen) {
      return {
        state: {
          ...state,
          workbenchOpen: true,
          draftActiveWorkbenchPaneId: startFilePaneId(entry.relativePath),
        },
        command: null,
      };
    }
    return {
      state: { ...state, workbenchOpen: true },
      command: {
        kind: "workspace.readFile",
        payload: { cwd: scope.cwd, path: entry.relativePath },
      },
    };
  }

  return {
    state: {
      ...state,
      workbenchOpen: true,
    },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_editor",
        data: {
          path: entry.relativePath,
        },
      },
    },
  };
}

// An entry is visible only when every ancestor folder on its path is expanded.
// New File: create a blank file at `relativePath` under the current folder and open it
// for editing (spec: workbench-new-file.md). Mirrors selectProductShellFileTreeEntry's
// open paths but carries `create: true` so the backend touches the file if missing
// (an existing file is opened, never clobbered). Works on the start page (composer
// cwd, thread-independent) and inside a thread (open_editor resolves the thread cwd).
export function newProductShellFile(
  state: ProductShellState,
  relativePath: string,
): ProductShellUpdateResult {
  // Normalize Windows backslashes to forward slashes first, then strip any leading
  // "./" or "/" so the path is relative (and consistent with the app's forward-slash paths).
  const path = relativePath.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "");
  if (path.length === 0) {
    return { state, command: null };
  }

  if (state.activeThreadId === null) {
    const scope = state.agentChat.composer.startOptions.scope;
    if (scope?.kind !== "project" || scope.cwd.length === 0) {
      return { state, command: null };
    }
    // Already open as a tab → just focus it (don't re-create/read, which would discard
    // an unsaved draft).
    const alreadyOpen = state.startPageFiles.some(
      (file) => file.cwd === scope.cwd && file.relativePath === path,
    );
    if (alreadyOpen) {
      return {
        state: { ...state, workbenchOpen: true, draftActiveWorkbenchPaneId: startFilePaneId(path) },
        command: null,
      };
    }
    return {
      state: { ...state, workbenchOpen: true },
      command: { kind: "workspace.readFile", payload: { cwd: scope.cwd, path, create: true } },
    };
  }

  return {
    state: { ...state, workbenchOpen: true },
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "open_editor",
        data: { path, create: true },
      },
    },
  };
}

export function fileTreePathHasCollapsedAncestor(
  relativePath: string,
  expanded: ReadonlySet<string>,
): boolean {
  const parts = relativePath.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    if (!expanded.has(parts.slice(0, i).join("/"))) {
      return true;
    }
  }
  return false;
}

export function productShellFileTreeFromPayload(
  payload: unknown,
): ProductShellFileTreeView | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const entries = Array.isArray(record.entries)
    ? record.entries.flatMap(productShellFileTreeEntryFromPayload)
    : [];
  const view: ProductShellFileTreeView = {
    cwdLabel:
      typeof record.cwdLabel === "string" && record.cwdLabel.length > 0
        ? record.cwdLabel
        : "tide",
    entries,
  };

  if (typeof record.root === "string") {
    view.root = record.root;
  }
  if (typeof record.revision === "string") {
    view.revision = record.revision;
  }
  if (typeof record.updatedAt === "string") {
    view.updatedAt = record.updatedAt;
  }
  if (typeof record.truncated === "boolean") {
    view.truncated = record.truncated;
  }

  return view;
}

function productShellFileTreeEntryFromPayload(
  payload: unknown,
): ProductShellFileTreeEntryView[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.relativePath !== "string" ||
    typeof record.depth !== "number" ||
    !Number.isInteger(record.depth) ||
    (record.kind !== "folder" && record.kind !== "file")
  ) {
    return [];
  }

  return [
    {
      id: record.id,
      name: record.name,
      relativePath: record.relativePath,
      depth: Math.max(0, record.depth),
      kind: record.kind,
      active: record.active === true,
    },
  ];
}

export function cloneProductShellFileTree(
  fileTree: ProductShellFileTreeView,
): ProductShellFileTreeView {
  return {
    ...fileTree,
    entries: fileTree.entries.map((entry) => ({ ...entry })),
  };
}

// ---------------------------------------------------------------------------
// FileTree mutations: inline new-folder / rename edits, the right-click context
// menu, and reconciling open editor tabs when a path is deleted/renamed/moved.
// The actual filesystem change is a Main-process IPC call from the handler
// (window.tide.fs*); these reducers own only the renderer state around it.
// Spec: workbench-filetree-file-operations.
// ---------------------------------------------------------------------------

// Normalize a typed path fragment: forward slashes, no leading "./" or "/".
export function normalizeRelativeInput(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
}

function joinRelativePath(parent: string, name: string): string {
  return parent === "" ? name : `${parent}/${name}`;
}

export function relativeParentPath(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? "" : relativePath.slice(0, index);
}

export function relativeBaseName(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? relativePath : relativePath.slice(index + 1);
}

// Begin an inline tree edit. New-folder expands the parent folder so the input row
// shows under it; rename prefills the current name.
export function beginProductShellTreeEdit(
  state: ProductShellState,
  edit: { kind: ProductShellTreeEdit["kind"]; parentPath: string; targetPath?: string },
): ProductShellState {
  const draft = edit.kind === "rename" && edit.targetPath !== undefined ? relativeBaseName(edit.targetPath) : "";
  const expanded =
    edit.kind === "new-folder" && edit.parentPath.length > 0 && !state.expandedFolderPaths.includes(edit.parentPath)
      ? [...state.expandedFolderPaths, edit.parentPath]
      : state.expandedFolderPaths;
  return {
    ...state,
    fileTreeMenu: null,
    fileTreeNotice: null,
    fileTreeEdit: { kind: edit.kind, parentPath: edit.parentPath, targetPath: edit.targetPath, draft },
    expandedFolderPaths: expanded,
  };
}

export function setProductShellTreeEditDraft(state: ProductShellState, draft: string): ProductShellState {
  if (state.fileTreeEdit === null) {
    return state;
  }
  return { ...state, fileTreeEdit: { ...state.fileTreeEdit, draft } };
}

export function cancelProductShellTreeEdit(state: ProductShellState): ProductShellState {
  if (state.fileTreeEdit === null) {
    return state;
  }
  return { ...state, fileTreeEdit: null };
}

// Resolve an inline edit to concrete relative paths the Main IPC needs. `toPath` is
// the new folder / renamed destination; `fromPath` is the rename source. Null when
// the typed name is empty (a no-op confirm).
export function resolveProductShellTreeEdit(
  edit: ProductShellTreeEdit,
): { kind: ProductShellTreeEdit["kind"]; fromPath?: string; toPath: string } | null {
  const name = normalizeRelativeInput(edit.draft);
  if (name.length === 0) {
    return null;
  }
  if (edit.kind === "rename") {
    if (edit.targetPath === undefined) {
      return null;
    }
    // A rename keeps the entry under its existing parent; a typed "a/b" is still
    // joined under the parent (move-by-rename is allowed).
    return { kind: "rename", fromPath: edit.targetPath, toPath: joinRelativePath(edit.parentPath, name) };
  }
  return { kind: "new-folder", toPath: joinRelativePath(edit.parentPath, name) };
}

export function openProductShellFileTreeMenu(
  state: ProductShellState,
  menu: ProductShellFileTreeMenu,
): ProductShellState {
  return { ...state, fileTreeMenu: menu };
}

export function closeProductShellFileTreeMenu(state: ProductShellState): ProductShellState {
  if (state.fileTreeMenu === null) {
    return state;
  }
  return { ...state, fileTreeMenu: null };
}

// Open / close the delete confirmation for one entry (closes the context menu).
export function openProductShellFileTreeDelete(
  state: ProductShellState,
  target: ProductShellFileTreeMenu,
): ProductShellState {
  return { ...state, fileTreeMenu: null, fileTreeDeleteTarget: target };
}

export function closeProductShellFileTreeDelete(state: ProductShellState): ProductShellState {
  if (state.fileTreeDeleteTarget === null) {
    return state;
  }
  return { ...state, fileTreeDeleteTarget: null };
}

// A transient FileTree error (e.g. a name collision), surfaced in the tree header.
export function setProductShellFileTreeNotice(state: ProductShellState, notice: string): ProductShellState {
  return { ...state, fileTreeNotice: notice };
}

export function clearProductShellFileTreeNotice(state: ProductShellState): ProductShellState {
  if (state.fileTreeNotice === null) {
    return state;
  }
  return { ...state, fileTreeNotice: null };
}

function pathMatchesChange(candidate: string, changed: string): boolean {
  return candidate === changed || candidate.startsWith(`${changed}/`);
}

// After a path is deleted/renamed/moved, drop start-page editor tabs that pointed at
// it (or a descendant) and report the thread editor pane ids the handler should close
// (thread panes are backend-owned, closed via a command). Keeps a stale tab from
// saving over a now-moved/-gone path.
export function reconcileProductShellAfterPathChange(
  state: ProductShellState,
  changedPaths: string[],
): { state: ProductShellState; threadEditorPaneIdsToClose: string[] } {
  const affected = (candidate: string | undefined): boolean =>
    candidate !== undefined && changedPaths.some((changed) => pathMatchesChange(candidate, changed));

  const startPageFiles = state.startPageFiles.filter((file) => !affected(file.relativePath));
  const droppedStartPaneIds = state.startPageFiles
    .filter((file) => affected(file.relativePath))
    .map((file) => startFilePaneId(file.relativePath));
  const editorDrafts = { ...state.editorDrafts };
  for (const paneId of droppedStartPaneIds) {
    delete editorDrafts[paneId];
  }
  const draftActiveWorkbenchPaneId =
    state.draftActiveWorkbenchPaneId !== null && droppedStartPaneIds.includes(state.draftActiveWorkbenchPaneId)
      ? null
      : state.draftActiveWorkbenchPaneId;

  const threadEditorPaneIdsToClose = state.appChrome.workbenchPanes
    .filter((pane) => (pane.kind === "editor" || pane.kind === "image") && affected(pane.relativePath))
    .map((pane) => pane.paneId);

  return {
    state: { ...state, startPageFiles, editorDrafts, draftActiveWorkbenchPaneId },
    threadEditorPaneIdsToClose,
  };
}
