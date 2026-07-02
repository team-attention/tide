import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  editProductShellQueuedInput,
  removeProductShellQueuedInput,
  openProductShellThreadFromLeftRail,
  addProductShellComposerAttachment,
  startNewProductShellScratchThread,
  submitProductShellComposerDraft,
  toggleProductShellWorkbench,
  updateProductShellComposerDraft,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

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
  return openProductShellThreadFromLeftRail(state, threadId, {
    backendTransportAvailable: true,
  }).state;
}

test("editing the queued message pulls it back into the composer and discards the backend queue", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = clickThread(state, "thread-a");
  state = updateProductShellComposerDraft(state, "teh typo");
  state = submitProductShellComposerDraft(state).state;
  assert.deepEqual(state.agentChat.queuedInputs, ["teh typo"]);

  const edited = editProductShellQueuedInput(state, 0);

  // The queued row clears and its text returns to the composer for editing.
  assert.deepEqual(edited.state.agentChat.queuedInputs, []);
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

test("a stale interrupted block does not restore into another thread", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = applyProductShellBackendEvent(
    state,
    hydrated("thread-b", "codex", [
      {
        blockId: "a-stream",
        threadId: "thread-a",
        role: "agent",
        kind: "agent_message",
        status: "streaming",
        body: "interrupted text",
      },
      {
        blockId: "b-complete",
        threadId: "thread-b",
        role: "agent",
        kind: "agent_message",
        status: "complete",
        body: "thread b text",
      },
    ]),
    "broadcast",
  );

  state = clickThread(state, "thread-b");

  assert.equal(state.agentChat.thread?.threadId, "thread-b");
  assert.deepEqual(
    state.agentChat.blocks.map((block: { body?: string }) => block.body),
    ["thread b text"],
  );
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

// Spec: docs_v2/specs/browser-pane-action-liveness.md (multi-thread workbench leak)
// On the New Thread composer (activeThreadId === null) a BACKGROUND thread opening a
// browser must NOT flip the workbench open on the composer the user is looking at —
// each thread's workbench is its own.
test("a background thread opening a browser does not open the workbench on the New Thread composer", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-bg", "codex", []));
  // The user is on the New Thread composer: no active thread, workbench closed.
  assert.equal(state.activeThreadId, null);
  assert.equal(state.workbenchOpen, false);

  // The background thread's agent opens a Browser Pane.
  state = applyProductShellBackendEvent(state, {
    kind: "workbench.changed" as const,
    payload: {
      threadId: "thread-bg",
      panes: [{ paneId: "p1", kind: "browser", title: "Naver", revision: "r1" }],
    },
  });

  // The composer view is unaffected — the workbench stays closed.
  assert.equal(state.workbenchOpen, false);
  assert.equal(state.activeThreadId, null);
  assert.deepEqual(
    state.threads
      .find((thread) => thread.threadId === "thread-bg")
      ?.workbenchPanes.map((pane) => pane.paneId),
    ["p1"],
  );
});

test("a background browser pane update is retained without stealing focus", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = applyProductShellBackendEvent(state, hydrated("thread-bg", "codex", []));
  state = clickThread(state, "thread-a");
  assert.equal(state.activeThreadId, "thread-a");

  state = applyProductShellBackendEvent(state, {
    kind: "workbench.changed" as const,
    payload: {
      threadId: "thread-bg",
      panes: [
        {
          paneId: "p1",
          kind: "browser",
          title: "Naver",
          revision: "r1",
          url: "https://example.test/",
          lastAction: {
            actionId: "action-1",
            kind: "click_at",
            requestedAt: "2026-06-04T00:00:00.000Z",
            x: 10,
            y: 12,
            status: "completed",
            completedAt: "2026-06-04T00:00:01.000Z",
          },
        },
      ],
    },
  });

  assert.equal(state.activeThreadId, "thread-a", "background action must not steal focus");
  assert.equal(state.appChrome.workbenchPanes.length, 0, "active workbench view is unchanged");
  assert.deepEqual(
    state.threads
      .find((thread) => thread.threadId === "thread-bg")
      ?.workbenchPanes.map((pane) => pane.paneId),
    ["p1"],
  );
});

// Regression: when the user IS viewing the thread, its own browser open still opens
// the workbench.
test("the active thread opening a browser still opens its workbench", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = clickThread(state, "thread-a");
  assert.equal(state.activeThreadId, "thread-a");

  state = applyProductShellBackendEvent(state, {
    kind: "workbench.changed" as const,
    payload: {
      threadId: "thread-a",
      panes: [{ paneId: "p1", kind: "browser", title: "Naver", revision: "r1" }],
    },
  });

  assert.equal(state.workbenchOpen, true);
});

