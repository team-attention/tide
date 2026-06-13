import type { ProductShellBackendCommand, ProductShellFileTreeEntryView, ProductShellFileTreeView, ProductShellState, ProductShellUpdateResult } from "./types.ts";
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
  // file tree (no thread yet).
  if (state.activeThreadId === null) {
    const command = startPageFileTreeCommand(state);
    return {
      state: command === null ? nextState : { ...nextState, fileTree: null, expandedFolderPaths: [] },
      command,
    };
  }
  // Opening for an active thread: refresh that thread's tree.
  return {
    state: nextState,
    command: {
      kind: "workbench.command",
      payload: {
        threadId: state.activeThreadId,
        command: "refresh_file_tree",
        data: {
          maxDepth: 12,
          maxEntries: 4000,
        },
      },
    },
  };
}

// On the start page the file tree follows the composer's selected scope. A project
// scope has a real cwd to list; a scratch scope has no directory yet (empty tree).
function startPageFileTreeCommand(
  state: ProductShellState,
): ProductShellBackendCommand | null {
  const scope = state.agentChat.composer.startOptions.scope;
  if (scope?.kind === "project" && scope.cwd.length > 0) {
    return {
      kind: "workspace.readFileTree",
      payload: { cwd: scope.cwd, maxDepth: 12, maxEntries: 4000 },
    };
  }
  return null;
}

// When the start-page composer scope changes while the file tree is open, reload the
// tree for the new directory. Returns null when not on the start page / tree closed.
export function refreshStartPageFileTree(
  state: ProductShellState,
): ProductShellBackendCommand | null {
  if (state.activeThreadId !== null || !state.fileTreeOpen) {
    return null;
  }
  return startPageFileTreeCommand(state);
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

  // Folders toggle expansion; files open. The whole tree is already loaded, so
  // expanding only reveals already-fetched children — no backend round-trip.
  // This works on the START PAGE too (no thread yet) — bailing on a null
  // activeThreadId froze the tree at its top level there.
  if (entry.kind === "folder") {
    const expanded = new Set(state.expandedFolderPaths);
    if (expanded.has(entry.relativePath)) {
      expanded.delete(entry.relativePath);
    } else {
      expanded.add(entry.relativePath);
    }
    const nextState = { ...state, expandedFolderPaths: [...expanded] };
    return { state: nextState, command: null };
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
