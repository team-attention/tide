import type { AnswerPromptInput, AnswerPromptResult, AppendRawAgentFrameInput, CreateDraftThreadInput, CreateDraftThreadResult, CreateThreadRuntimeServiceInput, DiscardDraftThreadInput, DiscardDraftThreadResult, HydrateThreadInput, HydrateThreadResult, RecordAgentSessionBlockInput, RecordAgentSessionBlockResult, RecordProviderPromptStateInput, RecordProviderPromptStateResult, WithdrawProviderPromptInput, WithdrawProviderPromptResult, RecordProviderSessionRefInput, RecordProviderSessionRefResult, RecordTurnCompleteInput, RecordTurnCompleteResult, ResumeAgentRuntimeInput, ResumeAgentRuntimeResult, StartThreadInput, StartThreadResult, StopAgentRuntimeInput, StopAgentRuntimeResult, ThreadRuntimeService, TrustWorkspaceInput, TrustWorkspaceResult } from "./thread-runtime-api.ts";
import { ComposerQueueService } from "./composer-queue-service.ts";
import type {
  AgentSessionBlock,
} from "../../domains/agent-session/agent-session-block.ts";

import {
  createLocalUserMessageBlock,
} from "../../domains/agent-session/agent-session-block.ts";

import type {
  RawAgentFrame,
  RawAgentFramePayloadKind,
  RawAgentFrameSource,
} from "../../domains/agent-session/raw-agent-frame.ts";

import type {
  AgentRuntimeHandle,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  AgentRuntimeState,
  TerminalInput,
} from "../../domains/agent-runtime/agent-runtime.ts";

import type {
  ProviderReadinessCheckInput,
  ProviderReadinessResult,
} from "../../domains/provider-readiness/provider-readiness.ts";

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
} from "../../domains/thread/thread.ts";

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
} from "../../domains/workbench/workbench.ts";

import { TIDE_MCP_WORKBENCH_TOOL_NAMES } from "../../domains/workbench/workbench.ts";

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
} from "../workbench/unavailable-workspace-ports.ts";

import { boundedDiffText, unifiedContentDiff } from "../support/diff-text.ts";

import { ThreadStore } from "./thread-store.ts";
import { promptAnswerValue } from "./prompt-answer-value.ts";

import { normalizeThreadSeed, snapshotThread, threadRoot } from "./thread-snapshot.ts";

import {
  activeLauncherPaneId,
  openWorkbenchLauncher,
  removeLauncherPane,
} from "../workbench/workbench-launcher.ts";

import { WorkbenchRuntime } from "../workbench/workbench-runtime.ts";

import {
  actBrowserOutput,
  clearAgentBrowserDriving,
  observeBrowserOutput,
  seedInitialWorkbenchPanes,
} from "../workbench/workbench-browser-operations.ts";

import { WorkbenchFileOperations } from "../workbench/workbench-file-operations.ts";

import { WorkbenchExecOperations } from "../workbench/workbench-exec-operations.ts";

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
} from "../support/service-value-helpers.ts";

import {
  arrayOfStrings,
  cloneEnv,
  literalStringField,
  recordField,
  recordOfStrings,
  shallowRecordEqual,
  stringField,
} from "../support/record-helpers.ts";

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
} from "../workbench/workbench-snapshot.ts";

import {
  browserPaneActionResultFromData,
  browserPaneSnapshotFromData,
  editorPanePositionFromData,
  editorPaneSaveFromData,
  providerSetupSurfaceActionFromData,
  providerSetupSurfaceInputFromData,
  type ProviderSetupSurfaceActionInput,
} from "../workbench/workbench-command-data.ts";

import type { AgentRuntimePort } from "../../ports/outbound/agent-runtime-port.ts";

import type {
  WorkspaceCodeIntelligenceErrorCode,
  WorkspaceCodeIntelligencePort,
} from "../../ports/outbound/workspace-code-intelligence-port.ts";

import type { ProviderReadinessPort } from "../../ports/outbound/provider-readiness-port.ts";

