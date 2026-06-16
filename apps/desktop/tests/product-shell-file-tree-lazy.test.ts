// Spec: docs_v2/specs/workbench-filetree-view.md (D6 lazy expand).
// The FileTree loads one level at a time: expanding a not-yet-loaded folder fetches
// its children (carrying the new expanded set); collapsing, and re-expanding an
// already-loaded folder, are client-side only.
import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductShellState,
  newProductShellFile,
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

// ---- New File (spec: workbench-new-file.md) ----

function startPageState(): ProductShellState {
  const base = createProductShellState({ includeFixtureData: false });
  return {
    ...base,
    activeThreadId: null,
    agentChat: {
      ...base.agentChat,
      composer: {
        ...base.agentChat.composer,
        startOptions: {
          ...base.agentChat.composer.startOptions,
          scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        },
      },
    },
  };
}

test("new_file_on_start_page_reads_with_create_under_the_composer_cwd", () => {
  const result = newProductShellFile(startPageState(), "scratch/new.txt");
  assert.equal(result.command?.kind, "workspace.readFile");
  if (result.command?.kind === "workspace.readFile") {
    assert.deepEqual(result.command.payload, { cwd: "/repo/tide", path: "scratch/new.txt", create: true });
  }
  assert.equal(result.state.workbenchOpen, true, "the workbench column opens");
});

test("new_file_in_a_thread_opens_an_editor_with_create_true", () => {
  const state = stateWithTree([SRC, README], []); // activeThreadId: "t1"
  const result = newProductShellFile(state, "lib/util.ts");
  assert.equal(result.command?.kind, "workbench.command");
  if (result.command?.kind === "workbench.command" && result.command.payload.command === "open_editor") {
    assert.equal(result.command.payload.threadId, "t1");
    assert.deepEqual(result.command.payload.data, { path: "lib/util.ts", create: true });
  }
});

test("new_file_normalizes_a_leading_dot_slash_and_no-ops_on_empty", () => {
  const thread = newProductShellFile(stateWithTree([], []), "./deep/x.ts");
  assert.equal(
    thread.command?.kind === "workbench.command" &&
      thread.command.payload.command === "open_editor" &&
      thread.command.payload.data.path,
    "deep/x.ts",
    "a leading ./ is stripped",
  );
  const empty = newProductShellFile(stateWithTree([], []), "   ");
  assert.equal(empty.command, null, "blank path is a no-op");
});

test("new_file_on_start_page_is_a_no-op_without_a_concrete_project_cwd", () => {
  const start = startPageState();
  const noCwd: ProductShellState = {
    ...start,
    agentChat: {
      ...start.agentChat,
      composer: {
        ...start.agentChat.composer,
        startOptions: {
          ...start.agentChat.composer.startOptions,
          scope: { kind: "project", projectId: "tide", cwd: "" },
        },
      },
    },
  };
  const result = newProductShellFile(noCwd, "x.txt");
  assert.equal(result.command, null, "no concrete cwd → nothing to create");
});
