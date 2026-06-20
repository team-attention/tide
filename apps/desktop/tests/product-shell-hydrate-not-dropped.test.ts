// Regression: a `thread.hydrated` response carries a thread's authoritative chat state
// (its blocks + a CLEARED `hydrating` flag). It is dispatched on open but resolves a
// round-trip later. If focus moved off that thread in the window (a clicked notification
// jumped elsewhere, a thread.listed nulled activeThreadId, …) the response used to match
// neither the active surface NOR an existing background entry and was DROPPED — leaving
// the thread stranded on the loading skeleton forever (until an app restart). These
// tests pin that a hydrate/started event is always recorded to its own thread.
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  openProductShellThread,
  openProductShellThreadFromLeftRail,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function threadSummary(threadId: string, overrides: Record<string, unknown> = {}) {
  return {
    threadId,
    title: `Thread ${threadId}`,
    agentBinding: {
      agentId: "claude",
      runtimeSource: { kind: "provider_cli", integrationId: "claude" },
    },
    scope: { kind: "project", projectId: "p1", cwd: "/repo/p1" },
    createdAt: "2026-06-17T00:00:00.000Z",
    updatedAt: "2026-06-17T00:01:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "waiting_for_approval",
    ...overrides,
  };
}

function block(blockId: string, threadId: string) {
  return {
    blockId,
    threadId,
    kind: "agent_message",
    role: "agent" as const,
    status: "complete" as const,
    body: "hello from the agent",
    updatedAt: "2026-06-17T00:01:00.000Z",
  };
}

function seed(threadIds: string[]) {
  return applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: threadIds.map((id) => threadSummary(id)) },
  });
}

test("thread.hydrated for a non-active thread with no prior entry is recorded, not dropped", () => {
  // Looking at X; Y's hydrate response arrives late (focus already on X) and Y was never
  // preserved into the per-thread map. The hydrate MUST still land in Y's stored state.
  const viewingX = openProductShellThread(seed(["x", "y"]), "x");
  assert.equal(viewingX.activeThreadId, "x");
  assert.equal(viewingX.agentChatByThreadId.y, undefined);

  const next = applyProductShellBackendEvent(viewingX, {
    kind: "thread.hydrated",
    payload: {
      thread: threadSummary("y"),
      blocks: [block("b1", "y")],
      runtimeState: "waiting_for_approval",
    },
  });

  // Focus is unchanged (a data event never moves focus)…
  assert.equal(next.activeThreadId, "x");
  // …but Y's authoritative state is now stored with the skeleton cleared + blocks present.
  const storedY = next.agentChatByThreadId.y;
  assert.ok(storedY, "Y's hydrate must be recorded into the per-thread map");
  assert.equal(storedY.hydrating, false);
  assert.equal(storedY.blocks.length, 1);
});

test("a stranded thread renders without the skeleton after the late hydrate lands", () => {
  // Open Y from the rail → optimistic skeleton (hydrating) awaiting the backend.
  const opened = openProductShellThreadFromLeftRail(seed(["x", "y"]), "y", {
    backendTransportAvailable: true,
  });
  assert.equal(opened.state.activeThreadId, "y");
  assert.equal(opened.state.agentChat.hydrating, true);
  assert.equal(opened.command?.kind, "thread.hydrate");

  // Focus is dragged off Y WITHOUT preserving it (a thread.listed that no longer lists Y,
  // e.g. it got archived) — this is the window that used to drop the response.
  const refocused = applyProductShellBackendEvent(opened.state, {
    kind: "thread.listed",
    payload: { threads: [threadSummary("x")] },
  });
  assert.equal(refocused.activeThreadId, null);
  assert.equal(refocused.agentChatByThreadId.y, undefined);

  // The delayed hydrate for Y finally arrives.
  const hydrated = applyProductShellBackendEvent(refocused, {
    kind: "thread.hydrated",
    payload: {
      thread: threadSummary("y"),
      blocks: [block("b1", "y")],
      runtimeState: "waiting_for_approval",
    },
  });
  assert.equal(hydrated.agentChatByThreadId.y?.hydrating, false);

  // Re-list Y and re-open it from the rail: the restored state is NOT hydrating, so the
  // chat shows the transcript (+ its pending approval) instead of an endless skeleton.
  const relisted = applyProductShellBackendEvent(hydrated, {
    kind: "thread.listed",
    payload: { threads: [threadSummary("x"), threadSummary("y")] },
  });
  const reopened = openProductShellThreadFromLeftRail(relisted, "y", {
    backendTransportAvailable: true,
  });
  assert.equal(reopened.state.activeThreadId, "y");
  assert.equal(reopened.state.agentChat.hydrating, false);
  assert.equal(reopened.state.agentChat.blocks.length, 1);
});

test("reselecting the active thread does not replace its ready chat with a hydrate skeleton", () => {
  const opened = openProductShellThreadFromLeftRail(seed(["x"]), "x", {
    backendTransportAvailable: true,
  });
  const ready = applyProductShellBackendEvent(opened.state, {
    kind: "thread.hydrated",
    payload: {
      thread: threadSummary("x"),
      blocks: [block("b1", "x")],
      runtimeState: "idle",
    },
  });
  assert.equal(ready.activeThreadId, "x");
  assert.equal(ready.agentChat.hydrating, false);
  assert.equal(ready.agentChat.blocks.length, 1);

  const reselected = openProductShellThreadFromLeftRail(
    {
      ...ready,
      leftRailMenu: { kind: "thread", threadId: "x" },
      archiveConfirmThreadId: "x",
      renamingThreadId: "x",
    },
    "x",
    {
      backendTransportAvailable: true,
    },
  );

  assert.equal(reselected.state.activeThreadId, "x");
  assert.equal(reselected.state.agentChat.hydrating, false);
  assert.equal(reselected.state.agentChat.blocks.length, 1);
  assert.equal(reselected.state.leftRailMenu, null);
  assert.equal(reselected.state.archiveConfirmThreadId, null);
  assert.equal(reselected.state.renamingThreadId, null);
  assert.equal(reselected.command?.kind, "thread.hydrate");
});

test("non-hydrate background events for an unknown thread are still ignored (scope unchanged)", () => {
  // The fix is scoped to hydrate/started seeding. A stray per-thread DATA event for a
  // thread we hold no state for must NOT fabricate an entry (that was the prior contract).
  const viewingX = openProductShellThread(seed(["x", "y"]), "x");

  const next = applyProductShellBackendEvent(viewingX, {
    kind: "agentRuntime.stateChanged",
    payload: { threadId: "y", state: "running" },
  });

  assert.equal(next.agentChatByThreadId.y, undefined);
});
