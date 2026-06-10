import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// Invariant #1 of the Agent Runtime Event Spine: provider-specific turn-lifecycle
// detection must live inside Agent Integration adapters, never in the Backend
// application service or infrastructure wiring. These are the codex rollout
// event-type literals used to decide a turn ended; they must not reappear inline
// in the god-files. See docs_v2/specs/agent-runtime-event-spine.md.
const codexTurnEndLiterals = ['"turn_aborted"', '"task_complete"'];

test("infra_live_backend_does_not_reimplement_codex_turn_detection", () => {
  const source = read("src/backend/infrastructure/node/live-backend.ts");
  for (const literal of codexTurnEndLiterals) {
    assert.equal(
      source.includes(literal),
      false,
      `live-backend.ts must not re-implement codex turn detection (${literal}); it belongs in the codex Agent Integration`,
    );
  }
});

test("thread_runtime_service_does_not_reimplement_codex_turn_detection", () => {
  const source = read("src/backend/application/services/thread-runtime-service.ts");
  for (const literal of codexTurnEndLiterals) {
    assert.equal(
      source.includes(literal),
      false,
      `thread-runtime-service.ts must not re-implement codex turn detection (${literal})`,
    );
  }
});

test("codex_turn_detection_lives_in_the_codex_agent_integration", () => {
  const source = read(
    "src/backend/adapters/outbound/agent-integrations/codex/codex-rollout-turn-detection.ts",
  );
  for (const literal of codexTurnEndLiterals) {
    assert.ok(
      source.includes(literal),
      `codex turn detection literal ${literal} should live in the codex adapter`,
    );
  }
});

// The hook event names that mean "turn ended" (codex-stop / agent-idle) are
// provider knowledge; they must be declared by each Agent Integration's
// turnEndSignalEvents(), not hardcoded in infrastructure (double-quoted literal
// form — explanatory comments use backticks and are allowed).
const turnEndHookLiterals = ['"codex-stop"', '"agent-idle"'];

test("infra_live_backend_does_not_hardcode_turn_end_hook_events", () => {
  const source = read("src/backend/infrastructure/node/live-backend.ts");
  for (const literal of turnEndHookLiterals) {
    assert.equal(
      source.includes(literal),
      false,
      `live-backend.ts must not hardcode turn-end hook event ${literal}; declare it in the Agent Integration's turnEndSignalEvents()`,
    );
  }
});

// All three providers own their turn-end detection in their adapters: codex
// (rollout task_complete/turn_aborted + codex-stop hook), claude (agent-idle
// hook), antigravity (agent-idle hook + transcript PLANNER_RESPONSE rule).
test("antigravity_transcript_turn_end_rule_lives_in_its_adapter", () => {
  const adapter = read(
    "src/backend/adapters/outbound/agent-integrations/antigravity/antigravity-transcript-turn-detection.ts",
  );
  assert.ok(adapter.includes('"PLANNER_RESPONSE"'));
  assert.ok(adapter.includes("tool_calls"));

  // The inline rule must no longer live in infrastructure.
  const infra = read("src/backend/infrastructure/node/live-backend.ts");
  assert.equal(infra.includes("turnEnd: toolCalls.length === 0"), false);
});

// Provider History Connector invariant #1: live-backend keeps exactly ONE
// generic history loop. No `agentId === "<provider>"` comparison and no
// per-provider emitter/binder may exist in infrastructure wiring; provider
// knowledge lives in each Agent Integration's connector.
// See docs_v2/specs/provider-history-connector.md.
test("infra_live_backend_has_zero_provider_branches", () => {
  const source = read("src/backend/infrastructure/node/live-backend.ts");
  for (const literal of [
    'agentId === "codex"',
    'agentId === "claude"',
    'agentId === "gemini"',
    'agentId === "antigravity"',
    "emitCodexHistory",
    "emitClaudeHistory",
    "emitGeminiHistory",
    "emitAntigravityHistory",
    "findRecentGeminiSessionPath",
  ]) {
    assert.equal(
      source.includes(literal),
      false,
      `live-backend.ts must not contain provider-specific dispatch (${literal}); it belongs in that provider's Agent Integration`,
    );
  }
});

// The runtime port is provider-neutral: submit-key and startup auto-responses
// are declared on the launch plan by each Agent Integration, never hardcoded by
// agent id in the port.
test("runtime_port_has_no_hardcoded_provider_key_sequences", () => {
  const source = read(
    "src/backend/adapters/outbound/agent-runtime/agent-integration-agent-runtime-port.ts",
  );
  assert.equal(
    source.includes('agentId === "claude" ? "\\x1b[13u"'),
    false,
    "the claude submit key belongs on the claude launch plan (submitKeySequence)",
  );
  assert.equal(
    source.includes("CODEX_HOOK_TRUST_PROMPT"),
    false,
    "the codex hook-trust auto-answer belongs on the codex launch plan (autoRespondPrompts)",
  );

  // claude moved to the structured stream-json transport: there is no TUI to
  // submit into, so its plan declares a transport instead of a submit key.
  const claudeAdapter = read(
    "src/backend/adapters/outbound/agent-integrations/claude/claude-agent-integration.ts",
  );
  assert.ok(claudeAdapter.includes('transport: "claude_stream_json"'));
  // codex moved to the structured app-server transport: no TUI boxes to
  // auto-answer, so its plan declares a transport instead of auto-responders.
  const codexAdapter = read(
    "src/backend/adapters/outbound/agent-integrations/codex/codex-agent-integration.ts",
  );
  assert.ok(codexAdapter.includes('transport: "codex_app_server"'));
});

// Deterministic session binding: the gemini recency heuristic must not return.
// Binding comes from a launch-assigned session id (claude/gemini --session-id)
// or a runtime-keyed hook payload only.
test("session_binding_is_assigned_not_recency_discovered", () => {
  const claudeAdapter = read(
    "src/backend/adapters/outbound/agent-integrations/claude/claude-agent-integration.ts",
  );
  assert.ok(claudeAdapter.includes('"--session-id"'));
  // gemini's ACP session id is GENERATED by the agent and recorded from the
  // session/new RESPONSE (deterministic, never recency-discovered); the ACP
  // client emits it as a session_ref event.
  const geminiClient = read(
    "src/backend/adapters/outbound/agent-runtime/structured/gemini-acp-client.ts",
  );
  assert.ok(geminiClient.includes('kind: "gemini_session"'));
});
