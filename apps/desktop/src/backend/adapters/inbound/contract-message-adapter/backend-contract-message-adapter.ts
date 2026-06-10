import type {
  AnswerPromptResult,
  ArchiveThreadResult,
  EditPendingInputResult,
  HydrateThreadResult,
  ListThreadsResult,
  RenameThreadResult,
  ResumeAgentRuntimeResult,
  SendComposerInputResult,
  SetThreadPinnedResult,
  ServiceError,
  ServiceResult,
  StartThreadResult,
  StopAgentRuntimeResult,
  ThreadRuntimeService,
  ThreadSnapshot,
  ProviderReadinessResult,
  TrustWorkspaceResult,
} from "../../../application/services/thread-runtime-service.ts";
import {
  CONTRACT_VERSION,
  createCommandAcceptedEvent,
  createCommandCompletedEvent,
  createContractErrorEvent,
  createContractErrorPayload,
  type AgentBindingDto,
  type AgentRuntimeSourceDto,
  type AgentRuntimeStateDto,
  type AgentSessionBlockDto,
  type BackendCommandEnvelope,
  type BackendEventEnvelope,
  type ContractErrorCode,
  type JsonObject,
  type LastKnownStateDto,
  type ProviderCliAgentId,
  type ProviderReadinessDto,
  type PromptStateDto,
  type ThreadScopeDto,
  type ThreadSummaryDto,
  type WorkbenchFileTreeDto,
  type WorkbenchPaneRefDto,
  sanitizeJsonValue,
  validateBackendCommandEnvelope,
} from "../../../../shared/contracts/index.ts";

export interface CreateBackendContractMessageAdapterInput {
  service: ThreadRuntimeService;
  clock?: () => string;
  idGenerator?: () => string;
  // Provider-CLI agents detected on the local system. Surfaced on thread.listed so the
  // composer menu can enable available agents and show the rest disabled. Evaluated
  // per call so newly-installed CLIs are picked up without a restart.
  detectAvailableAgents?: () => ProviderCliAgentId[];
}

export interface BackendContractMessageAdapter {
  handleMessage(message: unknown): Promise<BackendEventEnvelope[]>;
}

export function createBackendContractMessageAdapter(
  input: CreateBackendContractMessageAdapterInput,
): BackendContractMessageAdapter {
  return new ThreadRuntimeContractMessageAdapter(input);
}

class ThreadRuntimeContractMessageAdapter implements BackendContractMessageAdapter {
  private readonly service: ThreadRuntimeService;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;
  private readonly detectAvailableAgents?: () => ProviderCliAgentId[];

  constructor(input: CreateBackendContractMessageAdapterInput) {
    this.service = input.service;
    this.clock = input.clock ?? defaultClock;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;
    this.detectAvailableAgents = input.detectAvailableAgents;
  }

  async handleMessage(message: unknown): Promise<BackendEventEnvelope[]> {
    const validated = validateBackendCommandEnvelope(message);
    if (!validated.ok) {
      return [
        this.contractErrorEvent({
          requestId: requestIdFromUnknown(message),
          code: validated.error.code,
          message: validated.error.message,
          retryable: false,
        }),
      ];
    }

    const command = validated.value;
    const events: BackendEventEnvelope[] = [
      createCommandAcceptedEvent(command, {
        eventId: this.nextEventId(),
        emittedAt: this.clock(),
      }),
    ];

    events.push(...(await this.handleCommand(command)));
    return events;
  }

