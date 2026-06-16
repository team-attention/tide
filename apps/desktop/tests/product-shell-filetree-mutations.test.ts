// Spec: docs_v2/specs/workbench-filetree-file-operations.md
// FileTree inline edits (new folder / rename) + open-tab reconciliation on a path
// delete/rename/move.

import assert from "node:assert/strict";
import test from "node:test";

import {
  beginProductShellTreeEdit,
  cancelProductShellTreeEdit,
  createProductShellState,
  reconcileProductShellAfterPathChange,
  resolveProductShellTreeEdit,
  setProductShellTreeEditDraft,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { ProductShellState } from "../src/desktop/application/domains/product-shell/state/types.ts";

test("begin new-folder expands the parent and opens an empty inline input", () => {
  const base = createProductShellState({ includeFixtureData: false });
  const next = beginProductShellTreeEdit(base, { kind: "new-folder", parentPath: "src" });
  assert.deepEqual(next.fileTreeEdit, { kind: "new-folder", parentPath: "src", targetPath: undefined, draft: "" });
  assert.ok(next.expandedFolderPaths.includes("src"), "parent folder is expanded so the input shows");
});

test("begin rename prefills the entry's base name", () => {
  const base = createProductShellState({ includeFixtureData: false });
  const next = beginProductShellTreeEdit(base, { kind: "rename", parentPath: "src", targetPath: "src/app.ts" });
  assert.equal(next.fileTreeEdit?.draft, "app.ts");
});

test("resolveProductShellTreeEdit joins names under the parent and ignores empty", () => {
  assert.deepEqual(
    resolveProductShellTreeEdit({ kind: "new-folder", parentPath: "src", draft: "widgets" }),
    { kind: "new-folder", toPath: "src/widgets" },
  );
  assert.deepEqual(
    resolveProductShellTreeEdit({ kind: "new-folder", parentPath: "", draft: "lib" }),
    { kind: "new-folder", toPath: "lib" },
  );
  assert.deepEqual(
    resolveProductShellTreeEdit({ kind: "rename", parentPath: "src", targetPath: "src/a.ts", draft: "b.ts" }),
    { kind: "rename", fromPath: "src/a.ts", toPath: "src/b.ts" },
  );
  assert.equal(
    resolveProductShellTreeEdit({ kind: "new-folder", parentPath: "src", draft: "   " }),
    null,
    "an empty typed name is a no-op",
  );
});

test("cancel clears the inline edit", () => {
  const base = createProductShellState({ includeFixtureData: false });
  const editing = beginProductShellTreeEdit(base, { kind: "new-folder", parentPath: "src" });
  assert.equal(cancelProductShellTreeEdit(editing).fileTreeEdit, null);
  assert.equal(setProductShellTreeEditDraft(editing, "w").fileTreeEdit?.draft, "w");
});

test("reconcile drops start-page tabs for a deleted file and its folder descendants", () => {
  const base = createProductShellState({ includeFixtureData: false });
  const state: ProductShellState = {
    ...base,
    activeThreadId: null,
    startPageFiles: [
      { cwd: "/repo", relativePath: "src/a.ts", content: "a", truncated: false },
      { cwd: "/repo", relativePath: "src/nested/b.ts", content: "b", truncated: false },
      { cwd: "/repo", relativePath: "keep.ts", content: "k", truncated: false },
    ],
  };

  // Deleting the whole "src" folder closes both files under it, keeps the sibling.
  const result = reconcileProductShellAfterPathChange(state, ["src"]);
  assert.deepEqual(
    result.state.startPageFiles.map((file) => file.relativePath),
    ["keep.ts"],
  );
  assert.deepEqual(result.threadEditorPaneIdsToClose, [], "no thread panes on the start page");
});

test("reconcile reports thread editor panes to close for the changed path", () => {
  const base = createProductShellState({ includeFixtureData: false });
  const state: ProductShellState = {
    ...base,
    activeThreadId: "t1",
    appChrome: {
      ...base.appChrome,
      workbenchPanes: [
        { paneId: "p1", kind: "editor", title: "a.ts", visible: true, revision: "r", relativePath: "src/a.ts" },
        { paneId: "p2", kind: "editor", title: "c.ts", visible: true, revision: "r", relativePath: "src/c.ts" },
        { paneId: "b1", kind: "browser", title: "web", visible: true, revision: "r" },
      ],
    },
  };

  const result = reconcileProductShellAfterPathChange(state, ["src/a.ts"]);
  assert.deepEqual(result.threadEditorPaneIdsToClose, ["p1"]);
});
