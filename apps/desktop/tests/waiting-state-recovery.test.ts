// Spec: docs_v2/specs/waiting-state-recovery.md
//
// Behavioral proof (drives the REAL live-projector) that a turn-end no longer
// force-settles a live, unanswered prompt card — the root of "the AskUserQuestion /
// permission card never showed and the thread sat stuck waiting". The projector ingests
// every CLI provider's structured events through this one path, so the guarantee is
// provider-agnostic.
//
// Why the projector and not just the service: recordTurnComplete already keeps a card on
// force=false and drops it on force=true (covered in backend-thread-agent-runtime-
// lifecycle). The regression lived in WHAT force the projector passed — a turn_completed
// carrying a notice (claude's history reader infers an empty turn-end mid-permission)
// used to pass force=true and drop the just-raised card. These tests pin the force the
// projector emits for each turn outcome.

import assert from "node:assert/strict";
import test from "node:test";

import { createLiveAgentSessionEventProjector } from "../src/backend/infrastructure/node/live/live-backend.ts";

const THREAD = "thread-wait";
const AGENT = "claude" as const;
const RUNTIME = "runtime-1";

const card = {
  kind: "approval" as const,
  threadId: THREAD,
  promptId: "p1",
  agentId: AGENT,
  message: "Allow command?",
  source: "provider_signal" as const,
  choices: [{ choiceId: "allow", label: "Allow", providerValue: "allow" }],
};

// A fake service that captures the `force` each recordTurnComplete receives and tracks
// whether a card is currently held — applying the SAME settle rule the real service
// uses (force OR no-prompt settles; otherwise the card is kept). That lets the test read
// the end-state ("is the card still up?") directly while pinning the projector's force.
function createProjectorFixture(options: { activeGoal?: boolean; queuedInputs?: string[] } = {}) {
  const forces: Array<boolean | undefined> = [];
  let promptState: typeof card | undefined;
  const thread = {
    threadId: THREAD,
    agentBinding: { agentId: AGENT },
    updatedAt: "t",
    queuedInputs: options.queuedInputs ?? [],
    goalState: options.activeGoal
      ? {
          objective: "finish the goal",
          status: "active" as const,
          provider: AGENT,
          updatedAt: "t",
        }
      : undefined,
  };
  const service = {
    async hydrateThread() {
      return { ok: true as const, thread, runtimeState: "running", blocks: [] };
    },
    peekThread() {
      return { ok: true as const, thread, runtimeState: "running", blocks: [] };
    },
    async appendRawAgentFrame(frame: Record<string, unknown>) {
      return { ...frame, frameId: "f1" };
    },
    async recordAgentSessionBlock() {},
    async recordProviderPromptState(input: { promptState: typeof card }) {
      promptState = input.promptState;
      return { ok: true as const, thread, promptState: input.promptState, runtimeState: "waiting_for_approval" };
    },
    async recordTurnComplete(input: { force?: boolean }) {
      forces.push(input.force);
      // Real settle rule: a card is dropped only on force, or when none is held.
      const settles = input.force === true || promptState === undefined;
      if (settles) promptState = undefined;
      return {
        ok: true as const,
        thread,
        runtimeState: settles ? "idle" : "waiting_for_approval",
      };
    },
  };
  const persistence = {
    async writeAgentSessionCache() {
      return { ok: true as const, value: {} };
    },
  };
  const projector = createLiveAgentSessionEventProjector({
    service: () => service as never,
    persistence: persistence as never,
    homeDir: "/tmp",
    integrations: {} as never,
  });
  return { projector, forces: () => forces, cardUp: () => promptState !== undefined };
}

test("a turn_completed does NOT force-settle a live card (the AskUserQuestion card survives)", async () => {
  const { projector, forces, cardUp } = createProjectorFixture();

  // Agent raises the question card → waiting.
  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: { kind: "prompt" as const, promptState: card },
  });
  assert.equal(cardUp(), true, "precondition: the card is up");

  // The turn then 'completes' (the empty/history-inferred end). Pre-fix this passed
  // force:true and dropped the card; now it must NOT force, so the card survives.
  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: { kind: "turn_completed" as const },
  });
  assert.deepEqual(forces(), [undefined], "turn-end must not force");
  assert.equal(cardUp(), true, "the card survives the turn-end — user can still answer it");
});

test("a turn_completed carrying a notice still does NOT force away a live card", async () => {
  // The exact regression path: claude's reader infers an empty turn-end mid-permission
  // and tags it with a notice. That notice used to flip force:true and drop the card.
  const { projector, forces, cardUp } = createProjectorFixture();
  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: { kind: "prompt" as const, promptState: card },
  });
  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: { kind: "turn_completed" as const, notice: "Out of credits" },
  });
  assert.deepEqual(forces(), [undefined], "a notice turn-end must not force");
  assert.equal(cardUp(), true, "the card survives a notice turn-end");
});

test("an active_goal_turn_completed_without_queue_keeps_the_goal_runtime_busy", async () => {
  const { projector, forces } = createProjectorFixture({ activeGoal: true });

  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: { kind: "turn_completed" as const },
  });

  assert.deepEqual(forces(), [], "active goal without queued input is not settled");
});

test("an active_goal_turn_completed_with_queue_flushes_the_waiting_follow_up", async () => {
  const { projector, forces } = createProjectorFixture({
    activeGoal: true,
    queuedInputs: ["run this next"],
  });

  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: { kind: "turn_completed" as const },
  });

  assert.deepEqual(forces(), [undefined], "queued input gets the normal turn-complete drain path");
});

test("a runtime_exited DOES force-settle the now-dead card", async () => {
  // The one case that must still force: the runtime is gone, so the card can never be
  // answered — settle it rather than strand the thread Working forever.
  const { projector, forces, cardUp } = createProjectorFixture();
  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: { kind: "prompt" as const, promptState: card },
  });
  await projector.ingestStructuredProviderEvent({
    threadId: THREAD,
    agentId: AGENT,
    runtimeId: RUNTIME,
    event: { kind: "runtime_exited" as const },
  });
  assert.ok(forces().includes(true), "runtime exit forces the settle");
  assert.equal(cardUp(), false, "the dead card is cleared on runtime exit");
});
