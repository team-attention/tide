import type { AgentId, ThreadScope } from "../thread/thread.ts";

export type ProviderReadinessBlockerKind =
  | "not_installed"
  | "not_authenticated"
  | "onboarding_required"
  | "directory_trust_required"
  | "hook_bootstrap_required"
  | "unknown";

export interface ProviderReadinessBlocker {
  kind: ProviderReadinessBlockerKind;
  message: string;
  action?: "open_terminal" | "open_provider" | "retry" | "none";
}

export interface ProviderReadinessResult {
  agentId: AgentId;
  ready: boolean;
  blockers: ProviderReadinessBlocker[];
}

export interface ProviderReadinessCheckInput {
  agentId: AgentId;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
}
