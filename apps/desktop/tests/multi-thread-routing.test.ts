import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  createProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell-state.ts";

// When several agents run at once, a background thread finishing emits
// thread.hydrated (with ITS thread summary + blocks). That event must update the
// rail's data for that thread WITHOUT stealing focus from the thread the user is
// viewing or overwriting the active chat — otherwise another thread's answer
// shows up in the wrong thread.

function threadSummary(threadId: string, agentId: string) {
  return {
    threadId,
    title: threadId,
    agentBinding: { agentId },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    launchOptions: { model: "GPT-5.5", permission: "workspace-write" },
    pinned: false,
    archived: false,
    updatedAt: "2026-06-04T00:00:00.000Z",
    lastKnownState: "idle",
  };
}

function hydrated(threadId: string, agentId: string, blocks: unknown[]) {
  return {
    kind: "thread.hydrated" as const,
    payload: { thread: threadSummary(threadId, agentId), blocks, runtimeState: "idle" },
  };
}

test("a background thread hydrate does not steal focus or overwrite the active chat", () => {
  let state = createProductShellState({ includeFixtureData: false });

  // User opens / starts thread A and sees its answer.
  state = applyProductShellBackendEvent(
    state,
    hydrated("thread-a", "codex", [
      { blockId: "a1", threadId: "thread-a", role: "agent", kind: "agent_message", body: "A answer" },
    ]),
  );
  assert.equal(state.activeThreadId, "thread-a");

  // A concurrently-running background thread B finishes and broadcasts thread.hydrated.
  state = applyProductShellBackendEvent(
    state,
    hydrated("thread-b", "claude", [
      { blockId: "b1", threadId: "thread-b", role: "agent", kind: "agent_message", body: "B answer" },
    ]),
    "broadcast",
  );

  // Focus stays on A; the active chat still shows A, never B's answer.
  assert.equal(state.activeThreadId, "thread-a", "background hydrate must not steal focus");
  assert.equal(
    (state.agentChat.thread as { threadId?: string } | null)?.threadId,
    "thread-a",
  );
  assert.ok(
    state.agentChat.blocks.every(
      (block: { threadId?: string }) => block.threadId !== "thread-b",
    ),
    "B's blocks must not bleed into the active (A) chat",
  );

  // But B is still tracked in the rail (the data update still happens).
  assert.ok(
    state.threads.some((thread: { threadId: string }) => thread.threadId === "thread-b"),
    "background thread should still appear in the rail",
  );
});

test("a background broadcast answer does not appear on the empty New Thread composer", () => {
  // New Thread composer: nothing is active.
  let state = createProductShellState({ includeFixtureData: false });
  assert.equal(state.activeThreadId, null);
  const blocksBefore = state.agentChat.blocks.length;

  // A background thread broadcasts its agent answer.
  state = applyProductShellBackendEvent(
    state,
    {
      kind: "agentSessionBlock.upserted" as const,
      payload: {
        block: {
          blockId: "bg1",
          threadId: "thread-bg",
          role: "agent",
          kind: "agent_message",
          body: "background answer",
        },
      },
    },
    "broadcast",
  );

  // The empty composer must NOT absorb the background answer, and focus must not move.
  assert.equal(state.activeThreadId, null, "background broadcast must not focus a thread");
  assert.equal(
    state.agentChat.blocks.length,
    blocksBefore,
    "background answer must not appear in the New Thread composer",
  );
});

test("the user's own new-thread command response still populates the new thread", () => {
  // New Thread composer (nothing active) — the user submits, the backend responds
  // (command source) with thread.started + the answer for the brand-new thread.
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-new", "codex", [
    { blockId: "n1", threadId: "thread-new", role: "user", kind: "user_message", body: "hi" },
    { blockId: "n2", threadId: "thread-new", role: "agent", kind: "agent_message", body: "hello" },
  ]));
  assert.equal(state.activeThreadId, "thread-new", "the user's own new thread becomes active");
  assert.equal((state.agentChat.thread as { threadId?: string } | null)?.threadId, "thread-new");
});

test("clicking another thread switches focus even while a thread is running", () => {
  let state = createProductShellState({ includeFixtureData: false });
  // Thread A is open and running.
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", [
    { blockId: "a1", threadId: "thread-a", role: "agent", kind: "agent_message", body: "A answer" },
  ]));
  assert.equal(state.activeThreadId, "thread-a");

  // User clicks thread B -> the thread.hydrate command response (command source)
  // must switch focus AND the chat to B.
  state = applyProductShellBackendEvent(state, hydrated("thread-b", "claude", [
    { blockId: "b1", threadId: "thread-b", role: "agent", kind: "agent_message", body: "B answer" },
  ]));
  assert.equal(state.activeThreadId, "thread-b", "command hydrate must switch focus to B");
  assert.equal((state.agentChat.thread as { threadId?: string } | null)?.threadId, "thread-b");
});

test("a background thread's running state shows in the rail without stealing focus", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = applyProductShellBackendEvent(state, hydrated("thread-b", "claude", []), "broadcast");
  assert.equal(state.activeThreadId, "thread-a");

  // Background thread B starts running (async broadcast).
  state = applyProductShellBackendEvent(
    state,
    { kind: "agentRuntime.stateChanged" as const, payload: { threadId: "thread-b", state: "running" } },
    "broadcast",
  );
  assert.equal(
    state.threads.find((t: { threadId: string }) => t.threadId === "thread-b")?.running,
    true,
    "background thread shows a running indicator in the rail",
  );
  assert.equal(state.activeThreadId, "thread-a", "background running must not steal focus");

  // B finishes -> running clears.
  state = applyProductShellBackendEvent(
    state,
    { kind: "agentRuntime.stateChanged" as const, payload: { threadId: "thread-b", state: "idle" } },
    "broadcast",
  );
  assert.equal(
    state.threads.find((t: { threadId: string }) => t.threadId === "thread-b")?.running,
    false,
  );
});
