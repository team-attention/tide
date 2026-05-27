import type {
  AnswerPromptResult,
  HydrateThreadResult,
  SendComposerInputResult,
  ServiceError,
  ServiceResult,
  StartThreadResult,
  StopAgentRuntimeResult,
  ThreadRuntimeService,
  ThreadSnapshot,
  ProviderReadinessResult,
} from "../../../application/services/thread-runtime-service.ts";
import {
  CONTRACT_VERSION,
  createCommandAcceptedEvent,
  createCommandCompletedEvent,
  createContractErrorEvent,
  createContractErrorPayload,
  type AgentBindingDto,
  type AgentRuntimeStateDto,
  type AgentSessionBlockDto,
  type BackendCommandEnvelope,
  type BackendEventEnvelope,
  type ContractErrorCode,
  type LastKnownStateDto,
  type ProviderReadinessDto,
  type PromptStateDto,
  type ThreadScopeDto,
  type ThreadSummaryDto,
  type WorkbenchPaneRefDto,
  validateBackendCommandEnvelope,
} from "../../../../shared/contracts/index.ts";

export interface CreateBackendContractMessageAdapterInput {
  service: ThreadRuntimeService;
  clock?: () => string;
  idGenerator?: () => string;
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

  constructor(input: CreateBackendContractMessageAdapterInput) {
    this.service = input.service;
    this.clock = input.clock ?? defaultClock;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;
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
      case "thread.hydrate":
        return this.handleServiceResult(
          command,
          await this.service.hydrateThread(command.payload),
          (result) => [
            this.threadHydratedEvent(command, result),
            this.commandCompletedEvent(command),
          ],
        );
      case "thread.start":
        return this.handleServiceResult(
          command,
          await this.service.startThread(command.payload),
          (result) => this.threadStartedEvents(command, result),
        );
      case "composer.sendInput":
        return this.handleServiceResult(
          command,
          await this.service.sendComposerInput(command.payload),
          (result) => this.composerInputEvents(command, result),
        );
      case "prompt.answer":
        return this.handleServiceResult(
          command,
          await this.service.answerPrompt(command.payload),
          (result) => this.promptAnswerEvents(command, result),
        );
      case "agentRuntime.stop":
        return this.handleServiceResult(
          command,
          await this.service.stopAgentRuntime(command.payload),
          (result) => this.stopRuntimeEvents(command, result),
        );
      case "agentRuntime.resume":
        return [
          this.contractErrorEvent({
            requestId: command.requestId,
            code: "agent_runtime_unavailable",
            message: "Agent Runtime resume command is not implemented in this slice.",
            retryable: true,
          }),
        ];
      case "workbench.command":
        return [
          createCommandCompletedEvent(command, {
            eventId: this.nextEventId(),
            emittedAt: this.clock(),
            result: {
              handled: false,
              reason: "Workbench command handling is out of scope for this slice.",
            },
          }),
        ];
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
        thread: toThreadSummaryDto(result.thread),
        blocks: result.blocks.map((block) =>
          toAgentSessionBlockDto(result.thread, block),
        ),
        runtimeState: result.runtimeState,
        workbenchPanes: result.thread.workbench.panes.map(toWorkbenchPaneRefDto),
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
      this.agentRuntimeStateChangedEvent(command, result.thread, result.runtimeState),
      this.commandCompletedEvent(command),
    ];
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

  private stopRuntimeEvents(
    command: BackendCommandEnvelope,
    result: StopAgentRuntimeResult,
  ): BackendEventEnvelope[] {
    return [
      this.agentRuntimeStateChangedEvent(command, result.thread, result.runtimeState),
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
  ): BackendEventEnvelope<"command.completed"> {
    return createCommandCompletedEvent(command, {
      eventId: this.nextEventId(),
      emittedAt: this.clock(),
    });
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

function toThreadSummaryDto(thread: ThreadSnapshot): ThreadSummaryDto {
  return {
    threadId: thread.threadId,
    title: thread.title,
    agentBinding: toAgentBindingDto(thread.agentBinding),
    scope: toThreadScopeDto(thread.scope),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    pinned: false,
    archived: thread.lifecycleState === "archived",
    lastKnownState: thread.lastKnownState as LastKnownStateDto,
  };
}

function toAgentBindingDto(binding: ThreadSnapshot["agentBinding"]): AgentBindingDto {
  const dto: AgentBindingDto = {
    agentId: binding.agentId,
  };
  if (binding.providerSessionRef !== undefined) {
    dto.providerSessionRef = { ...binding.providerSessionRef };
  }
  return dto;
}

function toThreadScopeDto(scope: ThreadSnapshot["scope"]): ThreadScopeDto {
  if (scope === undefined) {
    return { kind: "scratch", scratchCwd: "" };
  }
  return { ...scope };
}

function toAgentSessionBlockDto(
  thread: ThreadSnapshot,
  block: ThreadSnapshot["cachedBlocks"][number],
): AgentSessionBlockDto {
  return {
    blockId: block.blockId,
    threadId: thread.threadId,
    agentId: thread.agentBinding.agentId,
    kind: block.kind,
    status: block.status,
    updatedAt: block.updatedAt,
  };
}

function toProviderReadinessDto(
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
    case "workbench_target_not_found":
    case "workbench_stale_reference":
    case "unsupported_tide_mcp_tool":
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

function toWorkbenchPaneRefDto(
  pane: ThreadSnapshot["workbench"]["panes"][number],
): WorkbenchPaneRefDto {
  if (pane.kind === "browser") {
    return {
      paneId: pane.paneId,
      kind: "browser",
      title: pane.title,
      visible: pane.visible,
      revision: pane.revision,
      updatedAt: pane.updatedAt,
      url: pane.url,
      pageTitle: pane.pageTitle,
      loading: pane.loading,
    };
  }
  return {
    paneId: pane.paneId,
    kind: pane.kind,
    title: pane.title,
    visible: pane.visible,
    revision: pane.revision,
    updatedAt: pane.updatedAt,
  };
}
