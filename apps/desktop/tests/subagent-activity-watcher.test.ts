// Spec: live-turn-activity-visibility.md (Slice B / B2). The watcher polls the
// subagents dir, excludes pre-turn files by mtime, emits only on change, and stops
// cleanly. Deps (fs/clock/timer) are injected so ticks are deterministic.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createSubagentActivityWatcher,
  type SubagentFileEntry,
} from "../src/backend/adapters/outbound/agent-runtime/structured/subagent-activity-watcher.ts";

function assistantToolUseLine(n: number): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: Array.from({ length: n }, () => ({ type: "tool_use", name: "WebSearch" })) },
  });
}

function makeHarness(initial: { files: Record<string, SubagentFileEntry & { lines: string[] }> }) {
  const store = initial.files;
  let tickCb: (() => void) | undefined;
  const emissions: Array<{ nestedAgents: number; nestedToolCalls: number }> = [];
  const watcher = createSubagentActivityWatcher({
    emit: (c) => emissions.push(c),
    deps: {
      resolveDir: () => "/sub",
      listSubagentFiles: () => Object.values(store).map(({ path, mtimeMs }) => ({ path, mtimeMs })),
      readFileLines: (path) => Object.values(store).find((f) => f.path === path)?.lines ?? [],
      schedule: (cb) => {
        tickCb = cb;
        return () => {
          tickCb = undefined;
        };
      },
    },
  });
  return { watcher, emissions, store, tick: () => tickCb?.() };
}

test("B2: emits nested counts for current-turn subagent files on start", () => {
  const h = makeHarness({
    files: {
      a: { path: "/sub/agent-a.jsonl", mtimeMs: 1100, lines: [assistantToolUseLine(2)] },
      b: { path: "/sub/agent-b.jsonl", mtimeMs: 1200, lines: [assistantToolUseLine(3)] },
    },
  });
  h.watcher.start(1000);
  assert.deepEqual(h.emissions, [{ nestedAgents: 2, nestedToolCalls: 5 }]);
});

test("B2b: pre-turn files (mtime < turnStart) are excluded", () => {
  const h = makeHarness({
    files: {
      old: { path: "/sub/agent-old.jsonl", mtimeMs: 500, lines: [assistantToolUseLine(9)] },
      live: { path: "/sub/agent-live.jsonl", mtimeMs: 2000, lines: [assistantToolUseLine(1)] },
    },
  });
  h.watcher.start(1000);
  assert.deepEqual(h.emissions, [{ nestedAgents: 1, nestedToolCalls: 1 }]);
});

test("B2c: re-emits only when counts change across polls", () => {
  const h = makeHarness({
    files: { a: { path: "/sub/agent-a.jsonl", mtimeMs: 1100, lines: [assistantToolUseLine(1)] } },
  });
  h.watcher.start(1000);
  h.tick(); // unchanged → no new emission
  assert.equal(h.emissions.length, 1);
  h.store.a.lines = [assistantToolUseLine(4)];
  h.tick(); // grew → emit
  assert.deepEqual(h.emissions[1], { nestedAgents: 1, nestedToolCalls: 4 });
});

test("B2d: stop halts polling", () => {
  const h = makeHarness({
    files: { a: { path: "/sub/agent-a.jsonl", mtimeMs: 1100, lines: [assistantToolUseLine(1)] } },
  });
  h.watcher.start(1000);
  h.watcher.stop();
  h.store.a.lines = [assistantToolUseLine(9)];
  h.tick(); // disposed → no-op
  assert.equal(h.emissions.length, 1);
});

test("B2e: an empty fan-out never emits a bare zero", () => {
  const h = makeHarness({ files: {} });
  h.watcher.start(1000);
  assert.equal(h.emissions.length, 0);
});
