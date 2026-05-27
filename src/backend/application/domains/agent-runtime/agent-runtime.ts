import type { AgentBinding, AgentId, ThreadId, ThreadScope } from "../thread/thread.ts";

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
  kind: "composer_input" | "prompt_answer";
  value: string;
  submittedAt: string;
  promptId?: string;
  choiceId?: string;
}

export interface AgentRuntimeStartInput {
  threadId: ThreadId;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
}

export interface AgentRuntimeResumeInput {
  threadId: ThreadId;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
}
