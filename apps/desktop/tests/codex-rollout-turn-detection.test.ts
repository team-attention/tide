import assert from "node:assert/strict";
import test from "node:test";

import {
  codexRolloutTurnEnded,
  detectCodexRolloutTurnEnd,
} from "../src/backend/adapters/outbound/agent-integrations/codex/codex-rollout-turn-detection.ts";

function rollout(...records: Record<string, unknown>[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

const userMsg = (message: string) => ({
  type: "event_msg",
  payload: { type: "user_message", message },
});
const taskComplete = () => ({ type: "event_msg", payload: { type: "task_complete" } });
const turnAborted = () => ({ type: "event_msg", payload: { type: "turn_aborted" } });

test("task_complete_after_current_user_message_ends_turn_completed", () => {
  const text = rollout(userMsg("do the thing"), taskComplete());
  const result = detectCodexRolloutTurnEnd(text, "do the thing");
  assert.equal(result.ended, true);
  assert.equal(result.reason, "completed");
});

test("turn_aborted_ends_turn_aborted", () => {
  const text = rollout(userMsg("do the thing"), turnAborted());
  const result = detectCodexRolloutTurnEnd(text, "do the thing");
  assert.equal(result.ended, true);
  assert.equal(result.reason, "aborted");
});

test("task_complete_before_current_user_message_does_not_end_turn", () => {
  // A prior turn's task_complete precedes this turn's user message: must NOT
  // settle the current turn early (the "honored once" guard).
  const text = rollout(
    userMsg("first turn"),
    taskComplete(),
    userMsg("second turn"),
  );
  const result = detectCodexRolloutTurnEnd(text, "second turn");
  assert.equal(result.ended, false);
});

test("no_turn_end_event_does_not_end_turn", () => {
  const text = rollout(userMsg("do the thing"));
  assert.equal(codexRolloutTurnEnded(text, "do the thing"), false);
});

test("task_complete_without_located_user_message_is_not_honored", () => {
  // task_complete requires the current turn's user message to be located.
  const text = rollout(taskComplete());
  assert.equal(detectCodexRolloutTurnEnd(text, "missing message").ended, false);
});

test("turn_aborted_is_honored_even_without_user_message", () => {
  // Abort (limit/error/interrupt) is a hard turn-end regardless of user-message match.
  const text = rollout(turnAborted());
  const result = detectCodexRolloutTurnEnd(text, undefined);
  assert.equal(result.ended, true);
  assert.equal(result.reason, "aborted");
});

test("user_message_matched_via_structured_content_array", () => {
  const text = rollout(
    {
      type: "event_msg",
      payload: {
        type: "user_message",
        content: [{ type: "input_text", text: "structured ask" }],
      },
    },
    taskComplete(),
  );
  assert.equal(detectCodexRolloutTurnEnd(text, "structured ask").ended, true);
});