  private async handleCommand(
    command: BackendCommandEnvelope,
  ): Promise<BackendEventEnvelope[]> {
    switch (command.kind) {
      case "thread.list": {
        const typedCommand = command as BackendCommandEnvelope<"thread.list">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.listThreads(typedCommand.payload),
          (result) => [
            this.threadListedEvent(typedCommand, result),
            this.commandCompletedEvent(typedCommand),
          ],
        );
      }
      case "thread.hydrate": {
        const typedCommand = command as BackendCommandEnvelope<"thread.hydrate">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.hydrateThread(typedCommand.payload),
          (result) => [
            this.threadHydratedEvent(typedCommand, result),
            this.commandCompletedEvent(typedCommand),
          ],
        );
      }
      case "thread.start": {
        const typedCommand = command as BackendCommandEnvelope<"thread.start">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.startThread(typedCommand.payload),
          (result) => this.threadStartedEvents(typedCommand, result),
        );
      }
      case "thread.archive": {
        const typedCommand = command as BackendCommandEnvelope<"thread.archive">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.archiveThread(typedCommand.payload),
          (result) => [
            this.threadArchivedEvent(typedCommand, result),
            this.commandCompletedEvent(typedCommand),
          ],
        );
      }
      case "thread.setPinned": {
        const typedCommand = command as BackendCommandEnvelope<"thread.setPinned">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.setThreadPinned(typedCommand.payload),
          (result) => [
            this.threadPinChangedEvent(typedCommand, result),
            this.commandCompletedEvent(typedCommand),
          ],
        );
      }
      case "thread.rename": {
        const typedCommand = command as BackendCommandEnvelope<"thread.rename">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.renameThread(typedCommand.payload),
          (result) => [
            this.threadRenamedEvent(typedCommand, result),
            this.commandCompletedEvent(typedCommand),
          ],
        );
      }
      case "composer.sendInput": {
        const typedCommand = command as BackendCommandEnvelope<"composer.sendInput">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.sendComposerInput(typedCommand.payload),
          (result) => this.composerInputEvents(typedCommand, result),
        );
      }
      case "composer.editQueuedInput": {
        const typedCommand = command as BackendCommandEnvelope<"composer.editQueuedInput">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.editPendingInput(typedCommand.payload),
          (result) => this.editQueuedInputEvents(typedCommand, result),
        );
      }
      case "prompt.answer": {
        const typedCommand = command as BackendCommandEnvelope<"prompt.answer">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.answerPrompt(typedCommand.payload),
          (result) => this.promptAnswerEvents(typedCommand, result),
        );
      }
      case "agentRuntime.stop": {
        const typedCommand = command as BackendCommandEnvelope<"agentRuntime.stop">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.stopAgentRuntime(typedCommand.payload),
          (result) => this.stopRuntimeEvents(typedCommand, result),
        );
      }
      case "provider.trustWorkspace": {
        const typedCommand = command as BackendCommandEnvelope<"provider.trustWorkspace">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.trustWorkspace(typedCommand.payload),
          (result) => this.trustWorkspaceEvents(typedCommand, result),
        );
      }
      case "agentRuntime.resume": {
        const typedCommand = command as BackendCommandEnvelope<"agentRuntime.resume">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.resumeAgentRuntime(typedCommand.payload),
          (result) => this.resumeRuntimeEvents(typedCommand, result),
        );
      }
      case "workbench.command": {
        const typedCommand = command as BackendCommandEnvelope<"workbench.command">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.handleWorkbenchCommand(typedCommand.payload),
          (result) => [
            this.workbenchChangedEvent(typedCommand, result.thread),
            this.commandCompletedEvent(typedCommand, { handled: result.handled }),
          ],
        );
      }
      case "workspace.readFileTree": {
        const typedCommand = command as BackendCommandEnvelope<"workspace.readFileTree">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.readWorkspaceFileTree(typedCommand.payload),
          (result) => [
            {
              contractVersion: CONTRACT_VERSION,
              eventId: this.nextEventId(),
              requestId: typedCommand.requestId,
              kind: "workspace.fileTreeLoaded",
              emittedAt: this.clock(),
              payload: {
                cwd: result.cwd,
                fileTree: toWorkbenchFileTreeDto(result.fileTree),
              },
            } satisfies BackendEventEnvelope<"workspace.fileTreeLoaded">,
            this.commandCompletedEvent(typedCommand, { handled: true }),
          ],
        );
      }
      case "workspace.searchContent": {
        const typedCommand = command as BackendCommandEnvelope<"workspace.searchContent">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.searchWorkspaceContent(typedCommand.payload),
          (result) => [
            {
              contractVersion: CONTRACT_VERSION,
              eventId: this.nextEventId(),
              requestId: typedCommand.requestId,
              kind: "workspace.contentSearchResults",
              emittedAt: this.clock(),
              payload: {
                cwd: result.cwd,
                query: result.query,
                matches: result.matches.map((match) => ({ ...match })),
                fileCount: result.fileCount,
                truncated: result.truncated,
              },
            } satisfies BackendEventEnvelope<"workspace.contentSearchResults">,
            this.commandCompletedEvent(typedCommand, { handled: true }),
          ],
        );
      }
    }
  }

  private handleServiceResult<T>(
    command: BackendCommandEnvelope,
    result: ServiceResult<T>,
    onSuccess: (result: T) => BackendEventEnvelope[],
  ): BackendEventEnvelope[] {
    if (!result.ok) {
      return [
        this.contractErrorEvent({
          requestId: command.requestId,
          code: contractCodeFromServiceError(result.error),
          message: result.error.message,
          retryable: isRetryableServiceError(result.error),
        }),
      ];
    }

    return onSuccess(result);
  }

  private threadListedEvent(
    command: BackendCommandEnvelope,
    result: ListThreadsResult,
  ): BackendEventEnvelope<"thread.listed"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "thread.listed",
      emittedAt: this.clock(),
      payload: {
        threads: result.threads.map(toThreadSummaryDto),
        availableAgents: this.detectAvailableAgents?.(),
      },
    };
  }

  private threadArchivedEvent(
    command: BackendCommandEnvelope,
    result: ArchiveThreadResult,
  ): BackendEventEnvelope<"thread.archived"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "thread.archived",
      emittedAt: this.clock(),
      payload: {
        thread: toThreadSummaryDto(result.thread),
      },
    };
  }

  private threadPinChangedEvent(
    command: BackendCommandEnvelope,
    result: SetThreadPinnedResult,
  ): BackendEventEnvelope<"thread.pinChanged"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "thread.pinChanged",
      emittedAt: this.clock(),
      payload: {
        thread: toThreadSummaryDto(result.thread),
      },
    };
  }

  private threadRenamedEvent(
    command: BackendCommandEnvelope,
    result: RenameThreadResult,
  ): BackendEventEnvelope<"thread.renamed"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "thread.renamed",
      emittedAt: this.clock(),
      payload: {
        thread: toThreadSummaryDto(result.thread),
      },
    };
  }

  private threadHydratedEvent(
    command: BackendCommandEnvelope,
    result: HydrateThreadResult,
  ): BackendEventEnvelope<"thread.hydrated"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "thread.hydrated",
      emittedAt: this.clock(),
      payload: {
        ...omitUndefinedProperties({
          thread: toThreadSummaryDto(result.thread),
          blocks: result.blocks.map((block) =>
            toAgentSessionBlockDto(result.thread, block),
          ),
          runtimeState: result.runtimeState,
          // Always present (null when none): hydrate is the source of truth for
          // the pending prompt when a thread is (re)opened.
          prompt:
            result.thread.promptState === undefined
              ? null
              : toPromptStateDto(result.thread.promptState),
          workbenchPanes: result.thread.workbench.panes.map(toWorkbenchPaneRefDto),
          fileTree:
            result.thread.workbench.fileTree === undefined
              ? undefined
              : toWorkbenchFileTreeDto(result.thread.workbench.fileTree),
        }),
      },
    };
  }

  private threadStartedEvents(
    command: BackendCommandEnvelope,
    result: StartThreadResult,
  ): BackendEventEnvelope[] {
    if (result.status === "provider_not_ready") {
      return [
        this.providerReadinessChangedEvent(command, result.thread.threadId, result.providerReadiness),
        this.threadHydratedEvent(command, {
          thread: result.thread,
          runtimeState: result.runtimeState,
          blocks: result.thread.cachedBlocks,
        }),
        this.commandCompletedEvent(command),
      ];
    }

    return [
      ...(result.submittedBlock === undefined
        ? []
        : [this.agentSessionBlockUpsertedEvent(command, result.thread, result.submittedBlock)]),
      {
        contractVersion: CONTRACT_VERSION,
        eventId: this.nextEventId(),
        requestId: command.requestId,
        kind: "thread.started",
        emittedAt: this.clock(),
        payload: {
          thread: toThreadSummaryDto(result.thread),
          runtimeState: result.runtimeState,
        },
      },
      this.commandCompletedEvent(command),
    ];
  }

  private composerInputEvents(
    command: BackendCommandEnvelope,
    result: SendComposerInputResult,
  ): BackendEventEnvelope[] {
    if (result.status === "provider_not_ready") {
      return [
        this.providerReadinessChangedEvent(command, result.thread.threadId, result.providerReadiness),
        this.commandCompletedEvent(command),
      ];
    }

    return [
      ...(result.submittedBlock === undefined
        ? []
        : [this.agentSessionBlockUpsertedEvent(command, result.thread, result.submittedBlock)]),
      this.agentRuntimeStateChangedEvent(command, result.thread, result.runtimeState),
      this.commandCompletedEvent(command),
    ];
  }

  private editQueuedInputEvents(
    command: BackendCommandEnvelope,
    result: EditPendingInputResult,
  ): BackendEventEnvelope[] {
    // The queued message hasn't been sent, so editing only confirms the new
    // backend state; Desktop already holds the edited text it typed.
    return [this.commandCompletedEvent(command, { status: result.status })];
  }

  private promptAnswerEvents(
    command: BackendCommandEnvelope,
    result: AnswerPromptResult,
  ): BackendEventEnvelope[] {
    return [
      {
        contractVersion: CONTRACT_VERSION,
        eventId: this.nextEventId(),
        requestId: command.requestId,
        kind: "prompt.changed",
        emittedAt: this.clock(),
        payload: {
          threadId: result.thread.threadId,
          prompt: result.promptState === null ? null : toPromptStateDto(result.promptState),
        },
      },
      this.agentRuntimeStateChangedEvent(command, result.thread, result.runtimeState),
      this.commandCompletedEvent(command),
    ];
  }

  private trustWorkspaceEvents(
    command: BackendCommandEnvelope,
    result: TrustWorkspaceResult,
  ): BackendEventEnvelope[] {
    return [
      this.providerReadinessChangedEvent(
        command,
        result.thread.threadId,
        result.providerReadiness,
      ),
      this.agentRuntimeStateChangedEvent(command, result.thread, result.runtimeState),
      this.commandCompletedEvent(command),
    ];
  }

  private resumeRuntimeEvents(
    command: BackendCommandEnvelope,
    result: ResumeAgentRuntimeResult,
  ): BackendEventEnvelope[] {
    return [
      this.agentRuntimeStateChangedEvent(command, result.thread, result.runtimeState),
      this.commandCompletedEvent(command),
    ];
  }

  private workbenchChangedEvent(
    command: BackendCommandEnvelope,
    thread: ThreadSnapshot,
  ): BackendEventEnvelope<"workbench.changed"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "workbench.changed",
      emittedAt: this.clock(),
      payload: omitUndefinedProperties({
        threadId: thread.threadId,
        panes: thread.workbench.panes.map(toWorkbenchPaneRefDto),
        activePaneId: thread.workbench.activePaneId,
        fileTree:
          thread.workbench.fileTree === undefined
            ? undefined
            : toWorkbenchFileTreeDto(thread.workbench.fileTree),
      }),
    };
  }

  private stopRuntimeEvents(
    command: BackendCommandEnvelope,
    result: StopAgentRuntimeResult,
  ): BackendEventEnvelope[] {
    return [
      this.agentRuntimeStateChangedEvent(command, result.thread, result.runtimeState),
      // When stopping consumed a queued follow-up, surface its user block.
      ...(result.submittedBlock === undefined
        ? []
        : [this.agentSessionBlockUpsertedEvent(command, result.thread, result.submittedBlock)]),
      this.commandCompletedEvent(command),
    ];
  }

  private providerReadinessChangedEvent(
    command: BackendCommandEnvelope,
    threadId: string,
    readiness: ProviderReadinessResult,
  ): BackendEventEnvelope<"providerReadiness.changed"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "providerReadiness.changed",
      emittedAt: this.clock(),
      payload: {
        threadId,
        readiness: toProviderReadinessDto(readiness),
      },
    };
  }

  private agentRuntimeStateChangedEvent(
    command: BackendCommandEnvelope,
    thread: ThreadSnapshot,
    state: AgentRuntimeStateDto,
  ): BackendEventEnvelope<"agentRuntime.stateChanged"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "agentRuntime.stateChanged",
      emittedAt: this.clock(),
      payload: {
        threadId: thread.threadId,
        state,
        changedAt: thread.updatedAt,
      },
    };
  }

  private commandCompletedEvent(
    command: BackendCommandEnvelope,
    result?: JsonObject,
  ): BackendEventEnvelope<"command.completed"> {
    return createCommandCompletedEvent(command, {
      eventId: this.nextEventId(),
      emittedAt: this.clock(),
      result,
    });
  }

  private agentSessionBlockUpsertedEvent(
    command: BackendCommandEnvelope,
    thread: ThreadSnapshot,
    block: ThreadSnapshot["cachedBlocks"][number],
  ): BackendEventEnvelope<"agentSessionBlock.upserted"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "agentSessionBlock.upserted",
      emittedAt: this.clock(),
      payload: {
        block: toAgentSessionBlockDto(thread, block),
      },
    };
  }

  private contractErrorEvent(input: {
    requestId?: string;
    code: ContractErrorCode;
    message: string;
    retryable: boolean;
  }): BackendEventEnvelope<"contract.error"> {
    return createContractErrorEvent({
      eventId: this.nextEventId(),
      requestId: input.requestId,
      emittedAt: this.clock(),
      error: createContractErrorPayload({
        code: input.code,
        message: input.message,
        severity: "error",
        retryable: input.retryable,
      }),
    });
  }

  private nextEventId(): string {
    return this.idGenerator();
  }
}

