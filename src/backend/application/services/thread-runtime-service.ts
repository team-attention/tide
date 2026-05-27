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
  | "agent_runtime_unavailable";

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

export interface TideMcpToolCallInput {
  threadId: ThreadId;
  toolName: string;
  input?: Record<string, unknown>;
}

export interface TideMcpToolCallResult {
  handledByService: true;
  thread: ThreadSnapshot;
  toolName: string;
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

  async handleTideMcpToolCall(
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<TideMcpToolCallResult>> {
    const thread = this.threads.get(input.threadId);
    if (thread === undefined) {
      return failure("thread_not_found", "Thread was not found.");
    }

    thread.mcpToolCallCount += 1;
    thread.updatedAt = this.clock();

    return {
      ok: true,
      handledByService: true,
      thread: snapshotThread(thread),
      toolName: input.toolName,
      mcpToolCallCount: thread.mcpToolCallCount,
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
