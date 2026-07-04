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
import type { BackendEventEnvelope, ProviderCliAgentId } from "../src/shared/contracts/index.ts";
import { structuredToNativeRuntimeEvent } from "../src/backend/adapters/outbound/agent-runtime/clients/structured-to-native-runtime-event.ts";

const THREAD = "thread-coalesce";
const AGENT: ProviderCliAgentId = "claude";
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
function createCountingFixture(input: {
  nativeProjectionMode?: "structured_mirror" | "external_all_blocks";
  agentId?: ProviderCliAgentId;
} = {}) {
  let writes = 0;
  const events: BackendEventEnvelope[] = [];
  const agentId = input.agentId ?? AGENT;
  const block = {
    blockId: "b1",
    threadId: THREAD,
    agentId,
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
        thread: { threadId: THREAD, agentBinding: { agentId } },
        runtimeState: "running",
        blocks: [block],
      };
    },
    // Synchronous non-cloning read used by the projector hot path (Phase 4.3).
    peekThread() {
      return {
        ok: true as const,
        thread: { threadId: THREAD, agentBinding: { agentId } },
        runtimeState: "running",
        blocks: [block],
      };
    },
    async appendRawAgentFrame(frame: Record<string, unknown>) {
      return { ...frame, frameId: "frame-1" };
    },
    async recordAgentSessionBlock() {},
    // In-memory streaming tail mirror; must NOT persist (the delta path stays disk-free).
    async recordStreamingBlock() {
      return {
        ok: true as const,
        thread: { threadId: THREAD, agentBinding: { agentId } },
        runtimeState: "running",
      };
    },
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
    onEvent: (event) => events.push(event),
    homeDir: "/tmp",
    integrations: {} as never,
    nativeProjectionMode: input.nativeProjectionMode,
  });
  return { projector, writes: () => writes, events: () => events };
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

test("turn_completed emits structured usage with context percent", async () => {
  const { projector, events } = createCountingFixture();

  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: {
      kind: "turn_completed" as const,
      usage: {
        inputTokens: 60000,
        outputTokens: 4000,
        contextWindow: 256000,
        rateLimits: [
          { usedPercent: 58, windowMinutes: 300, resetsAt: 1781973894 },
          { usedPercent: 68, windowMinutes: 10080, resetsAt: 1782378364 },
        ],
      },
    },
  });

  const usageEvent = events().find((event) => event.kind === "agentRuntime.usageChanged");
  assert.deepEqual(usageEvent?.payload, {
    threadId: THREAD,
    usage: {
      totalTokens: 64000,
      contextTokens: 64000,
      contextWindow: 256000,
      contextUsedPercent: 25,
      rateLimits: [
        { usedPercent: 58, windowMinutes: 300, resetsAt: 1781973894 },
        { usedPercent: 68, windowMinutes: 10080, resetsAt: 1782378364 },
      ],
    },
  });
});

test("standalone structured usage event emits rate-limit-only updates", async () => {
  const { projector, events } = createCountingFixture();

  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: {
      kind: "usage" as const,
      usage: {
        rateLimits: [
          { usedPercent: 44, windowMinutes: 300 },
          { usedPercent: 72, windowMinutes: 10080 },
        ],
      },
    },
  });

  const usageEvent = events().find((event) => event.kind === "agentRuntime.usageChanged");
  assert.deepEqual(usageEvent?.payload, {
    threadId: THREAD,
    usage: {
      rateLimits: [
        { usedPercent: 44, windowMinutes: 300 },
        { usedPercent: 72, windowMinutes: 10080 },
      ],
    },
  });
});

test("structured usage updates runtime state without a transcript usage block", async () => {
  const { projector, events } = createCountingFixture();

  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: {
      kind: "usage" as const,
      usage: {
        inputTokens: 60000,
        outputTokens: 4000,
        contextWindow: 256000,
      },
    },
  });

  const blockEvent = events().find(
    (event) =>
      event.kind === "agentSessionBlock.upserted" &&
      event.payload.block.kind === "usage",
  );
  assert.equal(blockEvent, undefined);
  const usageEvent = events().find((event) => event.kind === "agentRuntime.usageChanged");
  assert.deepEqual(usageEvent?.payload, {
    threadId: THREAD,
    usage: {
      totalTokens: 64000,
      contextTokens: 64000,
      contextWindow: 256000,
      contextUsedPercent: 25,
    },
  });
});

test("live activity upserts one stable agent activity block and completes it on clear", async () => {
  const { projector, events } = createCountingFixture();

  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: {
      kind: "live_activity" as const,
      nestedAgents: 3,
      nestedToolCalls: 7,
    },
  });
  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: { kind: "live_activity" as const },
  });

  const blockEvents = events().filter(
    (event) =>
      event.kind === "agentSessionBlock.upserted" &&
      event.payload.block.kind === "agent_activity",
  );
  assert.equal(blockEvents.length, 2);
  assert.equal(blockEvents[0]?.payload.block.blockId, `agent-activity:${THREAD}:${RUNTIME}`);
  assert.equal(blockEvents[0]?.payload.block.status, "streaming");
  assert.equal(blockEvents[0]?.payload.block.body, "3 agents running · 7 tool calls");
  assert.equal(blockEvents[1]?.payload.block.blockId, `agent-activity:${THREAD}:${RUNTIME}`);
  assert.equal(blockEvents[1]?.payload.block.status, "complete");
  assert.equal(blockEvents[1]?.payload.block.body, "Activity complete");
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

