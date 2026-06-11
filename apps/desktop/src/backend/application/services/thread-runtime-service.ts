import type {
  AgentSessionBlock,
} from "../domains/agent-session/agent-session-block.ts";
import {
  createLocalUserMessageBlock,
} from "../domains/agent-session/agent-session-block.ts";
import type {
  RawAgentFrame,
  RawAgentFramePayloadKind,
  RawAgentFrameSource,
} from "../domains/agent-session/raw-agent-frame.ts";
import type {
  AgentRuntimeHandle,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  AgentRuntimeState,
  TerminalInput,
} from "../domains/agent-runtime/agent-runtime.ts";
import type {
  ProviderReadinessCheckInput,
  ProviderReadinessResult,
} from "../domains/provider-readiness/provider-readiness.ts";
import type {
  AgentBinding,
  AgentId,
  AgentSessionBlockReference,
  ComposerAttachmentRef,
  LastKnownState,
  PendingInput,
  PromptState,
  ProviderSessionRef,
  ThreadId,
  ThreadLifecycleState,
  ThreadRecord,
  ThreadScope,
  ThreadSeed,
  ThreadSnapshot,
} from "../domains/thread/thread.ts";
import type {
  BrowserPaneRef,
  BrowserPaneActionRequest,
  BrowserPaneState,
  DiffPaneState,
  EditorPaneState,
  LauncherPaneState,
  TerminalPaneState,
  TideMcpToolDefinition,
  TideMcpToolName,
  WorkbenchPaneRef,
  WorkbenchPaneId,
  WorkbenchPaneSnapshotRef,
  WorkbenchFileTreeView,
  WorkbenchSnapshot,
  WorkbenchState,
} from "../domains/workbench/workbench.ts";
import { TIDE_MCP_WORKBENCH_TOOL_NAMES } from "../domains/workbench/workbench.ts";
import {
  cloneAgentBinding,
  cloneBlocks,
  cloneFileTreeView,
  cloneLaunchOptions,
  clonePendingInput,
  clonePromptState,
  cloneRuntimeHandle,
  cloneScope,
  cloneWorkbenchState,
  defaultWorkbenchState,
  providerSessionRefsEqual,
  runtimeStateForPromptKind,
  toAgentSessionBlockReference,
} from "./thread-runtime-clone.ts";
import {
  createUnavailableWorkspaceCodeIntelligencePort,
  createUnavailableWorkspaceCommandPort,
  createUnavailableWorkspaceFilePort,
} from "./unavailable-workspace-ports.ts";
import { boundedDiffText, unifiedContentDiff } from "./diff-text.ts";
import { ThreadStore } from "./thread-store.ts";
import { normalizeThreadSeed, snapshotThread, threadRoot } from "./thread-snapshot.ts";
import {
  activeLauncherPaneId,
  openWorkbenchLauncher,
  removeLauncherPane,
} from "./workbench-launcher.ts";
import { WorkbenchRuntime } from "./workbench-runtime.ts";
import {
  actBrowserOutput,
  observeBrowserOutput,
  openBrowserOutput,
} from "./workbench-browser-operations.ts";
import { WorkbenchFileOperations } from "./workbench-file-operations.ts";
import { WorkbenchExecOperations } from "./workbench-exec-operations.ts";
import {
  boundedBrowserTextPreview,
  boundedTranscriptPreview,
  browserActionKindFromInput,
  browserTitleFromUrl,
  commandByteLimit,
  commandName,
  commandTimeoutMs,
  errorMessage,
  expectedOccurrences,
  fileByteLimit,
  fileTreeMaxDepth,
  fileTreeMaxEntries,
  numberFromData,
  optionalRawString,
  optionalString,
  setupLaunchPreview,
  titleFromMessage,
  titleFromRelativePath,
} from "./service-value-helpers.ts";
import {
  arrayOfStrings,
  cloneEnv,
  literalStringField,
  recordField,
  recordOfStrings,
  shallowRecordEqual,
  stringField,
} from "./record-helpers.ts";
import {
  browserPaneRef,
  diffPaneRef,
  editorPaneRef,
  firstBrowserPane,
  firstVisiblePane,
  launcherPaneActions,
  snapshotWorkbench,
  terminalPaneRef,
  workbenchPaneById,
} from "./workbench-snapshot.ts";
import {
  browserPaneActionResultFromData,
  browserPaneSnapshotFromData,
  editorPanePositionFromData,
  editorPaneSaveFromData,
  providerSetupSurfaceActionFromData,
  providerSetupSurfaceInputFromData,
  type ProviderSetupSurfaceActionInput,
} from "./workbench-command-data.ts";
import type { AgentRuntimePort } from "../ports/outbound/agent-runtime-port.ts";
import type {
  WorkspaceCodeIntelligenceErrorCode,
  WorkspaceCodeIntelligencePort,
} from "../ports/outbound/workspace-code-intelligence-port.ts";
import type { ProviderReadinessPort } from "../ports/outbound/provider-readiness-port.ts";
import type {
  ProviderSetupSurfaceExit,
  ProviderSetupSurfaceHandle,
  ProviderSetupSurfaceOutput,
  ProviderSetupSurfaceStartInput,
  ProviderSetupSurfaceTerminalPort,
} from "../ports/outbound/provider-setup-surface-terminal-port.ts";
import type { PtyTranscriptPort } from "../ports/outbound/pty-transcript-port.ts";
import type {
  ComposerAttachmentInput,
  ComposerAttachmentStorePort,
} from "../ports/outbound/composer-attachment-store-port.ts";
import type { ProviderTrustPort } from "../ports/outbound/provider-trust-port.ts";
import type {
  WorkspaceCommandErrorCode,
  WorkspaceCommandPort,
  WorkspaceCommandRun,
} from "../ports/outbound/workspace-command-port.ts";
import type {
  WorkspaceFileErrorCode,
  WorkspaceFileEdit,
  WorkspaceFilePort,
  WorkspaceFileRead,
  WorkspaceFileTree,
  WorkspaceFileWrite,
} from "../ports/outbound/workspace-file-port.ts";
import type {
  WorkbenchTerminalExit,
  WorkbenchTerminalHandle,
  WorkbenchTerminalOutput,
  WorkbenchTerminalPort,
} from "../ports/outbound/workbench-terminal-port.ts";

const DEFAULT_WORKBENCH_TERMINAL_COMMAND = "sh";

export type {
  RawAgentFrame,
  RawAgentFramePayloadKind,
  RawAgentFrameSource,
  AgentRuntimeHandle,
  AgentRuntimePort,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  AgentRuntimeState,
  TerminalInput,
  ProviderReadinessCheckInput,
  ProviderReadinessPort,
  ProviderReadinessResult,
  ProviderSetupSurfaceHandle,
  ProviderSetupSurfaceOutput,
  ProviderSetupSurfaceStartInput,
  ProviderSetupSurfaceTerminalPort,
  PtyTranscriptPort,
  WorkspaceCommandPort,
  WorkspaceCodeIntelligencePort,
  WorkspaceFilePort,
  ComposerAttachmentInput,
  ComposerAttachmentStorePort,
  ProviderTrustPort,
  AgentBinding,
  AgentId,
  LastKnownState,
  PendingInput,
  PromptState,
  ThreadId,
  ThreadLifecycleState,
  ThreadScope,
  ThreadSnapshot,
  BrowserPaneRef,
  TideMcpToolDefinition,
  TideMcpToolName,
  WorkbenchSnapshot,
  WorkbenchState,
};

export type { ThreadSeed };

