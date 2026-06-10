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
  // How Tide talks to the spawned process. "hidden_pty" (default) wraps the
  // interactive TUI in a pseudo-terminal and infers everything from scrapes,
  // hooks, and history files. Structured transports speak the provider's own
  // machine protocol over plain stdio — events, permissions, and turn ends are
  // native protocol messages (see docs_v2/specs/structured-agent-runtime.md).
  transport?: "hidden_pty" | "claude_stream_json" | "codex_app_server" | "gemini_acp";
  // Structured-transport session parameters that ride the protocol instead of
  // argv (codex thread/start approvalPolicy/sandbox/model; gemini session/new).
  protocolParams?: Record<string, unknown>;
  inputTiming?: {
    startupDelayMs?: number;
    preSubmitDelayMs?: number;
  };
  // The key sequence that submits typed input in this provider's TUI. Defaults
  // to "\r"; claude uses CSI-u Enter ("\x1b[13u") because its TUI negotiates the
  // extended keyboard protocol on the hidden PTY. Provider knowledge — declared
  // here so the runtime port stays provider-neutral.
  submitKeySequence?: string;
  // One-shot TUI prompts this provider renders at startup that Tide must answer
  // automatically (e.g. codex's "Hooks need review" trust box for Tide's own
  // generated hooks). The runtime port replays `response` keys (with a beat
  // between them) the first time `pattern` appears in PTY output.
  autoRespondPrompts?: Array<{
    pattern: string;
    response: string[];
    interKeyDelayMs?: number;
  }>;
  expectedSignalSources: ProviderSignalSource[];
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
  // whose turn boundary is a transcript record (antigravity).
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

export interface AgentPromptSignalInput {
  threadId: ThreadId;
  source: "pty_transcript" | "provider_hook" | "provider_history";
  eventName?: string;
  payload?: unknown;
  text?: string;
}

// A user-facing notice surfaced when a turn ended WITHOUT a usable answer (rate
// limit / out of credits / empty output / error), so the UI shows why instead of a
// silent empty turn. Rendered as an `error` Agent Session block.
export interface AgentTurnNotice {
  severity: "warning" | "error";
  message: string;
}

// The normalized outcome of a finished turn, produced uniformly by every Agent
// Integration from its own signals (claude/codex hook payload, codex rollout,
// antigravity transcript). The shared runtime applies it identically: ingest
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
}

export type RuntimeReadinessGate =
  | { kind: "immediate" }
  | { kind: "tool_surface_ready" };
