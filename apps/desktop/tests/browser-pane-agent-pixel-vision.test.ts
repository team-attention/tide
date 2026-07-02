// Spec: docs_v2/specs/browser-pane-agent-computer-use.md (Slice 2 — pixel vision)
// tide_observe_browser supports vision modes (text|screenshot|both). BrowserRuntime
// refreshes screenshot evidence before this mapper runs; these tests set the cached
// runtime evidence directly and drive the observe + MCP plumbing.
import assert from "node:assert/strict";
import test from "node:test";

import { mcpToolSuccessResult } from "../src/backend/adapters/inbound/tide-mcp-server/tide-mcp-json-rpc.ts";
import type { ThreadRecord } from "../src/backend/application/domains/thread/thread.ts";
import type {
  BrowserPaneScreenshot,
  BrowserPaneState,
} from "../src/backend/application/domains/workbench/workbench.ts";
import { observeBrowserOutput } from "../src/backend/application/services/workbench/workbench-browser-operations.ts";

const now = "2026-06-14T00:00:00.000Z";

const SCREENSHOT: BrowserPaneScreenshot = {
  data: "iVBORw0KGgoAAAANSUhEUg==",
  mimeType: "image/png",
  width: 1024,
  height: 768,
  devicePixelRatio: 1,
};

function browserThread(overrides: Partial<BrowserPaneState> = {}): ThreadRecord {
  const pane: BrowserPaneState = {
    paneId: "p1",
    kind: "browser",
    title: "Example",
    url: "https://example.test",
    loading: false,
    revision: "rev-1",
    updatedAt: now,
    bodyTextPreview: "page body text",
    ...overrides,
  };
  return {
    threadId: "t1",
    updatedAt: now,
    workbench: { panes: [pane], focusOwner: "composer", layoutMode: "stacked" },
  } as unknown as ThreadRecord;
}

test("observe mode=text returns no screenshot even when one is cached", async () => {
  const thread = browserThread({ screenshot: SCREENSHOT });
  const result = await observeBrowserOutput(thread, { paneId: "p1", mode: "text" });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.pane.screenshot, undefined);
  assert.equal(result.ok && result.value.pane.bodyTextPreview, "page body text");
});

test("observe defaults to mode=both: returns BOTH the cached screenshot and the text body", async () => {
  // spec browser-pane-live-pull-vision.md D4: vision-first default when no mode is given.
  const thread = browserThread({ screenshot: SCREENSHOT });
  const result = await observeBrowserOutput(thread, { paneId: "p1" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value.pane.screenshot : undefined, SCREENSHOT);
  assert.equal(result.ok && result.value.pane.bodyTextPreview, "page body text");
});

test("observe mode=screenshot attaches the cached image and drops the text body", async () => {
  const thread = browserThread({ screenshot: SCREENSHOT });
  const result = await observeBrowserOutput(thread, { paneId: "p1", mode: "screenshot" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok ? result.value.pane.screenshot : undefined, SCREENSHOT);
  assert.equal(result.ok && result.value.pane.bodyTextPreview, undefined);
});

test("observe mode=both returns the text body AND the screenshot", async () => {
  const thread = browserThread({ screenshot: SCREENSHOT });
  const result = await observeBrowserOutput(thread, { paneId: "p1", mode: "both" });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.pane.bodyTextPreview, "page body text");
  assert.deepEqual(result.ok ? result.value.pane.screenshot : undefined, SCREENSHOT);
});

test("observe mode=screenshot with no cached capture returns no screenshot (degrade)", async () => {
  const thread = browserThread();
  const result = await observeBrowserOutput(thread, { paneId: "p1", mode: "screenshot" });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.value.pane.screenshot, undefined);
});

test("MCP success result emits an image content block + strips base64 from the text", () => {
  const output = {
    kind: "observe_browser",
    threadId: "t1",
    pane: { paneId: "p1", kind: "browser", screenshot: SCREENSHOT },
  };
  const result = mcpToolSuccessResult(output);
  const content = result.content as {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }[];
  assert.equal(content.length, 2);
  assert.equal(content[0].type, "text");
  assert.ok(!(content[0].text ?? "").includes(SCREENSHOT.data));
  assert.match(content[0].text ?? "", /devicePixelRatio/);
  assert.equal(content[1].type, "image");
  assert.equal(content[1].data, SCREENSHOT.data);
  assert.equal(content[1].mimeType, "image/png");
});

test("MCP success result without a screenshot is text-only", () => {
  const result = mcpToolSuccessResult({
    kind: "observe_browser",
    pane: { paneId: "p1", kind: "browser" },
  });
  const content = result.content as { type: string }[];
  assert.equal(content.length, 1);
  assert.equal(content[0].type, "text");
});
