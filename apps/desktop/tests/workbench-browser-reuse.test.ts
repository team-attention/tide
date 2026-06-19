import test from "node:test";
import assert from "node:assert/strict";

import { firstBrowserPane } from "../src/backend/application/services/workbench/workbench-snapshot.ts";
import type {
  WorkbenchState,
  BrowserPaneState,
} from "../src/backend/application/domains/workbench/workbench.ts";

function browserPane(paneId: string, url: string): BrowserPaneState {
  return {
    paneId,
    kind: "browser",
    title: "Browser",
    url,
    loading: false,
    revision: `${paneId}:rev`,
    updatedAt: "2026-06-11T00:00:00.000Z",
  };
}

function workbench(panes: BrowserPaneState[], activePaneId?: string): WorkbenchState {
  return { panes, activePaneId, focusOwner: "composer" };
}

test("firstBrowserPane reuses the active browser pane", () => {
  const pane = browserPane("b1", "https://a.example");
  assert.equal(firstBrowserPane(workbench([pane], "b1"))?.paneId, "b1");
});

test("firstBrowserPane returns undefined when no browser pane is open", () => {
  assert.equal(firstBrowserPane(workbench([])), undefined);
});

test("firstBrowserPane falls back to the first open browser pane", () => {
  const first = browserPane("b1", "https://old.example");
  const second = browserPane("b2", "https://new.example");
  assert.equal(firstBrowserPane(workbench([first, second]))?.paneId, "b1");
});
