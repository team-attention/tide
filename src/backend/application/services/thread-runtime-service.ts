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
  ThreadId,
  ThreadLifecycleState,
  ThreadRecord,
  ThreadScope,
  ThreadSnapshot,
} from "../domains/thread/thread.ts";
import type {
  BrowserPaneRef,
  BrowserPaneState,
  TideMcpToolDefinition,
  TideMcpToolName,
  WorkbenchPaneRef,
  WorkbenchSnapshot,
  WorkbenchState,
} from "../domains/workbench/workbench.ts";
import { TIDE_MCP_WORKBENCH_TOOL_NAMES } from "../domains/workbench/workbench.ts";
import type { AgentRuntimePort } from "../ports/outbound/agent-runtime-port.ts";
import type { ProviderReadinessPort } from "../ports/outbound/provider-readiness-port.ts";
import type { PtyTranscriptPort } from "../ports/outbound/pty-transcript-port.ts";

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
  PtyTranscriptPort,
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
  lifecycleState: ThreadLifecycleState;
  runtimeState: AgentRuntimeState;
  lastKnownState: LastKnownState;
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
  clock?: () => string;
  idGenerator?: () => string;
  initialThreads?: ThreadSeed[];
}

export type ServiceErrorCode =
  | "thread_not_found"
  | "agent_binding_locked"
  | "provider_not_ready"
  | "prompt_not_found"
  | "agent_runtime_unavailable"
  | "workbench_target_not_found"
  | "workbench_stale_reference"
  | "unsupported_tide_mcp_tool";

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
}

export interface StartThreadInput {
  threadId?: ThreadId;
  initialMessage: string;
  agentBinding: AgentBinding;
  scope?: ThreadScope;
  launchOptions?: Record<string, unknown>;
}

export interface StartThreadResult {
  status: "started" | "provider_not_ready";
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  providerReadiness: ProviderReadinessResult;
}

export interface SendComposerInput {
  threadId: ThreadId;
  input: string;
  agentId?: AgentId;
  launchOptions?: Record<string, unknown>;
}

export interface SendComposerInputResult {
  status: "sent" | "provider_not_ready";
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
  providerReadiness: ProviderReadinessResult;
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

export interface StopAgentRuntimeInput {
  threadId: ThreadId;
}

export interface StopAgentRuntimeResult {
  thread: ThreadSnapshot;
  runtimeState: AgentRuntimeState;
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
  | TideObserveBrowserOutput;

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

export interface TideMcpToolCallResult {
  handledByService: true;
  thread: ThreadSnapshot;
  toolName: TideMcpToolName;
  output: TideMcpToolOutput;
  mcpToolCallCount: number;
}

export interface ThreadRuntimeService {
  hydrateThread(input: HydrateThreadInput): Promise<ServiceResult<HydrateThreadResult>>;
  startThread(input: StartThreadInput): Promise<ServiceResult<StartThreadResult>>;
  sendComposerInput(
    input: SendComposerInput,
  ): Promise<ServiceResult<SendComposerInputResult>>;
  answerPrompt(input: AnswerPromptInput): Promise<ServiceResult<AnswerPromptResult>>;
  stopAgentRuntime(
    input: StopAgentRuntimeInput,
  ): Promise<ServiceResult<StopAgentRuntimeResult>>;
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
];

class InMemoryThreadRuntimeService implements ThreadRuntimeService {
  agentRuntimePort: AgentRuntimePort;
  providerReadinessPort: ProviderReadinessPort;
  ptyTranscriptPort: PtyTranscriptPort;
  clock: () => string;
  idGenerator: () => string;
  threads = new Map<ThreadId, ThreadRecord>();

  constructor(input: CreateThreadRuntimeServiceInput) {
    this.agentRuntimePort = input.agentRuntimePort;
    this.providerReadinessPort = input.providerReadinessPort;
    this.ptyTranscriptPort = input.ptyTranscriptPort;
    this.clock = input.clock ?? defaultClock;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;

    for (const seed of input.initialThreads ?? []) {
      this.threads.set(seed.threadId, normalizeThreadSeed(seed));
    }
  }

  async hydrateThread(
    input: HydrateThreadInput,
  ): Promise<ServiceResult<HydrateThreadResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      blocks: cloneBlocks(thread.cachedBlocks),
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

    const readiness = await this.providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: thread.scope,
      launchOptions: input.launchOptions,
    });

