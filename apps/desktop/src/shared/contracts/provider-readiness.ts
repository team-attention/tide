import type { AgentId } from "./agent.ts";

export interface ProviderReadinessDto {
  agentId: AgentId;
  ready: boolean;
  blockers: ProviderReadinessBlockerDto[];
  // A non-blocking "a newer CLI is published" advisory. Present only when the
  // installed version is known to be older than the latest npm version. It never
  // affects `ready`: an outdated-but-working CLI still starts Threads. Spec:
  // version-management.md (Lane 2).
  update?: ProviderUpdateAdvisoryDto;
}

export interface ProviderUpdateAdvisoryDto {
  currentVersion: string;
  latestVersion: string;
  // The readiness terminal action that updates the CLI in place, present only
  // when Tide can prove a safe updater for the resolved executable.
  terminalAction?: ProviderReadinessTerminalActionDto;
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
  terminalAction?: ProviderReadinessTerminalActionDto;
}

export interface ProviderReadinessTerminalActionDto {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
  expectedCompletion: "process_exit" | "retry_preflight";
}
