import type { AgentRuntimeState } from "./agent-runtime.ts";
import type { AgentRuntimeEvent, TurnEndReason } from "./agent-runtime-event.ts";

// The single provider-neutral consumption point for the Agent Runtime Event
// Spine. Given the per-runtime state and one ordered AgentRuntimeEvent, it
// returns the next state plus the effects the Backend service performs. All
// turn-lifecycle invariants live here, in one tested place, with zero
// provider-specific branching. See docs_v2/specs/agent-runtime-event-spine.md.

export interface RuntimeTurnState {
  runtimeId: string;
  lifecycle: AgentRuntimeState;
  // True between turn.started and the turn's single turn.ended.
  turnOpen: boolean;
  // Dedupe guard: a turn.ended is honored once per open turn; late/duplicate
  // provider signals (the codex "honored once" problem) are dropped here.
  endedForOpenTurn: boolean;
  // Open prompts keep the runtime in a waiting_* lifecycle until closed.
  openPromptIds: ReadonlySet<string>;
  // Last observed sequence; events must arrive in monotonic order per runtime.
  lastSequence: number;
}

export type RuntimeEffect =
  | { kind: "runtime_started"; providerSessionRefValue?: string }
  | { kind: "set_state"; state: AgentRuntimeState }
  | { kind: "block_update"; frameId: string }
  | { kind: "open_prompt"; promptId: string }
  | { kind: "close_prompt"; promptId: string; outcome: "answered" | "withdrawn" }
  | { kind: "settle_turn"; reason: TurnEndReason }
  | { kind: "runtime_exited"; expected: boolean };

export interface RuntimeReduction {
  state: RuntimeTurnState;
  effects: RuntimeEffect[];
}

export function initialRuntimeTurnState(runtimeId: string): RuntimeTurnState {
  return {
    runtimeId,
    lifecycle: "starting",
    turnOpen: false,
    endedForOpenTurn: false,
    openPromptIds: new Set<string>(),
    lastSequence: -1,
  };
}

function waitingStateForPromptKind(kind: string): AgentRuntimeState {
  return kind === "approval" || kind === "permission"
    ? "waiting_for_approval"
    : "waiting_for_input";
}

function lifecycleForTurnEnd(reason: TurnEndReason): AgentRuntimeState {
  return reason === "error" ? "failed" : "idle";
}

export function reduceRuntimeEvent(
  state: RuntimeTurnState,
  event: AgentRuntimeEvent,
): RuntimeReduction {
  // Ordering invariant (#4): drop out-of-order / duplicate-sequence events
  // rather than letting them corrupt lifecycle. Sources emit monotonically.
  if (event.sequence <= state.lastSequence) {
    return { state, effects: [] };
  }
  const base = { ...state, lastSequence: event.sequence };

  switch (event.type) {
    case "runtime.started": {
      return {
        state: base,
        effects: [
          {
            kind: "runtime_started",
            providerSessionRefValue: event.providerSessionRef?.value,
          },
        ],
      };
    }

    case "turn.started": {
      return {
        state: {
          ...base,
          lifecycle: "running",
          turnOpen: true,
          endedForOpenTurn: false,
          openPromptIds: new Set<string>(),
        },
        effects: [{ kind: "set_state", state: "running" }],
      };
    }

    case "output.delta": {
      return {
        state: base,
        effects: [{ kind: "block_update", frameId: event.frameId }],
      };
    }

    case "prompt.opened": {
      const next = new Set(base.openPromptIds);
      next.add(event.promptState.promptId);
      const lifecycle = waitingStateForPromptKind(event.promptState.kind);
      return {
        state: { ...base, openPromptIds: next, lifecycle },
        effects: [
          { kind: "set_state", state: lifecycle },
          { kind: "open_prompt", promptId: event.promptState.promptId },
        ],
      };
    }

    case "prompt.closed": {
      const next = new Set(base.openPromptIds);
      next.delete(event.promptId);
      // If the turn is still open and no prompts remain, return to running.
      const lifecycle =
        base.turnOpen && next.size === 0 ? "running" : base.lifecycle;
      const effects: RuntimeEffect[] = [
        { kind: "close_prompt", promptId: event.promptId, outcome: event.outcome },
      ];
      if (lifecycle !== base.lifecycle) {
        effects.unshift({ kind: "set_state", state: lifecycle });
      }
      return { state: { ...base, openPromptIds: next, lifecycle }, effects };
    }

    case "turn.ended": {
      // Dedupe (#2) + no-fabricated-settle (#5): only the first turn.ended for an
      // open turn settles. Late/duplicate signals are dropped with no effect.
      if (!base.turnOpen || base.endedForOpenTurn) {
        return { state: base, effects: [] };
      }
      const lifecycle = lifecycleForTurnEnd(event.reason);
      return {
        state: {
          ...base,
          turnOpen: false,
          endedForOpenTurn: true,
          openPromptIds: new Set<string>(),
          lifecycle,
        },
        effects: [
          { kind: "set_state", state: lifecycle },
          { kind: "settle_turn", reason: event.reason },
        ],
      };
    }

    case "runtime.exited": {
      const lifecycle: AgentRuntimeState = event.expected ? "stopped" : "failed";
      return {
        state: {
          ...base,
          turnOpen: false,
          lifecycle,
          openPromptIds: new Set<string>(),
        },
        effects: [
          { kind: "set_state", state: lifecycle },
          { kind: "runtime_exited", expected: event.expected },
        ],
      };
    }
  }
}
