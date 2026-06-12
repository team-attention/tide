import test from "node:test";
import assert from "node:assert/strict";

import { firstBrowserPane } from "../src/backend/application/services/workbench/workbench-snapshot.ts";
import type {
  WorkbenchState,
  BrowserPaneState,
} from "../src/backend/application/domains/workbench/workbench.ts";

function browserPane(paneId: string, visible: boolean, url: string): BrowserPaneState {
  return {
    paneId,
    kind: "browser",
    title: "Browser",
    url,
    loading: false,
    visible,
    revision: `${paneId}:rev`,
    updatedAt: "2026-06-11T00:00:00.000Z",
  };
}

function workbench(panes: BrowserPaneState[], activePaneId?: string): WorkbenchState {
  return { panes, activePaneId, focusOwner: "composer" };
}

test("firstBrowserPane reuses a visible browser pane", () => {
  const pane = browserPane("b1", true, "https://a.example");
  assert.equal(firstBrowserPane(workbench([pane], "b1"))?.paneId, "b1");
});

test("firstBrowserPane does NOT reuse a hidden (closed) browser pane", () => {
  // close_pane only sets visible=false; a hidden pane must not be reused, so the
  // next open_browser starts a fresh pane instead of showing the old page.
  const hidden = browserPane("b1", false, "https://old.example");
  assert.equal(firstBrowserPane(workbench([hidden], "b1")), undefined);
});

test("firstBrowserPane falls back to any VISIBLE browser pane, skipping hidden ones", () => {
  const hidden = browserPane("b1", false, "https://old.example");
  const visible = browserPane("b2", true, "https://new.example");
  assert.equal(firstBrowserPane(workbench([hidden, visible]))?.paneId, "b2");
});
