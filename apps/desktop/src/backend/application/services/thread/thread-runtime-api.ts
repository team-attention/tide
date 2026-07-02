import type { AgentRuntimePort } from "../../ports/outbound/agent-runtime-port.ts";
import type { ProviderReadinessPort } from "../../ports/outbound/provider-readiness-port.ts";
import type { PtyTranscriptPort } from "../../ports/outbound/pty-transcript-port.ts";
import type { WorkbenchTerminalPort } from "../../ports/outbound/workbench-terminal-port.ts";
import type { WorkspaceCommandPort } from "../../ports/outbound/workspace-command-port.ts";
import type { WorkspaceFilePort } from "../../ports/outbound/workspace-file-port.ts";
import type { WorkspaceCodeIntelligencePort } from "../../ports/outbound/workspace-code-intelligence-port.ts";
import type { ComposerAttachmentInput, ComposerAttachmentStorePort } from "../../ports/outbound/composer-attachment-store-port.ts";
import type { ProviderTrustPort } from "../../ports/outbound/provider-trust-port.ts";
import type { BrowserRuntimePort } from "../../ports/outbound/browser-runtime-port.ts";
import type { AgentBinding, AgentId, AgentSessionBlockReference, ProviderCliAgentId, PromptState, PromptStepAnswer, ProviderSessionRef, ThreadGoalState, ThreadId, ThreadScope, ThreadSeed, ThreadSnapshot } from "../../domains/thread/thread.ts";
import type { ThreadRuntimeAsyncEvent } from "./thread-runtime-events.ts";
import type { AgentRuntimeCapabilityInvoke, AgentRuntimeState } from "../../domains/agent-runtime/agent-runtime.ts";
import type { ProviderReadinessResult } from "../../domains/provider-readiness/provider-readiness.ts";
import type { AgentSessionBlock } from "../../domains/agent-session/agent-session-block.ts";
import type { RawAgentFrame, RawAgentFramePayloadKind, RawAgentFrameSource } from "../../domains/agent-session/raw-agent-frame.ts";
import type { ArchiveThreadInput, ArchiveThreadResult, ListThreadsInput, ListThreadsResult, RenameThreadInput, RenameThreadResult, RestoreThreadsInput, RestoreThreadsResult, SetThreadGoalInput, SetThreadGoalResult, SetThreadPinnedInput, SetThreadPinnedResult } from "./thread-crud-service.ts";
import type { ServiceResult } from "../support/service-result.ts";
import type { WorkbenchCommandInput, WorkbenchCommandResult } from "../workbench/workbench-command-types.ts";
import type { WorkspaceQueryHandler } from "../workbench/workspace-query-handler.ts";
import type { TideMcpToolDefinition } from "../../domains/workbench/workbench.ts";
import type { TideMcpToolCallInput, TideMcpToolCallResult } from "../tide-mcp/tide-mcp-tool-handler.ts";
// Thread runtime service API types (inputs/results/ports/contract), extracted
// from thread-runtime-service.ts (navigable-source-structure).

export interface CreateThreadRuntimeServiceInput {
  agentRuntimePort: AgentRuntimePort;
  providerReadinessPort: ProviderReadinessPort;
  ptyTranscriptPort: PtyTranscriptPort;
  nativeEvidencePort?: NativeEvidenceCleanupPort;
  workbenchTerminalPort?: WorkbenchTerminalPort;
  workspaceCommandPort?: WorkspaceCommandPort;
  workspaceFilePort?: WorkspaceFilePort;
  workspaceCodeIntelligencePort?: WorkspaceCodeIntelligencePort;
  composerAttachmentStorePort?: ComposerAttachmentStorePort;
  providerTrustPort?: ProviderTrustPort;
  browserRuntimePort?: BrowserRuntimePort;
  // Materializes a Scratch Thread's real per-thread cwd under the Tide app-support
  // dir (creates it). See docs_v2/specs/scratch-execution-context.md.
  ensureScratchDirectory?: (threadId: string) => string;
  defaultWorkbenchTerminalCommand?: string;
  defaultWorkbenchTerminalArgs?: string[];
  clock?: () => string;
  idGenerator?: () => string;
  initialThreads?: ThreadSeed[];
  onAsyncEvent?: (event: ThreadRuntimeAsyncEvent) => Promise<void> | void;
}

export interface NativeEvidenceCleanupPort {
  deleteThreadEvidence(threadId: ThreadId): void;
}