export function toThreadSummaryDto(thread: ThreadSnapshot): ThreadSummaryDto {
  const launchOptions = jsonObject(thread.launchOptions);
  const summary: ThreadSummaryDto = {
    threadId: thread.threadId,
    title: thread.title,
    agentBinding: toAgentBindingDto(thread.agentBinding),
    scope: toThreadScopeDto(thread.scope),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    pinned: thread.pinned ?? false,
    archived: thread.lifecycleState === "archived",
    lastKnownState: thread.lastKnownState as LastKnownStateDto,
  };
  if (launchOptions !== undefined) {
    summary.launchOptions = launchOptions;
  }
  if (thread.runtimeStartedAt !== undefined) {
    summary.runtimeStartedAt = thread.runtimeStartedAt;
  }
  return summary;
}

function toAgentBindingDto(binding: ThreadSnapshot["agentBinding"]): AgentBindingDto {
  const dto: AgentBindingDto = {
    agentId: binding.agentId,
    runtimeSource: toAgentRuntimeSourceDto(
      binding.runtimeSource ?? defaultRuntimeSourceForAgent(binding.agentId),
    ),
  };
  if (binding.providerSessionRef !== undefined) {
    dto.providerSessionRef = {
      kind: binding.providerSessionRef.kind,
      value: binding.providerSessionRef.value,
    };
    if (binding.providerSessionRef.transcriptPath !== undefined) {
      dto.providerSessionRef.transcriptPath = binding.providerSessionRef.transcriptPath;
    }
    if (binding.providerSessionRef.logPath !== undefined) {
      dto.providerSessionRef.logPath = binding.providerSessionRef.logPath;
    }
  }
  return dto;
}