// Regression: closing the workbench is remembered PER THREAD. Switching away and
// back used to re-derive workbenchOpen from pane visibility, re-opening a workbench
// the user had closed.
test("a closed workbench stays closed after switching threads and back", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = applyProductShellBackendEvent(state, hydrated("thread-b", "codex", []));
  state = clickThread(state, "thread-a");
  // An open pane opens the workbench on thread A.
  state = applyProductShellBackendEvent(state, {
    kind: "workbench.changed" as const,
    payload: {
      threadId: "thread-a",
      panes: [{ paneId: "p1", kind: "browser", title: "Naver", revision: "r1" }],
    },
  });
  assert.equal(state.workbenchOpen, true);

  // The user closes it.
  state = toggleProductShellWorkbench(state);
  assert.equal(state.workbenchOpen, false);

  // Switch to B (no panes → closed) and back to A: A's pane is still there, but the
  // user closed the column, so it stays closed.
  state = clickThread(state, "thread-b");
  assert.equal(state.workbenchOpen, false);
  state = clickThread(state, "thread-a");
  assert.equal(state.workbenchOpen, false);
});

test("composer draft+attachments survive switching to another thread and back", () => {
  const att = { id: "att-1", name: "x.png", mediaType: "image/png", dataBase64: "AAAA" };
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = applyProductShellBackendEvent(state, hydrated("thread-b", "codex", []));
  state = clickThread(state, "thread-a");
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = addProductShellComposerAttachment(state, att);
  state = updateProductShellComposerDraft(state, "in progress");
  state = clickThread(state, "thread-b");
  state = applyProductShellBackendEvent(state, hydrated("thread-b", "codex", []));
  state = clickThread(state, "thread-a");
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  assert.equal(state.agentChat.composer.attachments.length, 1, "attachment survives thread->thread->back");
  assert.equal(state.agentChat.composer.draft, "in progress", "draft survives thread->thread->back");
});

test("composer draft+attachments survive clicking New thread and returning", () => {
  const att = { id: "att-2", name: "y.png", mediaType: "image/png", dataBase64: "BBBB" };
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = clickThread(state, "thread-a");
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = addProductShellComposerAttachment(state, att);
  state = updateProductShellComposerDraft(state, "half-written");
  state = startNewProductShellScratchThread(state);
  state = clickThread(state, "thread-a");
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  assert.equal(state.agentChat.composer.attachments.length, 1, "attachment survives thread->New thread->back");
  assert.equal(state.agentChat.composer.draft, "half-written", "draft survives thread->New thread->back");
});

test("queued follow-ups survive switching to another thread and back", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = applyProductShellBackendEvent(state, hydrated("thread-b", "codex", []));
  state = clickThread(state, "thread-a");
  // Mark A running so follow-ups queue behind the live turn.
  state = applyProductShellBackendEvent(state, {
    kind: "agentRuntime.stateChanged" as const,
    payload: { threadId: "thread-a", state: "running", changedAt: "2026-06-04T00:00:00.000Z" },
  });
  state = submitProductShellComposerDraft(updateProductShellComposerDraft(state, "1")).state;
  state = submitProductShellComposerDraft(updateProductShellComposerDraft(state, "2")).state;
  state = submitProductShellComposerDraft(updateProductShellComposerDraft(state, "3")).state;
  assert.deepEqual(state.agentChat.queuedInputs, ["1", "2", "3"]);

  // Switch away and back. Hydrate returns only the persisted conversation (the
  // still-pending queue is NOT in those blocks), so the queue must be kept.
  state = clickThread(state, "thread-b");
  state = applyProductShellBackendEvent(state, hydrated("thread-b", "codex", []));
  state = clickThread(state, "thread-a");
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));

  assert.deepEqual(state.agentChat.queuedInputs, ["1", "2", "3"], "queue survives the round-trip");
});

test("deleting a queued message discards it without pulling it into the composer", () => {
  let state = createProductShellState({ includeFixtureData: false });
  state = applyProductShellBackendEvent(state, hydrated("thread-a", "codex", []));
  state = clickThread(state, "thread-a");
  state = updateProductShellComposerDraft(state, "discard me");
  state = submitProductShellComposerDraft(state).state;
  assert.deepEqual(state.agentChat.queuedInputs, ["discard me"]);

  const removed = removeProductShellQueuedInput(state, 0);

  // The row is gone AND the composer draft stays empty (unlike 수정, which pulls back).
  assert.deepEqual(removed.state.agentChat.queuedInputs, []);
  assert.equal(removed.state.agentChat.composer.draft, "");
  assert.equal(removed.command?.kind, "composer.editQueuedInput");
  assert.equal(removed.command?.payload.value, "");
});
