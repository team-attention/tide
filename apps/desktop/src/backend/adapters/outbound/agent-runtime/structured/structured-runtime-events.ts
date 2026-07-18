// The normalized event stream a STRUCTURED provider runtime emits to the
// projector. This is the runtime-event spine realized: with the structured
// machine protocols (claude stream-json control protocol, codex app-server,
// opencode ACP) these events are produced NATIVELY by the provider — never
// inferred from PTY scrapes, hook spools, or history-file polling.
//
// Every shape here is evidence-based from provider runtime frames and redacted
// fixtures summarized in docs_v2/specs/structured-agent-runtime.md. Do not
// extend from memory.
import type { ComposerAttachmentRef, PromptState, PromptStepAnswer } from "../../../../application/domains/thread/thread.ts";
import type { DiscoveredProviderSessionRef } from "../../../../application/ports/outbound/agent-integration-port.ts";
import type { AgentRuntimeRateLimitDto } from "../../../../../shared/contracts/agent-runtime.ts";
import type {
  AgentRuntimeDispatchResult,
  AgentRuntimeCapabilityInvocationInput,
  AgentRuntimeCapabilityInvocationResult,
} from "../../../../application/domains/agent-runtime/agent-runtime.ts";
import type { ProviderTurnTerminalStatus } from "../../../../application/domains/agent-runtime/agent-runtime.ts";

export type StructuredProviderId = "codex" | "claude" | "opencode" | "qwen";

export function normalizeProviderTerminalStatus(
  _provider: StructuredProviderId,
  nativeStatus: string | undefined,
): { status: ProviderTurnTerminalStatus; nativeStatus: string } {
  const native = nativeStatus?.trim() || "unknown";
  switch (native) {
    case "completed":
    case "end_turn":
    case "success":
      return { status: "completed", nativeStatus: native };
    case "interrupted":
    case "aborted":
    case "aborted_streaming":
      return { status: "interrupted", nativeStatus: native };
    case "failed":
    case "error":
    case "error_during_execution":
      return { status: "failed", nativeStatus: native };
    case "cancelled":
    case "canceled":
      return { status: "cancelled", nativeStatus: native };
    case "max_tokens":
      return { status: "max_tokens", nativeStatus: native };
    case "refusal":
      return { status: "refusal", nativeStatus: native };
    default:
      return { status: "unknown", nativeStatus: native };
  }
}

export type StructuredProviderEvent =
  // Provider bootstrap metadata from a structured runtime initialize handshake.
  // This is especially important for ACP-family providers that may reject
  // session/new until auth is configured: Tide still needs the provider's
  // declared auth methods and capabilities to render the setup surface.
  | {
      kind: "provider_capabilities";
      protocolVersion?: number;
      agentInfo?: Record<string, unknown>;
      authMethods?: unknown[];
      agentCapabilities?: Record<string, unknown>;
      nativePayload?: Record<string, unknown>;
    }
  // The provider announced (or confirmed) its session identity.
  | { kind: "session_ref"; ref: DiscoveredProviderSessionRef }
  // A provider-native turn started without Tide necessarily initiating it. Native
  // goal runners can continue turns on their own after stop-hook evaluation.
  | { kind: "delivery_acknowledged"; deliveryId: string; providerMessageId?: string; providerTurnId?: string }
  | { kind: "turn_started"; turnId?: string; deliveryId?: string }
  // Provider-native goal runner state changed or cleared.
  | { kind: "goal_updated"; goal: StructuredGoalState }
  | { kind: "goal_cleared" }
  // One conversation record (message / reasoning / tool_call / tool_result).
  // `payload` uses the SAME shapes the provider history connectors emit, so the
  // existing frame→block reader pipeline renders it unchanged. This is the
  // FINAL, persisted form of a block.
  | {
      kind: "content_record";
      sourceRef: string;
      payload: Record<string, unknown>;
      body: string;
    }
  // A live STREAMING update for an in-flight message/reasoning block. UI-only:
  // it upserts the block (text flows token-by-token) WITHOUT the reader/persist
  // pipeline — per-token disk writes would blow the perf budget. The matching
  // `content_record` (SAME blockId) finalizes + persists when the block
  // completes. Carries the full accumulated body each time (idempotent upsert).
  | {
      kind: "content_delta";
      blockId: string;
      role: "agent" | "reasoning";
      blockKind: "agent_message" | "reasoning";
      body: string;
    }
  // The provider is waiting on the user (tool permission, question). The
  // runtime client constructs the full PromptState — including choice values it
  // can route back as a structured response (no keystrokes).
  | { kind: "prompt"; promptState: PromptState }
  // The provider withdrew a pending interaction (e.g. interrupt cancelled it).
  | { kind: "prompt_withdrawn"; promptId: string }
  // The provider's available slash-commands / skills (claude init slash_commands
  // + skills, codex skills/list, ACP available_commands_update). Surfaced in
  // the composer "/" (commands) and "$" (skills) menus.
  | {
      kind: "commands";
      commands: Array<{ name: string; description: string; trigger: "/" | "$" }>;
    }
  // The provider self-reported its model catalog over the protocol — the ACP
  // `session/new.models` (availableModels/currentModelId) or opencode's
  // configOptions model category. Surfaces the live current model + the real
  // available list so the composer menu is accurate, not a drifted static guess.
  | {
      kind: "model_catalog";
      models: Array<{ value: string; label: string; vendor?: string }>;
      currentModel?: string;
    }
  // The provider reported usage/quota outside turn completion. Some protocols can
  // emit rate-limit state after the result message, so this must be separate.
  | {
      kind: "usage";
      usage: {
        inputTokens?: number;
        outputTokens?: number;
        contextTokens?: number;
        contextWindow?: number;
        totalTokens?: number;
        rateLimits?: AgentRuntimeRateLimitDto[];
      };
    }
  // Live in-flight-turn progress the provider stream renders elsewhere (or not at
  // all): a Claude `Task` fan-out's nested subagent counts (Slice B, from the
  // on-disk side-channel watcher) and/or codex/ACP plan step progress (Slice B′).
  // Surfaced in the Working indicator. See live-turn-activity-visibility.md.
  | {
      kind: "live_activity";
      nestedAgents?: number;
      nestedToolCalls?: number;
      planTotal?: number;
      planCompleted?: number;
    }
  // A non-blocking, out-of-band notice from the runtime process (currently an
  // "update available" banner the CLI printed to stderr). Surfaced as a native
  // OS notification, never a transcript block.
  | { kind: "runtime_notice"; level: "info"; message: string }
  // The turn ended. `notice` carries a user-visible failure/limit message.
  | {
      kind: "turn_completed";
      status: ProviderTurnTerminalStatus;
      nativeStatus: string;
      turnId?: string;
      deliveryId?: string;
      notice?: string;
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        contextTokens?: number;
        contextWindow?: number;
        totalTokens?: number;
        rateLimits?: AgentRuntimeRateLimitDto[];
      };
    }
  // The runtime process exited (crash or normal end-of-session).
  | { kind: "runtime_exited"; exitCode: number | null; activeDeliveryId?: string };

