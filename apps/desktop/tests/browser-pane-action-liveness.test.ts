// Spec: docs_v2/specs/browser-pane-action-liveness.md
// Browser panes are hosted live only when the user is actively near them or the agent has
// pending browser work. This keeps active-thread offscreen panes responsive while cold-idling
// non-active threads to avoid unbounded background <webview> memory.
import assert from "node:assert/strict";
import test from "node:test";

import { deriveBackgroundBrowserPanes } from "../src/desktop/application/domains/product-shell/product-shell.ts";

function browserPane(paneId: string, overrides: Record<string, unknown> = {}) {
  return { paneId, kind: "browser" as const, title: "Naver", revision: "r1", ...overrides };
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

test("non-active threads' idle browser panes are cold-idled", () => {
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
  assert.deepEqual(panes, []);
});

test("non-active threads' browser panes are hosted while an agent action is pending", () => {
  const panes = deriveBackgroundBrowserPanes(
    stateWith({
      activeThreadId: "t1",
      workbenchOpen: true,
      activeWorkbenchPaneId: "p1",
      threads: [
        { threadId: "t1", panes: [browserPane("p1")] },
        {
          threadId: "t2",
          panes: [
            browserPane("p2", {
              pendingAction: {
                actionId: "action-1",
                kind: "click_at",
                x: 10,
                y: 12,
                requestedAt: "2026-06-01T00:00:00.000Z",
              },
            }),
          ],
        },
      ],
    }),
  );
  assert.deepEqual(panes.map((p) => p.paneId), ["p2"]);
});

test("non-active threads' browser panes are hosted while an observe capture is pending", () => {
  const panes = deriveBackgroundBrowserPanes(
    stateWith({
      activeThreadId: "t1",
      workbenchOpen: true,
      activeWorkbenchPaneId: "p1",
      threads: [
        { threadId: "t1", panes: [browserPane("p1")] },
        {
          threadId: "t2",
          panes: [
            browserPane("p2", {
              pendingCapture: {
                captureId: "capture-1",
                requestedAt: "2026-06-01T00:00:00.000Z",
              },
            }),
          ],
        },
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