export interface CreateThreadRuntimeServiceInput {
  agentRuntimePort: AgentRuntimePort;
  providerReadinessPort: ProviderReadinessPort;
  ptyTranscriptPort: PtyTranscriptPort;
  providerSetupSurfaceTerminalPort?: ProviderSetupSurfaceTerminalPort;
  workbenchTerminalPort?: WorkbenchTerminalPort;
  workspaceCommandPort?: WorkspaceCommandPort;
  workspaceFilePort?: WorkspaceFilePort;
  workspaceCodeIntelligencePort?: WorkspaceCodeIntelligencePort;
  composerAttachmentStorePort?: ComposerAttachmentStorePort;
  providerTrustPort?: ProviderTrustPort;
  // Materializes a Scratch Thread's real per-thread cwd under the Tide app-support
  // dir (creates it). See docs_v2/specs/scratch-execution-context.md.
  ensureScratchDirectory?: (threadId: string) => string;
  defaultWorkbenchTerminalCommand?: string;
  clock?: () => string;
  idGenerator?: () => string;
  initialThreads?: ThreadSeed[];
  onAsyncEvent?: (event: ThreadRuntimeAsyncEvent) => Promise<void> | void;
}

import type { ThreadRuntimeAsyncEvent } from "./thread-runtime-events.ts";
export type { ThreadRuntimeAsyncEvent };

import { failure } from "./service-result.ts";
import type {
  ServiceError,
  ServiceErrorCode,
  ServiceResult,
} from "./service-result.ts";
export type { ServiceError, ServiceErrorCode, ServiceResult };

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

import {
  ThreadCrudService,
  type ListThreadsInput,
  type ListThreadsResult,
  type ArchiveThreadInput,
  type ArchiveThreadResult,
  type SetThreadPinnedInput,
  type SetThreadPinnedResult,
  type RenameThreadInput,
  type RenameThreadResult,
  type RestoreThreadsInput,
  type RestoreThreadsResult,
} from "./thread-crud-service.ts";
export type {
  ListThreadsInput,
  ListThreadsResult,
  ArchiveThreadInput,
  ArchiveThreadResult,
  SetThreadPinnedInput,
  SetThreadPinnedResult,
  RenameThreadInput,
  RenameThreadResult,
  RestoreThreadsInput,
  RestoreThreadsResult,
};

export interface StartThreadInput {
  threadId?: ThreadId;
  initialMessage: string;
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

export interface RecordProviderSessionRefInput {
  threadId: ThreadId;
  agentId: AgentId;
  providerSessionRef: ProviderSessionRef;
}

export interface RecordProviderSessionRefResult {
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

import type {
  TideActBrowserOutput,
  TideEditFileOutput,
  TideGoToDefinitionOutput,
  TideGoToReferencesOutput,
  TideMcpToolOutput,
  TideObserveBrowserOutput,
  TideObserveThreadOutput,
  TideObserveWorkbenchOutput,
  TideOpenBrowserOutput,
  TideOpenFileOutput,
  TideOpenTerminalOutput,
  TideReadFileOutput,
  TideRunTerminalCommandOutput,
} from "./tide-mcp-output.ts";
export type {
  TideActBrowserOutput,
  TideEditFileOutput,
  TideGoToDefinitionOutput,
  TideGoToReferencesOutput,
  TideMcpToolOutput,
  TideObserveBrowserOutput,
  TideObserveThreadOutput,
  TideObserveWorkbenchOutput,
  TideOpenBrowserOutput,
  TideOpenFileOutput,
  TideOpenTerminalOutput,
  TideReadFileOutput,
  TideRunTerminalCommandOutput,
};
import {
  TideMcpToolHandler,
  type TideMcpSessionRef,
  type TideMcpToolCallInput,
  type TideMcpToolCallResult,
} from "./tide-mcp-tool-handler.ts";
export type { TideMcpSessionRef, TideMcpToolCallInput, TideMcpToolCallResult };
import {
  WorkbenchCommandHandler,
  type WorkbenchCommandInput,
  type WorkbenchCommandResult,
  type ReadWorkspaceFileTreeInput,
  type ReadWorkspaceFileTreeResult,
  type SearchWorkspaceContentInput,
  type SearchWorkspaceContentResult,
} from "./workbench-command-handler.ts";
export type {
  WorkbenchCommandInput,
  WorkbenchCommandResult,
  ReadWorkspaceFileTreeInput,
  ReadWorkspaceFileTreeResult,
  SearchWorkspaceContentInput,
  SearchWorkspaceContentResult,
};

export interface ThreadRuntimeService {
  restoreThreads(input: RestoreThreadsInput): Promise<ServiceResult<RestoreThreadsResult>>;
  listThreads(input: ListThreadsInput): Promise<ServiceResult<ListThreadsResult>>;
  archiveThread(input: ArchiveThreadInput): Promise<ServiceResult<ArchiveThreadResult>>;
  setThreadPinned(input: SetThreadPinnedInput): Promise<ServiceResult<SetThreadPinnedResult>>;
  renameThread(input: RenameThreadInput): Promise<ServiceResult<RenameThreadResult>>;
  hydrateThread(input: HydrateThreadInput): Promise<ServiceResult<HydrateThreadResult>>;
  // Internal, NON-CLONING read for hot-path callers (the live projector + persist)
  // that only READ thread/binding/blocks and never mutate them. hydrateThread deep-
  // clones blocks twice (snapshot + top-level) for external safety; on the streaming
  // hot path that is wasted CPU (perf E4). peekThread shares block references and
  // never reconciles stale runtime state. Synchronous: no I/O.
  peekThread(threadId: string): ServiceResult<HydrateThreadResult>;
  startThread(input: StartThreadInput): Promise<ServiceResult<StartThreadResult>>;
  sendComposerInput(
    input: SendComposerInput,
  ): Promise<ServiceResult<SendComposerInputResult>>;
  updateThreadLaunchOptions(
    input: UpdateThreadLaunchOptionsInput,
  ): Promise<ServiceResult<UpdateThreadLaunchOptionsResult>>;
  editPendingInput(
    input: EditPendingInputInput,
  ): Promise<ServiceResult<EditPendingInputResult>>;
  answerPrompt(input: AnswerPromptInput): Promise<ServiceResult<AnswerPromptResult>>;
  recordProviderPromptState(
    input: RecordProviderPromptStateInput,
  ): Promise<ServiceResult<RecordProviderPromptStateResult>>;
  recordProviderSessionRef(
    input: RecordProviderSessionRefInput,
  ): Promise<ServiceResult<RecordProviderSessionRefResult>>;
  recordAgentSessionBlock(
    input: RecordAgentSessionBlockInput,
  ): Promise<ServiceResult<RecordAgentSessionBlockResult>>;
  resumeAgentRuntime(
    input: ResumeAgentRuntimeInput,
  ): Promise<ServiceResult<ResumeAgentRuntimeResult>>;
  stopAgentRuntime(
    input: StopAgentRuntimeInput,
  ): Promise<ServiceResult<StopAgentRuntimeResult>>;
  trustWorkspace(
    input: TrustWorkspaceInput,
  ): Promise<ServiceResult<TrustWorkspaceResult>>;
  recordTurnComplete(
    input: RecordTurnCompleteInput,
  ): Promise<ServiceResult<RecordTurnCompleteResult>>;
  handleWorkbenchCommand(
    input: WorkbenchCommandInput,
  ): Promise<ServiceResult<WorkbenchCommandResult>>;
  readWorkspaceFileTree(
    input: ReadWorkspaceFileTreeInput,
  ): Promise<ServiceResult<ReadWorkspaceFileTreeResult>>;
  searchWorkspaceContent(
    input: SearchWorkspaceContentInput,
  ): Promise<ServiceResult<SearchWorkspaceContentResult>>;
  appendRawAgentFrame(input: AppendRawAgentFrameInput): Promise<RawAgentFrame>;
  listTideMcpTools(): TideMcpToolDefinition[];
  handleTideMcpToolCall(
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<TideMcpToolCallResult>>;
}

export function createThreadRuntimeService(
  input: CreateThreadRuntimeServiceInput,
): ThreadRuntimeService {
  return new InMemoryThreadRuntimeService(input);
}

class InMemoryThreadRuntimeService implements ThreadRuntimeService {
  agentRuntimePort: AgentRuntimePort;
  providerReadinessPort: ProviderReadinessPort;
  ptyTranscriptPort: PtyTranscriptPort;
  providerSetupSurfaceTerminalPort?: ProviderSetupSurfaceTerminalPort;
  workbenchTerminalPort?: WorkbenchTerminalPort;
  workspaceCommandPort: WorkspaceCommandPort;
  workspaceFilePort: WorkspaceFilePort;
  workspaceCodeIntelligencePort: WorkspaceCodeIntelligencePort;
  composerAttachmentStorePort?: ComposerAttachmentStorePort;
  providerTrustPort?: ProviderTrustPort;
  ensureScratchDirectory?: (threadId: string) => string;
  defaultWorkbenchTerminalCommand: string;
  clock: () => string;
  idGenerator: () => string;
  onAsyncEvent?: (event: ThreadRuntimeAsyncEvent) => Promise<void> | void;
  threads = new ThreadStore();
  // threadId -> promptId currently being written to the runtime (answer claim).
  private readonly answeringPromptByThread = new Map<string, string>();
  private readonly threadCrud: ThreadCrudService;
  private readonly workbenchRuntime: WorkbenchRuntime;
  private readonly workbenchFileOps: WorkbenchFileOperations;
  private readonly workbenchExec: WorkbenchExecOperations;
  private readonly tideMcp: TideMcpToolHandler;
  private readonly workbenchCmd: WorkbenchCommandHandler;

