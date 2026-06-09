import assert from "node:assert/strict";
import test from "node:test";

import { parseProviderUsage } from "../src/backend/infrastructure/node/provider-usage.ts";

// Spec: docs_v2/specs/agent-chat-fidelity-reasoning-actions.md (usage meter slice)

test("parses codex token_count into tokens, context window, and percent", () => {
  const rollout = [
    JSON.stringify({ type: "session_meta", payload: { model: "gpt-5.5" } }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 60000, output_tokens: 4000, total_tokens: 64000 },
          model_context_window: 256000,
        },
      },
    }),
  ].join("\n");
  const usage = parseProviderUsage(rollout, "codex");
  assert.equal(usage?.totalTokens, 64000);
  assert.equal(usage?.contextWindow, 256000);
  assert.equal(usage?.contextUsedPercent, 25);
  assert.equal(usage?.model, "gpt-5.5");
});

test("codex usage takes the LAST token_count (cumulative latest)", () => {
  const rollout = [
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 1000 }, model_context_window: 200000 } } }),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 5000 }, model_context_window: 200000 } } }),
  ].join("\n");
  const usage = parseProviderUsage(rollout, "codex");
  assert.equal(usage?.totalTokens, 5000);
});

test("parses claude assistant usage into total tokens (no context window)", () => {
  const transcript = [
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-6",
        usage: {
          input_tokens: 1200,
          cache_read_input_tokens: 800,
          output_tokens: 300,
        },
      },
    }),
  ].join("\n");
  const usage = parseProviderUsage(transcript, "claude");
  assert.equal(usage?.totalTokens, 2300);
  assert.equal(usage?.contextWindow, undefined);
  assert.equal(usage?.contextUsedPercent, undefined);
  assert.equal(usage?.model, "claude-sonnet-4-6");
});

test("returns undefined when there is no usage in the transcript", () => {
  assert.equal(parseProviderUsage("not json\n{}", "codex"), undefined);
  assert.equal(parseProviderUsage("", "claude"), undefined);
});

test("antigravity has no transcript usage channel yet", () => {
  assert.equal(parseProviderUsage("{}", "antigravity"), undefined);
});