    if (!readiness.ready) {
      thread.lifecycleState = "open";
      thread.pendingInput = {
        kind: "composer_input",
        value: input.initialMessage,
        capturedAt,
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
    thread.lifecycleState = "running";
    thread.lastKnownState = "running";
    thread.updatedAt = this.clock();

    const handle = await this.agentRuntimePort.start({
      threadId,
      agentBinding: cloneAgentBinding(thread.agentBinding),
      scope: cloneScope(thread.scope),
      launchOptions: input.launchOptions,
    });

    thread.activeRuntimeHandle = cloneRuntimeHandle(handle);
    thread.runtimeState = "running";
    thread.updatedAt = this.clock();

    await this.agentRuntimePort.writeInput(handle, {
      kind: "composer_input",
      value: input.initialMessage,
      submittedAt: this.clock(),
    });

    return {
      ok: true,
      status: "started",
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      providerReadiness: readiness,
    };
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

    const readiness = await this.providerReadinessPort.check({
      agentId: thread.agentBinding.agentId,
      scope: thread.scope,
      launchOptions: input.launchOptions,
    });

    if (!readiness.ready) {
      thread.pendingInput = {
        kind: "composer_input",
        value: input.input,
        capturedAt: this.clock(),
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

    const handle = await this.activeOrResumedHandle(thread);
    thread.runtimeState = "running";
    thread.lifecycleState = "running";
    thread.lastKnownState = "running";
    thread.updatedAt = this.clock();

    await this.agentRuntimePort.writeInput(handle, {
      kind: "composer_input",
      value: input.input,
      submittedAt: this.clock(),
    });

    return {
      ok: true,
      status: "sent",
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
      providerReadiness: readiness,
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
      value: input.value ?? "",
      choiceId: input.choiceId,
      promptId: input.promptId,
      submittedAt: this.clock(),
    });

    thread.promptState = undefined;
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
    thread.updatedAt = this.clock();

    return {
      ok: true,
      thread: snapshotThread(thread),
      runtimeState: thread.runtimeState,
    };
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

    const output = this.handleResolvedTideMcpToolCall(thread, input);
    if (!output.ok) {
      return { ok: false, error: output.error };
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

  private handleResolvedTideMcpToolCall(
    thread: ThreadRecord,
    input: TideMcpToolCallInput,
  ): ServiceResult<{ value: TideMcpToolOutput }> {
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
      (candidate) =>
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

  async activeOrResumedHandle(thread: ThreadRecord): Promise<AgentRuntimeHandle> {
    if (thread.activeRuntimeHandle !== undefined) {
      return thread.activeRuntimeHandle;
    }

    thread.runtimeState = "starting";
    thread.updatedAt = this.clock();
    const resumeInput: AgentRuntimeResumeInput = {
      threadId: thread.threadId,
      agentBinding: cloneAgentBinding(thread.agentBinding),
      scope: cloneScope(thread.scope),
    };
    const handle = await this.agentRuntimePort.resume(resumeInput);
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
    lifecycleState: seed.lifecycleState,
    runtimeState: seed.runtimeState,
    lastKnownState: seed.lastKnownState,
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

function snapshotThread(thread: ThreadRecord): ThreadSnapshot {
  return {
    threadId: thread.threadId,
    title: thread.title,
    agentBinding: cloneAgentBinding(thread.agentBinding),
    scope: cloneScope(thread.scope),
    lifecycleState: thread.lifecycleState,
    runtimeState: thread.runtimeState,
    lastKnownState: thread.lastKnownState,
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
    providerSessionRef:
      binding.providerSessionRef === undefined
        ? undefined
        : { ...binding.providerSessionRef },
  };
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
  return blocks.map((block) => ({ ...block }));
}

function clonePendingInput(
  pendingInput: PendingInput | undefined,
): PendingInput | undefined {
  return pendingInput === undefined ? undefined : { ...pendingInput };
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

function cloneRuntimeHandle(
  handle: AgentRuntimeHandle | undefined,
): AgentRuntimeHandle | undefined {
  return handle === undefined ? undefined : { ...handle };
}

function cloneWorkbenchState(workbench: WorkbenchState): WorkbenchState {
  return {
    panes: workbench.panes.map((pane) => ({ ...pane })),
    activePaneId: workbench.activePaneId,
    focusOwner: workbench.focusOwner,
  };
}

function defaultWorkbenchState(): WorkbenchState {
  return {
    panes: [],
    focusOwner: "composer",
  };
}

function snapshotWorkbench(workbench: WorkbenchState): WorkbenchSnapshot {
  return {
    panes: workbench.panes.map(browserPaneRef),
    activePaneId: workbench.activePaneId,
    focusOwner: workbench.focusOwner,
    availableTools: [...TIDE_MCP_WORKBENCH_TOOL_NAMES],
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

function workbenchPaneRef(pane: BrowserPaneState): WorkbenchPaneRef {
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
    stale: false,
    availableTools: [...TIDE_MCP_WORKBENCH_TOOL_NAMES],
  };
}

function firstBrowserPane(
  workbench: WorkbenchState,
): BrowserPaneState | undefined {
  const activePane = workbench.panes.find(
    (pane) =>
      pane.kind === "browser" && pane.paneId === workbench.activePaneId,
  );
  return activePane ?? workbench.panes.find((pane) => pane.kind === "browser");
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

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
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
