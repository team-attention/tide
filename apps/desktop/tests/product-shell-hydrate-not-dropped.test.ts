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

test("a stranded thread un-skeletons on the visible surface when the late hydrate lands", () => {
  // Open Y from the rail → optimistic skeleton (hydrating) awaiting the backend.
  const opened = openProductShellThreadFromLeftRail(seed(["x", "y"]), "y", {
    backendTransportAvailable: true,
  });
  assert.equal(opened.state.activeThreadId, "y");
  assert.equal(opened.state.agentChat.hydrating, true);
  assert.equal(opened.command?.kind, "thread.hydrate");

  // A thread.listed transiently omits Y → activeThreadId is nulled, but the chat STILL
  // displays Y (nulling the bookkeeping field does not reset agentChat). This is the
  // window that used to strand the late hydrate response.
  const refocused = applyProductShellBackendEvent(opened.state, {
    kind: "thread.listed",
    payload: { threads: [threadSummary("x")] },
  });
  assert.equal(refocused.activeThreadId, null);
  assert.equal(refocused.agentChat.thread?.threadId, "y", "the surface still displays Y");

  // The delayed hydrate for Y finally arrives → it lands on the DISPLAYED surface itself,
  // clearing the skeleton in place (no re-open needed) instead of being stranded.
  const hydrated = applyProductShellBackendEvent(refocused, {
    kind: "thread.hydrated",
    payload: {
      thread: threadSummary("y"),
      blocks: [block("b1", "y")],
      runtimeState: "waiting_for_approval",
    },
  });
  assert.equal(hydrated.agentChat.hydrating, false);
  assert.equal(hydrated.agentChat.blocks.length, 1);

  // And the ready surface survives a real switch away and back: leaving Y preserves it
  // under its own id (even though activeThreadId was null), so returning restores the
  // transcript instead of rebuilding a skeleton.
  const relisted = applyProductShellBackendEvent(hydrated, {
    kind: "thread.listed",
    payload: { threads: [threadSummary("x"), threadSummary("y")] },
  });
  const onX = openProductShellThreadFromLeftRail(relisted, "x", {
    backendTransportAvailable: true,
  });
  assert.equal(onX.state.agentChatByThreadId.y?.blocks.length, 1, "Y preserved on switch-away");
  const backToY = openProductShellThreadFromLeftRail(onX.state, "y", {
    backendTransportAvailable: true,
  });
  assert.equal(backToY.state.activeThreadId, "y");
  assert.equal(backToY.state.agentChat.hydrating, false);
  assert.equal(backToY.state.agentChat.blocks.length, 1);
});

test("an approval card for the displayed thread reaches the visible surface in the activeThreadId-null window", () => {
  // The live wedge in miniature: the user is viewing the thread, activeThreadId is
  // transiently null (a thread.listed momentarily omitted it), and the promoted second
  // parallel-permission card arrives. It must land on the VISIBLE chat, not just the map.
  const opened = openProductShellThreadFromLeftRail(seed(["x", "y"]), "y", {
    backendTransportAvailable: true,
  });
  const ready = applyProductShellBackendEvent(opened.state, {
    kind: "thread.hydrated",
    payload: { thread: threadSummary("y"), blocks: [block("b1", "y")], runtimeState: "running" },
  });
  const nulled = applyProductShellBackendEvent(ready, {
    kind: "thread.listed",
    payload: { threads: [threadSummary("x")] },
  });
  assert.equal(nulled.activeThreadId, null);
  assert.equal(nulled.agentChat.thread?.threadId, "y", "the surface still displays Y");

  const carded = applyProductShellBackendEvent(nulled, {
    kind: "prompt.changed",
    payload: { threadId: "y", prompt: approvalPrompt("y", "p2") },
  });
  assert.equal(carded.agentChat.promptState?.promptId, "p2", "the card shows on the displayed surface");
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

test("a background per-thread DATA event for a thread with no prior entry is recorded, not dropped", () => {
  // ROOT FIX: the backend is authoritative for EVERY thread, so a per-thread event for a
  // non-active thread is ALWAYS folded (seeding a fresh entry) — never dropped just because
  // the renderer happens not to hold an entry yet. (The prior contract ignored it, which is
  // exactly how a promoted parallel-permission card got lost and wedged a thread.)
  const viewingX = openProductShellThread(seed(["x", "y"]), "x");
  assert.equal(viewingX.agentChatByThreadId.y, undefined);

  const next = applyProductShellBackendEvent(viewingX, {
    kind: "agentRuntime.stateChanged",
    payload: { threadId: "y", state: "running" },
  });

  // Focus is unchanged (a data event never moves focus)…
  assert.equal(next.activeThreadId, "x");
  // …and Y's authoritative runtime state is now recorded in the per-thread map.
  assert.ok(next.agentChatByThreadId.y, "Y's state event must be recorded into the per-thread map");
  assert.equal(next.agentChatByThreadId.y?.runtimeState, "running");
});

function approvalPrompt(threadId: string, promptId: string) {
  return {
    promptId,
    threadId,
    agentId: "claude",
    kind: "approval" as const,
    message: "Bash: ls -la 2026/06/23/",
    choices: [
      { choiceId: "allow", label: "Allow", providerValue: "__allow__" },
      { choiceId: "deny", label: "Deny", providerValue: "__deny__" },
    ],
    defaultChoiceId: "allow",
    source: "provider_hook" as const,
  };
}

test("a promoted parallel-permission card for a background thread is recorded (no wedge)", () => {
  // claude fires N can_use_tool permissions in parallel and blocks the turn until EVERY one
  // is answered. Tide shows one card + queues the rest; answering the visible card promotes
  // the next. If the promote's prompt.changed lands while this thread is NOT the active
  // surface, it used to be dropped — the second card never surfaced and the thread wedged
  // "running" with no card. It must now be recorded so re-viewing the thread shows it.
  const viewingX = openProductShellThread(seed(["x", "y"]), "x");
  assert.equal(viewingX.agentChatByThreadId.y, undefined);

  const next = applyProductShellBackendEvent(viewingX, {
    kind: "prompt.changed",
    payload: { threadId: "y", prompt: approvalPrompt("y", "p2") },
  });

  assert.equal(next.activeThreadId, "x", "a data event never moves focus");
  assert.equal(
    next.agentChatByThreadId.y?.promptState?.promptId,
    "p2",
    "the promoted card must be recorded for Y, not dropped",
  );
});

test("a promoted card is recorded even in the activeThreadId === null window", () => {
  // The exact window that produced the live wedge: a thread.listed transiently nulled the
  // focused thread, so the promote's prompt.changed matched neither the active surface NOR
  // an existing entry. It must still be recorded for the thread.
  const noFocus = applyProductShellBackendEvent(seed(["x", "y"]), {
    kind: "thread.listed",
    payload: { threads: [] },
  });
  assert.equal(noFocus.activeThreadId, null);

  const recorded = applyProductShellBackendEvent(noFocus, {
    kind: "prompt.changed",
    payload: { threadId: "y", prompt: approvalPrompt("y", "p2") },
  });

  assert.equal(
    recorded.agentChatByThreadId.y?.promptState?.promptId,
    "p2",
    "card recorded even with no active thread",
  );
});
