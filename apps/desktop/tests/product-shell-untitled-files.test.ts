// Spec: docs_v2/specs/workbench-filetree-file-operations.md
// VSCode-style untitled files: New File opens a blank buffer; the name is chosen on
// save (Save As).

import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  editProductShellWorkbenchEditorPane,
  ensureComposerDraftThreadActive,
  newProductShellUntitledFile,
  productShellUntitledSaved,
  removeProductShellUntitledFile,
  saveProductShellWorkbenchEditorPane,
  selectWorkbenchViewModel,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { ProductShellState } from "../src/desktop/application/domains/product-shell/state/types.ts";

function draftStateWithRoot(root = "/repo/tide"): ProductShellState {
  const base = createProductShellState({ includeFixtureData: false });
  const scoped: ProductShellState = {
    ...base,
    activeThreadId: null,
    agentChat: {
      ...base.agentChat,
      composer: {
        ...base.agentChat.composer,
        startOptions: {
          ...base.agentChat.composer.startOptions,
          scope: { kind: "project", projectId: "tide", cwd: root },
        },
      },
    },
  };
  return ensureComposerDraftThreadActive(scoped).state;
}

test("new untitled file opens a blank, focused buffer bound to the draft thread", () => {
  const draft = draftStateWithRoot();
  const next = newProductShellUntitledFile(draft);
  assert.equal(next.untitledFiles.length, 1);
  const file = next.untitledFiles[0];
  assert.equal(file.id, "untitled:1");
  assert.equal(file.title, "Untitled-1");
  assert.equal(file.draft, "");
  assert.equal(file.dirty, false);
  assert.equal(file.threadId, draft.draftThreadId);
  assert.equal(file.scopeCwd, "/repo/tide");
  assert.equal(next.workbenchOpen, true);
  assert.equal(next.draftActiveWorkbenchPaneId, "untitled:1");
  assert.equal(next.untitledSequence, 1);
});

test("new untitled is a no-op before a draft/thread exists", () => {
  const base = createProductShellState({ includeFixtureData: false });
  const input: ProductShellState = {
    ...base,
    activeThreadId: null,
    fileTree: { root: "/repo/tide", cwdLabel: "tide", entries: [] },
  };
  const next = newProductShellUntitledFile(input);
  assert.equal(next.untitledFiles.length, 0);
  assert.equal(next, input, "state is returned unchanged");
});

test("editing an untitled buffer marks it dirty; saving opens the Save As bar", () => {
  const opened = newProductShellUntitledFile(draftStateWithRoot());
  const typed = editProductShellWorkbenchEditorPane(opened, "untitled:1", "hello");
  assert.equal(typed.untitledFiles[0].draft, "hello");
  assert.equal(typed.untitledFiles[0].dirty, true);

  const saved = saveProductShellWorkbenchEditorPane(typed, "untitled:1");
  assert.equal(saved.command, null, "Save As prompts, it does not write yet");
  assert.equal(saved.state.untitledSaveAsPaneId, "untitled:1");
});

test("empty draft workbench events do not close a visible untitled pane", () => {
  const opened = newProductShellUntitledFile(draftStateWithRoot());
  const draftId = opened.draftThreadId as string;

  const afterEmptyWorkbench = applyProductShellBackendEvent(opened, {
    kind: "workbench.changed",
    payload: { threadId: draftId, panes: [] },
  } as Parameters<typeof applyProductShellBackendEvent>[1]);

  assert.equal(afterEmptyWorkbench.workbenchOpen, true);
  assert.equal(afterEmptyWorkbench.workbenchOpenByThreadId[draftId], true);
  const pane = selectWorkbenchViewModel(afterEmptyWorkbench).appChrome.openWorkbenchPanes.find(
    (candidate) => candidate.paneId === "untitled:1",
  );
  assert.equal(pane?.kind, "editor");
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
  const opened = newProductShellUntitledFile(draftStateWithRoot());
  const closed = removeProductShellUntitledFile(opened, "untitled:1");
  assert.equal(closed.untitledFiles.length, 0);
  assert.equal(closed.draftActiveWorkbenchPaneId, null);
});

test("the view-model derives an editor pane for the untitled, only in its context", () => {
  const opened = newProductShellUntitledFile(draftStateWithRoot());
  const panes = selectWorkbenchViewModel(opened).appChrome.openWorkbenchPanes;
  const untitledPane = panes.find((pane) => pane.paneId === "untitled:1");
  assert.ok(untitledPane !== undefined, "untitled pane is shown on its draft thread");
  assert.equal(untitledPane?.kind, "editor");

  // The same untitled bound to a different thread must NOT show on this draft.
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