import type {
  ProviderSetupSurfaceExit,
  ProviderSetupSurfaceHandle,
  ProviderSetupSurfaceOutput,
  ProviderSetupSurfaceStartInput,
  ProviderSetupSurfaceTerminalPort,
} from "../../ports/outbound/provider-setup-surface-terminal-port.ts";

import type { PtyTranscriptPort } from "../../ports/outbound/pty-transcript-port.ts";

import type {
  ComposerAttachmentInput,
  ComposerAttachmentStorePort,
} from "../../ports/outbound/composer-attachment-store-port.ts";

import type { ProviderTrustPort } from "../../ports/outbound/provider-trust-port.ts";

import type {
  WorkspaceCommandErrorCode,
  WorkspaceCommandPort,
  WorkspaceCommandRun,
} from "../../ports/outbound/workspace-command-port.ts";

import type {
  WorkspaceFileErrorCode,
  WorkspaceFileEdit,
  WorkspaceFilePort,
  WorkspaceFileRead,
  WorkspaceFileTree,
  WorkspaceFileWrite,
} from "../../ports/outbound/workspace-file-port.ts";

import type {
  WorkbenchTerminalExit,
  WorkbenchTerminalHandle,
  WorkbenchTerminalOutput,
  WorkbenchTerminalPort,
} from "../../ports/outbound/workbench-terminal-port.ts";

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

import type { ThreadRuntimeAsyncEvent } from "./thread-runtime-events.ts";

export type { ThreadRuntimeAsyncEvent };

import { failure } from "../support/service-result.ts";

import type {
  ServiceError,
  ServiceErrorCode,
  ServiceResult,
} from "../support/service-result.ts";

export type { ServiceError, ServiceErrorCode, ServiceResult };

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
import { DraftThreadService, newThreadRecord } from "./thread-draft-service.ts";

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
} from "../tide-mcp/tide-mcp-output.ts";

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
} from "../tide-mcp/tide-mcp-tool-handler.ts";

export type { TideMcpSessionRef, TideMcpToolCallInput, TideMcpToolCallResult };

import {
  WorkbenchCommandHandler,
  type WorkbenchCommandInput,
  type WorkbenchCommandResult,
} from "../workbench/workbench-command-handler.ts";
import { WorkspaceQueryHandler } from "../workbench/workspace-query-handler.ts";

export type { WorkbenchCommandInput, WorkbenchCommandResult };

export function createThreadRuntimeService(
  input: CreateThreadRuntimeServiceInput,
): ThreadRuntimeService {
  return new InMemoryThreadRuntimeService(input);
}

function defaultClock(): string {
  return new Date().toISOString();
}

function defaultIdGenerator(): string {
  return `id-${Math.random().toString(36).slice(2)}`;
}

class InMemoryThreadRuntimeService implements ThreadRuntimeService {
  private readonly composerQueue: ComposerQueueService;
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

