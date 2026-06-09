import assert from "node:assert/strict";
import test from "node:test";

import { detectClaudeTranscriptTurnEnd } from "../src/backend/adapters/outbound/agent-integrations/claude/claude-transcript-turn-detection.ts";

function transcript(...records: Record<string, unknown>[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

const userMsg = (message: string) => ({
  type: "user",
  message: { role: "user", content: message },
});
const assistantText = (text: string) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const assistantToolUse = () => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", name: "Bash" }] },
});
const toolResult = () => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
});
const lastPromptMarker = (lastPrompt: string) => ({ type: "last-prompt", lastPrompt });
const modeMarker = () => ({ type: "mode", mode: "normal" });
const permissionModeMarker = () => ({ type: "permission-mode", permissionMode: "default" });
const turnDuration = () => ({ type: "system", subtype: "turn_duration", durationMs: 1234 });
const stopHookSummary = (preventedContinuation: boolean) => ({
  type: "system",
  subtype: "stop_hook_summary",
  preventedContinuation,
});

test("turn_duration_after_current_user_message_ends_turn", () => {
  const text = transcript(userMsg("gd"), assistantText("done"), turnDuration());
  const result = detectClaudeTranscriptTurnEnd(text, "gd");
  assert.equal(result.ended, true);
  assert.equal(result.reason, "completed");
});

test("non_prevented_stop_hook_summary_ends_turn", () => {
  const text = transcript(userMsg("gd"), assistantText("done"), stopHookSummary(false));
  assert.equal(detectClaudeTranscriptTurnEnd(text, "gd").ended, true);
});

test("prevented_stop_hook_summary_does_not_end_turn", () => {
  // A Stop hook that blocks stopping keeps the turn running.
  const text = transcript(userMsg("gd"), assistantText("partial"), stopHookSummary(true));
  assert.equal(detectClaudeTranscriptTurnEnd(text, "gd").ended, false);
});

test("mid_turn_markers_do_not_end_turn", () => {
  // last-prompt / mode / permission-mode are session checkpoints, never turn-end.
  const text = transcript(
    userMsg("gd"),
    assistantToolUse(),
    toolResult(),
    lastPromptMarker("gd"),
    modeMarker(),
    permissionModeMarker(),
  );
  assert.equal(detectClaudeTranscriptTurnEnd(text, "gd").ended, false);
});

test("gd_shape_with_late_answer_then_turn_end_record_ends_turn", () => {
  // Exact shape of the production incident: two tool cycles, mid-turn checkpoint
  // markers, the real answer, THEN the stop_hook_summary + turn_duration records.
  // Turn-end must be detected (and only after the answer line is present).
  const text = transcript(
    userMsg("gd"),
    assistantToolUse(),
    toolResult(),
    assistantToolUse(),
    toolResult(),
    lastPromptMarker("gd"),
    modeMarker(),
    permissionModeMarker(),
    assistantText("Here's the working-tree diff..."),
    stopHookSummary(false),
    turnDuration(),
  );
  assert.equal(detectClaudeTranscriptTurnEnd(text, "gd").ended, true);
});

test("turn_end_before_current_user_message_does_not_end_turn", () => {
  // A prior turn's turn_duration precedes this turn's user message: must NOT
  // settle the current turn early (honored-once guard).
  const text = transcript(
    userMsg("first turn"),
    assistantText("first answer"),
    turnDuration(),
    userMsg("second turn"),
    assistantToolUse(),
  );
  assert.equal(detectClaudeTranscriptTurnEnd(text, "second turn").ended, false);
});

test("no_turn_end_record_does_not_end_turn", () => {
  const text = transcript(userMsg("gd"), assistantToolUse(), toolResult());
  assert.equal(detectClaudeTranscriptTurnEnd(text, "gd").ended, false);
});

test("turn_end_without_located_user_message_is_not_honored", () => {
  const text = transcript(assistantText("orphan"), turnDuration());
  assert.equal(detectClaudeTranscriptTurnEnd(text, "missing message").ended, false);
});
