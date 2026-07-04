import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { structuredToNativeRuntimeEvent } from "../src/backend/adapters/outbound/agent-runtime/clients/structured-to-native-runtime-event.ts";
import { createInMemoryNativeEvidenceStore } from "../src/backend/adapters/outbound/agent-runtime/evidence/native-evidence-store.ts";
import {
  parseNativeFixtureJsonl,
  replayNativeFixtureText,
} from "../src/backend/adapters/outbound/agent-runtime/evidence/native-fixture-replay.ts";
import { createNativeRuntimePipeline } from "../src/backend/adapters/outbound/agent-runtime/projectors/native-runtime-pipeline.ts";
import { codexBaseCapabilityRegistry } from "../src/backend/adapters/outbound/agent-integrations/codex/codex-capability-registry.ts";
import { claudeBaseCapabilityRegistry } from "../src/backend/adapters/outbound/agent-integrations/claude/claude-capability-registry.ts";
import { acpCapabilitiesFromSession } from "../src/backend/adapters/outbound/agent-integrations/acp/acp-provider-factory.ts";
import { providerCapabilityCatalogFromRuntimeCommands } from "../src/backend/adapters/outbound/agent-integrations/provider-capability-catalog.ts";
import {
  CONTRACT_VERSION,
  type BackendEventEnvelope,
  validateBackendEventEnvelope,
} from "../src/shared/contracts/index.ts";

const nativeFixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/native-agent-runtime",
);

function replayFixture(name: string) {
  return replayNativeFixtureText(fs.readFileSync(path.join(nativeFixtureRoot, name), "utf8"));
}

test("native pipeline records structured usage evidence without a visible semantic block", () => {
  const evidenceStore = createInMemoryNativeEvidenceStore();
  const pipeline = createNativeRuntimePipeline({ evidenceStore });
  const event = structuredToNativeRuntimeEvent({
    eventId: "native-1",
    provider: "codex",
    transport: "codex_app_server",
    runtimeId: "runtime-1",
    tideThreadId: "thread-1",
    nativeSequence: 1,
    receivedAt: "2026-07-03T00:00:00.000Z",
    event: {
      kind: "usage",
      usage: { inputTokens: 60000, outputTokens: 4000, contextWindow: 256000 },
    },
  });

  const blocks = pipeline.ingest(event);

  assert.equal(blocks.length, 0);
  assert.equal(evidenceStore.snapshotsForThread("thread-1").length, 1);
});

test("native fixture replay feeds captured frames through reducer and projector", () => {
  const summary = replayFixture("codex-basic.native.jsonl");

  assert.equal(summary.frames, 4);
  assert.deepEqual(summary.nativeKinds, {
    content_record: 2,
    session_ref: 1,
    usage: 1,
  });
  assert.equal(summary.semanticKinds.command_run, 1);
  assert.equal(summary.semanticKinds.message, 1);
  assert.equal(summary.semanticKinds.session_event, 1);
  assert.equal(summary.semanticKinds.usage ?? 0, 0);
  assert.equal(summary.evidenceSnapshots, 4);
  assert.ok(summary.semanticBlocks.some((block) => (
    block.blockId === "msg-1" &&
    block.kind === "message" &&
    block.body === "Fixture answer"
  )));
  assert.ok(summary.semanticBlocks.some((block) => (
    block.blockId === "tool-1" &&
    block.kind === "command_run"
  )));
  assert.equal(summary.semanticBlocks.some((block) => block.kind === "usage"), false);
});