export interface StructuredRuntimeClient {
  // Resolves only after the transport can accept a Composer dispatch. Codex and
  // ACP wait for session adoption; Claude resolves on successful spawn because
  // its protocol emits no init frame before the first user message.
  ready(): Promise<void>;
  // Routes composer input and prompt answers to the protocol.
  write(input: StructuredRuntimeWrite): Promise<AgentRuntimeDispatchResult | void>;
  // Apply a live session reconfiguration (mid-thread Launch Options change).
  // `protocolParams` are the provider-protocol values produced by the Agent
  // Integration's buildSessionConfigUpdate (claude control_request fields /
  // codex turn/start overrides / ACP modeId). Clients without this method
  // cannot be live-reconfigured (the runtime port reports restart_required).
  // Resolves true when the change was accepted live, false when the provider
  // REFUSED it (or never acked) so the caller can fall back to a restart — e.g.
  // claude refuses a live switch to bypassPermissions unless launched capable.
  applyConfig?(protocolParams: Record<string, unknown>): Promise<boolean>;
  invokeCapability?(
    input: AgentRuntimeCapabilityInvocationInput,
  ): Promise<AgentRuntimeCapabilityInvocationResult>;
  // Abort the in-flight turn via the provider's protocol interrupt, leaving the
  // process ALIVE and resumable (claude control_request:interrupt / codex
  // turn/interrupt / ACP session/cancel). The provider emits its turn-end so
  // the thread settles; the next message reuses this same session.
  interrupt(): Promise<void>;
  // Tear the process down (thread teardown / duplicate-runtime reap).
  stop(): Promise<void>;
  pid?: number;
}

export type StructuredRuntimeWrite =
  | { kind: "composer_input"; value: string; deliveryId?: string; attachments?: ComposerAttachmentRef[] }
  // Push the user's thread goal to the provider's native goal mechanism. Empty
  // `objective` clears the goal. codex maps this to thread/goal/set|clear; claude
  // sends `/goal <objective>`; ACP clients inject a goal preamble (no native goal).
  // See specs/thread-goal-and-checklist-panel.md.
  | { kind: "goal_set"; objective: string }
  | {
      kind: "prompt_answer";
      promptId?: string;
      choiceId?: string;
      value: string;
      // Free-text note on a single-question AskUserQuestion answer (→ claude annotations).
      notes?: string;
      // A multi-step prompt (wizard) submits one answer per step here. When present the
      // client builds the full provider answer set from it; `value`/`choiceId` are the
      // single-prompt path. See multi-step-prompt-navigation.md.
      stepAnswers?: PromptStepAnswer[];
    };

export type StructuredGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usage_limited"
  | "budget_limited"
  | "complete";

export type StructuredGoalProvider = "codex" | "claude" | "fallback";

export interface StructuredGoalState {
  objective: string;
  status: StructuredGoalStatus;
  provider: StructuredGoalProvider;
  createdAt?: string;
  updatedAt?: string;
  tokenBudget?: number;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  lastReason?: string;
}

export interface StructuredClientCallbacks {
  onEvent: (event: StructuredProviderEvent) => void;
}
