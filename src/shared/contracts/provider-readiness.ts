import type { AgentId } from "./agent.ts";

export interface ProviderReadinessDto {
  agentId: AgentId;
  ready: boolean;
  blockers: ProviderReadinessBlockerDto[];
}

export interface ProviderReadinessBlockerDto {
  kind:
    | "not_installed"
    | "not_authenticated"
    | "onboarding_required"
    | "directory_trust_required"
    | "provider_account_required"
    | "hook_bootstrap_required"
    | "unknown";
  message: string;
  scope?: "provider" | "execution_context" | "integration";
  action?: "open_terminal" | "open_provider" | "retry" | "none";
  setup?: ProviderSetupSurfaceActionDto;
}

export interface ProviderSetupSurfaceActionDto {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
  expectedCompletion: "process_exit" | "retry_preflight";
}
