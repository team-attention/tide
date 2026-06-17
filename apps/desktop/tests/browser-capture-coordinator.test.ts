// Spec: docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md
// The observe-time capture pull correlates a captureId with the renderer's response, with a
// timeout so a non-reporting pane degrades instead of hanging the agent's observe call.
import assert from "node:assert/strict";
import test from "node:test";

import { BrowserCaptureCoordinator } from "../src/backend/application/services/workbench/browser-capture-coordinator.ts";
import type { BrowserPaneScreenshot } from "../src/backend/application/domains/workbench/workbench.ts";

const shot: BrowserPaneScreenshot = {
  data: "QUJD",
  mimeType: "image/png",
  width: 800,
  height: 600,
  devicePixelRatio: 2,
};

// A controllable timer so timeout behaviour is deterministic (no wall-clock waits).
function fakeTimers(): {
  deps: { setTimeoutFn: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>; clearTimeoutFn: (h: ReturnType<typeof setTimeout>) => void };
  fire: () => void;
  cleared: () => boolean;
} {
  let callback: (() => void) | null = null;
  let wasCleared = false;
  return {
    deps: {
      setTimeoutFn: (cb) => {
        callback = cb;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {
        wasCleared = true;
      },
    },
    fire: () => callback?.(),
    cleared: () => wasCleared,
  };
}

test("request resolves with the renderer's screenshot when resolve() is called", async () => {
  const timers = fakeTimers();
  const coordinator = new BrowserCaptureCoordinator(timers.deps);
  const pending = coordinator.request("cap-1", 2000);
  assert.equal(coordinator.resolve("cap-1", shot), true);
  assert.deepEqual(await pending, shot);
  assert.equal(timers.cleared(), true, "resolving must clear the timeout timer");
});

test("request resolves undefined when the capture times out", async () => {
  const timers = fakeTimers();
  const coordinator = new BrowserCaptureCoordinator(timers.deps);
  const pending = coordinator.request("cap-2", 2000);
  timers.fire(); // simulate the timeout elapsing
  assert.equal(await pending, undefined);
});

test("resolve() returns false for an unknown / already-settled captureId", () => {
  const timers = fakeTimers();
  const coordinator = new BrowserCaptureCoordinator(timers.deps);
  assert.equal(coordinator.resolve("never-requested", shot), false);
});

test("a late report after timeout is ignored (resolve returns false)", async () => {
  const timers = fakeTimers();
  const coordinator = new BrowserCaptureCoordinator(timers.deps);
  const pending = coordinator.request("cap-3", 2000);
  timers.fire();
  assert.equal(await pending, undefined);
  assert.equal(coordinator.resolve("cap-3", shot), false);
});
