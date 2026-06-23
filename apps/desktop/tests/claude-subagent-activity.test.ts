// Spec: live-turn-activity-visibility.md (Slice B / B1). The pure parser aggregates a
// snapshot of Claude subagent transcripts into {nestedAgents, nestedToolCalls}.

import assert from "node:assert/strict";
import test from "node:test";

import { parseSubagentActivity } from "../src/backend/adapters/outbound/agent-integrations/claude/claude-subagent-activity.ts";

function assistantToolUseLine(...names: string[]): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: names.map((name) => ({ type: "tool_use", name, input: {} })) },
  });
}

function textLine(text: string): string {
  return JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
}

test("B1: counts each subagent file and sums tool_use items across them", () => {
  const counts = parseSubagentActivity([
    { lines: [assistantToolUseLine("WebSearch"), assistantToolUseLine("WebFetch", "WebFetch")] },
    { lines: [assistantToolUseLine("Bash"), textLine("done")] },
  ]);
  assert.equal(counts.nestedAgents, 2);
  // file 1: 1 + 2 tool_use, file 2: 1 tool_use, text line: 0 → 4 total.
  assert.equal(counts.nestedToolCalls, 4);
});

test("B1b: blank and partial (non-JSON) lines are skipped, not thrown on", () => {
  const counts = parseSubagentActivity([
    { lines: ["", assistantToolUseLine("WebSearch"), "{ partial mid-write"] },
  ]);
  assert.equal(counts.nestedAgents, 1);
  assert.equal(counts.nestedToolCalls, 1);
});

test("B1c: an empty snapshot is zero, not undefined", () => {
  const counts = parseSubagentActivity([]);
  assert.deepEqual(counts, { nestedAgents: 0, nestedToolCalls: 0 });
});

test("B1d: tool_result and user lines do not count as tool calls", () => {
  const userToolResult = JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] },
  });
  const counts = parseSubagentActivity([{ lines: [userToolResult, textLine("hi")] }]);
  assert.equal(counts.nestedAgents, 1);
  assert.equal(counts.nestedToolCalls, 0);
});
