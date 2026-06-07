import assert from "node:assert/strict";
import test from "node:test";

import {
  initialRuntimeTurnState,
  reduceRuntimeEvent,
  type RuntimeEffect,
  type RuntimeTurnState,
} from "../src/backend/application/domains/agent-runtime/runtime-turn-reducer.ts";
import type {
  AgentRuntimeEvent,
  InSessionCommand,
} from "../src/backend/application/domains/agent-runtime/agent-runtime-event.ts";
import type { AgentRuntimeEventSource } from "../src/backend/application/ports/outbound/agent-runtime-event-source-port.ts";
import type { PromptState } from "../src/backend/application/domains/thread/thread.ts";
import type { TerminalInput } from "../src/backend/application/domains/agent-runtime/agent-runtime.ts";

let seq = 0;
function ev(
  partial: Omit<AgentRuntimeEvent, "runtimeId" | "threadId" | "agentId" | "sequence" | "observedAt"> & {
    runtimeId?: string;
    sequence?: number;
  },
): AgentRuntimeEvent {
  const { runtimeId = "rt-1", sequence, ...rest } = partial;
  return {
    runtimeId,
    threadId: "th-1",
    agentId: "codex",
    sequence: sequence ?? (seq += 1),
    observedAt: new Date(seq).toISOString(),
    ...rest,
  } as AgentRuntimeEvent;
}

function promptState(promptId: string, kind: PromptState["kind"]): PromptState {
  return {
    promptId,
    threadId: "th-1",
    agentId: "codex",
    kind,
    message: "needs action",
    source: "provider_hook",
  };
}

// Fold a sequence of events through the reducer, collecting all effects.
function run(
  state: RuntimeTurnState,
  events: AgentRuntimeEvent[],
): { state: RuntimeTurnState; effects: RuntimeEffect[] } {
  let current = state;
  const effects: RuntimeEffect[] = [];
  for (const event of events) {
    const result = reduceRuntimeEvent(current, event);
    current = result.state;
    effects.push(...result.effects);
  }
  return { state: current, effects };
}

const settleEffects = (effects: RuntimeEffect[]) =>
  effects.filter((e) => e.kind === "settle_turn");

test("reducer_maps_events_to_lifecycle_without_provider_branch", () => {
  seq = 0;
  const { state, effects } = run(initialRuntimeTurnState("rt-1"), [
    ev({ type: "runtime.started" }),
    ev({ type: "turn.started", cause: "initial" }),
    ev({ type: "output.delta", frameId: "f1" }),
    ev({ type: "turn.ended", reason: "completed" }),
  ]);
  assert.equal(state.lifecycle, "idle");
  assert.equal(state.turnOpen, false);
  assert.ok(effects.some((e) => e.kind === "block_update" && e.frameId === "f1"));
  assert.equal(settleEffects(effects).length, 1);
});

test("fused_signals_resolve_to_single_turn_ended", () => {
  seq = 0;
  // The provider adapter may fuse stop-hook + rollout signals; if both leak as
  // two turn.ended events the reducer still settles exactly once.
  const { effects } = run(initialRuntimeTurnState("rt-1"), [
    ev({ type: "turn.started", cause: "initial" }),
    ev({ type: "turn.ended", reason: "completed" }),
    ev({ type: "turn.ended", reason: "completed" }),
  ]);
  assert.equal(settleEffects(effects).length, 1);
});

test("turn_ended_emits_settle_effect_for_queue_flush", () => {
  seq = 0;
  const { effects } = run(initialRuntimeTurnState("rt-1"), [
    ev({ type: "turn.started", cause: "follow_up" }),
    ev({ type: "turn.ended", reason: "completed" }),
  ]);
  const settle = settleEffects(effects);
  assert.equal(settle.length, 1);
  assert.equal(settle[0]?.kind === "settle_turn" && settle[0].reason, "completed");
});

test("interrupt_turn_ended_settles_like_completion", () => {
  seq = 0;
  const { state, effects } = run(initialRuntimeTurnState("rt-1"), [
    ev({ type: "turn.started", cause: "initial" }),
    ev({ type: "turn.ended", reason: "interrupted" }),
  ]);
  assert.equal(state.lifecycle, "idle");
  const settle = settleEffects(effects);
  assert.equal(settle[0]?.kind === "settle_turn" && settle[0].reason, "interrupted");
});

test("error_turn_end_settles_to_failed", () => {
  seq = 0;
  const { state, effects } = run(initialRuntimeTurnState("rt-1"), [
    ev({ type: "turn.started", cause: "initial" }),
    ev({ type: "turn.ended", reason: "error" }),
  ]);
  assert.equal(state.lifecycle, "failed");
  assert.equal(settleEffects(effects).length, 1);
});

