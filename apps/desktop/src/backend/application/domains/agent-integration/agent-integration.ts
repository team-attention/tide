import type { PromptState } from "../thread/thread.ts";
import type {
  ProviderReadinessBlockerKind,
  ProviderReadinessBlockerScope,
  ProviderSetupSurfaceAction,
} from "../provider-readiness/provider-readiness.ts";
import type {
  AgentBinding,
  ProviderCliAgentId,
  ProviderSessionRef,
  ThreadId,
  ThreadScope,
} from "../thread/thread.ts";

export type ProviderSignalSourceKind =
  | "pty_transcript"
  | "provider_hook"
  | "provider_history"
  | "tide_mcp";

export interface ProviderSignalSource {
  kind: ProviderSignalSourceKind;
  description: string;
}

export interface AgentIntegrationCapabilities {
  supportsHiddenPty: boolean;
  supportsResume: boolean;
  supportsTideMcp: boolean;
  supportsHooks: boolean;
  supportsReadableHistory: boolean;
  requiresTerminalKeyProtocol: boolean;
}

export interface ProviderLaunchPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  inputTiming?: {
    startupDelayMs?: number;
    preSubmitDelayMs?: number;
  };
  expectedSignalSources: ProviderSignalSource[];
}

export interface AgentIntegrationReadinessBlocker {
  kind: ProviderReadinessBlockerKind;
  scope: ProviderReadinessBlockerScope;
  message: string;
  setup?: ProviderSetupSurfaceAction;
}

export type {
  ProviderReadinessBlockerKind,
  ProviderReadinessBlockerScope,
  ProviderSetupSurfaceAction,
} from "../provider-readiness/provider-readiness.ts";

export interface AgentIntegrationPreflightInput {
  agentId: ProviderCliAgentId;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
}

export interface AgentIntegrationPreflightResult {
  agentId: ProviderCliAgentId;
  ready: boolean;
  blockers: AgentIntegrationReadinessBlocker[];
  capabilities: AgentIntegrationCapabilities;
  launchPlan?: ProviderLaunchPlan;
}

export interface AgentStartPlanInput {
  agentId: ProviderCliAgentId;
  agentBinding?: AgentBinding;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
  // The first user message, embedded into the launch as the provider's initial
  // prompt so the session starts a turn immediately (typing it into the TUI
  // after launch is unreliable).
  initialPrompt?: string;
}

export interface AgentResumePlanInput {
  agentId: ProviderCliAgentId;
  providerSessionRef: ProviderSessionRef;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
}

export interface AgentPromptSignalInput {
  threadId: ThreadId;
  source: "pty_transcript" | "provider_hook" | "provider_history";
  eventName?: string;
  payload?: unknown;
  text?: string;
}

export interface AgentIntegrationPort {
  preflight(
    input: AgentIntegrationPreflightInput,
  ): Promise<AgentIntegrationPreflightResult>;
  buildStartPlan(input: AgentStartPlanInput): Promise<ProviderLaunchPlan>;
  buildResumePlan(input: AgentResumePlanInput): Promise<ProviderLaunchPlan>;
  detectPromptState(input: AgentPromptSignalInput): PromptState | null;
}
