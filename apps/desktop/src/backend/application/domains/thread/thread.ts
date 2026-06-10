import type {
  AgentRuntimeHandle,
  AgentRuntimeState,
} from "../agent-runtime/agent-runtime.ts";
import type {
  WorkbenchSnapshot,
  WorkbenchState,
} from "../workbench/workbench.ts";

export type ProviderCliAgentId = "codex" | "claude" | "antigravity" | "gemini";
export type TideApiAgentId = "openai_api";
export type AgentId = ProviderCliAgentId | TideApiAgentId;
export type ThreadId = string;
export type ProjectId = string;

export type AgentRuntimeSource =
  | {
      kind: "provider_cli";
      integrationId: ProviderCliAgentId;
    }
  | {
      kind: "tide_api";
      provider: "openai";
      accountId?: string;
    };

export interface ProviderSessionRef {
  kind:
    | "codex_rollout"
    | "claude_transcript"
    | "antigravity_conversation"
    | "gemini_session"
    | "provider_native";
  value: string;
  transcriptPath?: string;
  logPath?: string;
}

export interface AgentBinding {
  agentId: AgentId;
  runtimeSource?: AgentRuntimeSource;
  providerSessionRef?: ProviderSessionRef;
}

export type ThreadScope =
  | { kind: "project"; projectId: ProjectId; cwd: string }
  | { kind: "scratch"; scratchCwd: string };

export type ThreadLifecycleState =
  | "creating"
  | "hydrating"
  | "open"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "failed"
  | "archived";

export type LastKnownState =
  | "idle"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "failed"
  | "archived";

export type PromptKind =
  | "question"
  | "approval"
  | "permission"
  | "choice"
  | "command_picker";

export interface PromptChoice {
  choiceId: string;
  label: string;
  providerValue: string;
}

export interface PromptState {
  promptId: string;
  threadId: ThreadId;
  agentId: AgentId;
  kind: PromptKind;
  message: string;
  choices?: PromptChoice[];
  defaultChoiceId?: string;
  source: "pty" | "provider_signal" | "provider_hook";
}

export interface PendingInput {
  kind: "composer_input";
  value: string;
  capturedAt: string;
  launchOptions?: Record<string, unknown>;
}

export interface AgentSessionBlockReference {
  blockId: string;
  agentId?: AgentId;
  kind: string;
  role?: "user" | "agent" | "reasoning" | "tool" | "system" | "runtime";
  sourceFrameIds?: string[];
  localProvenance?: Record<string, unknown>;
  status: "pending" | "streaming" | "complete" | "failed" | "needs_input";
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  rawFallback?: string;
  createdAt?: string;
  updatedAt: string;
}

export interface ThreadRecord {
  threadId: ThreadId;
  title: string;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
  lifecycleState: ThreadLifecycleState;
  runtimeState: AgentRuntimeState;
  lastKnownState: LastKnownState;
  // When the current turn started running. Set at each turn start so the Working
  // indicator can show elapsed-since-turn-start even after the thread is reopened
  // (the React indicator alone would reset to 0 on every open).
  runtimeStartedAt?: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  cachedBlocks: AgentSessionBlockReference[];
  pendingInput?: PendingInput;
  promptState?: PromptState;
  // Prompts that arrived while another was already pending, surfaced one at a
  // time (FIFO). A turn can raise several prompts at once — e.g. claude batching
  // two WebFetch calls fires two PermissionRequest hooks in the same instant —
  // and the single prompt slot would drop all but the last, leaving the agent
  // waiting forever on the unanswered one. Each answer promotes the next.
  promptQueue?: PromptState[];
  activeRuntimeHandle?: AgentRuntimeHandle;
  rawFrameSequence: number;
  mcpToolCallCount: number;
  workbench: WorkbenchState;
}

export interface ThreadSnapshot {
  threadId: ThreadId;
  title: string;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
  lifecycleState: ThreadLifecycleState;
  runtimeState: AgentRuntimeState;
  lastKnownState: LastKnownState;
  runtimeStartedAt?: string;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  cachedBlocks: AgentSessionBlockReference[];
  pendingInput?: PendingInput;
  promptState?: PromptState;
  workbench: WorkbenchSnapshot;
}

// A persisted Thread restored into the in-memory store on boot. Optional fields
// default when normalized into a ThreadRecord.
export interface ThreadSeed {
  threadId: ThreadId;
  title: string;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
  lifecycleState: ThreadLifecycleState;
  runtimeState: AgentRuntimeState;
  lastKnownState: LastKnownState;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
  cachedBlocks?: AgentSessionBlockReference[];
  pendingInput?: PendingInput;
  promptState?: PromptState;
  activeRuntimeHandle?: AgentRuntimeHandle;
  rawFrameSequence?: number;
  mcpToolCallCount?: number;
  workbench?: WorkbenchState;
}
