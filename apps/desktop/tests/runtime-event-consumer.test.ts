import assert from "node:assert/strict";
import test from "node:test";

import type { AgentRuntimeState } from "../src/backend/application/domains/agent-runtime/agent-runtime.ts";
import type {
  AgentRuntimeEvent,
  TurnEndReason,
} from "../src/backend/application/domains/agent-runtime/agent-runtime-event.ts";
import {
  consumeRuntimeEvents,
  type RuntimeEventContext,
  type RuntimeEventEffects,
} from "../src/backend/application/domains/agent-runtime/runtime-event-consumer.ts";
import type { PromptState } from "../src/backend/application/domains/thread/thread.ts";

// ---- fakes ------------------------------------------------------------------

function source(events: AgentRuntimeEvent[]) {
  return {
    async *events() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

interface Recorded {
  states: AgentRuntimeState[];
  settles: TurnEndReason[];
  blocks: string[];
  promptsOpened: string[];
  promptsClosed: { promptId: string; outcome: string }[];
  started: (string | undefined)[];
  exited: boolean[];
  log: string[];
}

function spyEffects(): { effects: RuntimeEventEffects; rec: Recorded } {
  const rec: Recorded = {
    states: [],
    settles: [],
    blocks: [],
    promptsOpened: [],
    promptsClosed: [],
    started: [],
    exited: [],
    log: [],
  };
  const effects: RuntimeEventEffects = {
    onRuntimeStarted: (_c, v) => {
      rec.started.push(v);
      rec.log.push("started");
    },
    onStateChanged: (_c, s) => {
      rec.states.push(s);
      rec.log.push(`state:${s}`);
    },
    onBlockUpdate: (_c, f) => {
      rec.blocks.push(f);
      rec.log.push(`block:${f}`);
    },
    onPromptOpened: (_c, p) => {
      rec.promptsOpened.push(p);
      rec.log.push(`prompt_open:${p}`);
    },
    onPromptClosed: (_c, p, o) => {
      rec.promptsClosed.push({ promptId: p, outcome: o });
      rec.log.push(`prompt_close:${p}:${o}`);
    },
    onTurnSettled: (_c, r) => {
      rec.settles.push(r);
      rec.log.push(`settle:${r}`);
    },
    onRuntimeExited: (_c, e) => {
      rec.exited.push(e);
      rec.log.push(`exited:${e}`);
    },
  };
  return { effects, rec };
}

// ---- event builders ---------------------------------------------------------

let seq = 0;
function base(runtimeId: string, threadId = "t1", agentId = "claude") {
  seq += 1;
  return { runtimeId, threadId, agentId, sequence: seq, observedAt: "now" } as const;
}
const started = (rt: string): AgentRuntimeEvent => ({
  ...base(rt),
  type: "runtime.started",
});
const turnStarted = (rt: string): AgentRuntimeEvent => ({
  ...base(rt),
  type: "turn.started",
  cause: "initial",
});
const delta = (rt: string, frameId: string): AgentRuntimeEvent => ({
  ...base(rt),
  type: "output.delta",
  frameId,
});
const turnEnded = (rt: string, reason: TurnEndReason): AgentRuntimeEvent => ({
  ...base(rt),
  type: "turn.ended",
  reason,
});
const promptState = (promptId: string): PromptState => ({
  promptId,
  threadId: "t1",
  agentId: "claude",
  kind: "question",
  message: "?",
  source: "provider_hook",
});
const promptOpened = (rt: string, promptId: string): AgentRuntimeEvent => ({
  ...base(rt),
  type: "prompt.opened",
  promptState: promptState(promptId),
});
const promptClosed = (
  rt: string,
  promptId: string,
  outcome: "answered" | "withdrawn",
): AgentRuntimeEvent => ({ ...base(rt), type: "prompt.closed", promptId, outcome });

// ---- tests (mirror agent-runtime-event-spine.md Tests table) ----------------

test("service_maps_runtime_events_to_runtime_state_without_provider_branch", async () => {
  const { effects, rec } = spyEffects();
  await consumeRuntimeEvents(
    source([turnStarted("r"), delta("r", "f1"), turnEnded("r", "completed")]),
    effects,
  );
  // running on start, idle on end; one block; one settle. No provider branching:
  // the same path handled a "claude" agentId with zero claude-specific logic.
  assert.deepEqual(rec.states, ["running", "idle"]);
  assert.deepEqual(rec.blocks, ["f1"]);
  assert.deepEqual(rec.settles, ["completed"]);
});

test("fused_signals_resolve_to_single_turn_ended", async () => {
  const { effects, rec } = spyEffects();
  // Two turn.ended events for one open turn (duplicate fused signals): only the
  // first settles; the reducer drops the rest.
  await consumeRuntimeEvents(
    source([
      turnStarted("r"),
      turnEnded("r", "completed"),
      turnEnded("r", "completed"),
    ]),
    effects,
  );
  assert.deepEqual(rec.settles, ["completed"]);
});

test("turn_ended_flushes_queued_composer_input", async () => {
  // The settle effect is the single hook a real handler uses to flush queued input;
  // assert turn.ended produces exactly one settle to drive that flush.
  const { effects, rec } = spyEffects();
  await consumeRuntimeEvents(
    source([turnStarted("r"), turnEnded("r", "completed")]),
    effects,
  );
  assert.equal(rec.settles.length, 1);
});

test("interrupt_emits_turn_ended_interrupted_and_settles", async () => {
  const { effects, rec } = spyEffects();
  await consumeRuntimeEvents(
    source([turnStarted("r"), turnEnded("r", "interrupted")]),
    effects,
  );
  assert.deepEqual(rec.settles, ["interrupted"]);
  assert.deepEqual(rec.states, ["running", "idle"]);
});

test("runtime_without_turn_end_does_not_auto_settle", async () => {
  const { effects, rec } = spyEffects();
  await consumeRuntimeEvents(
    source([turnStarted("r"), delta("r", "f1")]),
    effects,
  );
  assert.deepEqual(rec.settles, []);
});

test("two_runtimes_keep_independent_turn_lifecycles", async () => {
  // A shared state map; runtime A ends while runtime B stays running.
  const states = new Map();
  const a = spyEffects();
  const b = spyEffects();
  await consumeRuntimeEvents(
    source([turnStarted("A"), turnEnded("A", "completed")]),
    a.effects,
    states,
  );
  await consumeRuntimeEvents(source([turnStarted("B"), delta("B", "f")]), b.effects, states);
  assert.deepEqual(a.rec.settles, ["completed"]);
  assert.deepEqual(b.rec.settles, []);
  assert.deepEqual(b.rec.states, ["running"]);
});

test("prompt_opened_then_answer_emits_prompt_closed", async () => {
  const { effects, rec } = spyEffects();
  await consumeRuntimeEvents(
    source([
      turnStarted("r"),
      promptOpened("r", "p1"),
      promptClosed("r", "p1", "answered"),
      turnEnded("r", "completed"),
    ]),
    effects,
  );
  assert.deepEqual(rec.promptsOpened, ["p1"]);
  assert.deepEqual(rec.promptsClosed, [{ promptId: "p1", outcome: "answered" }]);
  // waiting while the prompt is open, back to running when it closes, idle on end.
  assert.deepEqual(rec.states, [
    "running",
    "waiting_for_input",
    "running",
    "idle",
  ]);
});

test("events_are_consumed_in_sequence_order", async () => {
  const { effects, rec } = spyEffects();
  await consumeRuntimeEvents(
    source([
      turnStarted("r"),
      delta("r", "f1"),
      delta("r", "f2"),
      turnEnded("r", "completed"),
    ]),
    effects,
  );
  assert.deepEqual(rec.log, [
    "state:running",
    "block:f1",
    "block:f2",
    "state:idle",
    "settle:completed",
  ]);
});
