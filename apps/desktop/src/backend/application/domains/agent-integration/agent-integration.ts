import type {
  ProviderReadinessBlockerKind,
  ProviderReadinessBlockerScope,
  ProviderSetupSurfaceAction,
} from "../provider-readiness/provider-readiness.ts";
import type {
  AgentBinding,
  ProviderCliAgentId,
  ProviderSessionRef,
  ThreadScope,
} from "../thread/thread.ts";

export interface AgentIntegrationCapabilities {
  supportsResume: boolean;
  supportsTideMcp: boolean;
  supportsHooks: boolean;
  supportsReadableHistory: boolean;
  // The provider protocol can inject new user input INTO an already-running turn
  // (mid-turn steer), instead of forcing the input to wait for the turn to end.
  // Evidence-based: ONLY codex declares this — its app-server exposes turn/steer
  // {threadId, input, expectedTurnId}. claude/gemini/opencode have no mid-turn
  // injection primitive, so their follow-up input queues until the turn settles.
  supportsTurnSteer: boolean;
}

export interface ProviderLaunchPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  // How Tide talks to the spawned process. Provider runtimes are structured-only:
  // claude stream-json, codex app-server, or ACP. Visible setup/workbench terminals
  // use the PTY port's own launch plan instead of this agent-runtime contract.
  transport: "claude_stream_json" | "codex_app_server" | "acp";
  // Structured-transport session parameters that ride the protocol instead of
  // argv (codex thread/start approvalPolicy/sandbox/model; gemini session/new).
  protocolParams?: Record<string, unknown>;
  // The provider session this launch will run as, when the adapter can assign or
  // derive it at plan time (claude/gemini mint a session id and pass it via
  // `--session-id`). Recorded as the thread's binding before the first history
  // poll, so binding is deterministic — never discovered by file recency.
  providerSessionRef?: DiscoveredProviderSessionRef;
}

// A provider session reference paired with the provider that owns it. The
// adapter-facing twin of the persistence layer's ProviderSessionRefRecord.
export interface DiscoveredProviderSessionRef {
  agentId: ProviderCliAgentId;
  kind: ProviderSessionRef["kind"];
  value: string;
  transcriptPath?: string;
  logPath?: string;
}

// One provider-record frame parsed from the provider's own history file. The
// same shape the live projector appends through the frame→block pipeline.
export interface ProviderHistoryFrame {
  source: "provider_history";
  sourceRef: string;
  payloadKind: "provider_record";
  payload: Record<string, unknown>;
  body: string;
  // True when this frame is the terminal agent message of a turn, for providers
  // whose turn boundary is a transcript record.
  turnComplete?: boolean;
}

export interface ProviderHistoryReadInput {
  threadId: string;
  runtimeId: string;
  // The session this runtime is bound to. readFrames parses ONLY this session's
  // tail; there is no cross-session scanning.
  sessionRef: DiscoveredProviderSessionRef;
  // Bounded tail of the bound session file, read by the shared history loop.
  tailText: string;
  // Incremental frame dedup across polls, owned per runtime by the caller.
  seenKeys: Set<string>;
  // The current turn's user message; readers that anchor on it emit only frames
  // that belong to the current turn.
  expectedUserMessage?: string;
}

// The provider-owned history plane: how Tide deterministically locates THIS
// runtime's session and parses it into frames. One per Agent Integration; the
// shared history loop in live-backend calls it uniformly with zero provider
// branching. See docs_v2/specs/provider-history-connector.md.
export interface ProviderHistoryConnector {
  // Locate the on-disk session file for a launch-assigned ref that does not know
  // its path yet (gemini's timestamped filename). Deterministic — resolves by the
  // assigned session id, never by recency. undefined until the file exists.
  resolveSessionRef?(
    assignedSessionRef: DiscoveredProviderSessionRef,
  ): DiscoveredProviderSessionRef | undefined;
  // Parse new provider-record frames for the current turn from the bound
  // session's tail. Pure: all I/O happens in the shared loop.
  readFrames(input: ProviderHistoryReadInput): ProviderHistoryFrame[];
  // Derive this provider's session ref from a runtime-keyed hook payload.
  sessionRefFromHookPayload(payload: unknown): DiscoveredProviderSessionRef | undefined;
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
  // The runtime id this launch will run as. Providers that do NOT inherit the
  // parent process env into their MCP server subprocess (codex) must embed it in
  // the MCP server config env so the Tide MCP bridge can identify the session.
  runtimeId?: string;
}

export interface AgentResumePlanInput {
  agentId: ProviderCliAgentId;
  providerSessionRef: ProviderSessionRef;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
  // See AgentStartPlanInput.runtimeId.
  runtimeId?: string;
}

// A mid-thread Launch Options change, asked of the integration: can the LIVE
// session be reconfigured through the provider protocol?
export interface SessionConfigUpdateInput {
  // The thread's full merged Launch Options after the change.
  launchOptions: Record<string, unknown>;
  // Which option keys actually changed (e.g. ["model"]).
  changedKeys: string[];
}

// "live": protocolParams carry the provider-protocol values the structured
// client delivers to the running session (claude control_request fields, codex
// turn/start overrides, ACP modeId). "restart": the live session cannot take
// this change — the runtime must be restarted via provider-native resume.
// See docs_v2/specs/mid-thread-launch-option-changes.md.
export type SessionConfigUpdatePlan =
  | { kind: "live"; protocolParams: Record<string, unknown> }
  | { kind: "restart" };

// A user-facing notice surfaced when a turn ended WITHOUT a usable answer (rate
// limit / out of credits / empty output / error), so the UI shows why instead of a
// silent empty turn. Rendered as an `error` Agent Session block.
export interface AgentTurnNotice {
  severity: "warning" | "error";
  message: string;
}

// The normalized outcome of a finished turn, produced uniformly by every Agent
// Integration from its own signals (claude/codex hook payload, codex rollout,
// gemini session). The shared runtime applies it identically: ingest
// `finalMessage` as the agent answer (deduped by content) and/or `notice` as an
// error block, then settle the turn.
export interface AgentTurnOutcome {
  finalMessage?: string;
  notice?: AgentTurnNotice;
}

export interface AgentIntegrationPort {
  preflight(
    input: AgentIntegrationPreflightInput,
  ): Promise<AgentIntegrationPreflightResult>;
  buildStartPlan(input: AgentStartPlanInput): Promise<ProviderLaunchPlan>;
  buildResumePlan(input: AgentResumePlanInput): Promise<ProviderLaunchPlan>;
  // Optional: how a mid-thread Launch Options change applies to a live session.
  // Absent ⇒ the runtime port treats every change as restart-required
  // (conservative default — never a silent no-op).
  buildSessionConfigUpdate?(
    input: SessionConfigUpdateInput,
  ): SessionConfigUpdatePlan;
}

export type RuntimeReadinessGate =
  | { kind: "immediate" }
  | { kind: "tool_surface_ready" };
