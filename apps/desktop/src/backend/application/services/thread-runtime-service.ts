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
  LastKnownState,
  PendingInput,
  PromptState,
  ProviderSessionRef,
  ThreadId,
  ThreadLifecycleState,
  ThreadRecord,
  ThreadScope,
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

const WORKBENCH_LAUNCHER_TITLE = "Workbench launcher";
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

export type ThreadRuntimeAsyncEvent =
  | {
      kind: "workbench_changed";
      thread: ThreadSnapshot;
    }
  | {
      kind: "provider_readiness_changed";
      threadId: ThreadId;
      readiness: ProviderReadinessResult;
    }
  | {
      kind: "agent_session_block_upserted";
      thread: ThreadSnapshot;
      block: AgentSessionBlockReference;
    }
  | {
      kind: "agent_runtime_state_changed";
      thread: ThreadSnapshot;
      runtimeState: AgentRuntimeState;
    }
  | {
      kind: "thread_hydrated";
      thread: ThreadSnapshot;
      runtimeState: AgentRuntimeState;
      blocks: AgentSessionBlockReference[];
    }
  | {
      kind: "workbench_terminal_output";
      threadId: ThreadId;
      paneId: WorkbenchPaneId;
      source: "stdout" | "stderr";
      chunk: string;
    };

export type ServiceErrorCode =
  | "thread_not_found"
  | "agent_binding_locked"
  | "provider_not_ready"
  | "prompt_not_found"
  | "agent_runtime_unavailable"
  | "invalid_workbench_command"
  | "invalid_thread_title"
  | "workbench_target_not_found"
  | "workbench_stale_reference"
  | "unsupported_tide_mcp_tool"
  | "directory_trust_unavailable"
  | WorkspaceCodeIntelligenceErrorCode
  | WorkspaceCommandErrorCode
  | WorkspaceFileErrorCode;

export interface ServiceError {
  code: ServiceErrorCode;
  message: string;
}

export type ServiceResult<T> = ({ ok: true } & T) | { ok: false; error: ServiceError };

export interface HydrateThreadInput {
  threadId: ThreadId;
}

export interface HydrateThreadResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  blocks: AgentSessionBlockReference[];
  // Present only for a Thread blocked on Provider Readiness (has pending input it
  // could not start). Lets re-opening a blocked Thread re-show its trust/setup
  // blocker instead of losing it on navigation. See docs_v2/specs/workspace-trust-grant.md.
  providerReadiness?: ProviderReadinessResult;
}

export interface ListThreadsInput {
  includeArchived?: boolean;
}

export interface ListThreadsResult {
  threads: ThreadSnapshot[];
}

export interface ArchiveThreadInput {
  threadId: ThreadId;
  archived: boolean;
}

export interface ArchiveThreadResult {
  thread: ThreadSnapshot;
}

export interface SetThreadPinnedInput {
  threadId: ThreadId;
  pinned: boolean;
}

export interface SetThreadPinnedResult {
  thread: ThreadSnapshot;
}

export interface RenameThreadInput {
  threadId: ThreadId;
  title: string;
}

export interface RenameThreadResult {
  thread: ThreadSnapshot;
}

export interface RestoreThreadsInput {
  threads: ThreadSeed[];
}

export interface RestoreThreadsResult {
  restoredCount: number;
}

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

export interface WorkbenchCommandInput {
  threadId: ThreadId;
  command: string;
  targetPaneId?: string;
  data?: Record<string, unknown>;
}

export interface WorkbenchCommandResult {
  handled: true;
  thread: ThreadSnapshot;
  workbench: WorkbenchSnapshot;
}

interface ProviderSetupSurfaceActionInput {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd: string;
  expectedCompletion: "process_exit" | "retry_preflight";
}

interface WorkbenchTerminalOpenInput {
  command: string;
  args: string[];
  cwd: string;
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

export interface TideMcpSessionRef {
  runtimeId: string;
  agentId: AgentId;
  threadId?: ThreadId;
}

export interface TideMcpToolCallInput {
  session: TideMcpSessionRef;
  toolName: TideMcpToolName;
  input?: Record<string, unknown>;
}

export type TideMcpToolOutput =
  | TideObserveThreadOutput
  | TideObserveWorkbenchOutput
  | TideOpenBrowserOutput
  | TideObserveBrowserOutput
  | TideActBrowserOutput
  | TideReadFileOutput
  | TideOpenFileOutput
  | TideEditFileOutput
  | TideGoToDefinitionOutput
  | TideGoToReferencesOutput
  | TideOpenTerminalOutput
  | TideRunTerminalCommandOutput;

export interface TideObserveThreadOutput {
  kind: "observe_thread";
  threadId: ThreadId;
  agentId: AgentId;
  agentChatState: AgentRuntimeState;
  promptActive: boolean;
  workbenchOpen: boolean;
  availableTools: TideMcpToolName[];
}

export interface TideObserveWorkbenchOutput extends WorkbenchSnapshot {
  kind: "observe_workbench";
  threadId: ThreadId;
}

export interface TideOpenBrowserOutput {
  kind: "open_browser";
  threadId: ThreadId;
  pane: BrowserPaneRef;
  visibleSideEffect: "created" | "revealed" | "navigated";
}

export interface TideObserveBrowserOutput {
  kind: "observe_browser";
  threadId: ThreadId;
  pane: BrowserPaneRef;
}

export interface TideActBrowserOutput {
  kind: "act_browser";
  threadId: ThreadId;
  pane: BrowserPaneRef;
  action: BrowserPaneActionRequest;
  status: "pending";
}

export interface TideReadFileOutput {
  kind: "read_file";
  threadId: ThreadId;
  root: string;
  path: string;
  relativePath: string;
  content: string;
  byteLength: number;
  truncated: boolean;
}

export interface TideOpenFileOutput {
  kind: "open_file";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "editor" };
  root: string;
  path: string;
  relativePath: string;
  byteLength: number;
  truncated: boolean;
  visibleSideEffect: "created" | "revealed";
}

export interface TideEditFileOutput {
  kind: "edit_file";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "diff" };
  root: string;
  path: string;
  relativePath: string;
  replacementCount: number;
  beforeByteLength: number;
  afterByteLength: number;
  afterContent: string;
  truncated: boolean;
  diff: string;
  visibleSideEffect: "created" | "refreshed";
}

export interface TideGoToDefinitionOutput {
  kind: "go_to_definition";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "editor" };
  sourcePaneId: WorkbenchPaneId;
  target: {
    line: number;
    character: number;
    length?: number;
    label?: string;
  };
}

export interface TideGoToReferencesOutput {
  kind: "go_to_references";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "editor" };
  sourcePaneId: WorkbenchPaneId;
  references: {
    relativePath: string;
    line: number;
    character: number;
    length?: number;
    label?: string;
  }[];
  truncated: boolean;
}

export interface TideOpenTerminalOutput {
  kind: "open_terminal";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "terminal" };
  command: string;
  args: string[];
  cwd: string;
  visibleSideEffect: "created" | "revealed";
}

export interface TideRunTerminalCommandOutput {
  kind: "run_terminal_command";
  threadId: ThreadId;
  pane: WorkbenchPaneSnapshotRef & { kind: "terminal" };
  command: string;
  args: string[];
  cwd: string;
  status: "completed" | "failed";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  transcript: string;
  truncated: boolean;
  timedOut: boolean;
}

export interface TideMcpToolCallResult {
  handledByService: true;
  thread: ThreadSnapshot;
  toolName: TideMcpToolName;
  output: TideMcpToolOutput;
  mcpToolCallCount: number;
}

