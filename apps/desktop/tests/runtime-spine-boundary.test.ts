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

// Turn-end is provider knowledge owned in each Agent Integration's history
// detection — NOT a hook the infrastructure settles on. Infrastructure must not
// hardcode provider turn-end hook event names (double-quoted literal form;
// explanatory comments use backticks and are allowed). The hooks still flow as
// Provider Signals, but no `if (eventName === "codex-stop") settle` lives here.
const turnEndHookLiterals = ['"codex-stop"', '"agent-idle"'];

test("infra_live_backend_does_not_hardcode_turn_end_hook_events", () => {
  const source = read("src/backend/infrastructure/node/live-backend.ts");
  for (const literal of turnEndHookLiterals) {
    assert.equal(
      source.includes(literal),
      false,
      `live-backend.ts must not hardcode turn-end hook event ${literal}; turn-end is owned by each provider's history detection in its adapter`,
    );
  }
});

// All three providers own their turn-end detection in their adapters, settled from
// their own provider history (no cross-channel hook settle): codex (rollout
// task_complete/turn_aborted), claude (transcript turn_duration/stop_hook_summary),
// antigravity (transcript PLANNER_RESPONSE terminal rule).
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
