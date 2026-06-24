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

export interface TerminalInput {
  // "goal_set" pushes the thread goal to the provider's native goal mechanism;
  // `value` carries the objective (empty ⇒ clear). See
  // docs_v2/specs/thread-goal-and-checklist-panel.md.
  kind: "composer_input" | "prompt_answer" | "goal_set";
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
