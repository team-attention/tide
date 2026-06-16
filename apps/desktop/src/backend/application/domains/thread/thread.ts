import type {
  AgentRuntimeHandle,
  AgentRuntimeState,
} from "../agent-runtime/agent-runtime.ts";
import type {
  WorkbenchSnapshot,
  WorkbenchState,
} from "../workbench/workbench.ts";

export type ProviderCliAgentId = "codex" | "claude" | "gemini" | "opencode";
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
    | "gemini_session"
    | "opencode_session"
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

// One question of a batched multi-step prompt (claude AskUserQuestion). `message` is the
// raw question — the wizard chrome shows the i/N position, so no "(i/N)" prefix here.
export interface PromptStep {
  stepId: string;
  message: string;
  choices?: PromptChoice[];
  defaultChoiceId?: string;
  multiSelect?: boolean;
}

// One resolved answer in a multi-step submit; `value` is the provider-native answer
// (a chosen option's providerValue, free text, or "" to skip).
export interface PromptStepAnswer {
  stepId: string;
  value: string;
}

export interface PromptState {
  promptId: string;
  threadId: ThreadId;
  agentId: AgentId;
  kind: PromptKind;
  message: string;
  choices?: PromptChoice[];
  defaultChoiceId?: string;
  // Multi-select question (e.g. claude AskUserQuestion multiSelect): the card toggles
  // several options and submits them joined as the free-text answer.
  multiSelect?: boolean;
  // A batched, multi-step prompt (claude AskUserQuestion's 1-4 questions). When present
  // with length > 1 the card is a navigable wizard; single prompts omit it.
  // `message`/`choices`/`multiSelect` mirror `steps[0]` as a single-view fallback.
  steps?: PromptStep[];
  source: "pty" | "provider_signal" | "provider_hook";
}

// A materialized image attachment, sent to providers in their NATIVE image-input
// format (codex localImage item / ACP image ContentBlock). The path also rides
// the message text as "[Attached image: <path>]" — that text is what claude reads
// (it has a file-read tool) and what the transcript renders as a thumbnail — but
// codex/gemini/opencode have no file-read tool, so they need the native item.
export interface ComposerAttachmentRef {
  path: string;
  mediaType: string;
}

export interface PendingInput {
  kind: "composer_input";
  value: string;
  capturedAt: string;
  launchOptions?: Record<string, unknown>;
  attachments?: ComposerAttachmentRef[];
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
  // `pendingInput` is the HEAD of the Composer follow-up queue (the next message
  // to run); `pendingInputQueue` holds the rest, FIFO. Splitting head+tail keeps
  // the single-queued path byte-identical (tail empty) while letting the user
  // stack several follow-ups behind a live turn — each turn-end promotes the next.
  pendingInput?: PendingInput;
  pendingInputQueue?: PendingInput[];
  promptState?: PromptState;
  // Prompts that arrived while another was already pending, surfaced one at a
  // time (FIFO). A turn can raise several prompts at once — e.g. claude batching
  // two WebFetch calls fires two PermissionRequest hooks in the same instant —
  // and the single prompt slot would drop all but the last, leaving the agent
  // waiting forever on the unanswered one. Each answer promotes the next.
  promptQueue?: PromptState[];
  // True once the user has answered/denied a prompt in the CURRENT waiting episode.
  // It tells a later turn-end that the settle is legitimate (the agent ended its turn
  // BECAUSE of that answer — e.g. a deny cancelling the rest of a batch) so the dead
  // cards are dropped. Without an answer, a turn-end arriving while a card is still
  // open is spurious (the agent cannot end a turn it is blocked waiting on) and must
  // NOT drop the card. Reset when a fresh prompt episode opens and when a turn settles.
  // In-memory turn state only; never persisted.
  promptAnsweredPendingSettle?: boolean;
  activeRuntimeHandle?: AgentRuntimeHandle;
  // A mid-thread Launch Options change could not be applied to the live session
  // (the provider protocol has no live update for it). Consumed at the next
  // turn boundary: the old process is stopped and the provider-native resume
  // respawns with the new options. In-memory only — after an app restart there
  // is no live process and the fresh spawn reads the persisted launchOptions.
  pendingRuntimeRestart?: boolean;
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
  // True while an Agent Runtime for this thread is hydrated/alive in THIS process
  // (an activeRuntimeHandle exists), regardless of runtime state — the live set the
  // multitask switcher cycles. Cold/history-only threads are false.
  live: boolean;
  cachedBlocks: AgentSessionBlockReference[];
  pendingInput?: PendingInput;
  // The Composer follow-up queue as plain texts, head-first (pendingInput then the
  // tail). This is what the renderer DISPLAYS — the backend is authoritative, so the
  // renderer never guesses the queue. See docs_v2/specs/backend-authoritative-composer-queue.md.
  queuedInputs: string[];
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
