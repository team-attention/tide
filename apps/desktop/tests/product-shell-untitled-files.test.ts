// Spec: docs_v2/specs/workbench-filetree-file-operations.md
// VSCode-style untitled files: New File opens a blank buffer; the name is chosen on
// save (Save As).

import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductShellState,
  editProductShellWorkbenchEditorPane,
  newProductShellUntitledFile,
  productShellUntitledSaved,
  removeProductShellUntitledFile,
  saveProductShellWorkbenchEditorPane,
  selectWorkbenchViewModel,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { ProductShellState } from "../src/desktop/application/domains/product-shell/state/types.ts";

function startStateWithRoot(root = "/repo/tide"): ProductShellState {
  const base = createProductShellState({ includeFixtureData: false });
  // resolveActiveWorkspaceCwd falls back to the loaded file-tree root when the
  // composer has no project scope, so this gives New File a cwd to save under.
  return { ...base, activeThreadId: null, fileTree: { root, cwdLabel: "tide", entries: [] } };
}

test("new untitled file opens a blank, focused buffer bound to the context", () => {
  const next = newProductShellUntitledFile(startStateWithRoot());
  assert.equal(next.untitledFiles.length, 1);
  const file = next.untitledFiles[0];
  assert.equal(file.id, "untitled:1");
  assert.equal(file.title, "Untitled-1");
  assert.equal(file.draft, "");
  assert.equal(file.dirty, false);
  assert.equal(file.threadId, null);
  assert.equal(file.scopeCwd, "/repo/tide");
  assert.equal(next.workbenchOpen, true);
  assert.equal(next.draftActiveWorkbenchPaneId, "untitled:1");
  assert.equal(next.untitledSequence, 1);
});

test("new untitled is a no-op when there is no workspace directory", () => {
  const base = createProductShellState({ includeFixtureData: false });
  const input: ProductShellState = { ...base, activeThreadId: null, fileTree: null };
  const next = newProductShellUntitledFile(input);
  assert.equal(next.untitledFiles.length, 0);
  assert.equal(next, input, "state is returned unchanged");
});

test("editing an untitled buffer marks it dirty; saving opens the Save As bar", () => {
  const opened = newProductShellUntitledFile(startStateWithRoot());
  const typed = editProductShellWorkbenchEditorPane(opened, "untitled:1", "hello");
  assert.equal(typed.untitledFiles[0].draft, "hello");
  assert.equal(typed.untitledFiles[0].dirty, true);

  const saved = saveProductShellWorkbenchEditorPane(typed, "untitled:1");
  assert.equal(saved.command, null, "Save As prompts, it does not write yet");
  assert.equal(saved.state.untitledSaveAsPaneId, "untitled:1");
});

test("untitledSaved (start page) drops the untitled and reads the now-real file", () => {
  const opened = editProductShellWorkbenchEditorPane(
    newProductShellUntitledFile(startStateWithRoot()),
    "untitled:1",
    "x",
  );
  const result = productShellUntitledSaved(opened, "untitled:1", "notes/todo.md");
  assert.equal(result.state.untitledFiles.length, 0, "untitled tab is gone");
  assert.equal(result.command?.kind, "workspace.readFile");
  assert.deepEqual(result.command?.kind === "workspace.readFile" ? result.command.payload : null, {
    cwd: "/repo/tide",
    path: "notes/todo.md",
  });
  assert.equal(result.state.draftActiveWorkbenchPaneId, "start-file:notes/todo.md");
});

test("untitledSaved (thread) drops the untitled and opens it as a thread editor", () => {
  const base = createProductShellState({ includeFixtureData: false });
  const threadState: ProductShellState = {
    ...base,
    activeThreadId: "t1",
    fileTree: { root: "/repo/tide", cwdLabel: "tide", entries: [] },
  };
  const opened = newProductShellUntitledFile(threadState);
  assert.equal(opened.untitledFiles[0].threadId, "t1");

  const result = productShellUntitledSaved(opened, "untitled:1", "src/new.ts");
  assert.equal(result.state.untitledFiles.length, 0);
  assert.equal(result.command?.kind, "workbench.command");
  assert.equal(
    result.command?.kind === "workbench.command" ? result.command.payload.command : null,
    "open_editor",
  );
});

test("closing an untitled tab discards it and clears the active override", () => {
  const opened = newProductShellUntitledFile(startStateWithRoot());
  const closed = removeProductShellUntitledFile(opened, "untitled:1");
  assert.equal(closed.untitledFiles.length, 0);
  assert.equal(closed.draftActiveWorkbenchPaneId, null);
});

test("the view-model derives an editor pane for the untitled, only in its context", () => {
  const opened = newProductShellUntitledFile(startStateWithRoot());
  const panes = selectWorkbenchViewModel(opened).appChrome.openWorkbenchPanes;
  const untitledPane = panes.find((pane) => pane.paneId === "untitled:1");
  assert.ok(untitledPane !== undefined, "untitled pane is shown on the start page");
  assert.equal(untitledPane?.kind, "editor");

  // The same untitled bound to a thread must NOT show on the start page.
  const wrongContext: ProductShellState = {
    ...opened,
    untitledFiles: opened.untitledFiles.map((file) => ({ ...file, threadId: "other" })),
  };
  const panes2 = selectWorkbenchViewModel(wrongContext).appChrome.openWorkbenchPanes;
  assert.ok(
    panes2.every((pane) => pane.paneId !== "untitled:1"),
    "untitled bound to another context is hidden",
  );
});
