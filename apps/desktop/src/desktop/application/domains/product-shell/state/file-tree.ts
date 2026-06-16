import type { ProductShellBackendCommand, ProductShellFileTreeEntryView, ProductShellFileTreeView, ProductShellState, ProductShellUpdateResult } from "./types.ts";
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
  const path = relativePath.trim().replace(/^\.?\/+/, "");
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
