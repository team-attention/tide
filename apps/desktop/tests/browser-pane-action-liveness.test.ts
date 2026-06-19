// Spec: docs_v2/specs/browser-pane-action-liveness.md
// Every open agent-owned Browser Pane must have exactly one live <webview> so its
// agent-scheduled actions execute instead of sitting `pending`. The foreground hosts
// only the active thread's currently-shown pane; deriveBackgroundBrowserPanes must
// cover everything else — including the active thread's off-screen browser panes.
import assert from "node:assert/strict";
import test from "node:test";

import { deriveBackgroundBrowserPanes } from "../src/desktop/application/domains/product-shell/product-shell.ts";

function browserPane(paneId: string) {
  return { paneId, kind: "browser" as const, title: "Naver", revision: "r1" };
}

function stateWith(input: {
  activeThreadId: string | null;
  workbenchOpen: boolean;
  activeWorkbenchPaneId?: string;
  threads: { threadId: string; panes: ReturnType<typeof browserPane>[] }[];
}) {
  return {
    activeThreadId: input.activeThreadId,
    workbenchOpen: input.workbenchOpen,
    appChrome: { activeWorkbenchPaneId: input.activeWorkbenchPaneId },
    threads: input.threads.map((t) => ({ threadId: t.threadId, workbenchPanes: t.panes })),
  } as Parameters<typeof deriveBackgroundBrowserPanes>[0];
}

test("active thread's browser pane is kept alive offscreen when the workbench is closed", () => {
  const panes = deriveBackgroundBrowserPanes(
    stateWith({
      activeThreadId: "t1",
      workbenchOpen: false,
      threads: [{ threadId: "t1", panes: [browserPane("p1")] }],
    }),
  );
  assert.deepEqual(panes.map((p) => p.paneId), ["p1"]);
  assert.equal(panes[0].threadId, "t1");
});

test("active thread's browser pane is kept alive when a DIFFERENT pane is foregrounded", () => {
  const panes = deriveBackgroundBrowserPanes(
    stateWith({
      activeThreadId: "t1",
      workbenchOpen: true,
      activeWorkbenchPaneId: "editor-pane",
      threads: [{ threadId: "t1", panes: [browserPane("p1")] }],
    }),
  );
  assert.deepEqual(panes.map((p) => p.paneId), ["p1"]);
});

test("the foregrounded active browser pane is excluded (no duplicate webview)", () => {
  const panes = deriveBackgroundBrowserPanes(
    stateWith({
      activeThreadId: "t1",
      workbenchOpen: true,
      activeWorkbenchPaneId: "p1",
      threads: [{ threadId: "t1", panes: [browserPane("p1")] }],
    }),
  );
  assert.deepEqual(panes, []);
});

test("non-active threads' open browser panes are still kept alive (regression)", () => {
  const panes = deriveBackgroundBrowserPanes(
    stateWith({
      activeThreadId: "t1",
      workbenchOpen: true,
      activeWorkbenchPaneId: "p1",
      threads: [
        { threadId: "t1", panes: [browserPane("p1")] },
        { threadId: "t2", panes: [browserPane("p2")] },
      ],
    }),
  );
  assert.deepEqual(panes.map((p) => p.paneId), ["p2"]);
});

test("closed browser panes are absent and never hosted", () => {
  const panes = deriveBackgroundBrowserPanes(
    stateWith({
      activeThreadId: "t1",
      workbenchOpen: false,
      threads: [{ threadId: "t1", panes: [] }],
    }),
  );
  assert.deepEqual(panes, []);
});
