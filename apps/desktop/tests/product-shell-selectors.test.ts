// Spec: desktop-product-shell-render-isolation. Proves the two isolation properties of
// the per-area view-model selectors:
//   - STABILITY (insensitivity): a change to one area's inputs leaves the OTHER areas'
//     slices reference-equal, so a subscribing column bails out of re-rendering. The key
//     case — a streaming chat token must not invalidate the workbench/file-tree slices —
//     is the original "editor reconfigures on every token" bug.
//   - SENSITIVITY: a slice recomputes when ANY of its OWN inputs changes, so a missing
//     input (which would render stale data) fails the test.
import assert from "node:assert/strict";
import test from "node:test";

import type { ProductShellState } from "../src/desktop/application/domains/product-shell/product-shell.ts";
import {
  createProductShellState,
  selectAgentChatViewModel,
  selectFileTreeViewModel,
  selectThreadListViewModel,
  selectWorkbenchViewModel,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

const base = (): ProductShellState => createProductShellState({ includeFixtureData: true });

test("a streaming chat token leaves the workbench, file-tree and thread-list slices stable", () => {
  const s0 = base();
  const workbench0 = selectWorkbenchViewModel(s0);
  const fileTree0 = selectFileTreeViewModel(s0);
  const threadList0 = selectThreadListViewModel(s0);
  const chat0 = selectAgentChatViewModel(s0);

  // A token mutates ONLY state.agentChat.
  const s1: ProductShellState = { ...s0, agentChat: { ...s0.agentChat } };
  assert.equal(selectWorkbenchViewModel(s1), workbench0, "workbench slice stays referentially equal");
  assert.equal(selectFileTreeViewModel(s1), fileTree0, "file-tree slice stays referentially equal");
  assert.equal(selectThreadListViewModel(s1), threadList0, "thread-list slice stays referentially equal");
  assert.notEqual(selectAgentChatViewModel(s1), chat0, "agent-chat slice DOES recompute on a chat change");
});

test("the workbench slice recomputes when any of its own inputs change", () => {
  const s0 = base();
  const changes: Array<[string, ProductShellState]> = [
    ["appChrome", { ...s0, appChrome: { ...s0.appChrome } }],
    ["editorDrafts", { ...s0, editorDrafts: { ...s0.editorDrafts } }],
    ["fileTree (editorPicker)", { ...s0, fileTree: { cwdLabel: "changed", entries: [] } }],
    ["workbenchLayoutMode", { ...s0, workbenchLayoutMode: s0.workbenchLayoutMode === "split" ? "stack" : "split" }],
    ["workbenchFullscreen", { ...s0, workbenchFullscreen: !s0.workbenchFullscreen }],
    ["activeThreadId", { ...s0, activeThreadId: `${s0.activeThreadId ?? ""}x` }],
  ];
  for (const [label, next] of changes) {
    assert.notEqual(selectWorkbenchViewModel(next), selectWorkbenchViewModel(s0), `workbench recomputes on ${label}`);
  }
});

test("the thread-list slice recomputes when its own inputs change", () => {
  const s0 = base();
  const changes: Array<[string, ProductShellState]> = [
    ["threads", { ...s0, threads: [...s0.threads] }],
    ["listSettings", { ...s0, listSettings: { ...s0.listSettings } }],
    ["searchQuery", { ...s0, searchQuery: `${s0.searchQuery}q` }],
    ["pinnedProjectIds", { ...s0, pinnedProjectIds: [...s0.pinnedProjectIds, "x"] }],
    ["activeThreadId", { ...s0, activeThreadId: `${s0.activeThreadId ?? ""}x` }],
  ];
  for (const [label, next] of changes) {
    assert.notEqual(selectThreadListViewModel(next), selectThreadListViewModel(s0), `thread-list recomputes on ${label}`);
  }
});

test("the file-tree slice recomputes on fileTree / expansion / thread changes", () => {
  const s0 = base();
  const changes: Array<[string, ProductShellState]> = [
    ["fileTree", { ...s0, fileTree: { cwdLabel: "changed", entries: [] } }],
    ["expandedFolderPaths", { ...s0, expandedFolderPaths: [...s0.expandedFolderPaths, "x"] }],
    ["threads", { ...s0, threads: [...s0.threads] }],
  ];
  for (const [label, next] of changes) {
    assert.notEqual(selectFileTreeViewModel(next), selectFileTreeViewModel(s0), `file-tree recomputes on ${label}`);
  }
});

test("the agent-chat slice recomputes on composer-menu data changes", () => {
  const s0 = base();
  assert.notEqual(
    selectAgentChatViewModel({ ...s0, gitBranches: [...s0.gitBranches, { name: "feature" } as never] }),
    selectAgentChatViewModel(s0),
    "agent-chat recomputes when availableBranches changes",
  );
});
