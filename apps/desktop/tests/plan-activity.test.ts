// Spec: live-turn-activity-visibility.md (Slice B′). The shared plan-step counter
// used by the codex `plan` item, the ACP `plan` session update, and opencode's
// ACP `todowrite` tool result.

import assert from "node:assert/strict";
import test from "node:test";

import {
  planActivityFromEntries,
  planActivityFromToolResultPayload,
  planActivityFromTodoToolOutput,
} from "../src/backend/adapters/outbound/agent-runtime/structured/plan-activity.ts";

test("B'1: counts total steps and completed ones", () => {
  const plan = planActivityFromEntries([
    { content: "a", status: "completed" },
    { content: "b", status: "in_progress" },
    { content: "c", status: "pending" },
    { content: "d", status: "completed" },
  ]);
  assert.deepEqual(plan, { planTotal: 4, planCompleted: 2 });
});

test("B'2: undefined for a non-array or empty plan", () => {
  assert.equal(planActivityFromEntries(undefined), undefined);
  assert.equal(planActivityFromEntries([]), undefined);
  assert.equal(planActivityFromEntries("nope"), undefined);
});

test("B'3: non-record entries are ignored", () => {
  const plan = planActivityFromEntries([{ status: "completed" }, "junk", 42]);
  assert.deepEqual(plan, { planTotal: 1, planCompleted: 1 });
});

test("B'4: opencode todowrite output is counted as plan activity", () => {
  const plan = planActivityFromTodoToolOutput(
    "3 todos",
    JSON.stringify([
      { content: "a", status: "completed" },
      { content: "b", status: "in_progress" },
      { content: "c", status: "pending" },
      { content: "d", status: "pending" },
    ]),
  );
  assert.deepEqual(plan, { planTotal: 4, planCompleted: 1 });
  assert.equal(planActivityFromTodoToolOutput("bash", "[]"), undefined);
});

test("B'5: opencode tool_result payload is counted as plan activity", () => {
  const plan = planActivityFromToolResultPayload({
    type: "tool_result",
    toolName: "2 todos",
    output: JSON.stringify([
      { status: "completed" },
      { status: "completed" },
      { status: "in_progress" },
      { status: "pending" },
    ]),
  });
  assert.deepEqual(plan, { planTotal: 4, planCompleted: 2 });
});
