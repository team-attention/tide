// A background thread finishing a turn (running -> done, off-screen) should be
// surfaced so the user doesn't have to babysit it. selectBackgroundCompletions
// is the uniform signal (per-thread `running` flag), independent of provider.
import test from "node:test";
import assert from "node:assert/strict";

import {
  selectBackgroundCompletions,
  type ProductShellThread,
} from "../src/desktop/application/domains/product-shell/product-shell-state.ts";

function thread(over: Partial<ProductShellThread> & { threadId: string }): ProductShellThread {
  return {
    threadId: over.threadId,
    title: over.title ?? over.threadId,
    agentId: "codex",
    time: "now",
    scope: { kind: "scratch", scratchCwd: "Scratch" },
    workbenchPanes: [],
    ...over,
  } as ProductShellThread;
}

test("a background thread that stopped running is reported as completed", () => {
  const prev = new Set(["t1", "t2"]);
  const threads = [thread({ threadId: "t1", running: false }), thread({ threadId: "t2", running: true })];
  const done = selectBackgroundCompletions(prev, threads, "active-other");
  assert.deepEqual(done.map((t) => t.threadId), ["t1"]);
});

test("the thread the user is viewing is NOT reported (no need to notify)", () => {
  const prev = new Set(["t1"]);
  const threads = [thread({ threadId: "t1", running: false })];
  assert.equal(selectBackgroundCompletions(prev, threads, "t1").length, 0);
});

test("a thread that stopped running because it needs input is left to the attention path", () => {
  const prev = new Set(["t1"]);
  const threads = [thread({ threadId: "t1", running: false, attention: true })];
  assert.equal(selectBackgroundCompletions(prev, threads, "active-other").length, 0);
});

test("a thread that was not previously running is not reported", () => {
  const prev = new Set<string>();
  const threads = [thread({ threadId: "t1", running: false })];
  assert.equal(selectBackgroundCompletions(prev, threads, null).length, 0);
});
