// Spec: docs_v2/specs/browser-pane-agent-computer-use.md
// Slice 1b — coordinate computer-use actions drive the live <webview> through real
// sendInputEvent; selector actions resolve a DOM target, then prefer real input events.
import assert from "node:assert/strict";
import test from "node:test";

import {
  captureBrowserWebViewScreenshot,
  executeBrowserWebViewAction,
  isWebViewSettled,
  readBrowserWebViewSnapshot,
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

test("selector click resolves a target and sends real mouse events", async () => {
  const inputEvents: BrowserWebViewInputEvent[] = [];
  const scripts: string[] = [];
  const webview = {
    sendInputEvent: (event: BrowserWebViewInputEvent) => {
      inputEvents.push(event);
    },
    executeJavaScript: (code: string) => {
      scripts.push(code);
      return Promise.resolve({
        ok: true,
        message: "Resolved button.primary",
        x: 40,
        y: 50,
        description: "button.primaryhit",
        disabled: false,
        formValid: true,
      });
    },
  } as unknown as BrowserWebViewElement;
  const result = await executeBrowserWebViewAction(
    webview,
    action({ kind: "click", selector: "button.primary" }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(inputEvents.map((event) => event.type), ["mouseMove", "mouseDown", "mouseUp"]);
  const down = inputEvents[1];
  assert.equal(down.type, "mouseDown");
  if (down.type === "mouseDown") {
    assert.equal(down.x, 40);
    assert.equal(down.y, 50);
  }
  assert.equal(scripts.length, 1);
});

test("selector click reports an invalid form before sending mouse events", async () => {
  const inputEvents: BrowserWebViewInputEvent[] = [];
  const webview = {
    sendInputEvent: (event: BrowserWebViewInputEvent) => {
      inputEvents.push(event);
    },
    executeJavaScript: () =>
      Promise.resolve({
        ok: true,
        message: "Resolved button.primary",
        x: 40,
        y: 50,
        description: "button.primaryhit",
        disabled: false,
        formValid: false,
      }),
  } as unknown as BrowserWebViewElement;
  const result = await executeBrowserWebViewAction(
    webview,
    action({ kind: "click", selector: "button.primary" }),
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /form is invalid/);
  assert.equal(inputEvents.length, 0);
});

test("selector type_text focuses the target and sends char events", async () => {
  const inputEvents: BrowserWebViewInputEvent[] = [];
  const scripts: string[] = [];
  const webview = {
    sendInputEvent: (event: BrowserWebViewInputEvent) => {
      inputEvents.push(event);
    },
    executeJavaScript: (code: string) => {
      scripts.push(code);
      return Promise.resolve({
        ok: true,
        message: code.includes("document.activeElement") ? "focused value length 2" : "focused",
      });
    },
  } as unknown as BrowserWebViewElement;
  const result = await executeBrowserWebViewAction(
    webview,
    action({ kind: "type_text", selector: "input.title", text: "hi" }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(inputEvents.map((event) => event.type), ["keyDown", "keyUp", "char", "char"]);
  assert.equal(scripts.length, 2);
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

// --- readBrowserWebViewSnapshot: screenshot capture decoupled from the text snapshot ---
// Spec: docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md. The recurring load-event
// path (did-stop-loading/did-finish-load) is TEXT-ONLY — it must NOT capture a screenshot, since
// that storm pegged the host renderer. Pixels come only from captureBrowserWebViewScreenshot,
// which the observe-time pull (pendingCapture) calls on demand.

function snapshotWebView(): { webview: BrowserWebViewElement; calls: { capture: number } } {
  const calls = { capture: 0 };
  const webview = {
    executeJavaScript: () =>
      Promise.resolve({ url: "https://x.test/", pageTitle: "X", bodyTextPreview: "hello" }),
    getURL: () => "https://x.test/",
    capturePage: () => {
      calls.capture += 1;
      return Promise.resolve({
        toDataURL: () => "data:image/png;base64,QUJD",
        getSize: () => ({ width: 800, height: 600 }),
      });
    },
  } as unknown as BrowserWebViewElement;
  return { webview, calls };
}

test("readBrowserWebViewSnapshot is text-only and NEVER calls capturePage (no load-event storm)", async () => {
  const { webview, calls } = snapshotWebView();
  const snapshot = await readBrowserWebViewSnapshot(webview);
  assert.equal(calls.capture, 0, "the load-event snapshot must never call capturePage");
  assert.equal(snapshot.screenshot, undefined);
  assert.equal(snapshot.url, "https://x.test/");
  assert.equal(snapshot.pageTitle, "X");
  assert.equal(snapshot.bodyTextPreview, "hello");
});

test("captureBrowserWebViewScreenshot is the single on-demand pixel-capture path", async () => {
  const { webview, calls } = snapshotWebView();
  const screenshot = await captureBrowserWebViewScreenshot(webview);
  assert.equal(calls.capture, 1);
  assert.equal(screenshot?.data, "QUJD");
  assert.equal(screenshot?.width, 800);
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
