import assert from "node:assert/strict";
import test from "node:test";

import { antigravityRecordIsTurnEnd } from "../src/backend/adapters/outbound/agent-integrations/antigravity/antigravity-transcript-turn-detection.ts";

test("planner_response_with_content_and_no_tool_calls_is_turn_end", () => {
  assert.equal(
    antigravityRecordIsTurnEnd({
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      content: "Here is the final answer.",
    }),
    true,
  );
});

test("planner_response_with_tool_calls_is_not_turn_end", () => {
  assert.equal(
    antigravityRecordIsTurnEnd({
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      content: "calling a tool",
      tool_calls: [{ name: "read_file", args: {} }],
    }),
    false,
  );
});

test("planner_response_without_content_is_not_turn_end", () => {
  assert.equal(
    antigravityRecordIsTurnEnd({
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      tool_calls: [],
    }),
    false,
  );
});

test("non_planner_or_non_model_records_are_not_turn_end", () => {
  assert.equal(
    antigravityRecordIsTurnEnd({ source: "MODEL", type: "TOOL_RESULT", content: "x" }),
    false,
  );
  assert.equal(
    antigravityRecordIsTurnEnd({ source: "SYSTEM", type: "PLANNER_RESPONSE", content: "x" }),
    false,
  );
  assert.equal(antigravityRecordIsTurnEnd(undefined), false);
  assert.equal(antigravityRecordIsTurnEnd("not a record"), false);
});
