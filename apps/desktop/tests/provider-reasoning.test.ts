import assert from "node:assert/strict";
import test from "node:test";

import { codexReasoningText } from "../src/backend/infrastructure/node/provider-history-helpers.ts";
import { claudeThinkingText } from "../src/backend/infrastructure/node/live-backend-json.ts";
import {
  rebuildCodexConversation,
  rebuildClaudeConversation,
} from "../src/backend/infrastructure/node/provider-conversation-rebuilders.ts";

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
