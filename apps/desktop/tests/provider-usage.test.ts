import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readProviderAccountUsageSnapshotsFromHome } from "../src/backend/infrastructure/node/provider/provider-account-usage.ts";
import { parseProviderUsage } from "../src/backend/infrastructure/node/provider/provider-usage.ts";

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
          last_token_usage: { total_tokens: 48000 },
          model_context_window: 256000,
        },
        rate_limits: {
          primary: { used_percent: 58.0, window_minutes: 300, resets_at: 1781973894 },
          secondary: { used_percent: 68.0, window_minutes: 10080, resets_at: 1782378364 },
        },
      },
    }),
  ].join("\n");
  const usage = parseProviderUsage(rollout, "codex");
  assert.equal(usage?.totalTokens, 64000);
  assert.equal(usage?.contextTokens, 48000);
  assert.equal(usage?.contextWindow, 256000);
  assert.equal(usage?.contextUsedPercent, 19);
  assert.equal(usage?.model, "gpt-5.5");
  assert.deepEqual(usage?.rateLimits, [
    { usedPercent: 58, windowMinutes: 300, resetsAt: 1781973894 },
    { usedPercent: 68, windowMinutes: 10080, resetsAt: 1782378364 },
  ]);
});

test("codex context percent uses last token_count instead of cumulative session total", () => {
  const rollout = [
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: 7633249 },
          last_token_usage: { total_tokens: 173394 },
          model_context_window: 258400,
        },
      },
    }),
  ].join("\n");
  const usage = parseProviderUsage(rollout, "codex");
  assert.equal(usage?.totalTokens, 7633249);
  assert.equal(usage?.contextTokens, 173394);
  assert.equal(usage?.contextWindow, 258400);
  assert.equal(usage?.contextUsedPercent, 67);
});

for (const [label, info, expectedTokens, expectedPercent] of [
  ["direct camelCase", { contextTokens: 40000 }, 40000, 20],
  ["camelCase last usage", { lastTokenUsage: { totalTokens: 60000 } }, 60000, 30],
  ["nested context total", { contextUsage: { total: { totalTokens: 120000 } } }, 120000, 60],
] as const) {
  test(`codex hydrate usage supports ${label} context token format`, () => {
    const rollout = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: 900000 },
          model_context_window: 200000,
          ...info,
        },
      },
    });
    const usage = parseProviderUsage(rollout, "codex");
    assert.equal(usage?.totalTokens, 900000);
    assert.equal(usage?.contextTokens, expectedTokens);
    assert.equal(usage?.contextUsedPercent, expectedPercent);
  });
}

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

test("parses claude rate_limit_event into provider rate limits", () => {
  const transcript = [
    JSON.stringify({
      type: "rate_limit_event",
      rateLimits: [
        { label: "5h", usedPercent: 42, windowMinutes: 300, resetsAt: 1781973894 },
        { label: "Weekly", usedPercent: 61, windowMinutes: 10080, resetsAt: 1782378364 },
      ],
    }),
  ].join("\n");
  const usage = parseProviderUsage(transcript, "claude");
  assert.deepEqual(usage?.rateLimits, [
    { label: "5h", usedPercent: 42, windowMinutes: 300, resetsAt: 1781973894 },
    { label: "Weekly", usedPercent: 61, windowMinutes: 10080, resetsAt: 1782378364 },
  ]);
});

test("returns undefined when there is no usage in the transcript", () => {
  assert.equal(parseProviderUsage("not json\n{}", "codex"), undefined);
  assert.equal(parseProviderUsage("", "claude"), undefined);
});

test("reads account quota snapshots from recent provider history", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "tide-provider-usage-"));
  const codexHome = join(homeDir, "codex-home");
  const codexDir = join(codexHome, "sessions", "2026", "07", "02");
  const claudeDir = join(homeDir, ".claude", "projects", "repo");
  mkdirSync(codexDir, { recursive: true });
  mkdirSync(claudeDir, { recursive: true });

  const older = new Date(Date.now() - 10_000);
  const newer = new Date(Date.now() - 1_000);
  const codexOld = join(codexDir, "rollout-old.jsonl");
  const codexLatest = join(codexDir, "rollout-latest.jsonl");
  const claudeLatest = join(claudeDir, "11111111-1111-4111-8111-111111111111.jsonl");

  writeFileSync(codexOld, JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { total_tokens: 1000 } } } }));
  writeFileSync(
    codexLatest,
    [
      JSON.stringify({ type: "session_meta", payload: { model: "gpt-5.5" } }),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          rate_limits: {
            primary: { used_percent: 12, window_minutes: 300, resets_at: 1781973894 },
          },
        },
      }),
    ].join("\n"),
  );
  writeFileSync(
    claudeLatest,
    JSON.stringify({
      type: "rate_limit_event",
      rateLimits: [{ label: "Weekly", usedPercent: 65, windowMinutes: 10080 }],
    }),
  );
  utimesSync(codexOld, older, older);
  utimesSync(codexLatest, newer, newer);
  utimesSync(claudeLatest, newer, newer);

  const snapshots = readProviderAccountUsageSnapshotsFromHome({ homeDir, codexHome });

  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.agentId).sort(),
    ["claude", "codex"],
  );
  assert.deepEqual(
    snapshots.find((snapshot) => snapshot.agentId === "codex")?.usage.rateLimits,
    [{ usedPercent: 12, windowMinutes: 300, resetsAt: 1781973894 }],
  );
  assert.deepEqual(
    snapshots.find((snapshot) => snapshot.agentId === "claude")?.usage.rateLimits,
    [{ label: "Weekly", usedPercent: 65, windowMinutes: 10080 }],
  );
});
