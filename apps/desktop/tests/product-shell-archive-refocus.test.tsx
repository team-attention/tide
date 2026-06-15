// The chat column renders state.agentChat directly (not gated by activeThreadId),
// so REMOVING the Thread you're viewing must reset the chat to the Start Composer —
// nulling activeThreadId alone leaves the dead transcript on screen. The worktree
// delete path is covered in worktree-branch-deletion.test.tsx; this covers the
// sibling archive paths (single-thread, project, backend event) that share
// refocusStartComposerIfActiveDropped.
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyProductShellBackendEvent,
  archiveProductShellProjectChats,
  confirmProductShellThreadArchive,
  createProductShellState,
  openProductShellThread,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function threadSummary(threadId: string, projectId: string, cwd: string) {
  return {
    threadId,
    title: `Thread ${threadId}`,
    agentBinding: {
      agentId: "claude",
      runtimeSource: { kind: "provider_cli", integrationId: "claude" },
    },
    scope: { kind: "project", projectId, cwd },
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:01:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "idle",
  };
}

function seed(threads: { threadId: string; projectId: string; cwd: string }[]) {
  return applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: threads.map((t) => threadSummary(t.threadId, t.projectId, t.cwd)) },
  });
}

test("archiving_the_thread_youre_viewing_returns_to_the_start_composer", () => {
  const state = seed([
    { threadId: "a", projectId: "p1", cwd: "/repo/p1" },
    { threadId: "b", projectId: "p1", cwd: "/repo/p1" },
  ]);
  const viewing = openProductShellThread(state, "a");
  assert.equal(viewing.activeThreadId, "a");
  assert.equal(viewing.agentChat.thread?.threadId, "a");

  const result = confirmProductShellThreadArchive(viewing, "a");

  assert.equal(result.state.activeThreadId, null);
  assert.equal(result.state.agentChat.thread, null);
  assert.equal(result.command?.kind, "thread.archive");
});

test("archiving_a_background_thread_keeps_you_on_the_one_youre_viewing", () => {
  const state = seed([
    { threadId: "a", projectId: "p1", cwd: "/repo/p1" },
    { threadId: "b", projectId: "p1", cwd: "/repo/p1" },
  ]);
  const viewing = openProductShellThread(state, "a");

  const result = confirmProductShellThreadArchive(viewing, "b");

  assert.equal(result.state.activeThreadId, "a");
  assert.equal(result.state.agentChat.thread?.threadId, "a");
});

test("archiving_a_projects_chats_while_viewing_one_returns_to_the_start_composer", () => {
  const state = seed([
    { threadId: "a", projectId: "p1", cwd: "/repo/p1" },
    { threadId: "c", projectId: "p2", cwd: "/repo/p2" },
  ]);
  const viewing = openProductShellThread(state, "a");

  const result = archiveProductShellProjectChats(viewing, "p1");

  assert.equal(result.state.activeThreadId, null);
  assert.equal(result.state.agentChat.thread, null);
  assert.deepEqual(
    result.commands.map((command) => command.payload.threadId),
    ["a"],
  );
});

test("archiving_an_unrelated_projects_chats_keeps_focus", () => {
  const state = seed([
    { threadId: "a", projectId: "p1", cwd: "/repo/p1" },
    { threadId: "c", projectId: "p2", cwd: "/repo/p2" },
  ]);
  const viewing = openProductShellThread(state, "a");

  const result = archiveProductShellProjectChats(viewing, "p2");

  assert.equal(result.state.activeThreadId, "a");
  assert.equal(result.state.agentChat.thread?.threadId, "a");
});

test("a_backend_archived_event_for_the_viewed_thread_returns_to_the_start_composer", () => {
  const state = seed([
    { threadId: "a", projectId: "p1", cwd: "/repo/p1" },
    { threadId: "b", projectId: "p1", cwd: "/repo/p1" },
  ]);
  const viewing = openProductShellThread(state, "a");

  const next = applyProductShellBackendEvent(viewing, {
    kind: "thread.archived",
    payload: { thread: { ...threadSummary("a", "p1", "/repo/p1"), archived: true } },
  });

  assert.equal(next.activeThreadId, null);
  assert.equal(next.agentChat.thread, null);
});