export interface HydrateThreadInput {
  threadId: ThreadId;
  // True ONLY on an explicit user thread-open (the contract adapter). When set,
  // hydrate reconciles a thread whose runtime is dead but left in a running/
  // waiting state back to idle (drops the stale prompt). MUST stay false on the
  // internal polling reads (emitProviderHistory/pollWhileRunning call hydrate
  // every cycle); reconciling there would race-kill a live turn.
  reconcileStaleRuntime?: boolean;
}

export interface HydrateThreadResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  blocks: AgentSessionBlockReference[];
}

export interface StartThreadInput {
  threadId?: ThreadId;
  initialMessage: string;
  goal?: string;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
  attachments?: ComposerAttachmentInput[];
}

export interface StartThreadResult {
  status: "started" | "provider_not_ready";
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  providerReadiness: ProviderReadinessResult;
  submittedBlock?: AgentSessionBlockReference;
}

// Create a Draft Thread: a registered ThreadRecord with full context and a live
// Workbench, but no agent runtime. Workbench commands (open_terminal/editor/diff/
// browser) run against it via the normal per-thread path; Send later calls
// startThread with this threadId to start it in place. See composer-draft-thread.md.
export interface CreateDraftThreadInput {
  threadId?: ThreadId;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
}

export interface CreateDraftThreadResult {
  thread: ThreadSnapshot;
}

// Discard a Draft Thread that was never sent: tear down its Workbench (kill any
// visible-terminal PTYs) and remove it from memory. A no-op `discarded:false` when
// the thread is gone; refuses to discard a started thread.
export interface DiscardDraftThreadInput {
  threadId: ThreadId;
}

export interface DiscardDraftThreadResult {
  discarded: boolean;
}

export interface SendComposerInput {
  threadId: ThreadId;
  input: string;
  agentId?: AgentId;
  launchOptions?: Record<string, unknown>;
  attachments?: ComposerAttachmentInput[];
}

// Mid-thread Launch Options change (model/permission/reasoning) on an active
// Thread. See docs_v2/specs/mid-thread-launch-option-changes.md.
export interface UpdateThreadLaunchOptionsInput {
  threadId: ThreadId;
  launchOptions: Record<string, unknown>;
}

export interface UpdateThreadLaunchOptionsResult {
  thread: ThreadSnapshot;
  // "live" = the running session was reconfigured; "next_turn" = a runtime
  // restart is pending and happens transparently at the next send; "none" =
  // nothing changed or no live runtime exists (spawn-time options apply).
  applied: "live" | "next_turn" | "none";
  // The Launch Option keys (⊆ model/permission/reasoning) that actually differed
  // from the thread's previous options. Empty when the change was a no-op. Lets
  // the renderer attach chip feedback to the right chip(s).
  changedKeys: string[];
}

export interface InvokeProviderCapabilityInput {
  threadId: ThreadId;
  capabilityId: string;
  invoke: AgentRuntimeCapabilityInvoke;
  params?: unknown;
}

export interface InvokeProviderCapabilityResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  status: "handled";
  result?: unknown;
}

export interface TrustWorkspaceInput {
  threadId: ThreadId;
}

export interface TrustWorkspaceResult {
  status: "trusted" | "still_not_ready";
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  providerReadiness: ProviderReadinessResult;
}

export interface CheckReadinessInput {
  threadId: ThreadId;
  // Provider-CLI only — the install/sign-in handoff is for the CLI agents
  // (codex/claude/opencode). Narrowing here lets checkReadiness rebuild
  // the full provider_cli runtimeSource without a cast.
  agentId: ProviderCliAgentId;
}
export interface CheckReadinessResult {
  thread: ThreadSnapshot;
  providerReadiness: ProviderReadinessResult;
}

export interface SendComposerInputResult {
  status: "sent" | "queued" | "provider_not_ready";
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  providerReadiness: ProviderReadinessResult;
  submittedBlock?: AgentSessionBlockReference;
}

export interface EditPendingInputInput {
  threadId: ThreadId;
  value: string;
  // Which queued message to edit/discard: 0 (or omitted) = the head/next to run;
  // 1..N = a message further back in the follow-up queue.
  index?: number;
}

export interface EditPendingInputResult {
  thread: ThreadSnapshot;
  status: "edited" | "discarded";
}