test("codex fixture replay links command file and MCP approvals to gated blocks", () => {
  const summary = replayFixture("codex-approval-matrix.native.jsonl");

  assert.equal(summary.frames, 11);
  assert.deepEqual(summary.nativeKinds, {
    content_record: 6,
    prompt: 3,
    session_ref: 1,
    usage: 1,
  });
  assert.equal(summary.semanticKinds.command_run, 2);
  assert.equal(summary.semanticKinds.file_change, 2);
  assert.equal(summary.semanticKinds.mcp_call, 2);
  assert.equal(summary.semanticKinds.approval_prompt, 3);
  assert.equal(summary.semanticKinds.usage ?? 0, 0);
  assert.equal(summary.evidenceSnapshots, 11);

  assert.deepEqual(
    ["codex-command-1", "codex-file-1", "codex-mcp-1"].map((blockId) => {
      const block = summary.semanticBlocks.find((candidate) => candidate.blockId === blockId);
      return [block?.kind, block?.status, block?.evidenceCount];
    }),
    [
      ["command_run", "completed", 2],
      ["file_change", "completed", 2],
      ["mcp_call", "completed", 2],
    ],
  );
  assert.equal(
    summary.semanticBlocks.find((block) => block.blockId.endsWith(":prompt:codex-perm-cmd"))?.parentBlockId,
    "codex-command-1",
  );
  assert.equal(
    summary.semanticBlocks.find((block) => block.blockId.endsWith(":prompt:codex-perm-file"))?.parentBlockId,
    "codex-file-1",
  );
  assert.equal(
    summary.semanticBlocks.find((block) => block.blockId.endsWith(":prompt:codex-perm-mcp"))?.parentBlockId,
    "codex-mcp-1",
  );
});

test("structured prompt conversion preserves provider native ids for live projection", () => {
  const event = structuredToNativeRuntimeEvent({
    eventId: "native-prompt-linked",
    provider: "codex",
    transport: "codex_app_server",
    runtimeId: "runtime-linked",
    tideThreadId: "thread-linked",
    nativeSequence: 1,
    receivedAt: "2026-07-03T00:00:00.000Z",
    event: {
      kind: "prompt",
      promptState: {
        promptId: "codex-perm-linked",
        threadId: "thread-linked",
        agentId: "codex",
        kind: "approval",
        message: "Run command",
        nativeIds: { callId: "cmd-linked", itemId: "cmd-linked", blockId: "command-block-linked" },
        source: "provider_hook",
      },
    },
  });

  assert.deepEqual(event.nativeIds, {
    blockId: "command-block-linked",
    callId: "cmd-linked",
    itemId: "cmd-linked",
    requestId: "codex-perm-linked",
  });
});

test("claude fixture replay preserves tool permission parentage and live activity", () => {
  const summary = replayFixture("claude-tool-control.native.jsonl");

  assert.equal(summary.frames, 8);
  assert.deepEqual(summary.nativeKinds, {
    content_delta: 1,
    content_record: 2,
    live_activity: 2,
    prompt: 1,
    session_ref: 1,
    usage: 1,
  });
  assert.equal(summary.semanticKinds.reasoning, 1);
  assert.equal(summary.semanticKinds.tool_call, 2);
  assert.equal(summary.semanticKinds.approval_prompt, 1);
  assert.equal(summary.semanticKinds.usage ?? 0, 0);
  assert.equal(summary.semanticKinds.agent_activity, 2);
  assert.equal(summary.evidenceSnapshots, 8);

  const tool = summary.semanticBlocks.find((block) => block.blockId === "claude-tool-1");
  assert.equal(tool?.kind, "tool_call");
  assert.equal(tool?.status, "completed");
  assert.equal(tool?.evidenceCount, 2);

  const prompt = summary.semanticBlocks.find((block) => block.blockId.endsWith(":prompt:ctrl-1"));
  assert.equal(prompt?.kind, "approval_prompt");
  assert.equal(prompt?.status, "waiting_for_approval");
  assert.equal(prompt?.parentBlockId, "claude-tool-1");

  const activity = summary.semanticBlocks.find((block) => block.blockId === "agent-activity:thread-claude-fixture:runtime-claude-fixture");
  assert.equal(activity?.kind, "agent_activity");
  assert.equal(activity?.status, "completed");
  assert.equal(activity?.evidenceCount, 2);
});

