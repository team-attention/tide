import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  editProductShellQueuedInput,
  openProductShellThreadFromLeftUi,
  submitProductShellComposerDraft,
  updateProductShellComposerDraft,
} from "../src/desktop/application/domains/product-shell/product-shell-state.ts";

// When several agents run at once, focus is owned by the user's actions (click a
// thread / start a new thread set activeThreadId locally). Backend events NEVER
// move focus — they update the rail's data for their thread and only touch the
// active chat when they are FOR the active thread. So a background thread's answer
// can't steal focus or bleed into the thread the user is viewing.

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

function clickThread(state: ReturnType<typeof createProductShellState>, threadId: string) {
  return openProductShellThreadFromLeftUi(state, threadId, {
    backendTransportAvailable: true,
  }).state;
}

test("editing the queued message pulls it back into the composer and discards the backend queue", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = clickThread(state, "thread-a");
  state = updateProductShellComposerDraft(state, "teh typo");
  state = submitProductShellComposerDraft(state).state;
  assert.equal(state.agentChat.queuedInput, "teh typo");

  const edited = editProductShellQueuedInput(state);

  // The queued row clears and its text returns to the composer for editing.
  assert.equal(edited.state.agentChat.queuedInput, null);
  assert.equal(edited.state.agentChat.composer.draft, "teh typo");
  // The backend is told to discard its queued pendingInput (a blank edit).
  assert.equal(edited.command?.kind, "composer.editQueuedInput");
  assert.equal(edited.command?.payload.value, "");
});

test("editing with nothing queued is a no-op with no backend command", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = clickThread(state, "thread-a");

  const result = editProductShellQueuedInput(state);

  assert.equal(result.command, null);
  assert.equal(result.state, state);
});

test("a background thread hydrate does not steal focus or overwrite the active chat", () => {
  let state = createProductShellState({ includeFixtureData: false });

  // Thread A exists in the rail (events add it without focusing it).
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  assert.equal(state.activeThreadId, null, "events never move focus");

  // The user clicks A; focus is owned by that click. A's hydrate response then
  // populates A's chat (it is FOR the active thread).
  state = clickThread(state, "thread-a");
  assert.equal(state.activeThreadId, "thread-a");
  state = applyProductShellBackendEvent(
    state,
    hydrated("thread-a", "codex", [
      { blockId: "a1", threadId: "thread-a", role: "agent", kind: "agent_message", body: "A answer" },
    ]),
  );
  assert.ok(
    state.agentChat.blocks.some((block: { body?: string }) => block.body === "A answer"),
  );

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

test("a new thread's own backend blocks populate its chat (optimistic focus)", () => {
  // The user starts a new thread: submit sets focus + shows the thread locally
  // (optimistic, with a client id). The backend then streams blocks for that same
  // id — they land in the new thread because it is the active one.
  let state = createProductShellState({ includeFixtureData: false });
  state = updateProductShellComposerDraft(state, "hi");
  const submit = submitProductShellComposerDraft(state);
  state = submit.state;
  const newThreadId = submit.command?.kind === "thread.start" ? submit.command.payload.threadId : undefined;
  assert.equal(typeof newThreadId, "string");
  assert.equal(state.activeThreadId, newThreadId, "the user's own new thread is active immediately");

  state = applyProductShellBackendEvent(state, {
    kind: "agentSessionBlock.upserted" as const,
    payload: {
      block: {
        blockId: "n2",
        threadId: newThreadId as string,
        role: "agent",
        kind: "agent_message",
        body: "hello",
      },
    },
  });
  assert.ok(
    state.agentChat.blocks.some(
      (block: { threadId?: string; body?: string }) =>
        block.threadId === newThreadId && block.body === "hello",
    ),
  );
});

test("clicking another thread switches focus even while a thread is running", () => {
  let state = createProductShellState({ includeFixtureData: false });
  // Threads A and B both exist in the rail.
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = applyProductShellBackendEvent(state, hydrated("thread-b", "claude", []));

  // User opens A, then clicks B while A is still running.
  state = clickThread(state, "thread-a");
  assert.equal(state.activeThreadId, "thread-a");
  state = clickThread(state, "thread-b");
  assert.equal(state.activeThreadId, "thread-b", "a click switches focus to B");
  assert.equal((state.agentChat.thread as { threadId?: string } | null)?.threadId, "thread-b");
});

test("a background thread's running state shows in the rail without stealing focus", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = applyProductShellBackendEvent(state, hydrated("thread-b", "claude", []), "broadcast");
  state = clickThread(state, "thread-a");
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
