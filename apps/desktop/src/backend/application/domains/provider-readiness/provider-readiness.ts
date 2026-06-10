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

// A focused, backend-only summary of the provider's runtime capabilities,
// surfaced through the readiness check so the service can route follow-up input
// correctly (e.g. mid-turn steer). NOT part of the renderer DTO — the renderer
// never needs it; the backend decides on the basis of it.
export interface ProviderRuntimeCapabilitySummary {
  // The provider can inject new input into the active turn (codex turn/steer).
  supportsTurnSteer: boolean;
}

export interface ProviderReadinessResult {
  agentId: AgentId;
  ready: boolean;
  blockers: ProviderReadinessBlocker[];
  // Present for Provider CLI agents (derived from the integration's declared
  // capabilities). Absent for Tide API agents.
  capabilities?: ProviderRuntimeCapabilitySummary;
}

export interface ProviderReadinessCheckInput {
  agentId: AgentId;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
}