export interface ThreadRuntimeService {
  restoreThreads(input: RestoreThreadsInput): Promise<ServiceResult<RestoreThreadsResult>>;
  listThreads(input: ListThreadsInput): Promise<ServiceResult<ListThreadsResult>>;
  archiveThread(input: ArchiveThreadInput): Promise<ServiceResult<ArchiveThreadResult>>;
  setThreadPinned(input: SetThreadPinnedInput): Promise<ServiceResult<SetThreadPinnedResult>>;
  renameThread(input: RenameThreadInput): Promise<ServiceResult<RenameThreadResult>>;
  hydrateThread(input: HydrateThreadInput): Promise<ServiceResult<HydrateThreadResult>>;
  startThread(input: StartThreadInput): Promise<ServiceResult<StartThreadResult>>;
  sendComposerInput(
    input: SendComposerInput,
  ): Promise<ServiceResult<SendComposerInputResult>>;
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

const TIDE_MCP_TOOL_DEFINITIONS: TideMcpToolDefinition[] = [
  {
    name: "tide_observe_thread",
    description: "Observe bounded Thread and Agent Chat state for the owning MCP Session.",
    inputSchema: {
      type: "object",
      properties: {
        detail: { type: "string", enum: ["compact", "full"] },
      },
    },
  },
  {
    name: "tide_observe_workbench",
    description: "Observe visible Workbench Pane refs for the owning Thread without mutating state.",
    inputSchema: {
      type: "object",
      properties: {
        detail: { type: "string", enum: ["compact", "full"] },
      },
    },
  },
  {
    name: "tide_open_browser",
    description: "Create, reveal, or navigate a visible Tide Browser Pane in the owning Thread Workbench.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string" },
        disposition: {
          type: "string",
          enum: ["reuse_active_browser", "new_browser_pane"],
        },
      },
    },
  },
  {
    name: "tide_observe_browser",
    description: "Observe bounded Browser Pane state after validating Thread ownership and revision.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: { type: "string" },
        revision: { type: "string" },
        detail: { type: "string", enum: ["compact", "full"] },
      },
      required: ["paneId"],
    },
  },
  {
    name: "tide_act_browser",
    description: "Schedule a bounded click or text input action on a visible Tide Browser Pane.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: { type: "string" },
        revision: { type: "string" },
        action: { type: "string", enum: ["click", "type_text"] },
        selector: { type: "string" },
        text: { type: "string" },
      },
      required: ["paneId", "revision", "action", "selector"],
    },
  },
  {
    name: "tide_read_file",
    description: "Read bounded text file content inside the owning Thread root without mutating Workbench state.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        byteLimit: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "tide_open_file",
    description: "Create, reveal, or refresh a visible Tide Editor Pane for a text file in the owning Thread root.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        byteLimit: { type: "number" },
      },
      required: ["path"],
    },
  },
  {
    name: "tide_edit_file",
    description: "Replace exact text inside a Thread-root text file and expose a bounded Diff Pane.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
        expectedOccurrences: { type: "number" },
        byteLimit: { type: "number" },
      },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "tide_go_to_definition",
    description: "Navigate from an existing Editor Pane cursor position to a visible definition Editor Pane.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: { type: "string" },
        line: { type: "number" },
        character: { type: "number" },
      },
      required: ["paneId", "line", "character"],
    },
  },
  {
    name: "tide_go_to_references",
    description: "List every Thread-root use site of the symbol at an Editor Pane cursor position as a visible references list on that Pane.",
    inputSchema: {
      type: "object",
      properties: {
        paneId: { type: "string" },
        line: { type: "number" },
        character: { type: "number" },
      },
      required: ["paneId", "line", "character"],
    },
  },
  {
    name: "tide_open_terminal",
    description: "Open or reveal a visible interactive Terminal Pane in the owning Thread Workbench.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: {
          type: "array",
          items: { type: "string" },
        },
        cwd: { type: "string" },
      },
    },
  },
  {
    name: "tide_run_terminal_command",
    description: "Run a bounded non-interactive command in the owning Thread Execution Context and expose a Terminal Pane.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: {
          type: "array",
          items: { type: "string" },
        },
        cwd: { type: "string" },
        timeoutMs: { type: "number" },
        byteLimit: { type: "number" },
      },
      required: ["command"],
    },
  },
];

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
  threads = new Map<ThreadId, ThreadRecord>();
  providerSetupSurfaceHandles = new Map<string, ProviderSetupSurfaceHandle>();
  workbenchTerminalHandles = new Map<string, WorkbenchTerminalHandle>();

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

    for (const seed of input.initialThreads ?? []) {
      this.threads.set(seed.threadId, normalizeThreadSeed(seed));
    }
  }

  async restoreThreads(
    input: RestoreThreadsInput,
  ): Promise<ServiceResult<RestoreThreadsResult>> {
    let restoredCount = 0;
    for (const seed of input.threads) {
      if (this.threads.has(seed.threadId)) {
        continue;
      }
      this.threads.set(seed.threadId, normalizeThreadSeed(seed));
      restoredCount += 1;
    }

    return {
      ok: true,
      restoredCount,
    };
  }

  async listThreads(
    input: ListThreadsInput,
  ): Promise<ServiceResult<ListThreadsResult>> {
    const threads = [...this.threads.values()]
      .filter((thread) => input.includeArchived === true || thread.lifecycleState !== "archived")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(snapshotThread);

    return {
      ok: true,
      threads,
    };
  }

  async archiveThread(
    input: ArchiveThreadInput,
  ): Promise<ServiceResult<ArchiveThreadResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    thread.lifecycleState = input.archived ? "archived" : "open";
    thread.updatedAt = this.clock();
    return {
      ok: true,
      thread: snapshotThread(thread),
    };
  }

  async setThreadPinned(
    input: SetThreadPinnedInput,
  ): Promise<ServiceResult<SetThreadPinnedResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    thread.pinned = input.pinned;
    thread.updatedAt = this.clock();
    return {
      ok: true,
      thread: snapshotThread(thread),
    };
  }

  async renameThread(
    input: RenameThreadInput,
  ): Promise<ServiceResult<RenameThreadResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }
    // Manual rename: trim and collapse whitespace; ignore an empty title.
    const title = input.title.replace(/\s+/g, " ").trim();
    if (title.length === 0) {
      return failure("invalid_thread_title", "Thread title cannot be empty.");
    }
    thread.title = title;
    thread.updatedAt = this.clock();
    return {
      ok: true,
      thread: snapshotThread(thread),
    };
  }

  async hydrateThread(
    input: HydrateThreadInput,
  ): Promise<ServiceResult<HydrateThreadResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    // Re-derive Provider Readiness for any Thread that is not actively running, so
    // hydrate is authoritative: a blocked Thread (e.g. directory trust) re-shows its
    // blocker on open/switch instead of going blank or being cleared by a stale hydrate,
    // and a ready Thread reports ready so a previous thread's blocker is dropped.
    const isRunning =
      thread.runtimeState === "running" || thread.runtimeState === "starting";
    const providerReadiness = isRunning
      ? undefined
      : await this.providerReadinessPort.check({
          agentId: thread.agentBinding.agentId,
          scope: thread.scope,
          launchOptions: thread.launchOptions,
        });

    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      blocks: cloneBlocks(thread.cachedBlocks),
      ...(providerReadiness !== undefined ? { providerReadiness } : {}),
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
    const message = await this.composeMessageWithAttachments(
      thread,
      input.initialMessage,
      input.attachments,
    );

    const readiness = await this.providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: thread.scope,
      launchOptions: thread.launchOptions,
    });

    if (!readiness.ready) {
      thread.lifecycleState = "open";
      thread.pendingInput = {
        kind: "composer_input",
        value: message,
        capturedAt,
        launchOptions: cloneLaunchOptions(input.launchOptions),
      };
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
    const handle = await this.agentRuntimePort.start({
      threadId,
      agentBinding: cloneAgentBinding(thread.agentBinding),
      scope: cloneScope(thread.scope),
      launchOptions: thread.launchOptions,
      initialPrompt: deliverPromptViaLaunch ? message : undefined,
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
  ): Promise<string> {
    if (
      attachments === undefined ||
      attachments.length === 0 ||
      this.composerAttachmentStorePort === undefined
    ) {
      return text;
    }
    const cwd = threadRoot(thread);
    if (cwd === undefined) {
      return text;
    }
    const paths = await this.composerAttachmentStorePort.materialize({
      cwd,
      attachments,
    });
    const lines = paths.map((p) => `[Attached image: ${p}]`);
    if (lines.length === 0) {
      return text;
    }
    return text.length > 0 ? `${text}\n\n${lines.join("\n")}` : lines.join("\n");
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

    // Materialize pasted images and fold their paths into the message before any
    // readiness/busy branch, so a queued or deferred send still carries them.
    const message = await this.composeMessageWithAttachments(
      thread,
      input.input,
      input.attachments,
    );

    const readiness = await this.providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: thread.scope,
      launchOptions: input.launchOptions ?? thread.launchOptions,
    });

    if (!readiness.ready) {
      thread.pendingInput = {
        kind: "composer_input",
        value: message,
        capturedAt: this.clock(),
        launchOptions: cloneLaunchOptions(input.launchOptions ?? thread.launchOptions),
      };
      thread.updatedAt = this.clock();

      return {
        ok: true,
        status: "provider_not_ready",
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        providerReadiness: readiness,
      };
    }

    // Default behaviour while a turn is in flight: queue the input Tide-side and
    // flush it when the turn completes (recordTurnComplete). The user can
    // explicitly interrupt to end the turn early and send sooner. This is
    // agent-agnostic — Tide never relies on the CLI's own mid-turn input.
    const busy =
      thread.activeRuntimeHandle !== undefined &&
      (thread.runtimeState === "running" || thread.runtimeState === "starting");
    if (busy) {
      thread.pendingInput = {
        kind: "composer_input",
        value: message,
        capturedAt: this.clock(),
        launchOptions: cloneLaunchOptions(input.launchOptions ?? thread.launchOptions),
      };
      thread.updatedAt = this.clock();
      return {
        ok: true,
        status: "queued",
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
        providerReadiness: readiness,
      };
    }

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

    await this.agentRuntimePort.writeInput(thread.activeRuntimeHandle, {
      kind: "prompt_answer",
      value: promptAnswerValue(thread.promptState, input),
      choiceId: input.choiceId,
      promptId: input.promptId,
      submittedAt: this.clock(),
    });

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

    const promptState = {
      ...input.promptState,
      choices: input.promptState.choices?.map((choice) => ({ ...choice })),
    };
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

    if (
      thread.agentBinding.providerSessionRef !== undefined &&
      !providerSessionRefsEqual(
        thread.agentBinding.providerSessionRef,
        input.providerSessionRef,
      )
    ) {
      return {
        ok: true,
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
      };
    }

    thread.agentBinding.providerSessionRef = { ...input.providerSessionRef };
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

    if (thread.activeRuntimeHandle !== undefined) {
      thread.runtimeState = "stopping";
      thread.updatedAt = this.clock();
      await this.agentRuntimePort.stop(thread.activeRuntimeHandle);
    }

    thread.activeRuntimeHandle = undefined;
    thread.runtimeState = "stopped";
    thread.lifecycleState = "open";
    thread.lastKnownState = "idle";
    // An interrupt drops the in-flight turn; don't resurrect a queued input.
    thread.pendingInput = undefined;
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
    const handle = await this.startOrResumeRuntimeForPendingInput(
      thread,
      pendingInput.launchOptions,
    );
    const submittedBlock = this.appendLocalUserMessageBlock(
      thread,
      pendingInput.value,
    );
    thread.activeRuntimeHandle = cloneRuntimeHandle(handle);
    thread.runtimeState = "running";
    thread.pendingInput = undefined;
    thread.updatedAt = this.clock();
    await this.agentRuntimePort.writeInput(handle, {
      kind: "composer_input",
      value: pendingInput.value,
      submittedAt: this.clock(),
    });
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
    if (thread.runtimeState !== "running" && thread.runtimeState !== "starting") {
      return {
        ok: true,
        thread: snapshotThread(thread),
        runtimeState: thread.runtimeState,
      };
    }

    const queued = thread.pendingInput;
    if (queued !== undefined && queued.kind === "composer_input") {
      thread.pendingInput = undefined;
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

  async handleWorkbenchCommand(
    input: WorkbenchCommandInput,
  ): Promise<ServiceResult<WorkbenchCommandResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    switch (input.command) {
      case "open_launcher": {
        const pane = this.openWorkbenchLauncher(thread);
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "open_browser": {
        const opened = this.openBrowserOutput(thread, input.data);
        const pane = workbenchPaneById(thread.workbench, opened.pane.paneId);
        if (pane !== undefined) {
          pane.visible = true;
          thread.workbench.activePaneId = pane.paneId;
        }
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "update_browser_snapshot": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "browser") {
          return failure(
            "workbench_target_not_found",
            "Browser Pane target was not found.",
          );
        }
        const snapshot = browserPaneSnapshotFromData(input.data);
        if (snapshot === undefined) {
          return failure(
            "invalid_workbench_command",
            "Browser Pane snapshot requires revision.",
          );
        }
        if (snapshot.revision !== pane.revision) {
          return failure(
            "workbench_stale_reference",
            "Browser Pane revision is stale.",
          );
        }

        pane.pageTitle = snapshot.pageTitle;
        if (snapshot.url !== undefined) {
          pane.url = snapshot.url;
        }
        pane.bodyTextPreview = snapshot.bodyTextPreview;
        pane.loading = snapshot.loading ?? false;
        pane.revision = this.idGenerator();
        pane.updatedAt = this.clock();
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "update_browser_action_result": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "browser") {
          return failure(
            "workbench_target_not_found",
            "Browser Pane target was not found.",
          );
        }
        const result = browserPaneActionResultFromData(input.data);
        if (result === undefined) {
          return failure(
            "invalid_workbench_command",
            "Browser Pane action result requires revision, action id, status, and message.",
          );
        }
        if (
          result.revision !== pane.revision ||
          pane.pendingAction?.actionId !== result.actionId
        ) {
          return failure(
            "workbench_stale_reference",
            "Browser Pane action result is stale.",
          );
        }

        const completedAt = this.clock();
        pane.lastAction = {
          ...pane.pendingAction,
          status: result.status,
          message: result.message,
          completedAt,
        };
        delete pane.pendingAction;
        if (result.pageTitle !== undefined) {
          pane.pageTitle = result.pageTitle;
        }
        if (result.url !== undefined) {
          pane.url = result.url;
        }
        if (result.bodyTextPreview !== undefined) {
          pane.bodyTextPreview = result.bodyTextPreview;
        }
        pane.loading = result.loading ?? false;
        pane.revision = this.idGenerator();
        pane.updatedAt = completedAt;
        thread.updatedAt = completedAt;
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "open_editor": {
        const opened = await this.openFileOutput(thread, input.data);
        if (!opened.ok) {
          return failure(opened.error.code, opened.error.message);
        }
        const pane = workbenchPaneById(thread.workbench, opened.value.pane.paneId);
        if (pane !== undefined) {
          pane.visible = true;
          thread.workbench.activePaneId = pane.paneId;
        }
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "open_terminal": {
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_command_unavailable",
            "Thread does not have an Execution Context root for Terminal Pane.",
          );
        }
        const resolvedCwd = await this.workspaceCommandPort.resolveCwd({
          root,
          cwd: optionalString(input.data?.cwd),
        });
        if (!resolvedCwd.ok) {
          return failure(resolvedCwd.error.code, resolvedCwd.error.message);
        }
        const command = optionalString(input.data?.command) ?? this.defaultWorkbenchTerminalCommand;
        const args = arrayOfStrings(input.data?.args);
        const pane = this.openWorkbenchTerminal(thread, {
          command,
          args,
          cwd: resolvedCwd.cwd.cwd,
        });
        await this.ensureWorkbenchTerminalRunning(thread, pane);
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "open_provider_setup_surface": {
        const setup = providerSetupSurfaceActionFromData(input.data);
        if (setup === undefined) {
          return failure(
            "invalid_workbench_command",
            "Provider Setup Surface command requires setup data.",
          );
        }
        const pane = this.openProviderSetupSurface(thread, setup);
        await this.ensureProviderSetupSurfaceRunning(thread, pane);
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "write_terminal_input": {
        const bytes = providerSetupSurfaceInputFromData(input.data);
        if (bytes === undefined) {
          return failure(
            "invalid_workbench_command",
            "Terminal input command requires input bytes.",
          );
        }
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "terminal") {
          return failure(
            "workbench_target_not_found",
            "Terminal Pane target was not found.",
          );
        }
        const setupHandle = this.providerSetupSurfaceHandles.get(pane.paneId);
        if (setupHandle !== undefined && pane.status === "running") {
          await setupHandle.write(bytes);
          pane.updatedAt = this.clock();
          thread.workbench.activePaneId = pane.paneId;
          thread.workbench.focusOwner = "workbench";
          thread.updatedAt = this.clock();
          return {
            ok: true,
            handled: true,
            thread: snapshotThread(thread),
            workbench: snapshotWorkbench(thread.workbench),
          };
        }
        const terminalHandle = this.workbenchTerminalHandles.get(pane.paneId);
        if (terminalHandle === undefined || pane.status !== "running") {
          return failure(
            "agent_runtime_unavailable",
            "Terminal Pane is not running.",
          );
        }
        await terminalHandle.write(bytes);
        pane.updatedAt = this.clock();
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "resize_terminal": {
        const cols = numberFromData(input.data, "cols");
        const rows = numberFromData(input.data, "rows");
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "terminal") {
          return failure("workbench_target_not_found", "Terminal Pane target was not found.");
        }
        if (cols !== undefined && rows !== undefined) {
          this.workbenchTerminalHandles.get(pane.paneId)?.resize?.(cols, rows);
        }
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "focus_pane": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined) {
          return failure(
            "workbench_target_not_found",
            "Workbench Pane target was not found.",
          );
        }
        pane.visible = true;
        pane.updatedAt = this.clock();
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "close_pane": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined) {
          return failure(
            "workbench_target_not_found",
            "Workbench Pane target was not found.",
          );
        }
        if (pane.kind === "terminal") {
          await this.stopTerminalPane(pane);
        }
        pane.visible = false;
        if (pane.kind === "terminal" && pane.status === "running") {
          pane.status = "completed";
        }
        pane.updatedAt = this.clock();
        if (thread.workbench.activePaneId === pane.paneId) {
          thread.workbench.activePaneId = firstVisiblePane(thread.workbench)?.paneId;
        }
        thread.workbench.focusOwner =
          thread.workbench.activePaneId === undefined ? "composer" : thread.workbench.focusOwner;
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "save_editor_file": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "editor") {
          return failure(
            "workbench_target_not_found",
            "Editor Pane target was not found.",
          );
        }
        const save = editorPaneSaveFromData(input.data);
        if (save === undefined) {
          return failure(
            "invalid_workbench_command",
            "Editor Pane save requires baseRevision and content.",
          );
        }
        if (save.baseRevision !== pane.revision) {
          return failure(
            "workbench_stale_reference",
            "Editor Pane revision is stale.",
          );
        }
        if (pane.truncated) {
          return failure(
            "workspace_file_edit_conflict",
            "Truncated Editor Panes are read-only.",
          );
        }
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_file_unavailable",
            "Thread does not have an Execution Context root for Editor Pane save.",
          );
        }
        const byteLimit = fileByteLimit(input.data?.byteLimit);
        if (save.content.length > byteLimit) {
          return failure(
            "workspace_file_too_large",
            "Editor Pane content exceeds the bounded save size.",
          );
        }
        const written = await this.workspaceFilePort.writeTextFile({
          root,
          path: pane.filePath,
          content: save.content,
          byteLimit,
        });
        if (!written.ok) {
          return failure(written.error.code, written.error.message);
        }
        this.refreshEditorPaneAfterWrite(thread, pane, written.file);
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "go_to_definition": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "editor") {
          return failure(
            "workbench_target_not_found",
            "Editor Pane target was not found.",
          );
        }
        const position = editorPanePositionFromData(input.data);
        if (position === undefined) {
          return failure(
            "invalid_workbench_command",
            "Go to definition requires line and character.",
          );
        }
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_code_intelligence_unavailable",
            "Thread does not have an Execution Context root for code navigation.",
          );
        }
        const definition = await this.workspaceCodeIntelligencePort.findDefinition({
          root,
          path: pane.filePath,
          line: position.line,
          character: position.character,
        });
        if (!definition.ok) {
          return failure(definition.error.code, definition.error.message);
        }
        const opened = await this.openFileOutput(thread, {
          path: definition.location.relativePath,
        });
        if (!opened.ok) {
          return failure(opened.error.code, opened.error.message);
        }
        const targetPane = workbenchPaneById(thread.workbench, opened.value.pane.paneId);
        if (targetPane !== undefined && targetPane.kind === "editor") {
          targetPane.navigationTarget = {
            line: definition.location.line,
            character: definition.location.character,
            length: definition.location.length,
            label: definition.location.label,
            sourcePaneId: pane.paneId,
          };
          targetPane.visible = true;
          thread.workbench.activePaneId = targetPane.paneId;
        }
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "go_to_references": {
        const pane = workbenchPaneById(thread.workbench, input.targetPaneId);
        if (pane === undefined || pane.kind !== "editor") {
          return failure(
            "workbench_target_not_found",
            "Editor Pane target was not found.",
          );
        }
        const position = editorPanePositionFromData(input.data);
        if (position === undefined) {
          return failure(
            "invalid_workbench_command",
            "Go to references requires line and character.",
          );
        }
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_code_intelligence_unavailable",
            "Thread does not have an Execution Context root for code navigation.",
          );
        }
        const references = await this.workspaceCodeIntelligencePort.findReferences({
          root,
          path: pane.filePath,
          line: position.line,
          character: position.character,
        });
        if (!references.ok) {
          return failure(references.error.code, references.error.message);
        }
        pane.references = {
          query: pane.relativePath,
          truncated: references.truncated,
          items: references.locations.map((location) => ({
            relativePath: location.relativePath,
            line: location.line,
            character: location.character,
            length: location.length,
            label: location.label,
          })),
        };
        pane.visible = true;
        pane.revision = this.idGenerator();
        pane.updatedAt = this.clock();
        thread.workbench.activePaneId = pane.paneId;
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      case "refresh_file_tree": {
        const root = threadRoot(thread);
        if (root === undefined) {
          return failure(
            "workspace_file_unavailable",
            "Thread does not have an Execution Context root for FileTree View.",
          );
        }
        // Full tree: load the whole source tree once (heavy dirs are skipped by
        // the workspace file port). Folders are collapsed by default in the UI,
        // so the DOM stays light even though every entry is loaded upfront.
        const listed = await this.workspaceFilePort.listTree({
          root,
          maxDepth: fileTreeMaxDepth(input.data?.maxDepth),
          maxEntries: fileTreeMaxEntries(input.data?.maxEntries),
        });
        if (!listed.ok) {
          return failure(listed.error.code, listed.error.message);
        }
        thread.workbench.fileTree = cloneFileTreeView(listed.fileTree);
        thread.workbench.focusOwner = "workbench";
        thread.updatedAt = this.clock();
        return {
          ok: true,
          handled: true,
          thread: snapshotThread(thread),
          workbench: snapshotWorkbench(thread.workbench),
        };
      }
      default:
        return failure(
          "invalid_workbench_command",
          "Workbench command is not supported.",
        );
    }
  }

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

  private openProviderSetupSurface(
    thread: ThreadRecord,
    setup: ProviderSetupSurfaceActionInput,
  ): TerminalPaneState {
    const existing = thread.workbench.panes.find(
      (pane): pane is TerminalPaneState =>
        pane.kind === "terminal" &&
        pane.command === setup.command &&
        shallowRecordEqual(pane.env, setup.env) &&
        pane.cwd === setup.cwd,
    );
    if (existing !== undefined) {
      existing.visible = true;
      existing.status = "ready";
      existing.args = [...setup.args];
      existing.env = cloneEnv(setup.env);
      existing.expectedCompletion = setup.expectedCompletion;
      existing.revision = this.idGenerator();
      existing.updatedAt = this.clock();
      return existing;
    }

    const pane: TerminalPaneState = {
      paneId: this.idGenerator(),
      kind: "terminal",
      title: `Provider setup: ${commandName(setup.command)}`,
      visible: true,
      revision: this.idGenerator(),
      updatedAt: this.clock(),
      command: setup.command,
      args: [...setup.args],
      env: cloneEnv(setup.env),
      cwd: setup.cwd,
      status: "ready",
      expectedCompletion: setup.expectedCompletion,
    };
    thread.workbench.panes.push(pane);
    return pane;
  }

  private openWorkbenchLauncher(thread: ThreadRecord): LauncherPaneState {
    const existingPane = thread.workbench.panes.find(
      (pane): pane is LauncherPaneState => pane.kind === "launcher",
    );
    if (existingPane !== undefined) {
      existingPane.visible = true;
      existingPane.title = WORKBENCH_LAUNCHER_TITLE;
      existingPane.actions = launcherPaneActions();
      existingPane.revision = this.idGenerator();
      existingPane.updatedAt = this.clock();
      return existingPane;
    }

    const pane: LauncherPaneState = {
      paneId: this.idGenerator(),
      kind: "launcher",
      title: WORKBENCH_LAUNCHER_TITLE,
      visible: true,
      revision: this.idGenerator(),
      updatedAt: this.clock(),
      actions: launcherPaneActions(),
    };
    thread.workbench.panes.push(pane);
    return pane;
  }

  private openWorkbenchTerminal(
    thread: ThreadRecord,
    input: WorkbenchTerminalOpenInput,
  ): TerminalPaneState {
    const existing = thread.workbench.panes.find(
      (pane): pane is TerminalPaneState =>
        pane.kind === "terminal" &&
        pane.expectedCompletion === undefined &&
        pane.command === input.command &&
        pane.cwd === input.cwd,
    );
    if (existing !== undefined) {
      existing.visible = true;
      existing.title = "Terminal";
      existing.args = [...input.args];
      existing.status = this.workbenchTerminalHandles.has(existing.paneId)
        ? "running"
        : "ready";
      existing.revision = this.idGenerator();
      existing.updatedAt = this.clock();
      return existing;
    }

    const pane: TerminalPaneState = {
      paneId: this.idGenerator(),
      kind: "terminal",
      title: "Terminal",
      visible: true,
      revision: this.idGenerator(),
      updatedAt: this.clock(),
      command: input.command,
      args: [...input.args],
      cwd: input.cwd,
      status: "ready",
    };
    thread.workbench.panes.push(pane);
    return pane;
  }

  private async ensureProviderSetupSurfaceRunning(
    thread: ThreadRecord,
    pane: TerminalPaneState,
  ): Promise<void> {
    if (
      this.providerSetupSurfaceTerminalPort === undefined ||
      pane.command === undefined ||
      pane.cwd === undefined
    ) {
      return;
    }
    if (this.providerSetupSurfaceHandles.has(pane.paneId)) {
      pane.status = "running";
      return;
    }

    pane.status = "running";
    pane.transcriptPreview = setupLaunchPreview(pane.command, pane.args ?? [], pane.cwd);
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();

    try {
      const handle = await this.providerSetupSurfaceTerminalPort.start({
        threadId: thread.threadId,
        paneId: pane.paneId,
        command: pane.command,
        args: pane.args ?? [],
        env: cloneEnv(pane.env),
        cwd: pane.cwd,
        onOutput: (output) =>
          this.appendProviderSetupSurfaceOutput(thread.threadId, pane.paneId, output),
        onExit: (exit) =>
          this.completeProviderSetupSurface(thread.threadId, pane.paneId, exit),
      });
      this.providerSetupSurfaceHandles.set(pane.paneId, handle);
    } catch (error) {
      pane.status = "failed";
      pane.transcriptPreview = boundedTranscriptPreview(
        `${pane.transcriptPreview ?? ""}\n${errorMessage(error)}`,
      );
      pane.revision = this.idGenerator();
      pane.updatedAt = this.clock();
    }
  }

  private async ensureWorkbenchTerminalRunning(
    thread: ThreadRecord,
    pane: TerminalPaneState,
  ): Promise<void> {
    if (
      this.workbenchTerminalPort === undefined ||
      pane.command === undefined ||
      pane.cwd === undefined
    ) {
      return;
    }
    if (this.workbenchTerminalHandles.has(pane.paneId)) {
      pane.status = "running";
      return;
    }

    pane.status = "running";
    // The PTY spawns the shell directly in `cwd`; don't seed a synthetic
    // `$ cd ...\n$ <shell>` banner — the live xterm should show only real output.
    pane.transcriptPreview = "";
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();

    try {
      const handle = await this.workbenchTerminalPort.start({
        threadId: thread.threadId,
        paneId: pane.paneId,
        command: pane.command,
        args: pane.args ?? [],
        cwd: pane.cwd,
        onOutput: (output) =>
          this.appendWorkbenchTerminalOutput(thread.threadId, pane.paneId, output),
        onExit: (exit) =>
          this.completeWorkbenchTerminal(thread.threadId, pane.paneId, exit),
      });
      this.workbenchTerminalHandles.set(pane.paneId, handle);
    } catch (error) {
      pane.status = "failed";
      pane.transcriptPreview = boundedTranscriptPreview(
        `${pane.transcriptPreview ?? ""}\n${errorMessage(error)}`,
      );
      pane.revision = this.idGenerator();
      pane.updatedAt = this.clock();
    }
  }

  private appendWorkbenchTerminalOutput(
    threadId: ThreadId,
    paneId: string,
    output: WorkbenchTerminalOutput,
  ): void {
    const thread = this.threads.get(threadId);
    const pane = thread?.workbench.panes.find(
      (candidate): candidate is TerminalPaneState =>
        candidate.kind === "terminal" && candidate.paneId === paneId,
    );
    if (thread === undefined || pane === undefined) {
      return;
    }

    pane.transcriptPreview = boundedTranscriptPreview(
      `${pane.transcriptPreview ?? ""}${output.body}`,
    );
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    // Stream the delta chunk so a live terminal renderer can write it directly,
    // preserving escape sequences and cursor state (the bounded transcript
    // preview remains a fallback snapshot).
    this.emitAsyncEvent({
      kind: "workbench_terminal_output",
      threadId,
      paneId,
      source: output.source,
      chunk: output.body,
    });
    this.emitAsyncEvent({
      kind: "workbench_changed",
      thread: snapshotThread(thread),
    });
  }

  private async completeWorkbenchTerminal(
    threadId: ThreadId,
    paneId: string,
    exit: WorkbenchTerminalExit,
  ): Promise<void> {
    const thread = this.threads.get(threadId);
    const pane = thread?.workbench.panes.find(
      (candidate): candidate is TerminalPaneState =>
        candidate.kind === "terminal" && candidate.paneId === paneId,
    );
    if (thread === undefined || pane === undefined) {
      return;
    }

    this.workbenchTerminalHandles.delete(paneId);
    pane.status = exit.exitCode === 0 ? "completed" : "failed";
    pane.transcriptPreview = boundedTranscriptPreview(
      `${pane.transcriptPreview ?? ""}\n[terminal exited ${exit.exitCode ?? exit.signal ?? "unknown"}]\n`,
    );
    pane.exitCode = exit.exitCode;
    pane.signal = exit.signal;
    pane.completedAt = this.clock();
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    thread.updatedAt = this.clock();
    this.emitAsyncEvent({
      kind: "workbench_changed",
      thread: snapshotThread(thread),
    });
  }

  private appendProviderSetupSurfaceOutput(
    threadId: ThreadId,
    paneId: string,
    output: ProviderSetupSurfaceOutput,
  ): void {
    const thread = this.threads.get(threadId);
    const pane = thread?.workbench.panes.find(
      (candidate): candidate is TerminalPaneState =>
        candidate.kind === "terminal" && candidate.paneId === paneId,
    );
    if (thread === undefined || pane === undefined) {
      return;
    }

    pane.transcriptPreview = boundedTranscriptPreview(
      `${pane.transcriptPreview ?? ""}${output.body}`,
    );
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    this.emitAsyncEvent({
      kind: "workbench_changed",
      thread: snapshotThread(thread),
    });
  }

  private async completeProviderSetupSurface(
    threadId: ThreadId,
    paneId: string,
    exit: ProviderSetupSurfaceExit,
  ): Promise<void> {
    const thread = this.threads.get(threadId);
    const pane = thread?.workbench.panes.find(
      (candidate): candidate is TerminalPaneState =>
        candidate.kind === "terminal" && candidate.paneId === paneId,
    );
    if (thread === undefined || pane === undefined) {
      return;
    }

    this.providerSetupSurfaceHandles.delete(paneId);
    pane.status = exit.exitCode === 0 ? "completed" : "failed";
    pane.transcriptPreview = boundedTranscriptPreview(
      `${pane.transcriptPreview ?? ""}\n[setup exited ${exit.exitCode ?? exit.signal ?? "unknown"}]\n`,
    );
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    thread.updatedAt = this.clock();
    this.emitAsyncEvent({
      kind: "workbench_changed",
      thread: snapshotThread(thread),
    });

    if (pane.expectedCompletion === "retry_preflight") {
      await this.replayPendingInputIfProviderReady(thread, pane);
    }
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
      const handle = await this.startOrResumeRuntimeForPendingInput(
        thread,
        pendingInput.launchOptions,
      );
      const submittedBlock = this.appendLocalUserMessageBlock(
        thread,
        pendingInput.value,
      );
      thread.activeRuntimeHandle = cloneRuntimeHandle(handle);
      thread.runtimeState = "running";
      thread.updatedAt = this.clock();

      await this.agentRuntimePort.writeInput(handle, {
        kind: "composer_input",
        value: pendingInput.value,
        submittedAt: this.clock(),
      });
      thread.pendingInput = undefined;
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
  ): Promise<AgentRuntimeHandle> {
    if (thread.activeRuntimeHandle !== undefined) {
      return thread.activeRuntimeHandle;
    }
    if (thread.agentBinding.providerSessionRef !== undefined) {
      return this.activeOrResumedHandle(thread);
    }

    return this.agentRuntimePort.start({
      threadId: thread.threadId,
      agentBinding: cloneAgentBinding(thread.agentBinding),
      scope: cloneScope(thread.scope),
      launchOptions,
    });
  }

  private async stopTerminalPane(
    pane: BrowserPaneState | TerminalPaneState,
  ): Promise<void> {
    if (pane.kind !== "terminal") {
      return;
    }

    const setupHandle = this.providerSetupSurfaceHandles.get(pane.paneId);
    if (setupHandle !== undefined) {
      await setupHandle.stop();
      this.providerSetupSurfaceHandles.delete(pane.paneId);
    }
    const terminalHandle = this.workbenchTerminalHandles.get(pane.paneId);
    if (terminalHandle !== undefined) {
      await terminalHandle.stop();
      this.workbenchTerminalHandles.delete(pane.paneId);
    }
  }

  listTideMcpTools(): TideMcpToolDefinition[] {
    return TIDE_MCP_TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: { ...tool.inputSchema },
    }));
  }

  async handleTideMcpToolCall(
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<TideMcpToolCallResult>> {
    if (!isTideMcpToolName(input.toolName)) {
      return failure(
        "unsupported_tide_mcp_tool",
        "Tide MCP tool is not supported by this slice.",
      );
    }

    const resolved = this.resolveMcpThread(input.session);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    const thread = resolved.thread;

    thread.mcpToolCallCount += 1;
    thread.updatedAt = this.clock();

    const output = await this.handleResolvedTideMcpToolCall(thread, input);
    if (!output.ok) {
      return { ok: false, error: output.error };
    }
    if (isWorkbenchMutatingTideMcpTool(input.toolName)) {
      this.emitAsyncEvent({
        kind: "workbench_changed",
        thread: snapshotThread(thread),
      });
    }

    return {
      ok: true,
      handledByService: true,
      thread: snapshotThread(thread),
      toolName: input.toolName,
      output: output.value,
      mcpToolCallCount: thread.mcpToolCallCount,
    };
  }

  private resolveMcpThread(
    session: TideMcpSessionRef,
  ): ServiceResult<{ thread: ThreadRecord }> {
    if (session.threadId !== undefined) {
      const thread = this.threads.get(session.threadId);
      if (thread === undefined) {
        return failure("thread_not_found", "Thread was not found.");
      }
      if (!threadMatchesMcpSession(thread, session)) {
        return failure(
          "agent_runtime_unavailable",
          "MCP Session does not match the Thread's active Agent Runtime.",
        );
      }
      return { ok: true, thread };
    }

    for (const thread of this.threads.values()) {
      if (threadMatchesMcpSession(thread, session)) {
        return { ok: true, thread };
      }
    }

    return failure(
      "agent_runtime_unavailable",
      "MCP Session did not match an active Agent Runtime.",
    );
  }

  private async handleResolvedTideMcpToolCall(
    thread: ThreadRecord,
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<{ value: TideMcpToolOutput }>> {
    switch (input.toolName) {
      case "tide_observe_thread":
        return {
          ok: true,
          value: observeThreadOutput(thread),
        };
      case "tide_observe_workbench":
        return {
          ok: true,
          value: observeWorkbenchOutput(thread),
        };
      case "tide_open_browser":
        return {
          ok: true,
          value: this.openBrowserOutput(thread, input.input),
        };
      case "tide_observe_browser":
        return this.observeBrowserOutput(thread, input.input);
      case "tide_act_browser":
        return this.actBrowserOutput(thread, input.input);
      case "tide_read_file":
        return this.readFileOutput(thread, input.input);
      case "tide_open_file":
        return this.openFileOutput(thread, input.input);
      case "tide_edit_file":
        return this.editFileOutput(thread, input.input);
      case "tide_go_to_definition":
        return this.goToDefinitionOutput(thread, input.input);
      case "tide_go_to_references":
        return this.goToReferencesOutput(thread, input.input);
      case "tide_open_terminal":
        return this.openTerminalOutput(thread, input.input);
      case "tide_run_terminal_command":
        return this.runTerminalCommandOutput(thread, input.input);
    }
  }

  private openBrowserOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): TideOpenBrowserOutput {
    const capturedAt = this.clock();
    const requestedUrl = optionalString(input?.url);
    const requestedTitle = optionalString(input?.title);
    const disposition =
      input?.disposition === "new_browser_pane"
        ? "new_browser_pane"
        : "reuse_active_browser";
    const reusablePane =
      disposition === "reuse_active_browser"
        ? firstBrowserPane(thread.workbench)
        : undefined;

    if (reusablePane === undefined) {
      const pane: BrowserPaneState = {
        paneId: this.idGenerator(),
        kind: "browser",
        title: requestedTitle ?? browserTitleFromUrl(requestedUrl),
        url: requestedUrl,
        loading: false,
        visible: true,
        revision: this.idGenerator(),
        updatedAt: capturedAt,
      };
      thread.workbench.panes.push(pane);
      thread.workbench.activePaneId = pane.paneId;
      thread.workbench.focusOwner = "composer";

      return {
        kind: "open_browser",
        threadId: thread.threadId,
        pane: browserPaneRef(pane),
        visibleSideEffect: "created",
      };
    }

    const urlChanged =
      requestedUrl !== undefined && requestedUrl !== reusablePane.url;
    reusablePane.visible = true;
    reusablePane.title =
      requestedTitle ?? browserTitleFromUrl(requestedUrl ?? reusablePane.url);
    if (requestedUrl !== undefined) {
      reusablePane.url = requestedUrl;
    }
    reusablePane.revision = this.idGenerator();
    reusablePane.updatedAt = capturedAt;
    thread.workbench.activePaneId = reusablePane.paneId;
    thread.workbench.focusOwner = "composer";

    return {
      kind: "open_browser",
      threadId: thread.threadId,
      pane: browserPaneRef(reusablePane),
      visibleSideEffect: urlChanged ? "navigated" : "revealed",
    };
  }

  private observeBrowserOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): ServiceResult<{ value: TideObserveBrowserOutput }> {
    const paneId = optionalString(input?.paneId);
    if (paneId === undefined) {
      return failure(
        "workbench_target_not_found",
        "Browser Pane target was not found.",
      );
    }

    const pane = thread.workbench.panes.find(
      (candidate): candidate is BrowserPaneState =>
        candidate.kind === "browser" && candidate.paneId === paneId,
    );
    if (pane === undefined) {
      return failure(
        "workbench_target_not_found",
        "Browser Pane target was not found for this Thread.",
      );
    }

    const revision = optionalString(input?.revision);
    if (revision !== undefined && revision !== pane.revision) {
      return failure(
        "workbench_stale_reference",
        "Browser Pane revision is stale.",
      );
    }

    return {
      ok: true,
      value: {
        kind: "observe_browser",
        threadId: thread.threadId,
        pane: browserPaneRef(pane),
      },
    };
  }

  private actBrowserOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): ServiceResult<{ value: TideActBrowserOutput }> {
    const paneId = optionalString(input?.paneId);
    const revision = optionalString(input?.revision);
    const selector = optionalString(input?.selector);
    const actionKind = browserActionKindFromInput(input?.action);
    if (
      paneId === undefined ||
      revision === undefined ||
      selector === undefined ||
      actionKind === undefined
    ) {
      return failure(
        "invalid_workbench_command",
        "Browser action requires pane id, revision, action, and selector.",
      );
    }

    const text = optionalRawString(input?.text);
    if (actionKind === "type_text" && text === undefined) {
      return failure(
        "invalid_workbench_command",
        "Browser type action requires text.",
      );
    }

    const pane = thread.workbench.panes.find(
      (candidate): candidate is BrowserPaneState =>
        candidate.kind === "browser" && candidate.paneId === paneId,
    );
    if (pane === undefined) {
      return failure(
        "workbench_target_not_found",
        "Browser Pane target was not found for this Thread.",
      );
    }
    if (revision !== pane.revision) {
      return failure(
        "workbench_stale_reference",
        "Browser Pane revision is stale.",
      );
    }
    if (pane.pendingAction !== undefined) {
      return failure(
        "invalid_workbench_command",
        "Browser Pane already has a pending action.",
      );
    }

    const requestedAt = this.clock();
    const action: BrowserPaneActionRequest = {
      actionId: this.idGenerator(),
      kind: actionKind,
      selector,
      requestedAt,
      ...(text === undefined ? {} : { text }),
    };
    pane.pendingAction = action;
    pane.revision = this.idGenerator();
    pane.updatedAt = requestedAt;
    thread.updatedAt = requestedAt;

    return {
      ok: true,
      value: {
        kind: "act_browser",
        threadId: thread.threadId,
        pane: browserPaneRef(pane),
        action: { ...action },
        status: "pending",
      },
    };
  }

  private async readFileOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideReadFileOutput }>> {
    const file = await this.readThreadFile(thread, input);
    if (!file.ok) {
      return file;
    }

    return {
      ok: true,
      value: {
        kind: "read_file",
        threadId: thread.threadId,
        root: file.value.root,
        path: file.value.path,
        relativePath: file.value.relativePath,
        content: file.value.content,
        byteLength: file.value.byteLength,
        truncated: file.value.truncated,
      },
    };
  }

  private async openFileOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideOpenFileOutput }>> {
    const file = await this.readThreadFile(thread, input);
    if (!file.ok) {
      return file;
    }

    const existingPane = thread.workbench.panes.find(
      (pane): pane is EditorPaneState =>
        pane.kind === "editor" && pane.filePath === file.value.path,
    );
    const visibleSideEffect = existingPane === undefined ? "created" : "revealed";
    const pane =
      existingPane ??
      ({
        paneId: this.idGenerator(),
        kind: "editor",
        title: titleFromRelativePath(file.value.relativePath),
        filePath: file.value.path,
        relativePath: file.value.relativePath,
        visible: true,
        revision: this.idGenerator(),
        updatedAt: this.clock(),
        bodyText: file.value.content,
        bodyTextPreview: file.value.content,
        byteLength: file.value.byteLength,
        truncated: file.value.truncated,
      } satisfies EditorPaneState);

    pane.visible = true;
    pane.title = titleFromRelativePath(file.value.relativePath);
    pane.relativePath = file.value.relativePath;
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    pane.bodyText = file.value.content;
    pane.bodyTextPreview = file.value.content;
    pane.byteLength = file.value.byteLength;
    pane.truncated = file.value.truncated;

    if (existingPane === undefined) {
      thread.workbench.panes.push(pane);
    }
    thread.workbench.activePaneId = pane.paneId;
    thread.workbench.focusOwner = "composer";

    return {
      ok: true,
      value: {
        kind: "open_file",
        threadId: thread.threadId,
        pane: editorPaneRef(pane) as WorkbenchPaneSnapshotRef & { kind: "editor" },
        root: file.value.root,
        path: file.value.path,
        relativePath: file.value.relativePath,
        byteLength: file.value.byteLength,
        truncated: file.value.truncated,
        visibleSideEffect,
      },
    };
  }

  private async editFileOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideEditFileOutput }>> {
    const edit = await this.editThreadFile(thread, input);
    if (!edit.ok) {
      return edit;
    }

    const diff = boundedDiffText(
      unifiedContentDiff(
        edit.value.relativePath,
        edit.value.beforeContent,
        edit.value.afterContent,
      ),
      fileByteLimit(input?.byteLimit),
    );
    const existingPane = thread.workbench.panes.find(
      (pane): pane is DiffPaneState =>
        pane.kind === "diff" && pane.filePath === edit.value.path,
    );
    const visibleSideEffect =
      existingPane === undefined ? "created" : "refreshed";
    const pane =
      existingPane ??
      ({
        paneId: this.idGenerator(),
        kind: "diff",
        title: `Diff: ${titleFromRelativePath(edit.value.relativePath)}`,
        filePath: edit.value.path,
        relativePath: edit.value.relativePath,
        visible: true,
        revision: this.idGenerator(),
        updatedAt: this.clock(),
        diffText: diff,
        truncated: edit.value.truncated,
        beforeByteLength: edit.value.beforeByteLength,
        afterByteLength: edit.value.afterByteLength,
      } satisfies DiffPaneState);

    pane.visible = true;
    pane.title = `Diff: ${titleFromRelativePath(edit.value.relativePath)}`;
    pane.relativePath = edit.value.relativePath;
    pane.diffText = diff;
    pane.truncated = edit.value.truncated || diff.endsWith("\n[diff truncated]");
    pane.beforeByteLength = edit.value.beforeByteLength;
    pane.afterByteLength = edit.value.afterByteLength;
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();

    if (existingPane === undefined) {
      thread.workbench.panes.push(pane);
    }

    this.refreshEditorPaneAfterEdit(thread, edit.value);
    thread.workbench.activePaneId = pane.paneId;
    thread.workbench.focusOwner = "composer";

    return {
      ok: true,
      value: {
        kind: "edit_file",
        threadId: thread.threadId,
        pane: diffPaneRef(pane) as WorkbenchPaneSnapshotRef & { kind: "diff" },
        root: edit.value.root,
        path: edit.value.path,
        relativePath: edit.value.relativePath,
        replacementCount: edit.value.replacementCount,
        beforeByteLength: edit.value.beforeByteLength,
        afterByteLength: edit.value.afterByteLength,
        afterContent: edit.value.afterContent,
        truncated: edit.value.truncated,
        diff,
        visibleSideEffect,
      },
    };
  }

  private async goToDefinitionOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideGoToDefinitionOutput }>> {
    const paneId = optionalString(input?.paneId);
    const position = editorPanePositionFromData(input);
    if (paneId === undefined || position === undefined) {
      return failure(
        "invalid_workbench_command",
        "Go to definition requires paneId, line, and character.",
      );
    }
    const sourcePane = workbenchPaneById(thread.workbench, paneId);
    if (sourcePane === undefined || sourcePane.kind !== "editor") {
      return failure(
        "workbench_target_not_found",
        "Editor Pane target was not found.",
      );
    }
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_code_intelligence_unavailable",
        "Thread does not have an Execution Context root for code navigation.",
      );
    }

    const definition = await this.workspaceCodeIntelligencePort.findDefinition({
      root,
      path: sourcePane.filePath,
      line: position.line,
      character: position.character,
    });
    if (!definition.ok) {
      return failure(definition.error.code, definition.error.message);
    }

    const opened = await this.openFileOutput(thread, {
      path: definition.location.relativePath,
    });
    if (!opened.ok) {
      return opened;
    }
    const targetPane = workbenchPaneById(
      thread.workbench,
      opened.value.pane.paneId,
    );
    if (targetPane === undefined || targetPane.kind !== "editor") {
      return failure(
        "workbench_target_not_found",
        "Definition target Editor Pane was not found.",
      );
    }

    targetPane.navigationTarget = {
      line: definition.location.line,
      character: definition.location.character,
      length: definition.location.length,
      label: definition.location.label,
      sourcePaneId: sourcePane.paneId,
    };
    targetPane.visible = true;
    thread.workbench.activePaneId = targetPane.paneId;
    thread.updatedAt = this.clock();

    return {
      ok: true,
      value: {
        kind: "go_to_definition",
        threadId: thread.threadId,
        pane: editorPaneRef(targetPane) as WorkbenchPaneSnapshotRef & { kind: "editor" },
        sourcePaneId: sourcePane.paneId,
        target: {
          line: definition.location.line,
          character: definition.location.character,
          length: definition.location.length,
          label: definition.location.label,
        },
      },
    };
  }

  private async goToReferencesOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideGoToReferencesOutput }>> {
    const paneId = optionalString(input?.paneId);
    const position = editorPanePositionFromData(input);
    if (paneId === undefined || position === undefined) {
      return failure(
        "invalid_workbench_command",
        "Go to references requires paneId, line, and character.",
      );
    }
    const sourcePane = workbenchPaneById(thread.workbench, paneId);
    if (sourcePane === undefined || sourcePane.kind !== "editor") {
      return failure(
        "workbench_target_not_found",
        "Editor Pane target was not found.",
      );
    }
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_code_intelligence_unavailable",
        "Thread does not have an Execution Context root for code navigation.",
      );
    }

    const references = await this.workspaceCodeIntelligencePort.findReferences({
      root,
      path: sourcePane.filePath,
      line: position.line,
      character: position.character,
    });
    if (!references.ok) {
      return failure(references.error.code, references.error.message);
    }

    const items = references.locations.map((location) => ({
      relativePath: location.relativePath,
      line: location.line,
      character: location.character,
      length: location.length,
      label: location.label,
    }));
    sourcePane.references = {
      query: sourcePane.relativePath,
      truncated: references.truncated,
      items,
    };
    sourcePane.visible = true;
    sourcePane.revision = this.idGenerator();
    sourcePane.updatedAt = this.clock();
    thread.workbench.activePaneId = sourcePane.paneId;
    thread.updatedAt = this.clock();

    return {
      ok: true,
      value: {
        kind: "go_to_references",
        threadId: thread.threadId,
        pane: editorPaneRef(sourcePane) as WorkbenchPaneSnapshotRef & { kind: "editor" },
        sourcePaneId: sourcePane.paneId,
        references: items,
        truncated: references.truncated,
      },
    };
  }

  private async runTerminalCommandOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideRunTerminalCommandOutput }>> {
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_command_unavailable",
        "Thread does not have an Execution Context root for command tools.",
      );
    }

    const command = optionalString(input?.command);
    if (command === undefined) {
      return failure("workspace_command_invalid", "Command is required.");
    }
    const args = arrayOfStrings(input?.args);
    const resolvedCwd = await this.workspaceCommandPort.resolveCwd({
      root,
      cwd: optionalString(input?.cwd),
    });
    if (!resolvedCwd.ok) {
      return failure(resolvedCwd.error.code, resolvedCwd.error.message);
    }

    const startedAt = this.clock();
    const result = await this.workspaceCommandPort.run({
      command,
      args,
      cwd: resolvedCwd.cwd.cwd,
      timeoutMs: commandTimeoutMs(input?.timeoutMs),
      byteLimit: commandByteLimit(input?.byteLimit),
      startedAt,
    });
    if (!result.ok) {
      return failure(result.error.code, result.error.message);
    }

    const run = result.run;
    const status = commandRunStatus(run);
    const pane: TerminalPaneState = {
      paneId: this.idGenerator(),
      kind: "terminal",
      title: `Command: ${commandName(run.command)}`,
      visible: true,
      revision: this.idGenerator(),
      updatedAt: run.completedAt,
      command: run.command,
      args: [...run.args],
      cwd: run.cwd,
      status,
      transcriptPreview: boundedTranscriptPreview(run.transcript),
      exitCode: run.exitCode,
      signal: run.signal,
      timedOut: run.timedOut,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };
    thread.workbench.panes.push(pane);
    thread.workbench.activePaneId = pane.paneId;
    thread.workbench.focusOwner = "composer";
    thread.updatedAt = run.completedAt;

    return {
      ok: true,
      value: {
        kind: "run_terminal_command",
        threadId: thread.threadId,
        pane: terminalPaneRef(pane) as WorkbenchPaneSnapshotRef & { kind: "terminal" },
        command: run.command,
        args: [...run.args],
        cwd: run.cwd,
        status,
        exitCode: run.exitCode,
        signal: run.signal,
        stdout: run.stdout,
        stderr: run.stderr,
        transcript: run.transcript,
        truncated: run.truncated,
        timedOut: run.timedOut,
      },
    };
  }

  private async openTerminalOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideOpenTerminalOutput }>> {
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_command_unavailable",
        "Thread does not have an Execution Context root for Terminal Pane.",
      );
    }

    const resolvedCwd = await this.workspaceCommandPort.resolveCwd({
      root,
      cwd: optionalString(input?.cwd),
    });
    if (!resolvedCwd.ok) {
      return failure(resolvedCwd.error.code, resolvedCwd.error.message);
    }

    const command = optionalString(input?.command) ?? this.defaultWorkbenchTerminalCommand;
    const args = arrayOfStrings(input?.args);
    const existingPane = thread.workbench.panes.find(
      (pane): pane is TerminalPaneState =>
        pane.kind === "terminal" &&
        pane.expectedCompletion === undefined &&
        pane.command === command &&
        pane.cwd === resolvedCwd.cwd.cwd,
    );
    const pane = this.openWorkbenchTerminal(thread, {
      command,
      args,
      cwd: resolvedCwd.cwd.cwd,
    });
    await this.ensureWorkbenchTerminalRunning(thread, pane);
    thread.workbench.activePaneId = pane.paneId;
    thread.workbench.focusOwner = "composer";
    thread.updatedAt = this.clock();

    return {
      ok: true,
      value: {
        kind: "open_terminal",
        threadId: thread.threadId,
        pane: terminalPaneRef(pane) as WorkbenchPaneSnapshotRef & { kind: "terminal" },
        command,
        args,
        cwd: resolvedCwd.cwd.cwd,
        visibleSideEffect: existingPane === undefined ? "created" : "revealed",
      },
    };
  }

  private async readThreadFile(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: WorkspaceFileRead }>> {
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_file_unavailable",
        "Thread does not have an Execution Context root for file tools.",
      );
    }

    const filePath = optionalString(input?.path);
    if (filePath === undefined) {
      return failure("workspace_file_unreadable", "File path is required.");
    }

    const read = await this.workspaceFilePort.readTextFile({
      root,
      path: filePath,
      byteLimit: fileByteLimit(input?.byteLimit),
    });
    if (!read.ok) {
      return failure(read.error.code, read.error.message);
    }

    return {
      ok: true,
      value: read.file,
    };
  }

  private async editThreadFile(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: WorkspaceFileEdit }>> {
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_file_unavailable",
        "Thread does not have an Execution Context root for file tools.",
      );
    }

    const filePath = optionalString(input?.path);
    if (filePath === undefined) {
      return failure("workspace_file_unreadable", "File path is required.");
    }
    const oldText = literalStringField(input, "oldText");
    const newText = literalStringField(input, "newText");
    if (oldText === undefined || newText === undefined) {
      return failure(
        "workspace_file_edit_conflict",
        "File edit requires oldText and newText.",
      );
    }

    const edit = await this.workspaceFilePort.replaceText({
      root,
      path: filePath,
      oldText,
      newText,
      expectedOccurrences: expectedOccurrences(input?.expectedOccurrences),
      byteLimit: fileByteLimit(input?.byteLimit),
    });
    if (!edit.ok) {
      return failure(edit.error.code, edit.error.message);
    }

    return {
      ok: true,
      value: edit.file,
    };
  }

  private refreshEditorPaneAfterEdit(
    thread: ThreadRecord,
    file: WorkspaceFileEdit,
  ): void {
    const pane = thread.workbench.panes.find(
      (candidate): candidate is EditorPaneState =>
        candidate.kind === "editor" && candidate.filePath === file.path,
    );
    if (pane === undefined) {
      return;
    }

    pane.visible = true;
    pane.title = titleFromRelativePath(file.relativePath);
    pane.relativePath = file.relativePath;
    pane.bodyText = file.afterContent;
    pane.bodyTextPreview = file.afterContent;
    pane.byteLength = file.afterByteLength;
    pane.truncated = file.truncated;
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
  }

  private refreshEditorPaneAfterWrite(
    thread: ThreadRecord,
    pane: EditorPaneState,
    file: WorkspaceFileWrite,
  ): void {
    pane.visible = true;
    pane.title = titleFromRelativePath(file.relativePath);
    pane.filePath = file.path;
    pane.relativePath = file.relativePath;
    pane.bodyText = file.content;
    pane.bodyTextPreview = file.content;
    pane.byteLength = file.byteLength;
    pane.truncated = file.truncated;
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    thread.workbench.activePaneId = pane.paneId;
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
          });
    thread.activeRuntimeHandle = cloneRuntimeHandle(handle);
    return handle;
  }
}