  constructor(input: CreateThreadRuntimeServiceInput) {
    this.agentRuntimePort = input.agentRuntimePort;
    this.providerReadinessPort = input.providerReadinessPort;
    this.ptyTranscriptPort = input.ptyTranscriptPort;
    this.providerSetupSurfaceTerminalPort = input.providerSetupSurfaceTerminalPort;
    this.workbenchTerminalPort = input.workbenchTerminalPort;
    this.workspaceCommandPort = input.workspaceCommandPort ?? createUnavailableWorkspaceCommandPort();
    this.workspaceFilePort = input.workspaceFilePort ?? createUnavailableWorkspaceFilePort();
    this.workspaceCodeIntelligencePort =
      input.workspaceCodeIntelligencePort ?? createUnavailableWorkspaceCodeIntelligencePort();
    this.composerAttachmentStorePort = input.composerAttachmentStorePort;
    this.providerTrustPort = input.providerTrustPort;
    this.ensureScratchDirectory = input.ensureScratchDirectory;
    this.defaultWorkbenchTerminalCommand =
      input.defaultWorkbenchTerminalCommand ?? DEFAULT_WORKBENCH_TERMINAL_COMMAND;
    this.clock = input.clock ?? defaultClock;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;
    this.onAsyncEvent = input.onAsyncEvent;
    this.threadCrud = new ThreadCrudService({ store: this.threads, clock: this.clock });
    this.workbenchRuntime = new WorkbenchRuntime({
      store: this.threads,
      workbenchTerminalPort: this.workbenchTerminalPort,
      providerSetupSurfaceTerminalPort: this.providerSetupSurfaceTerminalPort,
      clock: this.clock,
      idGenerator: this.idGenerator,
      emitAsyncEvent: (event) => this.emitAsyncEvent(event),
      onProviderSetupReady: (thread, pane) =>
        this.replayPendingInputIfProviderReady(thread, pane),
    });
    this.workbenchFileOps = new WorkbenchFileOperations({
      workspaceFilePort: this.workspaceFilePort,
      clock: this.clock,
      idGenerator: this.idGenerator,
    });
    this.workbenchExec = new WorkbenchExecOperations({
      workspaceCommandPort: this.workspaceCommandPort,
      workspaceCodeIntelligencePort: this.workspaceCodeIntelligencePort,
      workbenchRuntime: this.workbenchRuntime,
      workbenchFileOps: this.workbenchFileOps,
      defaultWorkbenchTerminalCommand: this.defaultWorkbenchTerminalCommand,
      clock: this.clock,
      idGenerator: this.idGenerator,
    });
    this.tideMcp = new TideMcpToolHandler({
      store: this.threads,
      clock: this.clock,
      idGenerator: this.idGenerator,
      emitAsyncEvent: (event) => this.emitAsyncEvent(event),
      workbenchFileOps: this.workbenchFileOps,
      workbenchExec: this.workbenchExec,
    });
    this.workbenchCmd = new WorkbenchCommandHandler({
      threads: this.threads,
      clock: this.clock,
      idGenerator: this.idGenerator,
      defaultWorkbenchTerminalCommand: this.defaultWorkbenchTerminalCommand,
      workbenchRuntime: this.workbenchRuntime,
      workbenchFileOps: this.workbenchFileOps,
      workspaceFilePort: this.workspaceFilePort,
      workspaceCommandPort: this.workspaceCommandPort,
      workspaceCodeIntelligencePort: this.workspaceCodeIntelligencePort,
    });

    for (const seed of input.initialThreads ?? []) {
      this.threads.set(seed.threadId, normalizeThreadSeed(seed));
    }
  }

  // Thread store/list operations are owned by ThreadCrudService (shared store).
  restoreThreads(
    input: RestoreThreadsInput,
  ): Promise<ServiceResult<RestoreThreadsResult>> {
    return this.threadCrud.restoreThreads(input);
  }

  listThreads(input: ListThreadsInput): Promise<ServiceResult<ListThreadsResult>> {
    return this.threadCrud.listThreads(input);
  }

  archiveThread(
    input: ArchiveThreadInput,
  ): Promise<ServiceResult<ArchiveThreadResult>> {
    return this.threadCrud.archiveThread(input);
  }

  setThreadPinned(
    input: SetThreadPinnedInput,
  ): Promise<ServiceResult<SetThreadPinnedResult>> {
    return this.threadCrud.setThreadPinned(input);
  }

  renameThread(
    input: RenameThreadInput,
  ): Promise<ServiceResult<RenameThreadResult>> {
    return this.threadCrud.renameThread(input);
  }

  async hydrateThread(
    input: HydrateThreadInput,
  ): Promise<ServiceResult<HydrateThreadResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    // A pending prompt is ONLY answerable while the runtime that asked it is
    // alive: the answer is replayed as keystrokes on that runtime's hidden PTY.
    // After an app restart (runtime gone, prompt not persisted) or a mid-session
    // runtime death, a leftover waiting state is STALE — resurrecting a permission
    // card for a dead process is a lie (answering writes to nothing). On an
    // EXPLICIT user open, reconcile such a thread to idle: drop the stale prompt
    // and let the composer work, so the next message resumes the provider session.
    // This NEVER runs on the internal polling reads (reconcileStaleRuntime stays
    // false there) — mutating on every poll would race-kill a live turn.
    if (
      input.reconcileStaleRuntime === true &&
      thread.activeRuntimeHandle === undefined &&
      (thread.runtimeState === "waiting_for_approval" ||
        thread.runtimeState === "waiting_for_input" ||
        thread.runtimeState === "running" ||
        thread.runtimeState === "starting")
    ) {
      thread.runtimeState = "idle";
      thread.lastKnownState = "idle";
      thread.lifecycleState = "open";
      thread.promptState = undefined;
      thread.promptQueue = undefined;
      thread.updatedAt = this.clock();
    }

    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      blocks: cloneBlocks(thread.cachedBlocks),
    };
  }