function toAgentRuntimeSourceDto(
  source: AgentRuntimeSourceDto,
): AgentRuntimeSourceDto {
  if (source.kind === "provider_cli") {
    return { kind: "provider_cli", integrationId: source.integrationId };
  }
  const dto: AgentRuntimeSourceDto = { kind: "tide_api", provider: source.provider };
  if (source.accountId !== undefined) {
    dto.accountId = source.accountId;
  }
  return dto;
}

function defaultRuntimeSourceForAgent(
  agentId: ThreadSnapshot["agentBinding"]["agentId"],
): AgentRuntimeSourceDto {
  if (agentId === "openai_api") {
    return { kind: "tide_api", provider: "openai" };
  }
  return { kind: "provider_cli", integrationId: agentId };
}

function toThreadScopeDto(scope: ThreadSnapshot["scope"]): ThreadScopeDto {
  if (scope === undefined) {
    return { kind: "scratch", scratchCwd: "" };
  }
  return { ...scope };
}

export function toAgentSessionBlockDto(
  thread: ThreadSnapshot,
  block: ThreadSnapshot["cachedBlocks"][number],
): AgentSessionBlockDto {
  return omitUndefinedProperties({
    blockId: block.blockId,
    threadId: thread.threadId,
    agentId: block.agentId ?? thread.agentBinding.agentId,
    kind: block.kind,
    role: block.role,
    sourceFrameIds: block.sourceFrameIds?.map((frameId) => frameId),
    localProvenance: jsonObject(block.localProvenance),
    status: block.status,
    title: block.title,
    body: block.body,
    data: jsonObject(block.data),
    rawFallback: block.rawFallback,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  });
}

