import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { codexReasoningText } from "../src/backend/infrastructure/node/provider/provider-history-helpers.ts";
import { claudeThinkingText } from "../src/backend/infrastructure/node/live/live-backend-json.ts";
import {
  rebuildConversationFromProviderHistory,
  rebuildCodexConversation,
  rebuildClaudeConversation,
} from "../src/backend/infrastructure/node/provider/provider-conversation-rebuilders.ts";
import type { ThreadStorageRecord } from "../src/backend/application/services/thread/thread-persistence-service.ts";

// Spec: docs_v2/specs/agent-chat-fidelity-reasoning-actions.md

test("codexReasoningText reads agent_reasoning event text", () => {
  assert.equal(
    codexReasoningText({ type: "agent_reasoning", text: "Let me think." }),
    "Let me think.",
  );
});

test("codexReasoningText joins reasoning response_item summary parts", () => {
  const text = codexReasoningText({
    type: "reasoning",
    summary: [
      { type: "summary_text", text: "First, read the file." },
      { type: "summary_text", text: "Then tighten spacing." },
    ],
  });
  assert.equal(text, "First, read the file.\n\nThen tighten spacing.");
});

test("codexReasoningText returns undefined for encrypted/empty reasoning", () => {
  assert.equal(codexReasoningText({ type: "reasoning", summary: [] }), undefined);
  assert.equal(codexReasoningText({ type: "agent_message", message: "hi" }), undefined);
});

test("claudeThinkingText reads thinking content items", () => {
  const content = [
    { type: "thinking", thinking: "Considering the options." },
    { type: "text", text: "Here is the answer." },
  ];
  assert.equal(claudeThinkingText(content), "Considering the options.");
  assert.equal(claudeThinkingText([{ type: "text", text: "no thinking" }]), undefined);
});

test("rebuildCodexConversation emits a reasoning block before the answer", () => {
  const rollout = [
    JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "Tighten the transcript." } }),
    JSON.stringify({ type: "event_msg", payload: { type: "agent_reasoning", text: "I'll read the renderer first." } }),
    JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "Done." } }),
  ].join("\n");
  const blocks = rebuildCodexConversation(rollout, "thread-1", "session-1", "codex");
  const roles = blocks.map((b) => b.role);
  const kinds = blocks.map((b) => b.kind);
  assert.deepEqual(roles, ["user", "reasoning", "agent"]);
  assert.equal(kinds[1], "reasoning");
  assert.equal(blocks[1].body, "I'll read the renderer first.");
});

test("rebuildClaudeConversation emits reasoning from thinking content", () => {
  const transcript = [
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Plan the change." },
          { type: "text", text: "Applied." },
        ],
      },
    }),
  ].join("\n");
  const blocks = rebuildClaudeConversation(transcript, "thread-1", "session-1", "claude");
  assert.equal(blocks[0].role, "reasoning");
  assert.equal(blocks[0].body, "Plan the change.");
  assert.equal(blocks[1].role, "agent");
  assert.equal(blocks[1].body, "Applied.");
});

test("rebuildConversationFromProviderHistory reads the full provider transcript", () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "tide-provider-history-"));
  try {
    const rolloutPath = path.join(dir, "rollout.jsonl");
    fs.writeFileSync(
      rolloutPath,
      [
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "original prompt" },
        }),
        "x".repeat(1024 * 1024 + 100),
        JSON.stringify({
          type: "event_msg",
          payload: { type: "agent_message", message: "latest answer" },
        }),
      ].join("\n"),
    );

    const blocks = rebuildConversationFromProviderHistory(
      threadRecordWithProviderTranscript(rolloutPath),
    );

    assert.deepEqual(
      blocks
        .filter((block) => block.kind === "user_message" || block.kind === "agent_message")
        .map((block) => block.body),
      ["original prompt", "latest answer"],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function threadRecordWithProviderTranscript(transcriptPath: string): ThreadStorageRecord {
  const timestamp = "2026-07-02T00:00:00.000Z";
  return {
    storageVersion: 1,
    threadId: "thread-1",
    title: "Original prompt",
    pinned: false,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    agentBinding: {
      agentId: "codex",
      runtimeSource: { kind: "provider_cli", integrationId: "codex" },
      providerSessionRef: {
        kind: "codex_rollout",
        value: "session-1",
        transcriptPath,
      },
    },
    scope: { kind: "scratch", scratchCwd: dirFromPath(transcriptPath) },
    executionContext: { cwd: dirFromPath(transcriptPath) },
    providerSessionRef: {
      agentId: "codex",
      kind: "codex_rollout",
      value: "session-1",
      transcriptPath,
      observedAt: timestamp,
    },
    lastKnownState: "idle",
  };
}

function dirFromPath(filePath: string): string {
  return path.dirname(filePath);
}
