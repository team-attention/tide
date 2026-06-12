import assert from "node:assert/strict";
import test from "node:test";

import { codexReasoningText } from "../src/backend/infrastructure/node/provider/provider-history-helpers.ts";
import { claudeThinkingText } from "../src/backend/infrastructure/node/live/live-backend-json.ts";
import {
  rebuildCodexConversation,
  rebuildClaudeConversation,
  rebuildGeminiConversation,
} from "../src/backend/infrastructure/node/provider/provider-conversation-rebuilders.ts";

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

// Phase 5.3 — gemini threads must restore their conversation from the gemini
// session JSONL on reopen, like codex/claude (was the "No messages here" gap).
test("rebuildGeminiConversation restores user, reasoning, tool, and answer blocks", () => {
  const session = [
    JSON.stringify({ sessionId: "s1", projectHash: "p", startTime: "t" }),
    JSON.stringify({ type: "user", content: "List the files." }),
    JSON.stringify({
      type: "gemini",
      id: "g1",
      thoughts: [{ subject: "Plan", description: "I'll run ls." }],
      toolCalls: [
        {
          id: "call-1",
          name: "run_shell_command",
          args: { command: "ls" },
          result: [{ functionResponse: { response: { output: "a.txt\nb.txt" } } }],
        },
      ],
      content: "There are two files: a.txt and b.txt.",
    }),
  ].join("\n");
  const blocks = rebuildGeminiConversation(session, "thread-1", "s1", "gemini");
  assert.deepEqual(
    blocks.map((b) => b.role),
    ["user", "reasoning", "tool", "tool", "agent"],
  );
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["user_message", "reasoning", "tool_call", "tool_result", "agent_message"],
  );
  assert.equal(blocks[0].body, "List the files.");
  assert.equal(blocks[1].body, "Plan\nI'll run ls.");
  assert.match(blocks[3].body, /a\.txt/);
  assert.equal(blocks[4].body, "There are two files: a.txt and b.txt.");
});

test("rebuildGeminiConversation skips header and $set patch lines", () => {
  const session = [
    JSON.stringify({ sessionId: "s1" }),
    JSON.stringify({ $set: { foo: "bar" } }),
    JSON.stringify({ type: "user", content: "hi" }),
  ].join("\n");
  const blocks = rebuildGeminiConversation(session, "t", "s1", "gemini");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].role, "user");
});