function jsonObject(value: Record<string, unknown> | undefined): AgentSessionBlockDto["data"] {
  if (value === undefined) {
    return undefined;
  }
  const sanitized = sanitizeJsonValue(value);
  if (sanitized === undefined || sanitized === null || Array.isArray(sanitized) || typeof sanitized !== "object") {
    return undefined;
  }
  return sanitized;
}

export function toProviderReadinessDto(
  readiness: ProviderReadinessResult,
): ProviderReadinessDto {
  return {
    agentId: readiness.agentId,
    ready: readiness.ready,
    blockers: readiness.blockers.map((blocker) => ({ ...blocker })),
  };
}

function toPromptStateDto(prompt: NonNullable<ThreadSnapshot["promptState"]>): PromptStateDto {
  return {
    ...prompt,
    choices: prompt.choices?.map((choice) => ({ ...choice })),
  };
}

function contractCodeFromServiceError(error: ServiceError): ContractErrorCode {
  switch (error.code) {
    case "thread_not_found":
    case "provider_not_ready":
    case "agent_runtime_unavailable":
      return error.code;
    case "agent_binding_locked":
    case "prompt_not_found":
    case "no_pending_input":
    case "invalid_workbench_command":
    case "invalid_thread_title":
    case "workbench_target_not_found":
    case "workbench_stale_reference":
    case "unsupported_tide_mcp_tool":
    case "directory_trust_unavailable":
    case "workspace_file_unavailable":
    case "workspace_file_not_found":
    case "workspace_file_outside_scope":
    case "workspace_file_not_text":
    case "workspace_file_unreadable":
    case "workspace_file_too_large":
    case "workspace_file_edit_conflict":
    case "workspace_command_unavailable":
    case "workspace_command_invalid":
    case "workspace_command_outside_scope":
    case "workspace_code_intelligence_unavailable":
    case "workspace_code_definition_not_found":
    case "workspace_code_references_not_found":
      return "invalid_command";
  }
}

