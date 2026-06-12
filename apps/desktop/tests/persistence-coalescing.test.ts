// Spec: docs_v2/implementation/codebase-issues-and-remediation-plan.md — Phase 4.1.
//
// A streaming turn produces many content_record block updates. Persisting the full
// conversation on each one is O(messages) disk writes per turn. The projector now
// records blocks in the service synchronously but COALESCES the disk write behind a
// trailing debounce, with a hard flush at the durability-critical moments (turn end,
// prompt open, runtime exit, backend shutdown). These tests pin that behavior by
// counting writeAgentSessionCache calls while driving the real projector.

import assert from "node:assert/strict";
import test from "node:test";

import { createLiveAgentSessionEventProjector } from "../src/backend/infrastructure/node/live/live-backend.ts";

const THREAD = "thread-coalesce";
const AGENT = "claude" as const;
const RUNTIME = "runtime-1";

function contentRecordEvent(blockId: string, body: string) {
  return {
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: {
      kind: "content_record" as const,
      sourceRef: blockId,
      payload: {
        type: "message",
        role: "agent",
        status: "complete",
        blockId,
        body,
        sourceRuntimeId: RUNTIME,
      },
      body,
    },
  };
}

// Minimal fake service implementing exactly the methods the persist path touches.
// hydrateThread always returns one block so persistThreadBlocksUnsafe performs a
// real write (its blocks.length === 0 short-circuit would otherwise hide the count).
function createCountingFixture() {
  let writes = 0;
  const block = {
    blockId: "b1",
    threadId: THREAD,
    agentId: AGENT,
    kind: "message",
    role: "agent",
    status: "complete",
    body: "hello",
    sourceFrameIds: [],
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
  };
  const service = {
    async hydrateThread() {
      return {
        ok: true as const,
        thread: { threadId: THREAD, agentBinding: { agentId: AGENT } },
        runtimeState: "running",
        blocks: [block],
      };
    },
    // Synchronous non-cloning read used by the projector hot path (Phase 4.3).
    peekThread() {
      return {
        ok: true as const,
        thread: { threadId: THREAD, agentBinding: { agentId: AGENT } },
        runtimeState: "running",
        blocks: [block],
      };
    },
    async appendRawAgentFrame(frame: Record<string, unknown>) {
      return { ...frame, frameId: "frame-1" };
    },
    async recordAgentSessionBlock() {},
    async recordTurnComplete() {
      return {
        ok: true as const,
        thread: { threadId: THREAD, updatedAt: "2026-06-12T00:00:01.000Z", queuedInputs: [] },
        runtimeState: "idle",
      };
    },
    async recordProviderPromptState() {
      return {
        ok: true as const,
        thread: { threadId: THREAD, updatedAt: "2026-06-12T00:00:02.000Z", queuedInputs: [] },
        promptState: { kind: "permission", threadId: THREAD, promptId: "p1", title: "Allow?", options: [] },
        runtimeState: "waiting_for_approval",
      };
    },
  };
  const persistence = {
    async writeAgentSessionCache() {
      writes += 1;
      return { ok: true as const, value: {} };
    },
  };
  const projector = createLiveAgentSessionEventProjector({
    // deno-lint-ignore no-explicit-any
    service: () => service as never,
    persistence: persistence as never,
    homeDir: "/tmp",
    integrations: {} as never,
  });
  return { projector, writes: () => writes };
}

test("streaming content_records are coalesced into a single flushed write", async () => {
  const { projector, writes } = createCountingFixture();

  // 50 streamed message records — each schedules a debounced write, none fires yet.
  for (let i = 0; i < 50; i += 1) {
    await projector.ingestStructuredProviderEvent(contentRecordEvent(`b${i}`, `chunk ${i}`));
  }
  assert.equal(writes(), 0, "debounced writes must not fire during streaming");

  // Shutdown flush collapses the whole burst into ONE write.
  await projector.flushPendingPersists();
  assert.equal(writes(), 1, "the coalesced burst persists exactly once");
});

test("turn_completed flushes the conversation immediately (durable settled state)", async () => {
  const { projector, writes } = createCountingFixture();

  await projector.ingestStructuredProviderEvent(contentRecordEvent("b0", "partial"));
  assert.equal(writes(), 0);

  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: { kind: "turn_completed" as const },
  });
  assert.equal(writes(), 1, "turn end flushes once");

  // No pending timer remains to fire a redundant write afterward.
  await projector.flushPendingPersists();
  assert.equal(writes(), 1, "nothing left pending after a turn-end flush");
});

test("content_delta (live streaming tokens) never persists", async () => {
  const { projector, writes } = createCountingFixture();

  for (let i = 0; i < 20; i += 1) {
    await projector.ingestStructuredProviderEvent({
      threadId: THREAD,
      agentId: AGENT,
      runtimeId: RUNTIME,
      event: {
        kind: "content_delta" as const,
        blockId: "stream-1",
        blockKind: "message",
        role: "agent",
        body: `partial ${i}`,
      },
    });
  }
  await projector.flushPendingPersists();
  assert.equal(writes(), 0, "per-token deltas must not touch disk");
});

test("a prompt opening flushes pending writes so the waiting state is durable", async () => {
  const { projector, writes } = createCountingFixture();

  await projector.ingestStructuredProviderEvent(contentRecordEvent("b0", "before prompt"));
  assert.equal(writes(), 0);

  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: {
      kind: "prompt" as const,
      promptState: {
        kind: "permission",
        threadId: THREAD,
        promptId: "p1",
        title: "Allow?",
        options: [],
      },
    },
  });
  assert.equal(writes(), 1, "prompt open flushes the conversation up to the prompt");
});

test("the trailing debounce eventually persists without any explicit flush", async () => {
  const { projector, writes } = createCountingFixture();

  await projector.ingestStructuredProviderEvent(contentRecordEvent("b0", "lonely chunk"));
  assert.equal(writes(), 0);

  // Wait past the 300ms debounce window; the unref'd timer still fires while the
  // event loop is alive (unref only declines to keep the loop alive by itself).
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(writes(), 1, "a quiet stream still persists via the trailing debounce");
});