test("ACP fixture replay preserves command catalog, MCP tool updates, and permission choices", () => {
  const summary = replayFixture("opencode-acp-tool-permission.native.jsonl");

  assert.equal(summary.frames, 8);
  assert.deepEqual(summary.nativeKinds, {
    commands: 1,
    content_record: 2,
    live_activity: 1,
    model_catalog: 1,
    prompt: 1,
    session_ref: 1,
    usage: 1,
  });
  assert.equal(summary.semanticKinds.config_state, 2);
  assert.equal(summary.semanticKinds.mcp_call, 2);
  assert.equal(summary.semanticKinds.approval_prompt, 1);
  assert.equal(summary.semanticKinds.usage ?? 0, 0);
  assert.equal(summary.semanticKinds.agent_activity, 1);
  assert.equal(summary.evidenceSnapshots, 8);

  const mcp = summary.semanticBlocks.find((block) => block.blockId === "acp-tool-1");
  assert.equal(mcp?.kind, "mcp_call");
  assert.equal(mcp?.status, "completed");
  assert.equal(mcp?.evidenceCount, 2);

  const prompt = summary.semanticBlocks.find((block) => block.blockId.endsWith(":prompt:acp-perm-7"));
  assert.equal(prompt?.kind, "approval_prompt");
  assert.equal(prompt?.parentBlockId, "acp-tool-1");

  assert.ok(summary.semanticBlocks.some((block) => (
    block.kind === "config_state" &&
    block.title === "Commands updated" &&
    block.body === "2 commands"
  )));
  assert.ok(summary.semanticBlocks.some((block) => (
    block.kind === "config_state" &&
    block.title === "Model catalog updated" &&
    block.body === "openai/gpt-5.5"
  )));
});

test("Qwen ACP fixture preserves initialize capabilities before auth-gated session start", () => {
  const summary = replayFixture("qwen-acp-auth-required.native.jsonl");

  assert.equal(summary.frames, 2);
  assert.deepEqual(summary.nativeKinds, {
    provider_capabilities: 1,
    turn_completed: 1,
  });
  assert.equal(summary.semanticKinds.config_state, 1);
  assert.equal(summary.semanticKinds.session_event, 1);
  assert.equal(summary.semanticKinds.agent_activity, 1);
  assert.equal(summary.evidenceSnapshots, 2);

  const capabilities = summary.semanticBlocks.find((block) => block.blockId.endsWith(":provider-capabilities"));
  assert.equal(capabilities?.kind, "config_state");
  assert.equal(capabilities?.title, "Provider capabilities");
  assert.equal(capabilities?.body, "Qwen Code · 1 auth method · 4 capability groups");

  const failedTurn = summary.semanticBlocks.find((block) => block.blockId.endsWith(":turn:active"));
  assert.equal(failedTurn?.kind, "session_event");
  assert.equal(failedTurn?.status, "failed");
  assert.equal(failedTurn?.body, "Authentication required: Use Qwen Code CLI to authenticate first.");
});

test("native fixture parser rejects unsupported providers before replay", () => {
  assert.throws(
    () => parseNativeFixtureJsonl([
      "{",
      "\"eventId\":\"fixture-bad\",",
      "\"provider\":\"bad\",",
      "\"transport\":\"acp\",",
      "\"runtimeId\":\"runtime\",",
      "\"tideThreadId\":\"thread\",",
      "\"nativeSequence\":1,",
      "\"receivedAt\":\"2026-07-03T00:00:00.000Z\",",
      "\"nativeKind\":\"usage\",",
      "\"nativeIds\":{},",
      "\"payload\":{\"kind\":\"usage\",\"usage\":{}},",
      "\"redaction\":\"reduced\"",
      "}",
    ].join("")),
    /unsupported provider 'bad'/,
  );
});

test("native evidence stores payload shape and redacts text-like payload fields by default", () => {
  const evidenceStore = createInMemoryNativeEvidenceStore({ keepRawFrames: false });
  const event = structuredToNativeRuntimeEvent({
    eventId: "native-2",
    provider: "claude",
    transport: "claude_stream_json",
    runtimeId: "runtime-2",
    tideThreadId: "thread-2",
    nativeSequence: 1,
    receivedAt: "2026-07-03T00:00:00.000Z",
    event: {
      kind: "content_record",
      sourceRef: "message-1",
      payload: {
        type: "message",
        blockId: "message-1",
        body: "private prompt output",
        env: { SECRET_TOKEN: "do-not-store" },
      },
      body: "private prompt output",
    },
  });

  const snapshot = evidenceStore.recordReduced(event);

  assert.match(snapshot.summary, /claude\/content_record/);
  assert.ok(snapshot.payloadShape.some((entry) => entry.includes("$.payload.body:redacted")));
  assert.ok(snapshot.redactedFields.includes("$.body"));
  assert.ok(snapshot.redactedFields.includes("$.payload.env"));
  assert.equal(snapshot.rawRef, undefined);
});

