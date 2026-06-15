// Spec: docs_v2/specs/multitask-navigation.md (#2 — ⌥N shortcut numbers cover the
// first 9 threads in Left Rail order, NOT just pinned threads).
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  selectThreadListViewModel,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function summary(threadId: string, updatedAt: string, pinned: boolean) {
  return {
    threadId,
    title: `Thread ${threadId}`,
    agentBinding: {
      agentId: "claude",
      runtimeSource: { kind: "provider_cli", integrationId: "claude" },
    },
    scope: { kind: "project", projectId: "p1", cwd: "/Users/you/repo" },
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt,
    pinned,
    archived: false,
    lastKnownState: "idle",
  };
}

function seed(threads: ReturnType<typeof summary>[]) {
  return applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads },
  });
}

test("shortcut_numbers_span_pinned_then_unpinned_in_rail_order", () => {
  // #2: with only 2 pinned threads, ⌥1..9 must keep numbering past them into the
  // (unpinned) project-group threads — pinned first, then rail order.
  const state = seed([
    summary("p1", "2026-06-11T00:04:00.000Z", true),
    summary("p2", "2026-06-11T00:03:00.000Z", true),
    summary("n1", "2026-06-11T00:02:00.000Z", false),
    summary("n2", "2026-06-11T00:01:00.000Z", false),
  ]);
  const vm = selectThreadListViewModel(state);
  // numberedThreads (the ⌥N jump targets) = first 9 in rail order, numbered 1..N.
  assert.deepEqual(
    vm.numberedThreads.map((thread) => [thread.threadId, thread.pinNumber]),
    [
      ["p1", 1],
      ["p2", 2],
      ["n1", 3],
      ["n2", 4],
    ],
  );
  // The badge number is stamped onto the section view too — an UNPINNED thread now
  // carries a number (the old behavior left these undefined).
  const n1InGroup = vm.projectGroups.flatMap((g) => g.threads).find((t) => t.threadId === "n1");
  assert.equal(n1InGroup?.pinNumber, 3);
  // Pinned threads keep the leading numbers.
  assert.equal(vm.pinnedThreads.find((t) => t.threadId === "p1")?.pinNumber, 1);
});

test("shortcut_numbers_cap_at_nine", () => {
  const state = seed(
    Array.from({ length: 12 }, (_, i) =>
      summary(`t${i + 1}`, `2026-06-11T00:${String(12 - i).padStart(2, "0")}:00.000Z`, false),
    ),
  );
  const vm = selectThreadListViewModel(state);
  assert.equal(vm.numberedThreads.length, 9);
  assert.deepEqual(
    vm.numberedThreads.map((t) => t.pinNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  // The 10th+ rail threads carry no shortcut number.
  const flat = vm.flatThreads;
  assert.equal(flat.slice(0, 9).every((t) => t.pinNumber !== undefined), true);
  assert.equal(flat.slice(9).every((t) => t.pinNumber === undefined), true);
});