function isRetryableServiceError(error: ServiceError): boolean {
  return error.code === "provider_not_ready" || error.code === "agent_runtime_unavailable";
}

function requestIdFromUnknown(message: unknown): string | undefined {
  if (
    typeof message === "object" &&
    message !== null &&
    "requestId" in message &&
    typeof message.requestId === "string" &&
    message.requestId.length > 0
  ) {
    return message.requestId;
  }

  return undefined;
}

function defaultClock(): string {
  return new Date().toISOString();
}

function defaultIdGenerator(): string {
  return `evt-${Math.random().toString(36).slice(2)}`;
}

export function toWorkbenchPaneRefDto(
  pane: ThreadSnapshot["workbench"]["panes"][number],
): WorkbenchPaneRefDto {
  if (pane.kind === "browser") {
    const dto: WorkbenchPaneRefDto = {
      paneId: pane.paneId,
      kind: "browser",
      title: pane.title,
      visible: pane.visible,
      revision: pane.revision,
      updatedAt: pane.updatedAt,
      loading: pane.loading,
    };
    if (pane.url !== undefined) {
      dto.url = pane.url;
    }
    if (pane.pageTitle !== undefined) {
      dto.pageTitle = pane.pageTitle;
    }
    if (pane.bodyTextPreview !== undefined) {
      dto.bodyTextPreview = pane.bodyTextPreview;
    }
    if (pane.pendingAction !== undefined) {
      dto.pendingAction = { ...pane.pendingAction };
    }
    if (pane.lastAction !== undefined) {
      dto.lastAction = { ...pane.lastAction };
    }
    return dto;
  }
  if (pane.kind === "launcher") {
    return {
      paneId: pane.paneId,
      kind: "launcher",
      title: pane.title,
      visible: pane.visible,
      revision: pane.revision,
      updatedAt: pane.updatedAt,
      actions: pane.actions.map((action) => ({ ...action })),
    };
  }

  const dto: WorkbenchPaneRefDto = {
    paneId: pane.paneId,
    kind: pane.kind,
    title: pane.title,
    visible: pane.visible,
    revision: pane.revision,
    updatedAt: pane.updatedAt,
  };
  if (pane.kind === "editor" || pane.kind === "diff") {
    if (pane.filePath !== undefined) {
      dto.filePath = pane.filePath;
    }
    if (pane.relativePath !== undefined) {
      dto.relativePath = pane.relativePath;
    }
    if (pane.truncated !== undefined) {
      dto.truncated = pane.truncated;
    }
  }
  if (pane.kind === "editor") {
    if (pane.bodyTextPreview !== undefined) {
      dto.bodyTextPreview = pane.bodyTextPreview;
    }
    if (pane.byteLength !== undefined) {
      dto.byteLength = pane.byteLength;
    }
    if (pane.navigationTarget !== undefined) {
      dto.navigationTarget = { ...pane.navigationTarget };
    }
    if (pane.references !== undefined) {
      dto.references = {
        query: pane.references.query,
        truncated: pane.references.truncated,
        items: pane.references.items.map((item) => ({ ...item })),
      };
    }
  }
  if (pane.kind === "diff") {
    if (pane.diffText !== undefined) {
      dto.diffText = pane.diffText;
    }
    if (pane.beforeByteLength !== undefined) {
      dto.beforeByteLength = pane.beforeByteLength;
    }
    if (pane.afterByteLength !== undefined) {
      dto.afterByteLength = pane.afterByteLength;
    }
  }
  if (pane.kind === "terminal") {
    if (pane.command !== undefined) {
      dto.command = pane.command;
    }
    if (pane.args !== undefined) {
      dto.args = pane.args.map((arg) => arg);
    }
    if (pane.cwd !== undefined) {
      dto.cwd = pane.cwd;
    }
    if (pane.status !== undefined) {
      dto.status = pane.status;
    }
    if (pane.expectedCompletion !== undefined) {
      dto.expectedCompletion = pane.expectedCompletion;
    }
    if (pane.transcriptPreview !== undefined) {
      dto.transcriptPreview = pane.transcriptPreview;
    }
    if (pane.exitCode !== undefined) {
      dto.exitCode = pane.exitCode;
    }
    if (pane.signal !== undefined) {
      dto.signal = pane.signal;
    }
    if (pane.timedOut !== undefined) {
      dto.timedOut = pane.timedOut;
    }
    if (pane.startedAt !== undefined) {
      dto.startedAt = pane.startedAt;
    }
    if (pane.completedAt !== undefined) {
      dto.completedAt = pane.completedAt;
    }
  }
  return dto;
}

function toWorkbenchFileTreeDto(
  fileTree: NonNullable<ThreadSnapshot["workbench"]["fileTree"]>,
): WorkbenchFileTreeDto {
  return {
    root: fileTree.root,
    cwdLabel: fileTree.cwdLabel,
    revision: fileTree.revision,
    updatedAt: fileTree.updatedAt,
    truncated: fileTree.truncated,
    entries: fileTree.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      relativePath: entry.relativePath,
      depth: entry.depth,
      kind: entry.kind,
      ...(entry.active === undefined ? {} : { active: entry.active }),
    })),
  };
}

function omitUndefinedProperties<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  ) as T;
}