test("runtime_without_turn_end_does_not_auto_settle", () => {
  seq = 0;
  // No turn.ended observed: the reducer must never fabricate a settle (#5).
  const { state, effects } = run(initialRuntimeTurnState("rt-1"), [
    ev({ type: "turn.started", cause: "initial" }),
    ev({ type: "output.delta", frameId: "f1" }),
    ev({ type: "output.delta", frameId: "f2" }),
  ]);
  assert.equal(state.turnOpen, true);
  assert.equal(state.lifecycle, "running");
  assert.equal(settleEffects(effects).length, 0);
});

test("stray_turn_ended_without_open_turn_is_dropped", () => {
  seq = 0;
  const { effects } = run(initialRuntimeTurnState("rt-1"), [
    ev({ type: "turn.ended", reason: "completed" }),
  ]);
  assert.equal(settleEffects(effects).length, 0);
});

test("two_runtimes_keep_independent_turn_lifecycles", () => {
  seq = 0;
  let a = initialRuntimeTurnState("rt-a");
  let b = initialRuntimeTurnState("rt-b");
  // Interleave two runtimes; ending rt-a must not settle rt-b.
  a = reduceRuntimeEvent(a, ev({ runtimeId: "rt-a", type: "turn.started", cause: "initial" })).state;
  b = reduceRuntimeEvent(b, ev({ runtimeId: "rt-b", type: "turn.started", cause: "initial" })).state;
  const aEnd = reduceRuntimeEvent(a, ev({ runtimeId: "rt-a", type: "turn.ended", reason: "completed" }));
  a = aEnd.state;
  assert.equal(a.lifecycle, "idle");
  assert.equal(b.turnOpen, true);
  assert.equal(b.lifecycle, "running");
});

test("prompt_opened_then_closed_round_trip", () => {
  seq = 0;
  const { state, effects } = run(initialRuntimeTurnState("rt-1"), [
    ev({ type: "turn.started", cause: "initial" }),
    ev({ type: "prompt.opened", promptState: promptState("p1", "question") }),
  ]);
  assert.equal(state.lifecycle, "waiting_for_input");
  assert.ok(effects.some((e) => e.kind === "open_prompt" && e.promptId === "p1"));

  const closed = run(state, [
    ev({ type: "prompt.closed", promptId: "p1", outcome: "answered" }),
  ]);
  // Turn still open with no remaining prompts -> back to running.
  assert.equal(closed.state.lifecycle, "running");
  assert.ok(closed.effects.some((e) => e.kind === "close_prompt" && e.promptId === "p1"));
});

test("approval_prompt_enters_waiting_for_approval", () => {
  seq = 0;
  const { state } = run(initialRuntimeTurnState("rt-1"), [
    ev({ type: "turn.started", cause: "initial" }),
    ev({ type: "prompt.opened", promptState: promptState("p1", "approval") }),
  ]);
  assert.equal(state.lifecycle, "waiting_for_approval");
});

test("events_are_consumed_in_sequence_order", () => {
  seq = 0;
  // An out-of-order (stale sequence) event is dropped, not applied.
  let state = initialRuntimeTurnState("rt-1");
  state = reduceRuntimeEvent(state, ev({ type: "turn.started", cause: "initial", sequence: 5 })).state;
  const stale = reduceRuntimeEvent(state, ev({ type: "turn.ended", reason: "completed", sequence: 3 }));
  assert.equal(stale.effects.length, 0);
  assert.equal(stale.state.turnOpen, true);
});

test("service_consumes_one_uniform_stream_from_event_source", async () => {
  seq = 0;
  // A fake AgentRuntimeEventSource proves the port shape and that a single
  // consumer can fold the reducer over events() with no provider branching.
  const scripted: AgentRuntimeEvent[] = [
    ev({ type: "runtime.started" }),
    ev({ type: "turn.started", cause: "initial" }),
    ev({ type: "output.delta", frameId: "f1" }),
    ev({ type: "turn.ended", reason: "completed" }),
  ];
  const source: AgentRuntimeEventSource = {
    runtimeId: "rt-1",
    async *events() {
      for (const event of scripted) {
        yield event;
      }
    },
    async submit(_input: TerminalInput) {},
    async interrupt() {},
    async queryCommands(_prefix: string): Promise<InSessionCommand[]> {
      return [];
    },
    async stop() {},
  };

  let state = initialRuntimeTurnState(source.runtimeId);
  const effects: RuntimeEffect[] = [];
  for await (const event of source.events()) {
    const result = reduceRuntimeEvent(state, event);
    state = result.state;
    effects.push(...result.effects);
  }
  assert.equal(state.lifecycle, "idle");
  assert.equal(settleEffects(effects).length, 1);
});
