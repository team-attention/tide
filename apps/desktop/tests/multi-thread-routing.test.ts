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

  // A concurrently-running background thread B finishes and emits thread.hydrated.
  state = applyProductShellBackendEvent(
    state,
    hydrated("thread-b", "claude", [
      { blockId: "b1", threadId: "thread-b", role: "agent", kind: "agent_message", body: "B answer" },
    ]),
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