export interface AnswerPromptInput {
  threadId: ThreadId;
  promptId: string;
  value?: string;
  choiceId?: string;
  // Free-text note on a single-question AskUserQuestion answer (→ claude annotations).
  notes?: string;
  // Set for a multi-step prompt (wizard): one answer per step, forwarded to the runtime
  // write. The single `value`/`choiceId` path is used when this is absent.
  stepAnswers?: PromptStepAnswer[];
}

export interface AnswerPromptResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  promptState: PromptState | null;
}

export interface RecordProviderPromptStateInput {
  threadId: ThreadId;
  promptState: PromptState;
}

export interface RecordProviderPromptStateResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  promptState: PromptState;
}

export interface WithdrawProviderPromptInput {
  threadId: ThreadId;
  promptId: string;
}

export interface WithdrawProviderPromptResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  // The prompt now visible after the withdrawal: the next queued prompt promoted into
  // its place, or null when none remains (the turn resumes running).
  promptState: PromptState | null;
}

export interface RecordProviderSessionRefInput {
  threadId: ThreadId;
  agentId: AgentId;
  providerSessionRef: ProviderSessionRef;
}

export interface RecordProviderSessionRefResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
}

export interface RecordProviderGoalStateInput {
  threadId: ThreadId;
  goalState?: ThreadGoalState;
}

export interface RecordProviderGoalStateResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
}

export interface RecordProviderTurnStartedInput {
  threadId: ThreadId;
}

export interface RecordProviderTurnStartedResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
}

export interface RecordAgentSessionBlockInput {
  threadId: ThreadId;
  block: AgentSessionBlock;
}

export interface RecordAgentSessionBlockResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  blocks: AgentSessionBlockReference[];
}

export interface RecordStreamingBlockInput {
  threadId: ThreadId;
  block: AgentSessionBlock;
}

export interface RecordStreamingBlockResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
}

export interface ResumeAgentRuntimeInput {
  threadId: ThreadId;
}

export interface ResumeAgentRuntimeResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
}

export interface StopAgentRuntimeInput {
  threadId: ThreadId;
}

export interface StopAgentRuntimeResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  // When stopping consumed a queued follow-up, the local user block for it.
  submittedBlock?: AgentSessionBlockReference;
}

export interface RecordTurnCompleteInput {
  threadId: ThreadId;
  /**
   * Settle even when the thread is still blocked on an unanswered prompt. A normal
   * turn-end signal leaves this unset, so it can never drop a live, never-answered
   * permission/question card (a spurious turn-end while waiting must not strand the
   * user with an empty, idle-looking thread). A genuine runtime exit/crash — and a
   * turn-end that carried real content — pass `force: true`.
   */
  force?: boolean;
}

export interface RecordTurnCompleteResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  /** A queued Composer input flushed to the now-idle runtime, if any. */
  flushedInput?: string;
  /** The local user-message block created for a flushed queued input, if any. */
  submittedBlock?: AgentSessionBlockReference;
}

export interface AppendRawAgentFrameInput {
  threadId: ThreadId;
  agentId: AgentId;
  source: RawAgentFrameSource;
  sourceRef?: string;
  payloadKind?: RawAgentFramePayloadKind;
  payload?: unknown;
  body?: string;
  truncated?: boolean;
}

