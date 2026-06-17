// Spec: docs_v2/specs/browser-pane-agent-computer-use.md
// Slice 1b — coordinate computer-use actions drive the live <webview> through real
// sendInputEvent; the selector path stays on the executeJavaScript reliability fallback.
import assert from "node:assert/strict";
import test from "node:test";

import {
  captureBrowserWebViewScreenshot,
  executeBrowserWebViewAction,
  isWebViewSettled,
  type BrowserWebViewAction,
  type BrowserWebViewElement,
  type BrowserWebViewInputEvent,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/browser-webview-actions.ts";

function fakeWebView(): {
  webview: BrowserWebViewElement;
  inputEvents: BrowserWebViewInputEvent[];
  scripts: string[];
} {
  const inputEvents: BrowserWebViewInputEvent[] = [];
  const scripts: string[] = [];
  const webview = {
    sendInputEvent: (event: BrowserWebViewInputEvent) => {
      inputEvents.push(event);
    },
    executeJavaScript: (code: string) => {
      scripts.push(code);
      return Promise.resolve({ ok: true, message: "ok" });
    },
  } as unknown as BrowserWebViewElement;
  return { webview, inputEvents, scripts };
}

function action(
  overrides: Partial<BrowserWebViewAction> & { kind: BrowserWebViewAction["kind"] },
): BrowserWebViewAction {
  return {
    actionId: "a1",
    requestedAt: "2026-06-14T00:00:00.000Z",
    ...overrides,
  } as BrowserWebViewAction;
}

test("click_at sends mouseMove then mouseDown + mouseUp at the coordinates", async () => {
  const { webview, inputEvents } = fakeWebView();
  const result = await executeBrowserWebViewAction(
    webview,
    action({ kind: "click_at", x: 120, y: 240, button: "left", clickCount: 1 }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(inputEvents.map((event) => event.type), ["mouseMove", "mouseDown", "mouseUp"]);
  const down = inputEvents[1];
  assert.equal(down.type, "mouseDown");
  if (down.type === "mouseDown") {
    assert.equal(down.x, 120);
    assert.equal(down.y, 240);
    assert.equal(down.button, "left");
  }
});

test("move_to sends a single mouseMove", async () => {
  const { webview, inputEvents } = fakeWebView();
  await executeBrowserWebViewAction(webview, action({ kind: "move_to", x: 10, y: 20 }));
  assert.deepEqual(inputEvents.map((event) => event.type), ["mouseMove"]);
});

test("scroll sends a mouseWheel carrying the deltas", async () => {
  const { webview, inputEvents } = fakeWebView();
  await executeBrowserWebViewAction(
    webview,
    action({ kind: "scroll", x: 5, y: 6, deltaX: 0, deltaY: -120 }),
  );
  assert.equal(inputEvents.length, 1);
  const wheel = inputEvents[0];
  assert.equal(wheel.type, "mouseWheel");
  if (wheel.type === "mouseWheel") {
    assert.equal(wheel.deltaY, -120);
  }
});

test("key parses a chord into keyCode + modifiers (keyDown then keyUp)", async () => {
  const { webview, inputEvents } = fakeWebView();
  await executeBrowserWebViewAction(webview, action({ kind: "key", keys: "Cmd+A" }));
  assert.deepEqual(inputEvents.map((event) => event.type), ["keyDown", "keyUp"]);
  const down = inputEvents[0];
  if (down.type === "keyDown") {
    assert.equal(down.keyCode, "A");
    assert.deepEqual(down.modifiers, ["cmd"]);
  }
});

test("type sends one char event per character into the focused element", async () => {
  const { webview, inputEvents } = fakeWebView();
  await executeBrowserWebViewAction(webview, action({ kind: "type", text: "hi" }));
  assert.deepEqual(inputEvents.map((event) => event.type), ["char", "char"]);
  const first = inputEvents[0];
  if (first.type === "char") {
    assert.equal(first.keyCode, "h");
  }
});

test("selector click stays on the executeJavaScript path (no input events)", async () => {
  const { webview, inputEvents, scripts } = fakeWebView();
  const result = await executeBrowserWebViewAction(
    webview,
    action({ kind: "click", selector: "button.primary" }),
  );
  assert.equal(result.ok, true);
  assert.equal(inputEvents.length, 0);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /querySelector/);
});

test("a coordinate action on a webview without sendInputEvent fails gracefully", async () => {
  const webview = {
    executeJavaScript: () => Promise.resolve({ ok: true }),
  } as unknown as BrowserWebViewElement;
  const result = await executeBrowserWebViewAction(webview, action({ kind: "click_at", x: 1, y: 2 }));
  assert.equal(result.ok, false);
});

// --- Pixel vision: capturePage ---

test("captureBrowserWebViewScreenshot returns base64 PNG + size from capturePage", async () => {
  const webview = {
    capturePage: () =>
      Promise.resolve({
        toDataURL: () => "data:image/png;base64,QUJD",
        getSize: () => ({ width: 1024, height: 768 }),
      }),
  } as unknown as BrowserWebViewElement;

  const shot = await captureBrowserWebViewScreenshot(webview);
  assert.equal(shot?.data, "QUJD");
  assert.equal(shot?.mimeType, "image/png");
  assert.equal(shot?.width, 1024);
  assert.equal(shot?.height, 768);
});

test("captureBrowserWebViewScreenshot returns undefined when capturePage is unavailable", async () => {
  const webview = {} as unknown as BrowserWebViewElement;
  assert.equal(await captureBrowserWebViewScreenshot(webview), undefined);
});

// --- isWebViewSettled: guards the white-screen regression ---

test("isWebViewSettled returns false instead of throwing when isLoading() throws (pre-dom-ready)", () => {
  // A just-mounted <webview> throws synchronously from isLoading() ("must be attached to
  // the DOM and the dom-ready event emitted"). An un-guarded call escaped the snapshot
  // mount effect and unmounted the whole React tree (white screen). The guard must swallow
  // the throw and report "not settled".
  const webview = {
    isLoading: () => {
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted");
    },
  } as unknown as BrowserWebViewElement;
  assert.doesNotThrow(() => isWebViewSettled(webview));
  assert.equal(isWebViewSettled(webview), false);
});

test("isWebViewSettled returns true only when the guest finished loading", () => {
  const loaded = { isLoading: () => false } as unknown as BrowserWebViewElement;
  const loading = { isLoading: () => true } as unknown as BrowserWebViewElement;
  const missing = {} as unknown as BrowserWebViewElement;
  assert.equal(isWebViewSettled(loaded), true);
  assert.equal(isWebViewSettled(loading), false);
  assert.equal(isWebViewSettled(missing), false);
});
