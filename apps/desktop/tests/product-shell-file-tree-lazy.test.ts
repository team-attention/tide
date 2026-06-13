// Spec: docs_v2/specs/workbench-filetree-view.md (D6 lazy expand).
// The FileTree loads one level at a time: expanding a not-yet-loaded folder fetches
// its children (carrying the new expanded set); collapsing, and re-expanding an
// already-loaded folder, are client-side only.
import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductShellState,
  selectProductShellFileTreeEntry,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type {
  ProductShellFileTreeEntryView,
  ProductShellState,
} from "../src/desktop/application/domains/product-shell/state/types.ts";

const SRC: ProductShellFileTreeEntryView = { id: "src", name: "src", relativePath: "src", depth: 0, kind: "folder" };
const README: ProductShellFileTreeEntryView = { id: "readme.md", name: "readme.md", relativePath: "readme.md", depth: 0, kind: "file" };
const SRC_APP: ProductShellFileTreeEntryView = { id: "src/app.ts", name: "app.ts", relativePath: "src/app.ts", depth: 1, kind: "file" };

function stateWithTree(
  entries: ProductShellFileTreeEntryView[],
  expandedFolderPaths: string[] = [],
): ProductShellState {
  const base = createProductShellState({ includeFixtureData: false });
  return {
    ...base,
    activeThreadId: "t1",
    fileTree: { root: "/repo/tide", cwdLabel: "tide", entries },
    expandedFolderPaths,
  };
}

function refreshExpandedPaths(command: ReturnType<typeof selectProductShellFileTreeEntry>["command"]): string[] | undefined {
  if (command?.kind === "workbench.command" && command.payload.command === "refresh_file_tree") {
    return command.payload.data.expandedPaths;
  }
  return undefined;
}

test("expanding_unloaded_folder_emits_refresh_with_expanded_paths", () => {
  const state = stateWithTree([SRC, README], []);
  const result = selectProductShellFileTreeEntry(state, "src");

  assert.deepEqual(refreshExpandedPaths(result.command), ["src"], "refresh carries the new expanded set");
  assert.ok(result.state.expandedFolderPaths.includes("src"), "folder is marked expanded");
  assert.equal(result.state.fileTree?.loadingFolderPath, "src", "folder is marked loading for the skeleton");
});

test("re_expanding_loaded_folder_does_not_emit_a_command", () => {
  // src's children are already loaded (cached) but src is collapsed.
  const state = stateWithTree([SRC, SRC_APP, README], []);
  const result = selectProductShellFileTreeEntry(state, "src");

  assert.equal(result.command, null, "no Backend round-trip when children are cached");
  assert.ok(result.state.expandedFolderPaths.includes("src"), "folder is revealed client-side");
  assert.equal(result.state.fileTree?.loadingFolderPath ?? null, null, "no loading mark");
});

test("collapsing_folder_does_not_emit_a_command", () => {
  const state = stateWithTree([SRC, SRC_APP, README], ["src"]);
  const result = selectProductShellFileTreeEntry(state, "src");

  assert.equal(result.command, null, "collapse is client-side only");
  assert.ok(!result.state.expandedFolderPaths.includes("src"), "folder is collapsed");
});