function normalizeThreadSeed(seed: ThreadSeed): ThreadRecord {
  return {
    threadId: seed.threadId,
    title: seed.title,
    agentBinding: cloneAgentBinding(seed.agentBinding),
    scope: cloneScope(seed.scope),
    launchOptions: cloneLaunchOptions(seed.launchOptions),
    lifecycleState: seed.lifecycleState,
    runtimeState: seed.runtimeState,
    lastKnownState: seed.lastKnownState,
    pinned: seed.pinned ?? false,
    createdAt: seed.createdAt,
    updatedAt: seed.updatedAt,
    cachedBlocks: cloneBlocks(seed.cachedBlocks ?? []),
    pendingInput: clonePendingInput(seed.pendingInput),
    promptState: clonePromptState(seed.promptState),
    activeRuntimeHandle: cloneRuntimeHandle(seed.activeRuntimeHandle),
    rawFrameSequence: seed.rawFrameSequence ?? 0,
    mcpToolCallCount: seed.mcpToolCallCount ?? 0,
    workbench: cloneWorkbenchState(seed.workbench ?? defaultWorkbenchState()),
  };
}

function toAgentSessionBlockReference(
  block: AgentSessionBlock,
): AgentSessionBlockReference {
  return {
    blockId: block.blockId,
    agentId: block.agentId,
    kind: block.kind,
    role: block.role,
    sourceFrameIds: [...block.sourceFrameIds],
    localProvenance:
      block.localProvenance === undefined ? undefined : { ...block.localProvenance },
    status: block.status,
    title: block.title,
    body: block.body,
    data: block.data === undefined ? undefined : { ...block.data },
    rawFallback: block.rawFallback,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
}

function snapshotThread(thread: ThreadRecord): ThreadSnapshot {
  return {
    threadId: thread.threadId,
    title: thread.title,
    agentBinding: cloneAgentBinding(thread.agentBinding),
    scope: cloneScope(thread.scope),
    launchOptions: cloneLaunchOptions(thread.launchOptions),
    lifecycleState: thread.lifecycleState,
    runtimeState: thread.runtimeState,
    lastKnownState: thread.lastKnownState,
    runtimeStartedAt: thread.runtimeStartedAt,
    pinned: thread.pinned ?? false,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    cachedBlocks: cloneBlocks(thread.cachedBlocks),
    pendingInput: clonePendingInput(thread.pendingInput),
    promptState: clonePromptState(thread.promptState),
    workbench: snapshotWorkbench(thread.workbench),
  };
}

function cloneAgentBinding(binding: AgentBinding): AgentBinding {
  return {
    agentId: binding.agentId,
    runtimeSource:
      binding.runtimeSource === undefined
        ? undefined
        : { ...binding.runtimeSource },
    providerSessionRef:
      binding.providerSessionRef === undefined
        ? undefined
        : { ...binding.providerSessionRef },
  };
}

function providerSessionRefsEqual(
  left: ProviderSessionRef,
  right: ProviderSessionRef,
): boolean {
  return (
    left.kind === right.kind &&
    left.value === right.value &&
    left.transcriptPath === right.transcriptPath &&
    left.logPath === right.logPath
  );
}

function cloneScope(scope: ThreadScope | undefined): ThreadScope | undefined {
  if (scope === undefined) {
    return undefined;
  }
  return { ...scope };
}

function cloneBlocks(
  blocks: AgentSessionBlockReference[],
): AgentSessionBlockReference[] {
  return blocks.map((block) => ({
    ...block,
    sourceFrameIds:
      block.sourceFrameIds === undefined ? undefined : [...block.sourceFrameIds],
    localProvenance:
      block.localProvenance === undefined ? undefined : { ...block.localProvenance },
    data: block.data === undefined ? undefined : { ...block.data },
  }));
}

function clonePendingInput(
  pendingInput: PendingInput | undefined,
): PendingInput | undefined {
  return pendingInput === undefined
    ? undefined
    : {
        ...pendingInput,
        launchOptions: cloneLaunchOptions(pendingInput.launchOptions),
      };
}

function cloneLaunchOptions(
  launchOptions: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return launchOptions === undefined ? undefined : { ...launchOptions };
}

function clonePromptState(
  promptState: PromptState | undefined,
): PromptState | undefined {
  if (promptState === undefined) {
    return undefined;
  }
  return {
    ...promptState,
    choices: promptState.choices?.map((choice) => ({ ...choice })),
  };
}

function runtimeStateForPromptKind(kind: PromptState["kind"]): AgentRuntimeState {
  return kind === "approval" || kind === "permission"
    ? "waiting_for_approval"
    : "waiting_for_input";
}

function cloneRuntimeHandle(
  handle: AgentRuntimeHandle | undefined,
): AgentRuntimeHandle | undefined {
  return handle === undefined ? undefined : { ...handle };
}

function cloneWorkbenchState(workbench: WorkbenchState): WorkbenchState {
  return {
    panes: workbench.panes.map(cloneWorkbenchPaneState),
    activePaneId: workbench.activePaneId,
    focusOwner: workbench.focusOwner,
    fileTree:
      workbench.fileTree === undefined
        ? undefined
        : cloneFileTreeView(workbench.fileTree),
  };
}

function cloneWorkbenchPaneState(
  pane: WorkbenchState["panes"][number],
): WorkbenchState["panes"][number] {
  if (pane.kind === "launcher") {
    return {
      ...pane,
      actions: pane.actions.map((action) => ({ ...action })),
    };
  }
  return { ...pane };
}

function defaultWorkbenchState(): WorkbenchState {
  return {
    panes: [],
    focusOwner: "composer",
  };
}

function snapshotWorkbench(workbench: WorkbenchState): WorkbenchSnapshot {
  return {
    panes: workbench.panes.map(workbenchSnapshotPaneRef),
    activePaneId: workbench.activePaneId,
    focusOwner: workbench.focusOwner,
    availableTools: [...TIDE_MCP_WORKBENCH_TOOL_NAMES],
    fileTree:
      workbench.fileTree === undefined
        ? undefined
        : cloneFileTreeView(workbench.fileTree),
  };
}

function cloneFileTreeView(
  fileTree: WorkbenchFileTreeView | WorkspaceFileTree,
): WorkbenchFileTreeView {
  return {
    root: fileTree.root,
    cwdLabel: fileTree.cwdLabel,
    revision: fileTree.revision,
    updatedAt: fileTree.updatedAt,
    entries: fileTree.entries.map((entry) => ({ ...entry })),
    truncated: fileTree.truncated,
  };
}

function observeThreadOutput(thread: ThreadRecord): TideObserveThreadOutput {
  return {
    kind: "observe_thread",
    threadId: thread.threadId,
    agentId: thread.agentBinding.agentId,
    agentChatState: thread.runtimeState,
    promptActive: thread.promptState !== undefined,
    workbenchOpen: thread.workbench.panes.some((pane) => pane.visible),
    availableTools: [...TIDE_MCP_WORKBENCH_TOOL_NAMES],
  };
}

function observeWorkbenchOutput(thread: ThreadRecord): TideObserveWorkbenchOutput {
  return {
    kind: "observe_workbench",
    threadId: thread.threadId,
    ...snapshotWorkbench(thread.workbench),
  };
}

function workbenchPaneRef(pane: WorkbenchState["panes"][number]): WorkbenchPaneRef {
  return {
    paneId: pane.paneId,
    kind: pane.kind,
    title: pane.title,
    visible: pane.visible,
    revision: pane.revision,
    updatedAt: pane.updatedAt,
  };
}

function browserPaneRef(pane: BrowserPaneState): BrowserPaneRef {
  return {
    ...workbenchPaneRef(pane),
    kind: "browser",
    url: pane.url,
    pageTitle: pane.pageTitle,
    loading: pane.loading,
    bodyTextPreview: pane.bodyTextPreview,
    pendingAction:
      pane.pendingAction === undefined ? undefined : { ...pane.pendingAction },
    lastAction: pane.lastAction === undefined ? undefined : { ...pane.lastAction },
    stale: false,
    availableTools: [...TIDE_MCP_WORKBENCH_TOOL_NAMES],
  };
}

function terminalPaneRef(pane: TerminalPaneState): WorkbenchPaneSnapshotRef {
  return {
    ...workbenchPaneRef(pane),
    kind: "terminal",
    command: pane.command,
    args: pane.args === undefined ? undefined : [...pane.args],
    env: cloneEnv(pane.env),
    cwd: pane.cwd,
    status: pane.status,
    expectedCompletion: pane.expectedCompletion,
    transcriptPreview: pane.transcriptPreview,
    exitCode: pane.exitCode,
    signal: pane.signal,
    timedOut: pane.timedOut,
    startedAt: pane.startedAt,
    completedAt: pane.completedAt,
  };
}

function editorPaneRef(pane: EditorPaneState): WorkbenchPaneSnapshotRef {
  return {
    ...workbenchPaneRef(pane),
    kind: "editor",
    filePath: pane.filePath,
    relativePath: pane.relativePath,
    bodyText: pane.truncated ? undefined : pane.bodyText,
    bodyTextPreview: pane.bodyTextPreview,
    byteLength: pane.byteLength,
    truncated: pane.truncated,
    navigationTarget:
      pane.navigationTarget === undefined ? undefined : { ...pane.navigationTarget },
    references:
      pane.references === undefined
        ? undefined
        : {
            query: pane.references.query,
            truncated: pane.references.truncated,
            items: pane.references.items.map((item) => ({ ...item })),
          },
  };
}

function diffPaneRef(pane: DiffPaneState): WorkbenchPaneSnapshotRef {
  return {
    ...workbenchPaneRef(pane),
    kind: "diff",
    filePath: pane.filePath,
    relativePath: pane.relativePath,
    diffText: pane.diffText,
    truncated: pane.truncated,
    beforeByteLength: pane.beforeByteLength,
    afterByteLength: pane.afterByteLength,
  };
}

function launcherPaneRef(pane: LauncherPaneState): WorkbenchPaneSnapshotRef {
  return {
    ...workbenchPaneRef(pane),
    kind: "launcher",
    actions: pane.actions.map((action) => ({ ...action })),
  };
}

function workbenchSnapshotPaneRef(
  pane: WorkbenchState["panes"][number],
): WorkbenchPaneSnapshotRef {
  if (pane.kind === "browser") {
    return browserPaneRef(pane);
  }
  if (pane.kind === "editor") {
    return editorPaneRef(pane);
  }
  if (pane.kind === "diff") {
    return diffPaneRef(pane);
  }
  if (pane.kind === "launcher") {
    return launcherPaneRef(pane);
  }
  return terminalPaneRef(pane);
}

function launcherPaneActions(): LauncherPaneState["actions"] {
  return [
    {
      actionId: "open_browser",
      label: "Browser",
      description: "Open a Browser Pane",
      enabled: true,
    },
    {
      actionId: "open_editor",
      label: "Editor",
      description: "Pick a file from the FileTree to edit",
      enabled: true,
    },
    {
      actionId: "open_terminal",
      label: "Terminal",
      description: "Open a visible Terminal Pane",
      enabled: true,
    },
    {
      actionId: "open_diff",
      label: "Diff",
      description: "Available after a file edit or review target",
      enabled: false,
    },
  ];
}

function firstBrowserPane(
  workbench: WorkbenchState,
): BrowserPaneState | undefined {
  const activePane = workbench.panes.find(
    (pane): pane is BrowserPaneState =>
      pane.kind === "browser" && pane.paneId === workbench.activePaneId,
  );
  return activePane ?? workbench.panes.find(
    (pane): pane is BrowserPaneState => pane.kind === "browser",
  );
}

function workbenchPaneById(
  workbench: WorkbenchState,
  paneId: string | undefined,
): WorkbenchState["panes"][number] | undefined {
  if (paneId === undefined) {
    return undefined;
  }
  return workbench.panes.find((pane) => pane.paneId === paneId);
}

function firstVisiblePane(
  workbench: WorkbenchState,
): WorkbenchState["panes"][number] | undefined {
  return workbench.panes.find((pane) => pane.visible);
}

function providerSetupSurfaceActionFromData(
  data: Record<string, unknown> | undefined,
): ProviderSetupSurfaceActionInput | undefined {
  const setup = recordField(data, "setup");
  const command = stringField(setup, "command");
  const cwd = stringField(setup, "cwd");
  const expectedCompletion = stringField(setup, "expectedCompletion");
  if (
    command === undefined ||
    cwd === undefined ||
    (expectedCompletion !== "process_exit" && expectedCompletion !== "retry_preflight")
  ) {
    return undefined;
  }
  return {
    command,
    args: arrayOfStrings(setup?.args),
    env: recordOfStrings(setup?.env),
    cwd,
    expectedCompletion,
  };
}

function cloneEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  return env === undefined ? undefined : { ...env };
}

