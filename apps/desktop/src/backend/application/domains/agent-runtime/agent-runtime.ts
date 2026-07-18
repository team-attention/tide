import type { AgentBinding, AgentId, ComposerAttachmentRef, PromptStepAnswer, ThreadId, ThreadScope } from "../thread/thread.ts";

export type AgentRuntimeState =
  | "not_started"
  | "starting"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "idle"
  | "stopping"
  | "stopped"
  | "failed";

export interface AgentRuntimeHandle {
  runtimeId: string;
  threadId: ThreadId;
  agentId: AgentId;
}

// Tide owns one stable identity for a Composer delivery across queueing,
// provider dispatch, acknowledgement, restart reconciliation, and rendering.
// It is intentionally provider-neutral; adapters map it to their native field.
export type AgentDeliveryId = string;

export type AgentDeliveryState =
  | "queued"
  | "dispatching"
  | "working_unconfirmed"
  | "acknowledged"
  | "completed"
  | "interrupted"
  | "failed"
  | "indeterminate";

export type ProviderTurnTerminalStatus =
  | "completed"
  | "interrupted"
  | "failed"
  | "cancelled"
  | "max_tokens"
  | "refusal"
  | "unknown";

export interface AgentRuntimeDispatchResult {
  deliveryId: AgentDeliveryId;
  state: "working_unconfirmed" | "acknowledged";
  providerMessageId?: string;
  providerTurnId?: string;
}

export interface TerminalInput {
  // "goal_set" pushes the thread goal to the provider's native goal mechanism;
  // `value` carries the objective (empty ⇒ clear). See
  // docs_v2/specs/thread-goal-and-checklist-panel.md.
  kind: "composer_input" | "prompt_answer" | "goal_set";
  // Required on every real Composer delivery. Optional only for legacy callers
  // and non-Composer control writes while old persisted state is migrated.
  deliveryId?: AgentDeliveryId;
  value: string;
  submittedAt: string;
  promptId?: string;
  choiceId?: string;
  // Free-text note on a single-question AskUserQuestion answer (→ claude annotations).
  notes?: string;
  // Multi-step prompt (wizard) answers, one per step. Forwarded to the structured write.
  stepAnswers?: PromptStepAnswer[];
  attachments?: ComposerAttachmentRef[];
}

export interface AgentRuntimeStartInput {
  threadId: ThreadId;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
  // First user message, delivered to provider CLIs as the launch-time initial
  // prompt (see AgentStartPlanInput.initialPrompt).
  initialPrompt?: string;
  initialDeliveryId?: AgentDeliveryId;
  // Tide-owned thread goal, applied to the provider before the first prompt where
  // the structured protocol supports it.
  initialGoal?: string;
  initialAttachments?: ComposerAttachmentRef[];
}

export interface AgentRuntimeResumeInput {
  threadId: ThreadId;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
  // The thread's CURRENT Launch Options. A resume respawn must honor options
  // changed since the original launch (model/permission/effort), not the ones
  // the session was first started with. See
  // docs_v2/specs/mid-thread-launch-option-changes.md.
  launchOptions?: Record<string, unknown>;
}

// A mid-thread Launch Options change to apply to a LIVE runtime session.
export interface AgentSessionConfigInput {
  // The thread's full merged Launch Options after the change.
  launchOptions: Record<string, unknown>;
  // Which option keys actually changed (e.g. ["model"]).
  changedKeys: string[];
}

// "applied" = the running session now uses the new options (protocol-native
// update). "restart_required" = the protocol cannot reconfigure the live
// session; the caller must restart the runtime (provider-native resume) before
// the next turn.
export type AgentSessionConfigResult = "applied" | "restart_required";

export type AgentRuntimeCapabilityInvoke =
  | { kind: "provider_method"; method: string; params?: unknown }
  | { kind: "provider_prompt_text"; text: string }
  | { kind: "provider_structured_prompt_metadata"; metadata: unknown }
  | { kind: "provider_config"; key: string; value?: unknown }
  | { kind: "tide_surface"; surface: string; payload?: unknown }
  | { kind: "unsupported"; reason: string };

export interface AgentRuntimeCapabilityInvocationInput {
  capabilityId: string;
  invoke: AgentRuntimeCapabilityInvoke;
  params?: unknown;
}

export type AgentRuntimeCapabilityInvocationResult =
  | { status: "handled"; result?: unknown }
  | { status: "unsupported"; reason: string };
