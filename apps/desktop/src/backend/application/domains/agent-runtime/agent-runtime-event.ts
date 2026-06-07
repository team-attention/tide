import type { AgentId, PromptState, ThreadId } from "../thread/thread.ts";
import type { ProviderSessionRef } from "../thread/thread.ts";

// The normalized, typed, ordered control/lifecycle event an Agent Runtime emits.
// Each Agent Integration owns one AgentRuntimeEventSource per runtime and fuses
// its own Provider Signals (PTY transcript, hooks, rollout/transcript history,
// MCP) into this single stream. Nothing above the provider adapter knows about
// rollout files or stop hooks. See docs_v2/specs/agent-runtime-event-spine.md.

export type TurnEndReason = "completed" | "aborted" | "error" | "interrupted";

export type TurnStartCause = "initial" | "follow_up" | "prompt_answer";

export interface AgentRuntimeEventBase {
  runtimeId: string;
  threadId: ThreadId;
  // Provider identity for telemetry/labels only — never for service branching.
  agentId: AgentId;
  // Monotonic order within one runtime's event stream.
  sequence: number;
  observedAt: string;
}

export type AgentRuntimeEvent =
  | (AgentRuntimeEventBase & {
      type: "runtime.started";
      providerSessionRef?: ProviderSessionRef;
    })
  | (AgentRuntimeEventBase & {
      type: "turn.started";
      cause: TurnStartCause;
      inputRef?: string;
    })
  | (AgentRuntimeEventBase & {
      type: "output.delta";
      // References a RawAgentFrame already appended through the frame->block path.
      frameId: string;
    })
  | (AgentRuntimeEventBase & {
      type: "prompt.opened";
      promptState: PromptState;
    })
  | (AgentRuntimeEventBase & {
      type: "prompt.closed";
      promptId: string;
      outcome: "answered" | "withdrawn";
    })
  | (AgentRuntimeEventBase & {
      type: "turn.ended";
      reason: TurnEndReason;
    })
  | (AgentRuntimeEventBase & {
      type: "runtime.exited";
      code?: number;
      signal?: string;
      expected: boolean;
    });

export type AgentRuntimeEventType = AgentRuntimeEvent["type"];

// Provider In-Session Command suggestion for the Composer slash/options menu.
// Values stay provider-native; Tide does not normalize them across providers.
export interface InSessionCommand {
  // Provider-native trigger, e.g. "/model", "/approvals", "$shell".
  trigger: string;
  label: string;
  description?: string;
}