function recordOfStrings(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function shallowRecordEqual(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([key, value]) => right?.[key] === value);
}

function providerSetupSurfaceInputFromData(
  data: Record<string, unknown> | undefined,
): string | undefined {
  const input = data?.input ?? data?.bytes;
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function editorPaneSaveFromData(
  data: Record<string, unknown> | undefined,
): { baseRevision: string; content: string } | undefined {
  const baseRevision = stringField(data, "baseRevision");
  const content = data?.content;
  if (baseRevision === undefined || typeof content !== "string") {
    return undefined;
  }
  return { baseRevision, content };
}

function editorPanePositionFromData(
  data: Record<string, unknown> | undefined,
): { line: number; character: number } | undefined {
  const line = data?.line;
  const character = data?.character;
  if (
    typeof line !== "number" ||
    typeof character !== "number" ||
    !Number.isInteger(line) ||
    !Number.isInteger(character) ||
    line < 0 ||
    character < 0
  ) {
    return undefined;
  }
  return { line, character };
}

function browserPaneSnapshotFromData(
  data: Record<string, unknown> | undefined,
):
  | {
      revision: string;
      url?: string;
      pageTitle?: string;
      bodyTextPreview?: string;
      loading?: boolean;
    }
  | undefined {
  const revision = optionalString(data?.revision);
  if (revision === undefined) {
    return undefined;
  }
  const bodyTextPreview =
    typeof data?.bodyTextPreview === "string"
      ? boundedBrowserTextPreview(data.bodyTextPreview)
      : undefined;
  return {
    revision,
    url: optionalString(data?.url),
    pageTitle: optionalString(data?.pageTitle),
    bodyTextPreview,
    loading: typeof data?.loading === "boolean" ? data.loading : undefined,
  };
}

function browserPaneActionResultFromData(
  data: Record<string, unknown> | undefined,
):
  | {
      revision: string;
      actionId: string;
      status: "completed" | "failed";
      message: string;
      url?: string;
      pageTitle?: string;
      bodyTextPreview?: string;
      loading?: boolean;
    }
  | undefined {
  const revision = optionalString(data?.revision);
  const actionId = optionalString(data?.actionId);
  const status =
    data?.status === "completed" || data?.status === "failed"
      ? data.status
      : undefined;
  const message = optionalRawString(data?.message);
  if (
    revision === undefined ||
    actionId === undefined ||
    status === undefined ||
    message === undefined
  ) {
    return undefined;
  }
  const bodyTextPreview =
    typeof data?.bodyTextPreview === "string"
      ? boundedBrowserTextPreview(data.bodyTextPreview)
      : undefined;
  return {
    revision,
    actionId,
    status,
    message,
    url: optionalString(data?.url),
    pageTitle: optionalString(data?.pageTitle),
    bodyTextPreview,
    loading: typeof data?.loading === "boolean" ? data.loading : undefined,
  };
}

function browserActionKindFromInput(value: unknown): "click" | "type_text" | undefined {
  return value === "click" || value === "type_text" ? value : undefined;
}

function commandName(command: string): string {
  const trimmed = command.trim();
  const parts = trimmed.split("/");
  return parts.at(-1) || trimmed || "provider";
}

function setupLaunchPreview(command: string, args: string[], cwd: string): string {
  return `$ cd ${cwd}\n$ ${[command, ...args].join(" ")}\n`;
}

function boundedTranscriptPreview(value: string): string {
  const maxLength = 8000;
  return value.length <= maxLength ? value : value.slice(value.length - maxLength);
}

function boundedBrowserTextPreview(value: string): string {
  const maxLength = 64 * 1024;
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Provider Setup Surface failed.";
}

function threadMatchesMcpSession(
  thread: ThreadRecord,
  session: TideMcpSessionRef,
): boolean {
  const handle = thread.activeRuntimeHandle;
  return (
    handle !== undefined &&
    handle.runtimeId === session.runtimeId &&
    handle.agentId === session.agentId &&
    handle.threadId === thread.threadId
  );
}

function isTideMcpToolName(toolName: string): toolName is TideMcpToolName {
  return TIDE_MCP_WORKBENCH_TOOL_NAMES.includes(toolName as TideMcpToolName);
}

function isWorkbenchMutatingTideMcpTool(toolName: TideMcpToolName): boolean {
  switch (toolName) {
    case "tide_open_browser":
    case "tide_act_browser":
    case "tide_open_file":
    case "tide_edit_file":
    case "tide_go_to_definition":
    case "tide_go_to_references":
    case "tide_open_terminal":
    case "tide_run_terminal_command":
      return true;
    case "tide_observe_thread":
    case "tide_observe_workbench":
    case "tide_observe_browser":
    case "tide_read_file":
      return false;
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function numberFromData(
  data: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function optionalRawString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function fileByteLimit(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.floor(value), 128 * 1024);
  }
  return 64 * 1024;
}

function commandByteLimit(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.floor(value), 512 * 1024);
  }
  return 64 * 1024;
}

function commandTimeoutMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.max(Math.floor(value), 1000), 120000);
  }
  return 30000;
}

function fileTreeMaxDepth(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return Math.min(value, 12);
  }
  return 12;
}

function fileTreeMaxEntries(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Math.min(value, 4000);
  }
  return 4000;
}

function commandRunStatus(run: WorkspaceCommandRun): "completed" | "failed" {
  if (run.exitCode === 0 && run.signal === null && !run.timedOut) {
    return "completed";
  }
  return "failed";
}

function expectedOccurrences(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Math.min(value, 1000);
  }
  return 1;
}

function threadRoot(thread: ThreadRecord): string | undefined {
  if (thread.scope?.kind === "project") {
    return thread.scope.cwd;
  }
  if (thread.scope?.kind === "scratch") {
    return thread.scope.scratchCwd;
  }
  return undefined;
}

function titleFromRelativePath(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? relativePath;
}

function createUnavailableWorkspaceFilePort(): WorkspaceFilePort {
  return {
    async listTree() {
      return {
        ok: false,
        error: {
          code: "workspace_file_unavailable",
          message: "Workspace file access is not configured.",
        },
      };
    },
    async readTextFile() {
      return {
        ok: false,
        error: {
          code: "workspace_file_unavailable",
          message: "Workspace file access is not configured.",
        },
      };
    },
    async replaceText() {
      return {
        ok: false,
        error: {
          code: "workspace_file_unavailable",
          message: "Workspace file access is not configured.",
        },
      };
    },
    async writeTextFile() {
      return {
        ok: false,
        error: {
          code: "workspace_file_unavailable",
          message: "Workspace file access is not configured.",
        },
      };
    },
  };
}