  peekThread(threadId: string): ServiceResult<HydrateThreadResult> {
    const thread = this.threads.get(threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    return {
      ok: true,
      thread: snapshotThread(thread, { shareBlocks: true }),
      runtimeState: thread.runtimeState,
      blocks: thread.cachedBlocks,
    };
  }

  async startThread(
    input: StartThreadInput,
  ): Promise<ServiceResult<StartThreadResult>> {
    const capturedAt = this.clock();
    const threadId = input.threadId ?? this.idGenerator();
    const thread: ThreadRecord = {
      threadId,
      title: titleFromMessage(input.initialMessage),
      agentBinding: cloneAgentBinding(input.agentBinding),
      scope: cloneScope(input.scope),
      launchOptions: cloneLaunchOptions(input.launchOptions),
      lifecycleState: "creating",
      runtimeState: "not_started",
      lastKnownState: "idle",
      createdAt: capturedAt,
      updatedAt: capturedAt,
      cachedBlocks: [],
      rawFrameSequence: 0,
      mcpToolCallCount: 0,
      workbench: defaultWorkbenchState(),
    };
    this.threads.set(threadId, thread);

    // A Scratch Thread runs in a real Tide-owned per-thread dir; materialize + trust
    // it before readiness/attachments so the agent proceeds without a trust prompt.
    // See docs_v2/specs/scratch-execution-context.md.
    await this.materializeScratchScope(thread);

    // Materialize any pasted images and fold their paths into the message so the
    // Agent can read them. Done before readiness so a deferred (not-ready) send
    // still carries the references. See composer-image-attachments spec.
    const { text: message, attachments: messageAttachments } =
      await this.composeMessageWithAttachments(thread, input.initialMessage, input.attachments);

    const readiness = await this.providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: thread.scope,
      launchOptions: thread.launchOptions,
    });

    if (!readiness.ready) {
      thread.lifecycleState = "open";
      this.enqueuePendingInput(thread, {
        kind: "composer_input",
        value: message,
        capturedAt,
        launchOptions: cloneLaunchOptions(input.launchOptions),
        attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
      });
      thread.updatedAt = this.clock();

      return {
        ok: true,
        status: "provider_not_ready",
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        providerReadiness: readiness,
      };
    }

    thread.runtimeState = "starting";
    thread.runtimeStartedAt = this.clock();
    thread.lifecycleState = "running";
    thread.lastKnownState = "running";
    thread.updatedAt = this.clock();

    // Provider CLIs receive the first message as the launch-time initial prompt
    // (positional/flag), which reliably starts a turn. Tide API Agents have no
    // launch argv, so they still receive it via writeInput.
    const deliverPromptViaLaunch =
      thread.agentBinding.runtimeSource?.kind === "provider_cli";
    const attachmentsForRuntime = messageAttachments.length > 0 ? messageAttachments : undefined;
    const handle = await this.agentRuntimePort.start({
      threadId,
      agentBinding: cloneAgentBinding(thread.agentBinding),
      scope: cloneScope(thread.scope),
      launchOptions: thread.launchOptions,
      initialPrompt: deliverPromptViaLaunch ? message : undefined,
      initialAttachments: deliverPromptViaLaunch ? attachmentsForRuntime : undefined,
    });
    const submittedBlock = this.appendLocalUserMessageBlock(thread, message);

    thread.activeRuntimeHandle = cloneRuntimeHandle(handle);
    thread.runtimeState = "running";
    thread.updatedAt = this.clock();

    if (!deliverPromptViaLaunch) {
      await this.agentRuntimePort.writeInput(handle, {
        kind: "composer_input",
        value: message,
        submittedAt: this.clock(),
        attachments: attachmentsForRuntime,
      });
    }

    return {
      ok: true,
      status: "started",
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      providerReadiness: readiness,
      submittedBlock,
    };
  }

  private async composeMessageWithAttachments(
    thread: ThreadRecord,
    text: string,
    attachments: ComposerAttachmentInput[] | undefined,
  ): Promise<{ text: string; attachments: ComposerAttachmentRef[] }> {
    if (
      attachments === undefined ||
      attachments.length === 0 ||
      this.composerAttachmentStorePort === undefined
    ) {
      return { text, attachments: [] };
    }
    // Written under Tide's app-data dir (keyed by threadId), NEVER the user's
    // repo — so attachments never pollute git and need no .gitignore.
    const paths = await this.composerAttachmentStorePort.materialize({
      threadId: thread.threadId,
      attachments,
    });
    // Each client reads these bytes back into its NATIVE inline image input
    // (claude image block / codex localImage / ACP image ContentBlock); the path
    // also rides the message text as "[Attached image: <path>]" purely so the
    // transcript renders a thumbnail (claude strips it, having the image inline).
    const refs: ComposerAttachmentRef[] = paths.map((path, index) => ({
      path,
      mediaType: attachments[index]?.mediaType ?? "image/png",
    }));
    const lines = refs.map((ref) => `[Attached image: ${ref.path}]`);
    if (lines.length === 0) {
      return { text, attachments: [] };
    }
    const folded = text.length > 0 ? `${text}\n\n${lines.join("\n")}` : lines.join("\n");
    return { text: folded, attachments: refs };
  }

  async sendComposerInput(
    input: SendComposerInput,
  ): Promise<ServiceResult<SendComposerInputResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    if (
      input.agentId !== undefined &&
      input.agentId !== thread.agentBinding.agentId
    ) {
      return failure(
        "agent_binding_locked",
        "Thread Agent Binding cannot be changed by follow-up input.",
      );
    }

    // Launch options carried on the send (the composer's current model/
    // permission/reasoning) route through the same merge/apply path as the
    // explicit thread.setLaunchOptions command — a follow-up send can never
    // silently drop a changed setting again.
    await this.mergeAndApplyLaunchOptions(thread, input.launchOptions);

    // Materialize pasted images and fold their paths into the message before any
    // readiness/busy branch, so a queued or deferred send still carries them.
    const { text: message, attachments: messageAttachments } =
      await this.composeMessageWithAttachments(thread, input.input, input.attachments);
    const attachmentsForRuntime = messageAttachments.length > 0 ? messageAttachments : undefined;

