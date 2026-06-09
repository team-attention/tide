import type { AgentRuntimeState } from "./agent-runtime.ts";
import type { AgentRuntimeEvent, TurnEndReason } from "./agent-runtime-event.ts";
import {
  initialRuntimeTurnState,
  reduceRuntimeEvent,
  type RuntimeEffect,
  type RuntimeTurnState,
} from "./runtime-turn-reducer.ts";

// The provider-neutral driver of the Agent Runtime Event Spine. It consumes one
// ordered AgentRuntimeEvent stream (from ANY source — a fake, or a real per-adapter
// AgentRuntimeEventSource), threads each event through the pure reducer, and
// dispatches the resulting effects to an injected effects handler. It contains zero
// provider-specific branching: every provider asymmetry already collapsed into the
// typed event before it arrives here. See docs_v2/specs/agent-runtime-event-spine.md.
//
// The effects handler is where Backend wiring (real service ops) or a test spy
// lives. Keeping the consumer pure of service/IO makes the whole turn lifecycle
// unit-testable against a fake source.

export interface RuntimeEventContext {
  threadId: string;
  runtimeId: string;
  agentId: string;
}

export interface RuntimeEventEffects {
  onRuntimeStarted(
    context: RuntimeEventContext,
    providerSessionRefValue: string | undefined,
  ): void | Promise<void>;
  onStateChanged(
    context: RuntimeEventContext,
    state: AgentRuntimeState,
  ): void | Promise<void>;
  onBlockUpdate(
    context: RuntimeEventContext,
    frameId: string,
  ): void | Promise<void>;
  onPromptOpened(
    context: RuntimeEventContext,
    promptId: string,
  ): void | Promise<void>;
  onPromptClosed(
    context: RuntimeEventContext,
    promptId: string,
    outcome: "answered" | "withdrawn",
  ): void | Promise<void>;
  onTurnSettled(
    context: RuntimeEventContext,
    reason: TurnEndReason,
  ): void | Promise<void>;
  onRuntimeExited(
    context: RuntimeEventContext,
    expected: boolean,
  ): void | Promise<void>;
}

export interface RuntimeEventSourceLike {
  events(): AsyncIterable<AgentRuntimeEvent>;
}

async function applyEffect(
  effect: RuntimeEffect,
  context: RuntimeEventContext,
  effects: RuntimeEventEffects,
): Promise<void> {
  switch (effect.kind) {
    case "runtime_started":
      await effects.onRuntimeStarted(context, effect.providerSessionRefValue);
      return;
    case "set_state":
      await effects.onStateChanged(context, effect.state);
      return;
    case "block_update":
      await effects.onBlockUpdate(context, effect.frameId);
      return;
    case "open_prompt":
      await effects.onPromptOpened(context, effect.promptId);
      return;
    case "close_prompt":
      await effects.onPromptClosed(context, effect.promptId, effect.outcome);
      return;
    case "settle_turn":
      await effects.onTurnSettled(context, effect.reason);
      return;
    case "runtime_exited":
      await effects.onRuntimeExited(context, effect.expected);
      return;
  }
}

// Drive one runtime's event stream to completion. Per-runtime turn state is keyed by
// runtimeId in `states`, so a shared map across concurrent runtimes keeps their
// lifecycles independent (each event only ever touches its own runtime's state).
export async function consumeRuntimeEvents(
  source: RuntimeEventSourceLike,
  effects: RuntimeEventEffects,
  states: Map<string, RuntimeTurnState> = new Map<string, RuntimeTurnState>(),
): Promise<void> {
  for await (const event of source.events()) {
    const previous =
      states.get(event.runtimeId) ?? initialRuntimeTurnState(event.runtimeId);
    const { state, effects: produced } = reduceRuntimeEvent(previous, event);
    states.set(event.runtimeId, state);
    const context: RuntimeEventContext = {
      threadId: event.threadId,
      runtimeId: event.runtimeId,
      agentId: event.agentId,
    };
    for (const effect of produced) {
      await applyEffect(effect, context, effects);
    }
  }
}