function createUnavailableWorkspaceCommandPort(): WorkspaceCommandPort {
  return {
    async resolveCwd() {
      return {
        ok: false,
        error: {
          code: "workspace_command_unavailable",
          message: "Workspace command access is not configured.",
        },
      };
    },
    async run() {
      return {
        ok: false,
        error: {
          code: "workspace_command_unavailable",
          message: "Workspace command access is not configured.",
        },
      };
    },
  };
}

function createUnavailableWorkspaceCodeIntelligencePort(): WorkspaceCodeIntelligencePort {
  return {
    async findDefinition() {
      return {
        ok: false,
        error: {
          code: "workspace_code_intelligence_unavailable",
          message: "Workspace code intelligence is not configured.",
        },
      };
    },
    async findReferences() {
      return {
        ok: false,
        error: {
          code: "workspace_code_intelligence_unavailable",
          message: "Workspace code intelligence is not configured.",
        },
      };
    },
  };
}

function stringField(
  value: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  return value === undefined ? undefined : optionalString(value[field]);
}

function literalStringField(
  value: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === "string" ? candidate : undefined;
}

function unifiedContentDiff(
  relativePath: string,
  beforeContent: string,
  afterContent: string,
): string {
  const oldLines = linesForDiff(beforeContent);
  const newLines = linesForDiff(afterContent);
  const changedLines =
    oldLines.length === newLines.length
      ? oldLines.flatMap((line, index) =>
          line === newLines[index] ? [` ${line}`] : [`-${line}`, `+${newLines[index]}`],
        )
      : [
          ...oldLines.map((line) => `-${line}`),
          ...newLines.map((line) => `+${line}`),
        ];
  return [
    `--- ${relativePath}`,
    `+++ ${relativePath}`,
    ...changedLines,
  ].join("\n");
}

function linesForDiff(value: string): string[] {
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.length === 0 ? [""] : lines;
}

function boundedDiffText(value: string, byteLimit: number): string {
  if (value.length <= byteLimit) {
    return value;
  }
  return `${value.slice(0, byteLimit)}\n[diff truncated]`;
}

function recordField(
  value: Record<string, unknown> | undefined,
  field: string,
): Record<string, unknown> | undefined {
  const candidate = value?.[field];
  if (
    candidate === undefined ||
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    return undefined;
  }
  return candidate as Record<string, unknown>;
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function browserTitleFromUrl(url: string | undefined): string {
  if (url === undefined) {
    return "Browser";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname || "Browser";
  } catch {
    return "Browser";
  }
}

function titleFromMessage(message: string): string {
  const title = message.trim().replace(/\s+/g, " ");
  if (title.length === 0) {
    return "New Thread";
  }
  if (title.length <= 80) {
    return title;
  }
  return `${title.slice(0, 77)}...`;
}

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

function failure(code: ServiceErrorCode, message: string): { ok: false; error: ServiceError } {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

function defaultClock(): string {
  return new Date().toISOString();
}

function defaultIdGenerator(): string {
  return `id-${Math.random().toString(36).slice(2)}`;
}
