import type { ProductShellBackendCommand, ProductShellState } from "./types.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

export function setProductShellSearchQuery(
  state: ProductShellState,
  query: string,
): ProductShellState {
  return { ...state, searchQuery: query, searchActive: true };
}

// The Left UI "Search" entry is a nav row by default (matching the canonical
// Figma frame); activating it reveals the inline filter input. Closing it
// clears any in-progress query so the row returns to its resting state.
export function toggleProductShellSearch(
  state: ProductShellState,
): ProductShellState {
  if (state.searchActive) {
    return { ...state, searchActive: false, searchQuery: "" };
  }
  return { ...state, searchActive: true };
}

// The cwd a content search runs in: the active thread's root.
function activeThreadCwd(state: ProductShellState): string | null {
  const thread = state.threads.find((candidate) => candidate.threadId === state.activeThreadId);
  if (thread === undefined) {
    return null;
  }
  return thread.scope.kind === "project" ? thread.scope.cwd : thread.scope.scratchCwd;
}

// Builds the Cmd+Shift+F content-search command for the active thread, or null
// when there is no active thread root to search.
export function searchProductShellContentCommand(
  state: ProductShellState,
  query: string,
): ProductShellBackendCommand | null {
  const cwd = activeThreadCwd(state);
  if (cwd === null || query.trim().length === 0) {
    return null;
  }
  return {
    kind: "workspace.searchContent",
    payload: { cwd, query },
  };
}