test("native raw evidence ring expires by TTL while reduced snapshots remain", () => {
  let now = "2026-07-03T00:00:00.000Z";
  const evidenceStore = createInMemoryNativeEvidenceStore({
    keepRawFrames: true,
    rawTtlMs: 1000,
    now: () => now,
  });
  const first = structuredToNativeRuntimeEvent({
    eventId: "native-raw-old",
    provider: "codex",
    transport: "codex_app_server",
    runtimeId: "runtime-raw",
    tideThreadId: "thread-raw",
    nativeSequence: 1,
    receivedAt: "2026-07-03T00:00:00.000Z",
    event: { kind: "content_record", payload: { type: "message", text: "old raw" } },
  });
  const second = structuredToNativeRuntimeEvent({
    eventId: "native-raw-new",
    provider: "codex",
    transport: "codex_app_server",
    runtimeId: "runtime-raw",
    tideThreadId: "thread-raw",
    nativeSequence: 2,
    receivedAt: "2026-07-03T00:00:02.000Z",
    event: { kind: "content_record", payload: { type: "message", text: "new raw" } },
  });

  evidenceStore.recordReduced(first);
  now = "2026-07-03T00:00:02.000Z";
  evidenceStore.recordReduced(second);

  assert.deepEqual(
    (evidenceStore.rawFramesForThread?.("thread-raw") ?? []).map((frame) => frame.eventId),
    ["native-raw-new"],
  );
  assert.deepEqual(
    evidenceStore.snapshotsForThread("thread-raw").map((snapshot) => snapshot.eventId),
    ["native-raw-old", "native-raw-new"],
  );
});

test("native activity projection keeps one stable block across running and completed updates", () => {
  const pipeline = createNativeRuntimePipeline();
  const running = pipeline.ingest(structuredToNativeRuntimeEvent({
    eventId: "native-3",
    provider: "opencode",
    transport: "acp",
    runtimeId: "runtime-3",
    tideThreadId: "thread-3",
    nativeSequence: 1,
    receivedAt: "2026-07-03T00:00:00.000Z",
    event: { kind: "live_activity", nestedAgents: 2, nestedToolCalls: 5 },
  }));
  const complete = pipeline.ingest(structuredToNativeRuntimeEvent({
    eventId: "native-4",
    provider: "opencode",
    transport: "acp",
    runtimeId: "runtime-3",
    tideThreadId: "thread-3",
    nativeSequence: 2,
    receivedAt: "2026-07-03T00:00:01.000Z",
    event: { kind: "live_activity" },
  }));

  assert.equal(running[0]?.blockId, "agent-activity:thread-3:runtime-3");
  assert.equal(running[0]?.status, "running");
  assert.equal(running[0]?.body, "2 agents running · 5 tool calls");
  assert.equal(complete[0]?.blockId, "agent-activity:thread-3:runtime-3");
  assert.equal(complete[0]?.status, "completed");
  assert.equal(complete[0]?.body, "Activity complete");
});

test("native pipeline projects tool and approval identities into semantic blocks", () => {
  const pipeline = createNativeRuntimePipeline();
  const toolBlocks = pipeline.ingest(structuredToNativeRuntimeEvent({
    eventId: "native-tool-1",
    provider: "codex",
    transport: "codex_app_server",
    runtimeId: "runtime-tool",
    tideThreadId: "thread-tool",
    nativeSequence: 1,
    receivedAt: "2026-07-03T00:00:00.000Z",
    event: {
      kind: "content_record",
      sourceRef: "tool-shell-1",
      payload: {
        type: "tool_result",
        toolName: "shell",
        callId: "call-1",
        ok: true,
        output: "done",
        status: "complete",
        blockId: "tool-shell-1",
      },
      body: "done",
    },
  }));
  const promptBlocks = pipeline.ingest(structuredToNativeRuntimeEvent({
    eventId: "native-prompt-1",
    provider: "codex",
    transport: "codex_app_server",
    runtimeId: "runtime-tool",
    tideThreadId: "thread-tool",
    nativeSequence: 2,
    receivedAt: "2026-07-03T00:00:01.000Z",
    event: {
      kind: "prompt",
      promptState: {
        promptId: "request-1",
        threadId: "thread-tool",
        agentId: "codex",
        kind: "permission",
        message: "Allow shell?",
        source: "provider_signal",
      },
    },
  }));

  assert.equal(toolBlocks[0]?.kind, "command_run");
  assert.equal(toolBlocks[0]?.nativeIds.callId, "call-1");
  assert.equal(promptBlocks[0]?.kind, "approval_prompt");
  assert.equal(promptBlocks[0]?.nativeIds.requestId, "request-1");
  assert.equal(promptBlocks[0]?.status, "waiting_for_approval");
});