export interface ThreadRuntimeService {
  restoreThreads(input: RestoreThreadsInput): Promise<ServiceResult<RestoreThreadsResult>>;
  // Fill a metadata-only restored thread's conversation the first time it is opened
  // (live-backend restore is metadata-first; blocks are rebuilt lazily on hydrate).
  // No-op when the thread already has blocks or a live runtime owns it. Synchronous.
  seedCachedBlocksIfEmpty(threadId: ThreadId, blocks: AgentSessionBlockReference[]): boolean;
  listThreads(input: ListThreadsInput): Promise<ServiceResult<ListThreadsResult>>;
  archiveThread(input: ArchiveThreadInput): Promise<ServiceResult<ArchiveThreadResult>>;
  setThreadPinned(input: SetThreadPinnedInput): Promise<ServiceResult<SetThreadPinnedResult>>;
  renameThread(input: RenameThreadInput): Promise<ServiceResult<RenameThreadResult>>;
  setThreadGoal(input: SetThreadGoalInput): Promise<ServiceResult<SetThreadGoalResult>>;
  hydrateThread(input: HydrateThreadInput): Promise<ServiceResult<HydrateThreadResult>>;
  // Internal, NON-CLONING read for hot-path callers (the live projector + persist)
  // that only READ thread/binding/blocks and never mutate them. hydrateThread deep-
  // clones blocks twice (snapshot + top-level) for external safety; on the streaming
  // hot path that is wasted CPU (perf E4). peekThread shares block references and
  // never reconciles stale runtime state. Synchronous: no I/O.
  peekThread(threadId: string): ServiceResult<HydrateThreadResult>;
  createDraftThread(
    input: CreateDraftThreadInput,
  ): Promise<ServiceResult<CreateDraftThreadResult>>;
  discardDraftThread(
    input: DiscardDraftThreadInput,
  ): Promise<ServiceResult<DiscardDraftThreadResult>>;
  startThread(input: StartThreadInput): Promise<ServiceResult<StartThreadResult>>;
  sendComposerInput(
    input: SendComposerInput,
  ): Promise<ServiceResult<SendComposerInputResult>>;
  updateThreadLaunchOptions(
    input: UpdateThreadLaunchOptionsInput,
  ): Promise<ServiceResult<UpdateThreadLaunchOptionsResult>>;
  invokeProviderCapability(
    input: InvokeProviderCapabilityInput,
  ): Promise<ServiceResult<InvokeProviderCapabilityResult>>;
  editPendingInput(
    input: EditPendingInputInput,
  ): Promise<ServiceResult<EditPendingInputResult>>;
  answerPrompt(input: AnswerPromptInput): Promise<ServiceResult<AnswerPromptResult>>;
  recordProviderPromptState(
    input: RecordProviderPromptStateInput,
  ): Promise<ServiceResult<RecordProviderPromptStateResult>>;
  withdrawProviderPrompt(
    input: WithdrawProviderPromptInput,
  ): Promise<ServiceResult<WithdrawProviderPromptResult>>;
  recordProviderSessionRef(
    input: RecordProviderSessionRefInput,
  ): Promise<ServiceResult<RecordProviderSessionRefResult>>;
  recordProviderGoalState(
    input: RecordProviderGoalStateInput,
  ): Promise<ServiceResult<RecordProviderGoalStateResult>>;
  recordProviderTurnStarted(
    input: RecordProviderTurnStartedInput,
  ): Promise<ServiceResult<RecordProviderTurnStartedResult>>;
  recordAgentSessionBlock(
    input: RecordAgentSessionBlockInput,
  ): Promise<ServiceResult<RecordAgentSessionBlockResult>>;
  // Records a still-streaming block (status "streaming") into the in-memory streaming
  // tail WITHOUT touching cachedBlocks or persistence, so hydrate can include in-flight
  // content. recordAgentSessionBlock (finalize) evicts the same blockId.
  recordStreamingBlock(
    input: RecordStreamingBlockInput,
  ): Promise<ServiceResult<RecordStreamingBlockResult>>;
  resumeAgentRuntime(
    input: ResumeAgentRuntimeInput,
  ): Promise<ServiceResult<ResumeAgentRuntimeResult>>;
  stopAgentRuntime(
    input: StopAgentRuntimeInput,
  ): Promise<ServiceResult<StopAgentRuntimeResult>>;
  trustWorkspace(
    input: TrustWorkspaceInput,
  ): Promise<ServiceResult<TrustWorkspaceResult>>;
  checkReadiness(
    input: CheckReadinessInput,
  ): Promise<ServiceResult<CheckReadinessResult>>;
  recordTurnComplete(
    input: RecordTurnCompleteInput,
  ): Promise<ServiceResult<RecordTurnCompleteResult>>;
  handleWorkbenchCommand(
    input: WorkbenchCommandInput,
  ): Promise<ServiceResult<WorkbenchCommandResult>>;
  // Thread-independent workspace queries (start page, search, code intel).
  workspaceQueries(): WorkspaceQueryHandler;
  appendRawAgentFrame(input: AppendRawAgentFrameInput): Promise<RawAgentFrame>;
  listTideMcpTools(): TideMcpToolDefinition[];
  handleTideMcpToolCall(
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<TideMcpToolCallResult>>;
}

// The Launch Option keys that affect a live Agent Runtime mid-thread. The rest
// (worktree, branch, …) are start-time Execution Context and never change on an
// active thread. See docs_v2/specs/mid-thread-launch-option-changes.md.
export const RUNTIME_LAUNCH_OPTION_KEYS = ["model", "permission", "reasoning"] as const;
