import type {
  AgentSessionBlock,
  AgentSessionBlockKind,
  AgentSessionBlockRole,
  AgentSessionBlockStatus,
} from "../agent-session/agent-session-block.ts";
import type { AgentId, ThreadId } from "../thread/thread.ts";
import type {
  NativeEvidenceSnapshot,
  NativeLifecycleStatus,
  NativeProviderId,
  NativeRuntimeEvent,
  NativeTransport,
} from "./native-runtime-event.ts";

export type SemanticAgentBlockKind =
  | "message"
  | "reasoning"
  | "plan"
  | "command_run"
  | "file_change"
  | "tool_call"
  | "mcp_call"
  | "approval_prompt"
  | "question_prompt"
  | "session_event"
  | "config_state"
  | "agent_activity"
  | "usage"
  | "notice";

export interface SemanticAgentBlock {
  blockId: string;
  kind: SemanticAgentBlockKind;
  provider: NativeProviderId;
  transport: NativeTransport;
  tideThreadId: ThreadId;
  runtimeId: string;
  providerSessionId?: string;
  nativeIds: NativeRuntimeEvent["nativeIds"];
  parentBlockId?: string;
  status: NativeLifecycleStatus;
  title?: string;
  body?: string;
  data: Record<string, unknown>;
  evidence: NativeEvidenceSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export type UsageScope = "turn" | "thread" | "session" | "provider_account";

export interface UsageBlockData {
  scope: UsageScope;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  quotaRemaining?: number;
  rateLimitResetAt?: string;
  nativeUnits?: Record<string, unknown>;
}

export type AgentActivityStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentActivityBlockData {
  activityKind: "subagent" | "task" | "worker" | "team" | "provider_extension";
  label: string;
  role?: string;
  summary?: string;
  status: AgentActivityStatus;
  parentNativeId?: string;
  startedAt?: string;
  endedAt?: string;
  nativeFields?: Record<string, unknown>;
}

export type SemanticAgentSessionProvider = Extract<NativeProviderId, AgentId>;

export function isSemanticAgentSessionProvider(provider: NativeProviderId): provider is SemanticAgentSessionProvider {
  return provider === "codex" || provider === "claude" || provider === "opencode";
}

export function semanticAgentBlockToAgentSessionBlock(
  block: SemanticAgentBlock & { provider: SemanticAgentSessionProvider },
): AgentSessionBlock {
  const sessionBlock: AgentSessionBlock = {
    blockId: block.blockId,
    threadId: block.tideThreadId,
    agentId: block.provider,
    kind: agentSessionKindForSemanticKind(block.kind),
    role: agentSessionRoleForSemanticKind(block.kind),
    sourceFrameIds: [],
    localProvenance: {
      kind: "native_semantic_block",
      provider: block.provider,
      transport: block.transport,
      runtimeId: block.runtimeId,
      providerSessionId: block.providerSessionId,
      nativeIds: block.nativeIds,
      evidence: block.evidence,
    },
    status: agentSessionStatusForNativeStatus(block.status),
    title: block.title,
    body: block.body,
    data: block.data,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
  if (block.parentBlockId !== undefined) {
    sessionBlock.parentBlockId = block.parentBlockId;
  }
  return sessionBlock;
}

function agentSessionKindForSemanticKind(kind: SemanticAgentBlockKind): AgentSessionBlockKind {
  switch (kind) {
    case "message":
      return "agent_message";
    case "reasoning":
      return "reasoning";
    case "plan":
      return "plan";
    case "command_run":
      return "command_run";
    case "file_change":
      return "file_change";
    case "tool_call":
      return "tool_call";
    case "mcp_call":
      return "mcp_call";
    case "approval_prompt":
      return "approval_prompt";
    case "question_prompt":
      return "question_prompt";
    case "usage":
      return "usage";
    case "agent_activity":
      return "agent_activity";
    case "notice":
      return "error";
    case "config_state":
    case "session_event":
      return "progress_status";
  }
}

function agentSessionRoleForSemanticKind(kind: SemanticAgentBlockKind): AgentSessionBlockRole {
  switch (kind) {
    case "message":
      return "agent";
    case "reasoning":
      return "reasoning";
    case "command_run":
    case "file_change":
    case "tool_call":
    case "mcp_call":
      return "tool";
    case "notice":
      return "system";
    case "plan":
    case "approval_prompt":
    case "question_prompt":
    case "session_event":
    case "config_state":
    case "agent_activity":
    case "usage":
      return "runtime";
  }
}

function agentSessionStatusForNativeStatus(status: NativeLifecycleStatus): AgentSessionBlockStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "streaming";
    case "waiting_for_approval":
    case "waiting_for_input":
      return "needs_input";
    case "failed":
      return "failed";
    case "completed":
    case "cancelled":
      return "complete";
  }
}
