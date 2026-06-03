import type { AgentId, ThreadScope } from "../thread/thread.ts";

export type ProviderReadinessBlockerKind =
  | "not_installed"
  | "not_authenticated"
  | "onboarding_required"
  | "directory_trust_required"
  | "provider_account_required"
  | "hook_bootstrap_required"
  | "unknown";

export type ProviderReadinessBlockerScope =
  | "provider"
  | "execution_context"
  | "integration";

export interface ProviderSetupSurfaceAction {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
  expectedCompletion: "process_exit" | "retry_preflight";
}

export interface ProviderReadinessBlocker {
  kind: ProviderReadinessBlockerKind;
  message: string;
  scope?: ProviderReadinessBlockerScope;
  action?: "open_terminal" | "open_provider" | "retry" | "none";
  setup?: ProviderSetupSurfaceAction;
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