test("native pipeline classifies ACP MCP-style tool calls without discarding provider payload", () => {
  const pipeline = createNativeRuntimePipeline();
  const blocks = pipeline.ingest(structuredToNativeRuntimeEvent({
    eventId: "native-mcp-1",
    provider: "opencode",
    transport: "acp",
    runtimeId: "runtime-mcp",
    tideThreadId: "thread-mcp",
    nativeSequence: 1,
    receivedAt: "2026-07-03T00:00:00.000Z",
    event: {
      kind: "content_record",
      sourceRef: "tool-mcp-1",
      payload: {
        type: "tool_call",
        toolName: "tide.read_file",
        callId: "tool-call-1",
        arguments: "{}",
        status: "pending",
        blockId: "tool-mcp-1",
      },
      body: "{}",
    },
  }));

  assert.equal(blocks[0]?.kind, "mcp_call");
  assert.equal(blocks[0]?.status, "pending");
  assert.equal((blocks[0]?.data.nativePayload as Record<string, unknown>).toolName, "tide.read_file");
});

test("provider capability registries distinguish native methods, config, skills, and ACP commands", () => {
  const codex = codexBaseCapabilityRegistry();
  const compact = codex.find((capability) => capability.capabilityId === "codex:compact");
  const skillInvoke = codex.find((capability) => capability.capabilityId === "codex:skills:invoke");
  assert.deepEqual(compact?.invoke, { kind: "provider_method", method: "thread/compact/start" });
  assert.equal(skillInvoke?.invoke.kind, "unsupported");

  const claude = claudeBaseCapabilityRegistry({
    runtimeCommands: [{ name: "compact", description: "Compact context", trigger: "/" }],
  });
  assert.deepEqual(
    claude.find((capability) => capability.capabilityId === "claude:/:compact")?.invoke,
    { kind: "provider_prompt_text", text: "/compact" },
  );

  const acp = acpCapabilitiesFromSession({
    provider: "opencode",
    commands: [{ name: "compact", description: "Compact context" }],
    configOptions: [{ configId: "mode", label: "Mode" }],
  });
  assert.equal(acp.find((capability) => capability.capabilityId === "opencode:config:mode")?.kind, "permission_control");

  const qwenAcp = acpCapabilitiesFromSession({
    provider: "qwen",
    commands: [{ name: "review", description: "Review changes" }],
  });
  assert.deepEqual(
    qwenAcp.find((capability) => capability.capabilityId === "qwen:command:review")?.invoke,
    { kind: "provider_prompt_text", text: "/review" },
  );
});

test("provider capability catalog includes Tide-owned review surface for every provider", () => {
  for (const agentId of ["codex", "claude", "opencode"] as const) {
    const review = providerCapabilityCatalogFromRuntimeCommands(agentId, [])
      .find((capability) => capability.capabilityId === `${agentId}:tide:review`);
    assert.deepEqual(review?.invoke, { kind: "tide_surface", surface: "review" });
    assert.equal(review?.trigger, "/");
    assert.equal(review?.label, "Review");
    assert.equal(review?.available, true);
  }
});

test("capabilitiesChanged is a valid backend contract event", () => {
  const event: BackendEventEnvelope<"agentRuntime.capabilitiesChanged"> = {
    contractVersion: CONTRACT_VERSION,
    eventId: "event-1",
    kind: "agentRuntime.capabilitiesChanged",
    emittedAt: "2026-07-03T00:00:00.000Z",
    payload: {
      agentId: "codex",
      capabilities: [{
        capabilityId: "codex:compact",
        agentId: "codex",
        source: "generated_schema",
        kind: "session_action",
        label: "Compact",
        group: "session",
        invoke: { kind: "provider_method", method: "thread/compact/start" },
        available: true,
      }],
    },
  };

  assert.equal(validateBackendEventEnvelope(event).ok, true);
});