  private readonly draftThreads: DraftThreadService;

private readonly workbenchRuntime: WorkbenchRuntime;

private readonly workbenchFileOps: WorkbenchFileOperations;

private readonly workbenchExec: WorkbenchExecOperations;

private readonly tideMcp: TideMcpToolHandler;

private readonly workbenchCmd: WorkbenchCommandHandler;
  private readonly workspaceQuery: WorkspaceQueryHandler;

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
    // Draft Thread lifecycle (spec: composer-draft-thread). Discard kills visible-terminal
    // PTYs via the WorkbenchRuntime, injected so the collaborator stays port-light.
    this.draftThreads = new DraftThreadService({
      store: this.threads,
      clock: this.clock,
      idGenerator: this.idGenerator,
      stopTerminalPane: (pane) => this.workbenchRuntime.stopTerminalPane(pane),
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
    this.workspaceQuery = new WorkspaceQueryHandler({
      workspaceFilePort: this.workspaceFilePort,
      workspaceCodeIntelligencePort: this.workspaceCodeIntelligencePort,
    });

    this.composerQueue = new ComposerQueueService({
      threads: this.threads,
      agentRuntimePort: this.agentRuntimePort,
      providerReadinessPort: this.providerReadinessPort,
      composerAttachmentStorePort: this.composerAttachmentStorePort,
      clock: this.clock,
      idGenerator: this.idGenerator,
      appendLocalUserMessageBlock: (thread, input) => this.appendLocalUserMessageBlock(thread, input),
      activeOrResumedHandle: (thread) => this.activeOrResumedHandle(thread),
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
      clearAgentBrowserDriving(thread);
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

// Draft Thread lifecycle (create / discard / start-in-place) is owned by
  // DraftThreadService; the facade delegates. See docs_v2/specs/composer-draft-thread.md.
  createDraftThread(
    input: CreateDraftThreadInput,
  ): Promise<ServiceResult<CreateDraftThreadResult>> {
    return this.draftThreads.createDraftThread(input);
  }

  discardDraftThread(
    input: DiscardDraftThreadInput,
  ): Promise<ServiceResult<DiscardDraftThreadResult>> {
    return this.draftThreads.discardDraftThread(input);
  }

  async startThread(
    input: StartThreadInput,
  ): Promise<ServiceResult<StartThreadResult>> {
    const capturedAt = this.clock();
    const threadId = input.threadId ?? this.idGenerator();
    // Starting an existing Draft Thread reuses its record + Workbench (the panes opened
    // pre-send) and refreshes its context from the Send. A fresh start builds the record
    // and adopts any composer-screen panes (legacy path). Both share the spawn tail below.
    let thread = this.draftThreads.prepareStartInPlace(threadId, input, capturedAt);
    if (thread === undefined) {
      thread = newThreadRecord({
        threadId,
        title: titleFromMessage(input.initialMessage),
        agentBinding: input.agentBinding,
        scope: input.scope,
        launchOptions: input.launchOptions,
        lifecycleState: "creating",
        capturedAt,
      });
      this.threads.set(threadId, thread);
    }
    // Adopt composer-screen panes (renderer draft Browser Panes; race-free; spec:
    // workbench-dock-parity). For a Draft Thread this ADDS them alongside the Terminal/
    // Editor/Diff panes it already owns — both ride into the started Thread.
    await seedInitialWorkbenchPanes(thread, input.initialWorkbenchPanes, this.idGenerator, this.clock, (target, fileInput) => this.workbenchFileOps.openFileOutput(target, fileInput));

    // A Scratch Thread runs in a real Tide-owned per-thread dir; materialize + trust
    // it before readiness/attachments so the agent proceeds without a trust prompt.
    // See docs_v2/specs/scratch-execution-context.md.
    await this.materializeScratchScope(thread);

    // Materialize any pasted images and fold their paths into the message so the
    // Agent can read them. Done before readiness so a deferred (not-ready) send
    // still carries the references. See composer-image-attachments spec.
    const { text: message, attachments: messageAttachments } =
      await this.composerQueue.composeMessageWithAttachments(thread, input.initialMessage, input.attachments);

    const readiness = await this.providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: thread.scope,
      launchOptions: thread.launchOptions,
    });

    if (!readiness.ready) {
      thread.lifecycleState = "open";
      this.composerQueue.enqueuePendingInput(thread, {
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
      threadId: thread.threadId,
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
      stepAnswers: input.stepAnswers,
      submittedAt: this.clock(),
    });

    // This episode saw an answer: a following turn-end is now legitimate (the agent
    // ended because of it) and may settle the dead cards. See recordTurnComplete.
    thread.promptAnsweredPendingSettle = true;

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
    // A fresh waiting episode starts clean: a prior episode's answer must not make a
    // spurious turn-end on THIS new, unanswered card look legitimate.
    thread.promptAnsweredPendingSettle = false;
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

  // The provider WITHDREW one of its own pending interactions (claude control_cancel for
  // a prompt it raised then retracted — e.g. it changed its mind, or a question+cancel
  // arrived in the same stream chunk). Deterministically clear that exact prompt: if it is
  // the visible card, promote the next queued prompt into its place (or resume running with
  // none left); if it is only queued behind the visible one, drop it from the queue. This
  // replaces the old "emit nothing, wait for the next turn-end to settle" handling, which
  // left a ghost card when no turn-end followed. Keyed by promptId so a stale withdrawal
  // for an already-cleared prompt is a no-op.
  async withdrawProviderPrompt(
    input: WithdrawProviderPromptInput,
  ): Promise<ServiceResult<WithdrawProviderPromptResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    // Not the visible card: it may be sitting in the queue → remove it there. If it is
    // neither visible nor queued, the withdrawal is stale (already answered/cleared).
    if (thread.promptState?.promptId !== input.promptId) {
      const queue = thread.promptQueue ?? [];
      const filtered = queue.filter((prompt) => prompt.promptId !== input.promptId);
      if (filtered.length !== queue.length) {
        thread.promptQueue = filtered.length > 0 ? filtered : undefined;
        thread.updatedAt = this.clock();
      }
      return {
        ok: true,
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        promptState: thread.promptState ?? null,
      };
    }

    // It IS the visible card → promote the next queued prompt, or resume running.
    const next = thread.promptQueue?.shift();
    if (thread.promptQueue?.length === 0) {
      thread.promptQueue = undefined;
    }
    if (next !== undefined) {
      const nextKnown: LastKnownState =
        runtimeStateForPromptKind(next.kind) === "waiting_for_approval"
          ? "waiting_for_approval"
          : "waiting_for_input";
      thread.promptState = next;
      thread.promptAnsweredPendingSettle = false;
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

    // Nothing queued: the provider retracted its question and keeps working — resume the
    // running turn (the runtime is still live; no answer was sent).
    thread.promptState = undefined;
    thread.promptAnsweredPendingSettle = false;
    thread.runtimeState = "running";
    thread.lifecycleState = "running";
    thread.lastKnownState = "running";
    thread.updatedAt = this.clock();
    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      promptState: null,
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
      await this.composerQueue.consumePendingRuntimeRestart(thread);
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
    clearAgentBrowserDriving(thread);
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
    this.composerQueue.promoteNextPendingInput(thread);
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
    // A bare turn-end (force unset) must NOT drop a prompt the user hasn't answered on
    // a still-live runtime: an agent can't end a turn it's blocked waiting on, so the
    // signal is spurious (claude's history reader can infer one mid-permission). Honoring
    // it dropped the card → a switched-away thread came back empty/idle though still
    // resumable. Once answered (promptAnsweredPendingSettle) the turn-end is legitimate
    // (e.g. a deny cancels the batch) and drops the dead cards; force/exit always settles.
    if (
      input.force !== true &&
      thread.promptAnsweredPendingSettle !== true &&
      thread.activeRuntimeHandle !== undefined &&
      thread.promptState !== undefined
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
    thread.promptAnsweredPendingSettle = false;

    const queued = thread.pendingInput;
    if (queued !== undefined && queued.kind === "composer_input") {
      this.composerQueue.promoteNextPendingInput(thread);
      // An options change that needs a runtime restart applies before the
      // flushed turn starts (the ended turn's process is idle now).
      await this.composerQueue.consumePendingRuntimeRestart(thread);
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
    clearAgentBrowserDriving(thread);
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

// Thread-independent workspace queries (start-page tree/file viewer, content
// search, editor code intel) are owned by WorkspaceQueryHandler.
  workspaceQueries(): WorkspaceQueryHandler {
    return this.workspaceQuery;
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
      this.composerQueue.promoteNextPendingInput(thread);
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
    await this.composerQueue.consumePendingRuntimeRestart(thread);
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

  // Composer queue / launch-option operations are owned by ComposerQueueService
  // (shared store; spec: thread-runtime-service-decomposition.md).
  sendComposerInput(
    ...args: Parameters<ComposerQueueService["sendComposerInput"]>
  ): ReturnType<ComposerQueueService["sendComposerInput"]> {
    return this.composerQueue.sendComposerInput(...args);
  }

  editPendingInput(
    ...args: Parameters<ComposerQueueService["editPendingInput"]>
  ): ReturnType<ComposerQueueService["editPendingInput"]> {
    return this.composerQueue.editPendingInput(...args);
  }

  updateThreadLaunchOptions(
    ...args: Parameters<ComposerQueueService["updateThreadLaunchOptions"]>
  ): ReturnType<ComposerQueueService["updateThreadLaunchOptions"]> {
    return this.composerQueue.updateThreadLaunchOptions(...args);
  }
}

export * from "./thread-runtime-api.ts";
