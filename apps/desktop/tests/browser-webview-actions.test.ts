// Spec: docs_v2/specs/browser-pane-agent-computer-use.md
// Slice 1b — coordinate computer-use actions drive the live <webview> through real
// sendInputEvent; selector actions resolve a DOM target, then prefer real input events.
import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

import {
  captureBrowserWebViewScreenshot,
  executeBrowserWebViewAction,
  isWebViewSettled,
  readBrowserWebViewSnapshot,
  safeFindInWebView,
  safeGetWebViewURL,
  safeInvokeWebView,
  safeLoadWebViewURL,
  safeStopFindInWebView,
  type BrowserWebViewAction,
  type BrowserWebViewElement,
  type BrowserWebViewInputEvent,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/browser-webview-actions.ts";
import {
  promiseWithTimeout,
  runBrowserWebViewActionTransaction,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/browser-pane-helpers.ts";

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

test("coordinate actions convert screenshot pixels to CSS pixels by devicePixelRatio", async () => {
  const previous = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  (globalThis as { devicePixelRatio?: number }).devicePixelRatio = 2;
  try {
    const { webview, inputEvents } = fakeWebView();
    await executeBrowserWebViewAction(
      webview,
      action({ kind: "click_at", x: 120, y: 240, button: "left", clickCount: 1 }),
    );
    const down = inputEvents[1];
    assert.equal(down.type, "mouseDown");
    if (down.type === "mouseDown") {
      assert.equal(down.x, 60);
      assert.equal(down.y, 120);
    }
  } finally {
    if (previous === undefined) {
      delete (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
    } else {
      (globalThis as { devicePixelRatio?: number }).devicePixelRatio = previous;
    }
  }
});

test("move_to sends a single mouseMove", async () => {
  const { webview, inputEvents } = fakeWebView();
  await executeBrowserWebViewAction(webview, action({ kind: "move_to", x: 10, y: 20 }));
  assert.deepEqual(inputEvents.map((event) => event.type), ["mouseMove"]);
});

test("drag sends mouseDown, stepped mouseMove events, then mouseUp", async () => {
  const { webview, inputEvents } = fakeWebView();
  const result = await executeBrowserWebViewAction(
    webview,
    action({
      kind: "drag",
      x: 120,
      y: 700,
      toX: 120,
      toY: 260,
      durationMs: 0,
      steps: 4,
    }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(inputEvents.map((event) => event.type), [
    "mouseMove",
    "mouseDown",
    "mouseMove",
    "mouseMove",
    "mouseMove",
    "mouseMove",
    "mouseUp",
  ]);
  const down = inputEvents[1];
  assert.equal(down.type, "mouseDown");
  if (down.type === "mouseDown") {
    assert.equal(down.x, 120);
    assert.equal(down.y, 700);
  }
  const lastMove = inputEvents[5];
  assert.equal(lastMove.type, "mouseMove");
  if (lastMove.type === "mouseMove") {
    assert.equal(lastMove.x, 120);
    assert.equal(lastMove.y, 260);
  }
  const up = inputEvents[6];
  assert.equal(up.type, "mouseUp");
  if (up.type === "mouseUp") {
    assert.equal(up.x, 120);
    assert.equal(up.y, 260);
  }
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

test("element click uses observed interactive element index without coordinate input events", async () => {
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
        message: "Clicked interactive element #1 button Reserve",
      });
    },
  } as unknown as BrowserWebViewElement;
  const result = await executeBrowserWebViewAction(
    webview,
    action({ kind: "click_element", elementIndex: 1 }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.message, "Clicked interactive element #1 button Reserve");
  assert.deepEqual(inputEvents, []);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0] ?? "", /"elementIndex":1/);
  assert.match(scripts[0] ?? "", /target\.click\(\)/);
});

test("selector click does not block a target inside an invalid form", async () => {
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
  assert.equal(result.ok, true);
  assert.deepEqual(inputEvents.map((event) => event.type), ["mouseMove", "mouseDown", "mouseUp"]);
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

test("selector type_text does not require global process in the renderer", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
  Object.defineProperty(globalThis, "process", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  try {
    const inputEvents: BrowserWebViewInputEvent[] = [];
    const webview = {
      sendInputEvent: (event: BrowserWebViewInputEvent) => {
        inputEvents.push(event);
      },
      executeJavaScript: (code: string) =>
        Promise.resolve({
          ok: true,
          message: code.includes("document.activeElement") ? "focused value length 2" : "focused",
        }),
    } as unknown as BrowserWebViewElement;
    const result = await executeBrowserWebViewAction(
      webview,
      action({ kind: "type_text", selector: "input.title", text: "hi" }),
    );
    assert.equal(result.ok, true);
    assert.deepEqual(inputEvents.map((event) => event.type), ["keyDown", "keyUp", "char", "char"]);
  } finally {
    if (descriptor === undefined) {
      delete (globalThis as { process?: unknown }).process;
    } else {
      Object.defineProperty(globalThis, "process", descriptor);
    }
  }
});

test("a coordinate action on a webview without sendInputEvent fails gracefully", async () => {
  const webview = {
    executeJavaScript: () => Promise.resolve({ ok: true }),
  } as unknown as BrowserWebViewElement;
  const result = await executeBrowserWebViewAction(webview, action({ kind: "click_at", x: 1, y: 2 }));
  assert.equal(result.ok, false);
});

test("browser action transaction reports failed when the action chain times out", async () => {
  const webview = {
    sendInputEvent: () => undefined,
    isLoading: () => true,
  } as unknown as BrowserWebViewElement;
  const result = await runBrowserWebViewActionTransaction(
    webview,
    action({ kind: "move_to", x: 1, y: 2 }),
    1,
  );
  assert.equal(result.status, "failed");
  assert.match(result.message, /timed out/);
});

test("browser action timeout helper consumes late rejection after timeout", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const result = await promiseWithTimeout(
      new Promise<string>((_resolve, reject) => {
        setTimeout(() => reject(new Error("late browser action failure")), 20);
      }),
      1,
    );
    assert.equal(result, undefined);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
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

test("readBrowserWebViewSnapshot carries bounded interactive elements", async () => {
  const webview = {
    executeJavaScript: () =>
      Promise.resolve({
        url: "https://x.test/",
        pageTitle: "X",
        bodyTextPreview: "",
        interactiveElements: [
          {
            index: 0,
            tag: "input",
            type: "search",
            placeholder: "Search",
            rect: { x: 10, y: 20, width: 300, height: 44 },
          },
          {
            index: 1,
            tag: "a",
            text: "Instagram",
            href: "https://www.instagram.com/catchtable_official",
            rect: { x: 10, y: 90, width: 120, height: 32 },
          },
        ],
      }),
    getURL: () => "https://x.test/",
  } as unknown as BrowserWebViewElement;

  const snapshot = await readBrowserWebViewSnapshot(webview);

  assert.equal(snapshot.bodyTextPreview, "");
  assert.equal(snapshot.interactiveElements?.length, 2);
  assert.equal(snapshot.interactiveElements?.[0]?.placeholder, "Search");
  assert.equal(snapshot.interactiveElements?.[1]?.href, "https://www.instagram.com/catchtable_official");
});

test("readBrowserWebViewSnapshot tolerates pre-dom-ready getURL throws", async () => {
  const webview = {
    executeJavaScript: () => {
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted");
    },
    getURL: () => {
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted");
    },
  } as unknown as BrowserWebViewElement;

  const snapshot = await readBrowserWebViewSnapshot(webview);

  assert.equal(snapshot.url, undefined);
  assert.equal(snapshot.pageTitle, undefined);
  assert.equal(snapshot.bodyTextPreview, undefined);
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

test("safe webview wrappers swallow pre-dom-ready guest API throws", () => {
  let loadCalls = 0;
  let findCalls = 0;
  let stopFindCalls = 0;
  const webview = {
    getURL: () => {
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted");
    },
    loadURL: () => {
      loadCalls += 1;
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted");
    },
    reload: () => {
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted");
    },
    findInPage: () => {
      findCalls += 1;
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted");
    },
    stopFindInPage: () => {
      stopFindCalls += 1;
      throw new Error("The WebView must be attached to the DOM and the dom-ready event emitted");
    },
  } as unknown as BrowserWebViewElement;

  assert.doesNotThrow(() => safeLoadWebViewURL(webview, "https://example.test/"));
  assert.doesNotThrow(() => safeInvokeWebView(webview, "reload"));
  assert.doesNotThrow(() => safeFindInWebView(webview, "query"));
  assert.doesNotThrow(() => safeStopFindInWebView(webview, "clearSelection"));
  assert.equal(safeGetWebViewURL(webview), undefined);
  assert.equal(loadCalls, 1);
  assert.equal(findCalls, 1);
  assert.equal(stopFindCalls, 1);
});
