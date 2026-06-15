// Spec: docs_v2/specs/left-rail-manual-ordering.md
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  moveKeyInOrder,
  parsePinnedItemKey,
  selectThreadListViewModel,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { ProductShellState } from "../src/desktop/application/domains/product-shell/product-shell.ts";

function summary(threadId: string, projectId: string, pinned: boolean, updatedAt: string) {
  return {
    threadId,
    title: `Thread ${threadId}`,
    agentBinding: { agentId: "claude", runtimeSource: { kind: "provider_cli", integrationId: "claude" } },
    scope: { kind: "project", projectId, cwd: `/repo/${projectId}` },
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt,
    pinned,
    archived: false,
    lastKnownState: "idle",
  };
}

function seed(threads: ReturnType<typeof summary>[]): ProductShellState {
  return applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads },
  });
}

const itemKey = (item: { kind: string; thread?: { threadId: string }; project?: { projectId: string } }) =>
  item.kind === "thread" ? `t:${item.thread!.threadId}` : `p:${item.project!.projectId}`;

test("a pinned thread is lifted out of its project group into the Pinned section", () => {
  const state = seed([
    summary("t1", "p1", true, "2026-06-11T00:02:00.000Z"),
    summary("t2", "p1", false, "2026-06-11T00:01:00.000Z"),
  ]);
  const vm = selectThreadListViewModel(state);
  const p1 = vm.projectGroups.find((group) => group.projectId === "p1");
  assert.deepEqual(p1?.threads.map((thread) => thread.threadId), ["t2"]); // pinned t1 gone
  assert.deepEqual(vm.pinnedThreads.map((thread) => thread.threadId), ["t1"]);
});

test("a pinned scratch thread is lifted out of the Scratch list into Pinned", () => {
  // Review feedback: "exactly one place in the rail" must hold for scratch too.
  const scratch = (threadId: string, pinned: boolean) => ({
    threadId,
    title: `S ${threadId}`,
    agentBinding: { agentId: "claude", runtimeSource: { kind: "provider_cli", integrationId: "claude" } },
    scope: { kind: "scratch", scratchCwd: "Scratch" },
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:01:00.000Z",
    pinned,
    archived: false,
    lastKnownState: "idle",
  });
  const state = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [scratch("s1", true), scratch("s2", false)] },
  });
  const vm = selectThreadListViewModel(state);
  assert.deepEqual(vm.scratchThreads.map((thread) => thread.threadId), ["s2"]);
  assert.ok(vm.pinnedThreads.some((thread) => thread.threadId === "s1"));
});

test("nested project threads still follow sortBy (recent first), not manual order", () => {
  const state = seed([
    summary("older", "p1", false, "2026-06-11T00:01:00.000Z"),
    summary("newer", "p1", false, "2026-06-11T00:05:00.000Z"),
  ]);
  const p1 = selectThreadListViewModel(state).projectGroups.find((g) => g.projectId === "p1");
  assert.deepEqual(p1?.threads.map((t) => t.threadId), ["newer", "older"]);
});

test("pinned items are one intermixed list ordered by pinnedItemOrder (overrides default)", () => {
  // Default base order is projects-then-threads; the manual order flips it.
  const base = seed([
    summary("t1", "p1", true, "2026-06-11T00:02:00.000Z"),
    summary("t2", "p2", false, "2026-06-11T00:01:00.000Z"),
  ]);
  const state: ProductShellState = { ...base, pinnedProjectIds: ["p2"] };
  assert.deepEqual(
    selectThreadListViewModel(state).pinnedItems.map(itemKey),
    ["p:p2", "t:t1"], // default: project then thread
  );
  const reordered: ProductShellState = {
    ...state,
    pinnedItemOrder: [
      { kind: "thread", threadId: "t1" },
      { kind: "project", projectId: "p2" },
    ],
  };
  assert.deepEqual(selectThreadListViewModel(reordered).pinnedItems.map(itemKey), ["t:t1", "p:p2"]);
});

test("project folders follow projectOrder (independent of sortBy)", () => {
  const base = seed([
    summary("a", "p1", false, "2026-06-11T00:05:00.000Z"),
    summary("b", "p2", false, "2026-06-11T00:01:00.000Z"),
  ]);
  const state: ProductShellState = { ...base, projectOrder: ["p2", "p1"] };
  assert.deepEqual(
    selectThreadListViewModel(state).projectGroups.map((group) => group.projectId),
    ["p2", "p1"],
  );
});

test("moveKeyInOrder drops the dragged key before the target", () => {
  assert.deepEqual(moveKeyInOrder(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(moveKeyInOrder(["a", "b", "c"], "a", "c"), ["b", "a", "c"]);
  assert.deepEqual(moveKeyInOrder(["a", "b", "c"], "a", "a"), ["a", "b", "c"]); // no-op
  assert.deepEqual(moveKeyInOrder(["a", "b"], "x", "a"), ["a", "b"]); // missing key
});

test("parsePinnedItemKey round-trips thread/project keys", () => {
  assert.deepEqual(parsePinnedItemKey("t:abc"), { kind: "thread", threadId: "abc" });
  assert.deepEqual(parsePinnedItemKey("p:xyz"), { kind: "project", projectId: "xyz" });
  assert.equal(parsePinnedItemKey("nope"), null);
});