test("external native event path owns streaming and final content blocks", async () => {
  const { projector, writes, events } = createCountingFixture({
    nativeProjectionMode: "external_all_blocks",
  });
  const structured = contentRecordEvent("native-message-1", "hello from native");

  await projector.ingestStructuredProviderEvent(structured);
  assert.equal(
    events().some((event) => event.kind === "agentSessionBlock.upserted"),
    false,
    "structured path must not create content blocks when native events own projection",
  );

  await projector.ingestNativeRuntimeEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: structuredToNativeRuntimeEvent({
      eventId: "native-content-1",
      provider: AGENT,
      transport: "claude_stream_json",
      runtimeId: RUNTIME,
      tideThreadId: THREAD,
      nativeSequence: 1,
      receivedAt: "2026-06-12T00:00:03.000Z",
      event: structured.event,
    }),
  });

  const blockEvent = events().find(
    (event) =>
      event.kind === "agentSessionBlock.upserted" &&
      event.payload.block.blockId === "native-message-1",
  );
  assert.equal(blockEvent?.payload.block.kind, "agent_message");
  assert.equal(blockEvent?.payload.block.body, "hello from native");
  assert.equal(blockEvent?.payload.block.localProvenance?.kind, "native_semantic_block");
  assert.equal(writes(), 0);
  await projector.flushPendingPersists();
  assert.equal(writes(), 1);
});

test("provider capability initialize events project as config state in structured mirror mode", async () => {
  const { projector, events } = createCountingFixture();

  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: {
      kind: "provider_capabilities",
      protocolVersion: 1,
      agentInfo: { title: "Claude Code" },
      authMethods: [{ id: "anthropic" }],
      agentCapabilities: { loadSession: true, sessionCapabilities: {} },
    },
  });

  const blockEvent = events().find(
    (event) =>
      event.kind === "agentSessionBlock.upserted" &&
      event.payload.block.blockId.endsWith(":provider-capabilities"),
  );
  assert.equal(blockEvent?.payload.block.kind, "progress_status");
  assert.equal(blockEvent?.payload.block.body, "Claude Code · 1 auth method · 2 capability groups");
  assert.equal(blockEvent?.payload.block.localProvenance?.kind, "native_semantic_block");
  const capabilityEvent = events().find((event) => event.kind === "agentRuntime.capabilitiesChanged");
  assert.deepEqual(
    capabilityEvent?.payload.capabilities.map((capability) => capability.capabilityId),
    ["claude:setup:auth", "claude:setup:capabilities"],
  );
});

test("provider capability snapshots keep initialize setup rows when command rows arrive", async () => {
  const { projector, events } = createCountingFixture({ agentId: "opencode" });

  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: "opencode",
    runtimeId: RUNTIME,
    event: {
      kind: "provider_capabilities",
      protocolVersion: 1,
      agentInfo: { title: "opencode" },
      authMethods: [{ id: "oauth" }],
      agentCapabilities: { loadSession: true },
    },
  });
  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: "opencode",
    runtimeId: RUNTIME,
    event: {
      kind: "commands",
      commands: [{ name: "compact", description: "Compact context", trigger: "/" }],
    },
  });

  const capabilityEvents = events().filter((event) => event.kind === "agentRuntime.capabilitiesChanged");
  const latest = capabilityEvents[capabilityEvents.length - 1];
  assert.deepEqual(
    latest?.payload.capabilities.map((capability) => capability.capabilityId),
    [
      "opencode:command:compact",
      "opencode:tide:review",
      "opencode:setup:auth",
      "opencode:setup:capabilities",
    ],
  );
});

test("external native content_delta records only the streaming tail", async () => {
  const { projector, writes, events } = createCountingFixture({
    nativeProjectionMode: "external_all_blocks",
  });

  await projector.ingestNativeRuntimeEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: structuredToNativeRuntimeEvent({
      eventId: "native-delta-1",
      provider: AGENT,
      transport: "claude_stream_json",
      runtimeId: RUNTIME,
      tideThreadId: THREAD,
      nativeSequence: 1,
      receivedAt: "2026-06-12T00:00:04.000Z",
      event: {
        kind: "content_delta",
        blockId: "stream-native-1",
        role: "agent",
        blockKind: "agent_message",
        body: "partial",
      },
    }),
  });

  const blockEvent = events().find(
    (event) =>
      event.kind === "agentSessionBlock.upserted" &&
      event.payload.block.blockId === "stream-native-1",
  );
  assert.equal(blockEvent?.payload.block.status, "streaming");
  assert.equal(blockEvent?.payload.block.body, "partial");
  await projector.flushPendingPersists();
  assert.equal(writes(), 0, "streaming native deltas must not persist");
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