    const readiness = await this.providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: thread.scope,
      launchOptions: thread.launchOptions,
    });

    if (!readiness.ready) {
      this.enqueuePendingInput(thread, {
        kind: "composer_input",
        value: message,
        capturedAt: this.clock(),
        launchOptions: cloneLaunchOptions(thread.launchOptions),
        attachments: attachmentsForRuntime,
      });
      thread.updatedAt = this.clock();

      return {
        ok: true,
        status: "provider_not_ready",
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        providerReadiness: readiness,
      };
    }

    // While a turn is genuinely in flight, queue the input Tide-side and flush it when
    // the turn completes (recordTurnComplete). The user can interrupt to send sooner.
    // (An idle thread takes the path below and sends immediately.)
    // "Busy" includes waiting on a prompt card: writing composer text into the
    // open TUI box would blind-answer it (adversarial review finding). The text
    // queues and flushes when the turn completes.
    const busy =
      thread.activeRuntimeHandle !== undefined &&
      (thread.runtimeState === "running" ||
        thread.runtimeState === "starting" ||
        thread.runtimeState === "waiting_for_approval" ||
        thread.runtimeState === "waiting_for_input");
    if (busy) {
      // MID-TURN STEER: when the provider can inject input INTO the running turn
      // (codex turn/steer) and the turn is genuinely in flight — `running`, never
      // a `waiting_*` prompt card, which the user must answer first — deliver the
      // input now instead of queuing it for the turn's end. The runtime client
      // owns the start-vs-steer decision from its own turn state; the service only
      // gates on the declared capability (no agentId branch). Other providers fall
      // through to the queue below.
      if (
        thread.runtimeState === "running" &&
        readiness.capabilities?.supportsTurnSteer === true &&
        thread.activeRuntimeHandle !== undefined
      ) {
        const submittedBlock = this.appendLocalUserMessageBlock(thread, message);
        thread.runtimeStartedAt = this.clock();
        thread.updatedAt = this.clock();
        await this.agentRuntimePort.writeInput(thread.activeRuntimeHandle, {
          kind: "composer_input",
          value: message,
          submittedAt: this.clock(),
          attachments: attachmentsForRuntime,
        });
        return {
          ok: true,
          status: "sent",
          thread: snapshotThread(thread),
          runtimeState: thread.runtimeState,
          providerReadiness: readiness,
          submittedBlock,
        };
      }
      this.enqueuePendingInput(thread, {
        kind: "composer_input",
        value: message,
        capturedAt: this.clock(),
        launchOptions: cloneLaunchOptions(thread.launchOptions),
        attachments: attachmentsForRuntime,
      });
      thread.updatedAt = this.clock();
      return {
        ok: true,
        status: "queued",
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        providerReadiness: readiness,
      };
    }

    // A restart-required options change is consumed here, at the turn boundary:
    // the idle process is stopped and activeOrResumedHandle respawns it via the
    // provider-native resume with the new options (covered by the spinner).
    await this.consumePendingRuntimeRestart(thread);
    const handle = await this.activeOrResumedHandle(thread);
    const submittedBlock = this.appendLocalUserMessageBlock(thread, message);
    thread.runtimeState = "running";
    thread.runtimeStartedAt = this.clock();
    thread.lifecycleState = "running";
    thread.lastKnownState = "running";
    thread.updatedAt = this.clock();

    await this.agentRuntimePort.writeInput(handle, {
      kind: "composer_input",
      value: message,
      submittedAt: this.clock(),
      attachments: attachmentsForRuntime,
    });

    return {
      ok: true,
      status: "sent",
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      providerReadiness: readiness,
      submittedBlock,
    };
  }

  // --- Composer follow-up queue (head = pendingInput, tail = pendingInputQueue) ---

  // Enqueue a follow-up: fill the empty head slot, else append to the FIFO tail.
  private enqueuePendingInput(thread: ThreadRecord, pending: PendingInput): void {
    if (thread.pendingInput === undefined) {
      thread.pendingInput = pending;
    } else {
      (thread.pendingInputQueue ??= []).push(pending);
    }
  }

  // Promote the next queued follow-up into the head slot once the head ran/was
  // dropped (FIFO). Clears the tail array when empty so the single-queue path stays
  // byte-identical (head undefined, no tail). Replaces `pendingInput = undefined`.
  private promoteNextPendingInput(thread: ThreadRecord): void {
    thread.pendingInput = thread.pendingInputQueue?.shift();
    if (thread.pendingInputQueue !== undefined && thread.pendingInputQueue.length === 0) {
      thread.pendingInputQueue = undefined;
    }
  }

  // The whole follow-up queue, head first — for index-addressed edits/removals.
  private pendingInputsOf(thread: ThreadRecord): PendingInput[] {
    return thread.pendingInput === undefined
      ? []
      : [thread.pendingInput, ...(thread.pendingInputQueue ?? [])];
  }

  private writePendingInputs(thread: ThreadRecord, queue: PendingInput[]): void {
    thread.pendingInput = queue[0];
    thread.pendingInputQueue = queue.length > 1 ? queue.slice(1) : undefined;
  }

  // Mid-thread Launch Options change (model/permission/reasoning). Persists the
  // merged options on the thread record and applies them to the live runtime —
  // protocol-native when the provider supports it, otherwise via a transparent
  // restart at the next turn. Spec: mid-thread-launch-option-changes.md.
  async updateThreadLaunchOptions(
    input: UpdateThreadLaunchOptionsInput,
  ): Promise<ServiceResult<UpdateThreadLaunchOptionsResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    const applied = await this.mergeAndApplyLaunchOptions(thread, input.launchOptions);
    return { ok: true, thread: snapshotThread(thread), applied };
  }

  // Merge new Launch Options into the thread record and route the change to the
  // live runtime. Shared by the explicit thread.setLaunchOptions command and
  // the launch options piggybacked on composer.sendInput.
  private async mergeAndApplyLaunchOptions(
    thread: ThreadRecord,
    launchOptions: Record<string, unknown> | undefined,
  ): Promise<"live" | "next_turn" | "none"> {
    if (launchOptions === undefined) {
      return "none";
    }
    const previous = thread.launchOptions ?? {};
    const changedKeys = RUNTIME_LAUNCH_OPTION_KEYS.filter(
      (key) => key in launchOptions && launchOptions[key] !== previous[key],
    );
    if (changedKeys.length === 0) {
      return "none";
    }
    thread.launchOptions = { ...previous, ...launchOptions };
    thread.updatedAt = this.clock();
    if (thread.activeRuntimeHandle === undefined) {
      // No live session — the next spawn/resume reads thread.launchOptions.
      return "none";
    }
    const result = await this.agentRuntimePort.applySessionConfig(
      thread.activeRuntimeHandle,
      { launchOptions: { ...thread.launchOptions }, changedKeys },
    );
    if (result === "applied") {
      // NOTE: an earlier restart-required change stays pending — the restart
      // re-applies every current option at spawn, so nothing is lost.
      return thread.pendingRuntimeRestart === true ? "next_turn" : "live";
    }
    thread.pendingRuntimeRestart = true;
    return "next_turn";
  }

  // Consume a pending restart-required options change at a turn boundary: stop
  // the (idle — never mid-turn) process and clear the handle so the caller's
  // activeOrResumedHandle respawns via provider-native resume with the thread's
  // current options. No UI state of its own; the turn spinner covers it.
  private async consumePendingRuntimeRestart(thread: ThreadRecord): Promise<void> {
    if (thread.pendingRuntimeRestart !== true) {
      return;
    }
    thread.pendingRuntimeRestart = false;
    const handle = thread.activeRuntimeHandle;
    if (handle === undefined) {
      return;
    }
    thread.activeRuntimeHandle = undefined;
    await this.agentRuntimePort.stop(handle);
  }

  // Edit the queued (not-yet-sent) Composer message. The runtime has not seen the
  // queued input, so editing only mutates Tide-owned state — no provider rewind,
  // identical for every Agent. A blank value discards that queued message; `index`
  // (default 0 = the head/next to run) selects which one in the follow-up queue.
  // Spec: docs_v2/specs/composer-message-edit.md.
  async editPendingInput(
    input: EditPendingInputInput,
  ): Promise<ServiceResult<EditPendingInputResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    const index = input.index ?? 0;
    const queue = this.pendingInputsOf(thread);
    const pending = queue[index];
    if (pending === undefined || pending.kind !== "composer_input") {
      return failure(
        "no_pending_input",
        "There is no queued Composer input to edit.",
      );
    }

    const discards = input.value.trim().length === 0;
    if (discards) {
      queue.splice(index, 1);
    } else {
      queue[index] = {
        kind: "composer_input",
        value: input.value,
        capturedAt: this.clock(),
        // Preserve the queued message's launch options + attachments across the edit.
        launchOptions: cloneLaunchOptions(pending.launchOptions),
        attachments: pending.attachments,
      };
    }
    this.writePendingInputs(thread, queue);
    thread.updatedAt = this.clock();
    return {
      ok: true,
      thread: snapshotThread(thread),
      status: discards ? "discarded" : "edited",
    };
  }

  async answerPrompt(
    input: AnswerPromptInput,
  ): Promise<ServiceResult<AnswerPromptResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    if (
      thread.promptState === undefined ||
      thread.promptState.promptId !== input.promptId
    ) {
      return failure("prompt_not_found", "Prompt State was not found.");
    }
    if (thread.activeRuntimeHandle === undefined) {
      return failure(
        "agent_runtime_unavailable",
        "Active Agent Runtime is required to answer Prompt State.",
      );
    }
    // Claim the answer SYNCHRONOUSLY before the (multi-keystroke) async write: a
    // concurrent duplicate answer passing the checks above would interleave raw
    // bytes into the same TUI box and could silently answer the NEXT box
    // (adversarial review finding). Duplicates fail fast as prompt_not_found.
    if (this.answeringPromptByThread.get(input.threadId) === input.promptId) {
      return failure("prompt_not_found", "Prompt State is already being answered.");
    }
    this.answeringPromptByThread.set(input.threadId, input.promptId);
    try {

    await this.agentRuntimePort.writeInput(thread.activeRuntimeHandle, {
      kind: "prompt_answer",
      value: promptAnswerValue(thread.promptState, input),
      choiceId: input.choiceId,
      promptId: input.promptId,
      submittedAt: this.clock(),
    });

    // Promote the next queued prompt (a batched multi-permission turn) so the
    // user answers them one at a time instead of the agent hanging on the ones
    // the single slot dropped. With none queued, the turn resumes running.
    const next = (thread.promptQueue ?? []).shift();
    if (next !== undefined) {
      const nextKnown: LastKnownState =
        runtimeStateForPromptKind(next.kind) === "waiting_for_approval"
          ? "waiting_for_approval"
          : "waiting_for_input";
      thread.promptState = next;
      thread.runtimeState = runtimeStateForPromptKind(next.kind);
      thread.lifecycleState = nextKnown;
      thread.lastKnownState = nextKnown;
      thread.updatedAt = this.clock();
      return {
        ok: true,
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        promptState: next,
      };
    }

    thread.promptState = undefined;
    thread.runtimeState = "running";
    thread.runtimeStartedAt = this.clock();
    thread.lifecycleState = "running";
    thread.lastKnownState = "running";
    thread.updatedAt = this.clock();

    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      promptState: null,
    };
    } finally {
      this.answeringPromptByThread.delete(input.threadId);
    }
  }

  async recordProviderPromptState(
    input: RecordProviderPromptStateInput,
  ): Promise<ServiceResult<RecordProviderPromptStateResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    if (
      input.promptState.threadId !== input.threadId ||
      input.promptState.agentId !== thread.agentBinding.agentId
    ) {
      return failure(
        "agent_binding_locked",
        "Provider Prompt State must belong to the Thread Agent Binding.",
      );
    }
    // Prompts die with the runtime — and may not be BORN without one either. A
    // signal poll's grace cycles can deliver a prompt written just before Stop;
    // recording it would resurrect a card on a dead runtime (answer fails with
    // agent_runtime_unavailable) and re-arm the pollers for the 90-minute cap
    // (adversarial review finding, verified line-by-line).
    if (thread.activeRuntimeHandle === undefined) {
      return failure(
        "agent_runtime_unavailable",
        "Prompt State requires a live Agent Runtime.",
      );
    }

    const promptState = {
      ...input.promptState,
      choices: input.promptState.choices?.map((choice) => ({ ...choice })),
    };

    // Idempotent: a redraw/re-poll of the SAME prompt (by id) updates in place
    // and never duplicates. A prompt already queued behind the current one is
    // likewise ignored.
    if (thread.promptState?.promptId === promptState.promptId) {
      thread.promptState = promptState;
      thread.updatedAt = this.clock();
      return { ok: true, thread: snapshotThread(thread), runtimeState: thread.runtimeState, promptState };
    }
    if ((thread.promptQueue ?? []).some((p) => p.promptId === promptState.promptId)) {
      // Already queued: report the still-visible prompt (the queue invariant is
      // that a queue only exists while a prompt is visible).
      return { ok: true, thread: snapshotThread(thread), runtimeState: thread.runtimeState, promptState: thread.promptState ?? promptState };
    }

    // A different prompt is already pending → QUEUE this one (don't clobber the
    // visible card). It surfaces when the current one is answered. This is what
    // makes a batched multi-permission turn answerable instead of hanging.
    if (thread.promptState !== undefined) {
      thread.promptQueue = [...(thread.promptQueue ?? []), promptState];
      thread.updatedAt = this.clock();
      return { ok: true, thread: snapshotThread(thread), runtimeState: thread.runtimeState, promptState: thread.promptState };
    }

    const nextRuntimeState = runtimeStateForPromptKind(input.promptState.kind);
    const nextKnownState: LastKnownState = nextRuntimeState === "waiting_for_approval"
      ? "waiting_for_approval"
      : "waiting_for_input";

    thread.promptState = promptState;
    thread.runtimeState = nextRuntimeState;
    thread.lifecycleState = nextKnownState;
    thread.lastKnownState = nextKnownState;
    thread.updatedAt = this.clock();

    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      promptState,
    };
  }

  async recordProviderSessionRef(
    input: RecordProviderSessionRefInput,
  ): Promise<ServiceResult<RecordProviderSessionRefResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    if (input.agentId !== thread.agentBinding.agentId) {
      return failure(
        "agent_binding_locked",
        "Provider session reference must belong to the Thread Agent Binding.",
      );
    }

    const existing = thread.agentBinding.providerSessionRef;
    if (
      existing !== undefined &&
      (existing.kind !== input.providerSessionRef.kind ||
        existing.value !== input.providerSessionRef.value)
    ) {
      // A DIFFERENT session may never steal the binding.
      return {
        ok: true,
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
      };
    }
    if (
      existing !== undefined &&
      providerSessionRefsEqual(existing, input.providerSessionRef)
    ) {
      return {
        ok: true,
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
      };
    }

    // Same session (kind+value): allow the paths to be REFINED — the launch plan
    // may know the session id before the provider materializes the file, and the
    // hook later reports the authoritative on-disk path (which can differ from any
    // plan-time guess via symlinks/casing). Never erase a known path with undefined.
    const transcriptPath =
      input.providerSessionRef.transcriptPath ?? existing?.transcriptPath;
    const logPath = input.providerSessionRef.logPath ?? existing?.logPath;
    thread.agentBinding.providerSessionRef = {
      kind: input.providerSessionRef.kind,
      value: input.providerSessionRef.value,
      ...(transcriptPath !== undefined ? { transcriptPath } : {}),
      ...(logPath !== undefined ? { logPath } : {}),
    };
    thread.updatedAt = this.clock();

    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
    };
  }

  async recordAgentSessionBlock(
    input: RecordAgentSessionBlockInput,
  ): Promise<ServiceResult<RecordAgentSessionBlockResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    if (input.block.agentId !== thread.agentBinding.agentId) {
      return failure(
        "agent_binding_locked",
        "Agent Session Block must belong to the Thread Agent Binding.",
      );
    }

    const reference = toAgentSessionBlockReference(input.block);
    const existingIndex = thread.cachedBlocks.findIndex(
      (block) => block.blockId === reference.blockId,
    );
    if (existingIndex === -1) {
      thread.cachedBlocks.push(reference);
    } else {
      thread.cachedBlocks[existingIndex] = reference;
    }
    thread.updatedAt = this.clock();

    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      blocks: cloneBlocks(thread.cachedBlocks),
    };
  }

  async resumeAgentRuntime(
    input: ResumeAgentRuntimeInput,
  ): Promise<ServiceResult<ResumeAgentRuntimeResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    try {
      await this.consumePendingRuntimeRestart(thread);
      await this.activeOrResumedHandle(thread);
    } catch (error) {
      return failure(
        "agent_runtime_unavailable",
        error instanceof Error
          ? error.message
          : "Agent Runtime could not be resumed.",
      );
    }

    thread.runtimeState = "running";
    thread.runtimeStartedAt = this.clock();
    thread.lifecycleState = "running";
    thread.lastKnownState = "running";
    thread.updatedAt = this.clock();

    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
    };
  }

  async stopAgentRuntime(
    input: StopAgentRuntimeInput,
  ): Promise<ServiceResult<StopAgentRuntimeResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    // TRUE INTERRUPT: abort the in-flight turn via the provider's protocol, but
    // keep the runtime ALIVE and resumable — the next message reuses the same
    // session with no respawn. (Process teardown happens on app quit / a
    // duplicate-runtime reap, not here.) The interrupt makes the provider emit
    // its turn-end (claude result / codex turn:interrupted / gemini cancelled),
    // which drives recordTurnComplete.
    if (thread.activeRuntimeHandle !== undefined) {
      await this.agentRuntimePort.interrupt(thread.activeRuntimeHandle);
    }
    // Prompts die with the interrupted turn.
    thread.promptState = undefined;
    thread.promptQueue = undefined;

    // A queued follow-up is consumed on the SAME live runtime: stay `running` so
    // the aborted turn-end's recordTurnComplete flushes it (no respawn, and no
    // race with starting a new turn before the old one's abort lands). Requires
    // a live handle — without one there is nothing to flush onto.
    if (
      thread.pendingInput?.kind === "composer_input" &&
      thread.activeRuntimeHandle !== undefined
    ) {
      thread.runtimeState = "running";
      thread.lifecycleState = "running";
      thread.lastKnownState = "running";
      thread.updatedAt = this.clock();
      return {
        ok: true,
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
      };
    }

    // Plain interrupt: settle to idle now (the aborted turn-end no-ops on idle),
    // keeping the runtime alive for the next message. With no live handle to flush
    // onto, any queued follow-ups are dropped (the user chose to interrupt).
    thread.pendingInput = undefined;
    thread.pendingInputQueue = undefined;
    thread.runtimeState = "idle";
    thread.lifecycleState = "open";
    thread.lastKnownState = "idle";
    thread.updatedAt = this.clock();

    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
    };
  }

  // Grant the provider's own Workspace Trust for this Thread's Execution Context
  // cwd, then re-check Provider Readiness. If the provider is now ready and a
  // Composer input was held pending trust, proceed with it. See
  // docs_v2/specs/workspace-trust-grant.md.
  // Resolves a Scratch Thread's cwd to a real Tide-owned dir under the app-support
  // scratch root, creates it, persists the path, and auto-trusts it for the agent.
  // Idempotent: a second call returns the same path and does not re-trust.
  private async materializeScratchScope(thread: ThreadRecord): Promise<void> {
    if (thread.scope?.kind !== "scratch" || this.ensureScratchDirectory === undefined) {
      return;
    }
    const realCwd = this.ensureScratchDirectory(thread.threadId);
    if (thread.scope.scratchCwd === realCwd) {
      return;
    }
    thread.scope = { kind: "scratch", scratchCwd: realCwd };
    thread.updatedAt = this.clock();
    if (this.providerTrustPort !== undefined) {
      await this.providerTrustPort.trust({
        agentId: thread.agentBinding.agentId,
        cwd: realCwd,
      });
    }
  }

  async trustWorkspace(
    input: TrustWorkspaceInput,
  ): Promise<ServiceResult<TrustWorkspaceResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    const cwd = threadRoot(thread);
    if (cwd === undefined) {
      return failure(
        "directory_trust_unavailable",
        "Thread has no Execution Context cwd to trust.",
      );
    }

    if (this.providerTrustPort !== undefined) {
      await this.providerTrustPort.trust({
        agentId: thread.agentBinding.agentId,
        cwd,
      });
    }

    const readiness = await this.providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: thread.scope,
      launchOptions: thread.launchOptions,
    });
    thread.updatedAt = this.clock();
    this.emitAsyncEvent({
      kind: "provider_readiness_changed",
      threadId: thread.threadId,
      readiness,
    });

    if (readiness.ready && thread.pendingInput !== undefined) {
      await this.replayPendingInputAfterTrust(thread);
    }

    return {
      ok: true,
      status: readiness.ready ? "trusted" : "still_not_ready",
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      providerReadiness: readiness,
    };
  }

  private async replayPendingInputAfterTrust(thread: ThreadRecord): Promise<void> {
    const pendingInput = thread.pendingInput;
    if (pendingInput === undefined) {
      return;
    }
    thread.runtimeState = "starting";
    thread.runtimeStartedAt = this.clock();
    thread.lifecycleState = "running";
    thread.lastKnownState = "running";
    thread.updatedAt = this.clock();
    const { handle, deliveredViaLaunch } = await this.startOrResumeRuntimeForPendingInput(
      thread,
      pendingInput.launchOptions,
      pendingInput.value,
      pendingInput.attachments,
    );
    const submittedBlock = this.appendLocalUserMessageBlock(
      thread,
      pendingInput.value,
    );
    thread.activeRuntimeHandle = cloneRuntimeHandle(handle);
    thread.runtimeState = "running";
    this.promoteNextPendingInput(thread);
    thread.updatedAt = this.clock();
    if (!deliveredViaLaunch) {
      await this.agentRuntimePort.writeInput(handle, {
        kind: "composer_input",
        value: pendingInput.value,
        submittedAt: this.clock(),
        attachments: pendingInput.attachments,
      });
    }
    const threadSnapshot = snapshotThread(thread);
    this.emitAsyncEvent({
      kind: "agent_session_block_upserted",
      thread: threadSnapshot,
      block: submittedBlock,
    });
    this.emitAsyncEvent({
      kind: "agent_runtime_state_changed",
      thread: threadSnapshot,
      runtimeState: thread.runtimeState,
    });
  }

  // Called when a provider Stop signal ends the current turn. The runtime
  // session stays alive (this is not stopAgentRuntime). If the user queued input
  // during the turn, flush it now and begin the next turn; otherwise go idle so
  // the UI stops showing "working".
  async recordTurnComplete(
    input: RecordTurnCompleteInput,
  ): Promise<ServiceResult<RecordTurnCompleteResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    // Only react to a turn ending while busy; ignore duplicate/late Stop signals.
    // BUSY includes waiting on a prompt: the provider's turn-end definitively
    // invalidates its own pending requests (interrupt while an approval is open,
    // deny cancelling the rest of a batch). Dropping the settle here instead —
    // as this guard used to — discarded the ONE-SHOT settle signal and left the
    // thread "Working" forever once the stale card was answered (adversarial
    // review finding, verified line-by-line).
    if (
      thread.runtimeState !== "running" &&
      thread.runtimeState !== "starting" &&
      thread.runtimeState !== "waiting_for_approval" &&
      thread.runtimeState !== "waiting_for_input"
    ) {
      return {
        ok: true,
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
      };
    }
    // The ended turn's pending interactions are dead; drop card + queue.
    thread.promptState = undefined;
    thread.promptQueue = undefined;

    const queued = thread.pendingInput;
    if (queued !== undefined && queued.kind === "composer_input") {
      this.promoteNextPendingInput(thread);
      // An options change that needs a runtime restart applies before the
      // flushed turn starts (the ended turn's process is idle now).
      await this.consumePendingRuntimeRestart(thread);
      const handle = await this.activeOrResumedHandle(thread);
      const submittedBlock = this.appendLocalUserMessageBlock(thread, queued.value);
      thread.runtimeState = "running";
      thread.runtimeStartedAt = this.clock();
      thread.lifecycleState = "running";
      thread.lastKnownState = "running";
      thread.updatedAt = this.clock();
      await this.agentRuntimePort.writeInput(handle, {
        kind: "composer_input",
        value: queued.value,
        submittedAt: this.clock(),
        attachments: queued.attachments,
      });
      return {
        ok: true,
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        flushedInput: queued.value,
        submittedBlock,
      };
    }

    thread.runtimeState = "idle";
    thread.lifecycleState = "open";
    thread.lastKnownState = "idle";
    thread.updatedAt = this.clock();
    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
    };
  }

  // A Launcher tab is a transient "pick what to open" pad. When the active pane is a
  // Launcher and the user opens something from it, the Launcher is consumed (replaced
  // by the opened pane) instead of lingering as a dangling empty tab.

  async appendRawAgentFrame(input: AppendRawAgentFrameInput): Promise<RawAgentFrame> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      throw new Error("Thread was not found.");
    }

    thread.rawFrameSequence += 1;
    const frame: RawAgentFrame = {
      frameId: this.idGenerator(),
      threadId: input.threadId,
      agentId: input.agentId,
      source: input.source,
      sourceRef: input.sourceRef,
      sequence: thread.rawFrameSequence,
      observedAt: this.clock(),
      payloadKind: input.payloadKind,
      payload: input.payload,
      body: input.body,
      truncated: input.truncated,
    };

    await this.ptyTranscriptPort.append(frame);
    return frame;
  }

  // Visible Workbench commands are owned by WorkbenchCommandHandler.
  handleWorkbenchCommand(
    input: WorkbenchCommandInput,
  ): Promise<ServiceResult<WorkbenchCommandResult>> {
    return this.workbenchCmd.handleWorkbenchCommand(input);
  }

  readWorkspaceFileTree(
    input: ReadWorkspaceFileTreeInput,
  ): Promise<ServiceResult<ReadWorkspaceFileTreeResult>> {
    return this.workbenchCmd.readWorkspaceFileTree(input);
  }

  searchWorkspaceContent(
    input: SearchWorkspaceContentInput,
  ): Promise<ServiceResult<SearchWorkspaceContentResult>> {
    return this.workbenchCmd.searchWorkspaceContent(input);
  }

  // Tide MCP tool surface is owned by TideMcpToolHandler (shares the store + ops).
  listTideMcpTools(): TideMcpToolDefinition[] {
    return this.tideMcp.listTools();
  }

  handleTideMcpToolCall(
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<TideMcpToolCallResult>> {
    return this.tideMcp.handleToolCall(input);
  }

  private async replayPendingInputIfProviderReady(
    thread: ThreadRecord,
    pane: TerminalPaneState,
  ): Promise<void> {
    const pendingInput = thread.pendingInput;
    if (pendingInput === undefined) {
      return;
    }

    const readiness = await this.providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: thread.scope,
      launchOptions: pendingInput.launchOptions,
    });
    if (!readiness.ready) {
      thread.updatedAt = this.clock();
      this.emitAsyncEvent({
        kind: "provider_readiness_changed",
        threadId: thread.threadId,
        readiness,
      });
      this.emitAsyncEvent({
        kind: "thread_hydrated",
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        blocks: cloneBlocks(thread.cachedBlocks),
      });
      return;
    }

    try {
      thread.runtimeState = "starting";
    thread.runtimeStartedAt = this.clock();
      thread.lifecycleState = "running";
      thread.lastKnownState = "running";
      thread.updatedAt = this.clock();
      const { handle, deliveredViaLaunch } = await this.startOrResumeRuntimeForPendingInput(
        thread,
        pendingInput.launchOptions,
        pendingInput.value,
        pendingInput.attachments,
      );
      const submittedBlock = this.appendLocalUserMessageBlock(
        thread,
        pendingInput.value,
      );
      thread.activeRuntimeHandle = cloneRuntimeHandle(handle);
      thread.runtimeState = "running";
      thread.updatedAt = this.clock();

      if (!deliveredViaLaunch) {
        await this.agentRuntimePort.writeInput(handle, {
          kind: "composer_input",
          value: pendingInput.value,
          submittedAt: this.clock(),
          attachments: pendingInput.attachments,
        });
      }
      this.promoteNextPendingInput(thread);
      thread.updatedAt = this.clock();
      const threadSnapshot = snapshotThread(thread);
      this.emitAsyncEvent({
        kind: "agent_session_block_upserted",
        thread: threadSnapshot,
        block: submittedBlock,
      });
      this.emitAsyncEvent({
        kind: "agent_runtime_state_changed",
        thread: threadSnapshot,
        runtimeState: thread.runtimeState,
      });
      this.emitAsyncEvent({
        kind: "thread_hydrated",
        thread: threadSnapshot,
        runtimeState: thread.runtimeState,
        blocks: cloneBlocks(thread.cachedBlocks),
      });
    } catch (error) {
      thread.runtimeState = "failed";
      thread.lifecycleState = "failed";
      thread.lastKnownState = "failed";
      pane.status = "failed";
      pane.transcriptPreview = boundedTranscriptPreview(
        `${pane.transcriptPreview ?? ""}\n${errorMessage(error)}\n`,
      );
      pane.revision = this.idGenerator();
      pane.updatedAt = this.clock();
      thread.updatedAt = this.clock();
      this.emitAsyncEvent({
        kind: "workbench_changed",
        thread: snapshotThread(thread),
      });
      this.emitAsyncEvent({
        kind: "agent_runtime_state_changed",
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
      });
    }
  }

  private emitAsyncEvent(event: ThreadRuntimeAsyncEvent): void {
    if (this.onAsyncEvent === undefined) {
      return;
    }

    Promise.resolve(this.onAsyncEvent(event)).catch((error: unknown) => {
      process.emitWarning(errorMessage(error), {
        type: "TideThreadRuntimeAsyncEventWarning",
      });
    });
  }

  private async startOrResumeRuntimeForPendingInput(
    thread: ThreadRecord,
    launchOptions: Record<string, unknown> | undefined,
    promptValue: string,
    promptAttachments?: ComposerAttachmentRef[],
  ): Promise<{ handle: AgentRuntimeHandle; deliveredViaLaunch: boolean }> {
    await this.consumePendingRuntimeRestart(thread);
    if (thread.activeRuntimeHandle !== undefined) {
      return { handle: thread.activeRuntimeHandle, deliveredViaLaunch: false };
    }
    if (thread.agentBinding.providerSessionRef !== undefined) {
      return { handle: await this.activeOrResumedHandle(thread), deliveredViaLaunch: false };
    }

    // A fresh Provider CLI start must receive the first message as the launch-time
    // initial prompt (positional/flag), which reliably starts a turn — exactly like
    // startThread. Without it the CLI launches idle and the typed-in message does not
    // begin a turn (the held first message never resolves). Tide API Agents have no
    // launch argv, so they receive it via writeInput.
    const deliverPromptViaLaunch =
      thread.agentBinding.runtimeSource?.kind === "provider_cli";
    const handle = await this.agentRuntimePort.start({
      threadId: thread.threadId,
      agentBinding: cloneAgentBinding(thread.agentBinding),
      scope: cloneScope(thread.scope),
      launchOptions,
      initialPrompt: deliverPromptViaLaunch ? promptValue : undefined,
      initialAttachments: deliverPromptViaLaunch ? promptAttachments : undefined,
    });
    return { handle, deliveredViaLaunch: deliverPromptViaLaunch };
  }

  private appendLocalUserMessageBlock(
    thread: ThreadRecord,
    input: string,
  ): AgentSessionBlockReference {
    const submittedAt = this.clock();
    const block = createLocalUserMessageBlock({
      threadId: thread.threadId,
      agentId: thread.agentBinding.agentId,
      input,
      submittedAt,
      localId: this.idGenerator(),
    });
    const reference = toAgentSessionBlockReference(block);
    thread.cachedBlocks.push(reference);
    return reference;
  }

  async activeOrResumedHandle(thread: ThreadRecord): Promise<AgentRuntimeHandle> {
    if (thread.activeRuntimeHandle !== undefined) {
      return thread.activeRuntimeHandle;
    }

    thread.runtimeState = "starting";
    thread.runtimeStartedAt = this.clock();
    thread.updatedAt = this.clock();
    // Resume only when there is a provider session to resume. A thread that has
    // never run (e.g. hydrated from metadata before the agent produced a session
    // ref) has no providerSessionRef, so it must start a fresh runtime instead
    // of failing the resume.
    const handle =
      thread.agentBinding.providerSessionRef === undefined
        ? await this.agentRuntimePort.start({
            threadId: thread.threadId,
            agentBinding: cloneAgentBinding(thread.agentBinding),
            scope: cloneScope(thread.scope),
            launchOptions: thread.launchOptions,
          })
        : await this.agentRuntimePort.resume({
            threadId: thread.threadId,
            agentBinding: cloneAgentBinding(thread.agentBinding),
            scope: cloneScope(thread.scope),
            // Current options, not launch-time ones: a resume respawn after a
            // mid-thread model/permission/effort change uses the new values.
            launchOptions: cloneLaunchOptions(thread.launchOptions),
          });
    thread.activeRuntimeHandle = cloneRuntimeHandle(handle);
    return handle;
  }
}

// The Launch Option keys that affect a live Agent Runtime mid-thread. The rest
// (worktree, branch, …) are start-time Execution Context and never change on an
// active thread. See docs_v2/specs/mid-thread-launch-option-changes.md.
const RUNTIME_LAUNCH_OPTION_KEYS = ["model", "permission", "reasoning"] as const;

function promptAnswerValue(
  promptState: PromptState,
  input: AnswerPromptInput,
): string {
  if (input.value !== undefined && input.value.length > 0) {
    return input.value;
  }

  const choiceId = input.choiceId;
  if (choiceId === undefined) {
    return input.value ?? "";
  }

  return promptState.choices?.find((choice) => choice.choiceId === choiceId)?.providerValue ??
    choiceId;
}


function defaultClock(): string {
  return new Date().toISOString();
}

function defaultIdGenerator(): string {
  return `id-${Math.random().toString(36).slice(2)}`;
}
