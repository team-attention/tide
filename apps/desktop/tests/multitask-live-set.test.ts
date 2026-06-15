// Spec: docs_v2/specs/multitask-navigation.md (L3 live set + Decision 8 ordering)
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  selectThreadListViewModel,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function summary(threadId: string, updatedAt: string, live: boolean | undefined) {
  const base = {
    threadId,
    title: `Thread ${threadId}`,
    agentBinding: {
      agentId: "claude",
      runtimeSource: { kind: "provider_cli", integrationId: "claude" },
    },
    scope: { kind: "project", projectId: "p1", cwd: "/Users/you/repo" },
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt,
    pinned: false,
    archived: false,
    lastKnownState: "idle",
  };
  return live === undefined ? base : { ...base, live };
}

function seed(threads: ReturnType<typeof summary>[]) {
  return applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads },
  });
}

test("live_set_is_live_threads_in_rail_order_excluding_non_live", () => {
  // Decision 2: only hydrated/live-in-process threads are in the set (live:false and
  // a missing live flag are both excluded). Decision 8: in Left Rail render order
  // (project mode → recent within the group, here newest first).
  const state = seed([
    summary("t1", "2026-06-11T00:04:00.000Z", true),
    summary("t2", "2026-06-11T00:03:00.000Z", false),
    summary("t3", "2026-06-11T00:02:00.000Z", true),
    summary("t4", "2026-06-11T00:01:00.000Z", undefined),
  ]);
  const liveThreads = selectThreadListViewModel(state).liveThreads;
  assert.deepEqual(liveThreads.map((thread) => thread.threadId), ["t1", "t3"]);
});

test("live_set_is_empty_when_no_thread_is_live", () => {
  const state = seed([
    summary("a", "2026-06-11T00:02:00.000Z", false),
    summary("b", "2026-06-11T00:01:00.000Z", undefined),
  ]);
  assert.deepEqual(selectThreadListViewModel(state).liveThreads, []);
});

test("summary_live_flag_flows_into_shell_threads", () => {
  // The backend-authoritative `live` carries through the thread.listed mapping.
  const state = seed([
    summary("t1", "2026-06-11T00:02:00.000Z", true),
    summary("t2", "2026-06-11T00:01:00.000Z", false),
  ]);
  assert.equal(state.threads.find((thread) => thread.threadId === "t1")?.live, true);
  assert.equal(state.threads.find((thread) => thread.threadId === "t2")?.live, false);
});
