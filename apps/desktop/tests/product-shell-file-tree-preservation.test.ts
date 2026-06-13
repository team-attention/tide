// The New Thread page loads a file tree for the composer's directory. Sending starts a
// thread for that SAME directory, so the loaded tree must carry over instead of being
// nulled and replaced by a loading skeleton — a reload that's coupled to agent startup
// and so never resolves when the start is slow or fails (e.g. an unavailable model).
// The file tree belongs to the ACTIVE thread and only reloads when the cwd changes.
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  createProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function fileTreeLoaded(cwd: string) {
  return {
    kind: "workspace.fileTreeLoaded" as const,
    payload: {
      cwd,
      fileTree: {
        root: cwd,
        cwdLabel: cwd.split("/").filter(Boolean).pop() ?? cwd,
        entries: [
          { id: "src", name: "src", relativePath: "src", depth: 0, kind: "folder" },
          {
            id: "src/index.ts",
            name: "index.ts",
            relativePath: "src/index.ts",
            depth: 1,
            kind: "file",
          },
        ],
      },
    },
  };
}

function started(threadId: string, cwd: string) {
  return {
    kind: "thread.started" as const,
    payload: {
      thread: {
        threadId,
        title: threadId,
        agentBinding: { agentId: "claude" },
        scope: { kind: "project", projectId: "tide", cwd },
        launchOptions: { model: "Fable 5", permission: "workspace-write" },
        pinned: false,
        archived: false,
        updatedAt: "2026-06-13T00:00:00.000Z",
        lastKnownState: "idle",
      },
      runtimeState: "idle",
    },
  };
}

// Load the start-page tree for `cwd`, then optimistically activate `threadId` (what the
// composer does on send) so the following thread.started lands on the active thread.
function startPageWithLoadedTree(cwd: string, threadId: string) {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, fileTreeLoaded(cwd));
  assert.notEqual(state.fileTree, null, "precondition: the start-page tree is loaded");
  return { ...state, activeThreadId: threadId };
}

test("a started thread keeps the start-page file tree when the directory is unchanged", () => {
  const state = startPageWithLoadedTree("/repo/tide", "t1");
  const next = applyProductShellBackendEvent(state, started("t1", "/repo/tide"));
  assert.notEqual(next.fileTree, null);
  assert.equal(next.fileTree?.root, "/repo/tide");
  assert.equal(next.fileTree?.entries.length, 2);
});

test("a started thread clears a stale tree from a different directory", () => {
  const state = startPageWithLoadedTree("/repo/tide", "t1");
  const next = applyProductShellBackendEvent(state, started("t1", "/repo/other"));
  assert.equal(next.fileTree, null);
});

test("a trailing slash on the tree root still matches the thread cwd", () => {
  const state = startPageWithLoadedTree("/repo/tide/", "t1");
  const next = applyProductShellBackendEvent(state, started("t1", "/repo/tide"));
  assert.notEqual(next.fileTree, null);
});

test("a background thread's start event never touches the active thread's tree", () => {
  const state = startPageWithLoadedTree("/repo/tide", "t1");
  // t2 is NOT the active thread; its start must not null t1's already-loaded tree.
  const next = applyProductShellBackendEvent(state, started("t2", "/repo/other"));
  assert.notEqual(next.fileTree, null);
  assert.equal(next.fileTree?.root, "/repo/tide");
});
