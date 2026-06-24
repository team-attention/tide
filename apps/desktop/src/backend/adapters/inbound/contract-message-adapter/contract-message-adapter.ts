import { defaultClock, defaultIdGenerator, requestIdFromUnknown } from "./support/envelope-support.ts";
import { omitUndefinedProperties, toWorkbenchFileTreeDto, toWorkbenchPaneRefDto } from "./dto/workbench-dtos.ts";
import { contractCodeFromServiceError, isRetryableServiceError } from "./support/error-codes.ts";
import { toAgentSessionBlockDto, toPromptStateDto, toProviderReadinessDto, toThreadSummaryDto } from "./dto/thread-dtos.ts";
import {
  workspaceContentSearchResultsEvent,
  workspaceFileLoadedEvent,
  workspaceFileSavedEvent,
  workspaceFileTreeLoadedEvent,
  workspaceImageLoadedEvent,
} from "./dto/workspace-query-dtos.ts";
import type {
  AnswerPromptResult,
  ArchiveThreadResult,
  EditPendingInputResult,
  HydrateThreadResult,
  ListThreadsResult,
  ResumeAgentRuntimeResult,
  SendComposerInputResult,
  SetThreadPinnedResult,
  ServiceError,
  ServiceResult,
  StartThreadResult,
  StopAgentRuntimeResult,
  ThreadRuntimeService,
  UpdateThreadLaunchOptionsResult,
  ThreadSnapshot,
  ProviderReadinessResult,
  TrustWorkspaceResult,
} from "../../../application/services/thread/thread-runtime-service.ts";

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
  type OpencodeEnvironmentDto,
  type OpencodeVendorDto,
  type ProviderCatalogSnapshotDto,
  type ProviderCliAgentId,
  type ProviderReadinessDto,
  type ProviderModelDto,
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
  providerCatalog?: () => Promise<ProviderCatalogSnapshotDto>;
  enumerateOpencodeModels?: () => Promise<ProviderModelDto[]>;
  // opencode vendor tiles + connected-state (`opencode auth list`) and environment
  // (version + executable path), surfaced on thread.listed for the vendor on-ramp.
  enumerateOpencodeVendors?: () => Promise<OpencodeVendorDto[]>;
  opencodeEnvironment?: () => Promise<OpencodeEnvironmentDto>;
  connectOpencodeApiKey?: (vendorId: string, key: string) => Promise<void>;
  // Probe an agent's REAL command set for the composer menu (live-provider-command-mirroring.md).
  discoverProviderCommands?: (
    agentId: string,
    cwd: string,
  ) => Promise<Array<{ name: string; description: string; trigger: "/" | "$" }>>;
}

export interface BackendContractMessageAdapter {
  handleMessage(message: unknown): Promise<BackendEventEnvelope[]>;
  // Build a pushed thread.listed (no requestId) reflecting the current store. Used to
  // surface adopted (external) sessions that are discovered off the boot critical path,
  // after the first list has already rendered the rail. See live-backend restore.
  pushThreadListedEvents(): Promise<BackendEventEnvelope[]>;
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
  private readonly providerCatalog?: () => Promise<ProviderCatalogSnapshotDto>;
  private readonly enumerateOpencodeModels?: () => Promise<ProviderModelDto[]>;
  private readonly enumerateOpencodeVendors?: () => Promise<OpencodeVendorDto[]>;
  private readonly opencodeEnvironment?: () => Promise<OpencodeEnvironmentDto>;
  private readonly connectOpencodeApiKey?: (vendorId: string, key: string) => Promise<void>;
  private readonly discoverProviderCommands?: (
    agentId: string,
    cwd: string,
  ) => Promise<Array<{ name: string; description: string; trigger: "/" | "$" }>>;

  constructor(input: CreateBackendContractMessageAdapterInput) {
    this.service = input.service;
    this.clock = input.clock ?? defaultClock;
    this.idGenerator = input.idGenerator ?? defaultIdGenerator;
    this.detectAvailableAgents = input.detectAvailableAgents;
    this.providerCatalog = input.providerCatalog;
    this.enumerateOpencodeModels = input.enumerateOpencodeModels;
    this.enumerateOpencodeVendors = input.enumerateOpencodeVendors;
    this.opencodeEnvironment = input.opencodeEnvironment;
    this.connectOpencodeApiKey = input.connectOpencodeApiKey;
    this.discoverProviderCommands = input.discoverProviderCommands;
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
          // Explicit user open: reconcile a thread left waiting on a dead runtime
          // (app restart / runtime death) back to idle so it isn't frozen and a
          // stale permission card isn't resurrected.
          await this.service.hydrateThread({
            ...typedCommand.payload,
            reconcileStaleRuntime: true,
          }),
          (result) => [
            this.threadHydratedEvent(typedCommand, result),
            this.commandCompletedEvent(typedCommand),
          ],
        );
      }
      case "thread.createDraft": {
        const typedCommand = command as BackendCommandEnvelope<"thread.createDraft">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.createDraftThread(typedCommand.payload),
          // Emit the draft's (empty) Workbench so the Composer renders it; subsequent
          // workbench.command on the draft streams updated workbench.changed events.
          (result) => [
            this.workbenchChangedEvent(typedCommand, result.thread),
            this.commandCompletedEvent(typedCommand),
          ],
        );
      }
      case "thread.discardDraft": {
        const typedCommand = command as BackendCommandEnvelope<"thread.discardDraft">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.discardDraftThread(typedCommand.payload),
          () => [this.commandCompletedEvent(typedCommand)],
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
            this.threadSummaryChangedEvent(typedCommand, result, "thread.renamed"),
            this.commandCompletedEvent(typedCommand),
          ],
        );
      }
      case "thread.setGoal": {
        const typedCommand = command as BackendCommandEnvelope<"thread.setGoal">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.setThreadGoal(typedCommand.payload),
          (result) => [
            this.threadSummaryChangedEvent(typedCommand, result, "thread.goalSet"),
            this.commandCompletedEvent(typedCommand),
          ],
        );
      }
      case "thread.setLaunchOptions": {
        const typedCommand = command as BackendCommandEnvelope<"thread.setLaunchOptions">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.updateThreadLaunchOptions(typedCommand.payload),
          (result) => [
            this.threadLaunchOptionsChangedEvent(typedCommand, result),
            this.commandCompletedEvent(typedCommand, { applied: result.applied }),
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
      case "provider.checkReadiness": {
        const typedCommand = command as BackendCommandEnvelope<"provider.checkReadiness">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.checkReadiness({
            threadId: typedCommand.payload.threadId,
            agentId: typedCommand.payload.agentId as ProviderCliAgentId,
          }),
          (result) => [
            this.providerReadinessChangedEvent(
              typedCommand,
              result.thread.threadId,
              result.providerReadiness,
            ),
            this.commandCompletedEvent(typedCommand),
          ],
        );
      }
      case "provider.opencodeConnectApiKey": {
        const typed = command as BackendCommandEnvelope<"provider.opencodeConnectApiKey">;
        try {
          // No-op when no auth server is wired (tests); production always provides it.
          await this.connectOpencodeApiKey?.(typed.payload.vendorId, typed.payload.key);
        } catch (error) {
          const message = error instanceof Error ? error.message : "opencode could not save the API key.";
          return [this.contractErrorEvent({ requestId: typed.requestId, code: "provider_runtime_failed", message, retryable: true })];
        }
        // Re-list (threads/availableAgents) AND push the refreshed opencode catalog so the
        // now-connected vendor + its models surface (catalogs were invalidated by the connect).
        const catalogEvent = await this.providerCatalogChangedEvent(typed);
        return this.handleServiceResult(typed, await this.service.listThreads({}), (result) =>
          [this.threadListedEvent(typed, result), catalogEvent, this.commandCompletedEvent(typed)]);
      }
      case "provider.discoverCommands": {
        // The runtime probe resolves [] on any error/timeout (never rejects).
        const typed = command as BackendCommandEnvelope<"provider.discoverCommands">;
        const commands = (await this.discoverProviderCommands?.(typed.payload.agentId, typed.payload.cwd)) ?? [];
        return [
          {
            contractVersion: CONTRACT_VERSION,
            eventId: this.nextEventId(),
            requestId: typed.requestId,
            kind: "agentRuntime.commandsChanged",
            emittedAt: this.clock(),
            payload: { agentId: typed.payload.agentId as ProviderCliAgentId, cwd: typed.payload.cwd, commands },
          } satisfies BackendEventEnvelope<"agentRuntime.commandsChanged">,
          this.commandCompletedEvent(typed, { handled: commands.length > 0 }),
        ];
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
          await this.service.workspaceQueries().readWorkspaceFileTree(typedCommand.payload),
          (result) => [
            workspaceFileTreeLoadedEvent(this.commandEventMeta(typedCommand), result),
            this.commandCompletedEvent(typedCommand, { handled: true }),
          ],
        );
      }
      case "workspace.searchContent": {
        const typedCommand = command as BackendCommandEnvelope<"workspace.searchContent">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.workspaceQueries().searchWorkspaceContent(typedCommand.payload),
          (result) => [
            workspaceContentSearchResultsEvent(this.commandEventMeta(typedCommand), result),
            this.commandCompletedEvent(typedCommand, { handled: true }),
          ],
        );
      }
      case "workspace.readFile": {
        const typedCommand = command as BackendCommandEnvelope<"workspace.readFile">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.workspaceQueries().readWorkspaceFile(typedCommand.payload),
          (result) => [
            workspaceFileLoadedEvent(this.commandEventMeta(typedCommand), result),
            this.commandCompletedEvent(typedCommand, { handled: true }),
          ],
        );
      }
      case "workspace.readImageFile": {
        const typedCommand = command as BackendCommandEnvelope<"workspace.readImageFile">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.workspaceQueries().readWorkspaceImageFile(typedCommand.payload),
          (result) => [
            workspaceImageLoadedEvent(this.commandEventMeta(typedCommand), result),
            this.commandCompletedEvent(typedCommand, { handled: true }),
          ],
        );
      }
      case "workspace.writeFile": {
        const typedCommand = command as BackendCommandEnvelope<"workspace.writeFile">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.workspaceQueries().writeWorkspaceFile(typedCommand.payload),
          (result) => [
            workspaceFileSavedEvent(this.commandEventMeta(typedCommand), result),
            this.commandCompletedEvent(typedCommand, { handled: true }),
          ],
        );
      }
      case "workspace.codeIntel": {
        const typedCommand = command as BackendCommandEnvelope<"workspace.codeIntel">;
        return this.handleServiceResult(
          typedCommand,
          await this.service.workspaceQueries().queryWorkspaceCodeIntel(typedCommand.payload),
          (result) => [
            {
              contractVersion: CONTRACT_VERSION,
              eventId: this.nextEventId(),
              requestId: typedCommand.requestId,
              kind: "workspace.codeIntelResult",
              emittedAt: this.clock(),
              // Deep-sanitized: engine items carry nested optional fields
              // (insertText/detail = undefined) that a top-level omit misses,
              // and an envelope with ANY undefined fails the bridge's JSON
              // validation — the event would silently vanish (the same trap as
              // the renderer-side sanitizeJsonValue boundary fix).
              payload: sanitizeJsonValue({
                kind: result.kind,
                ok: result.available,
                message: result.message,
                completions: result.completions,
                hover: result.hover,
                highlights: result.highlights,
                signature: result.signature,
                diagnostics: result.diagnostics,
                definition: result.definition,
                references: result.references,
              }) as unknown as BackendEventEnvelope<"workspace.codeIntelResult">["payload"],
            } satisfies BackendEventEnvelope<"workspace.codeIntelResult">,
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

  async pushThreadListedEvents(): Promise<BackendEventEnvelope[]> {
    const result = await this.service.listThreads({});
    if (!result.ok) {
      return [];
    }
    // No requestId: this is a push (not a reply to a renderer command), so it flows
    // through the backend-event broadcast channel and refreshes the rail in place.
    return [
      {
        contractVersion: CONTRACT_VERSION,
        eventId: this.nextEventId(),
        kind: "thread.listed",
        emittedAt: this.clock(),
        payload: {
          threads: result.threads.map(toThreadSummaryDto),
          availableAgents: this.detectAvailableAgents?.(),
        },
      } satisfies BackendEventEnvelope<"thread.listed">,
    ];
  }

  // opencode's catalog (vendors/models/version), delivered separately from thread.listed so the
  // agent menu (availableAgents) is never blocked behind opencode's subprocesses. Pushed at
  // startup (live-backend) and after a vendor connect. Spec: provider-cli-setup-handoff.md.
  private async providerCatalogChangedEvent(
    command: BackendCommandEnvelope,
  ): Promise<BackendEventEnvelope<"providerCatalog.changed">> {
    const payload = (await this.providerCatalog?.()) ?? {
      opencodeModels: await this.enumerateOpencodeModels?.(),
      opencodeVendors: await this.enumerateOpencodeVendors?.(),
      opencodeEnvironment: await this.opencodeEnvironment?.(),
    };
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "providerCatalog.changed",
      emittedAt: this.clock(),
      payload,
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

  private threadLaunchOptionsChangedEvent(
    command: BackendCommandEnvelope,
    result: UpdateThreadLaunchOptionsResult,
  ): BackendEventEnvelope<"thread.launchOptionsChanged"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind: "thread.launchOptionsChanged",
      emittedAt: this.clock(),
      payload: {
        thread: toThreadSummaryDto(result.thread),
        applied: result.applied,
        changedKeys: result.changedKeys,
      },
    };
  }

  private threadSummaryChangedEvent(
    command: BackendCommandEnvelope,
    result: { thread: ThreadSnapshot },
    kind: "thread.renamed" | "thread.goalSet",
  ): BackendEventEnvelope<"thread.renamed" | "thread.goalSet"> {
    return {
      contractVersion: CONTRACT_VERSION,
      eventId: this.nextEventId(),
      requestId: command.requestId,
      kind,
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
          workbenchLayoutMode: result.thread.workbench.layoutMode,
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
      // If the started thread already has Workbench panes — a Draft Thread started
      // in place carries its Terminal/Editor/Diff, or a fresh start adopted Browser drafts
      // — push the Workbench now so it renders immediately instead of waiting for the
      // pane's next event. Omitted for an empty Workbench (no behavior change there).
      // See docs_v2/specs/composer-draft-thread.md.
      ...(result.thread.workbench.panes.length > 0
        ? [this.workbenchChangedEvent(command, result.thread)]
        : []),
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
        layoutMode: thread.workbench.layoutMode,
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
      // Stop clears the card+queue in the service; without this event the
      // renderer keeps a zombie card pinned (adversarial review finding).
      {
        contractVersion: CONTRACT_VERSION,
        eventId: this.nextEventId(),
        requestId: command.requestId,
        kind: "prompt.changed",
        emittedAt: this.clock(),
        payload: { threadId: result.thread.threadId, prompt: null },
      },
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
        // Carry the authoritative queue so the renderer reconciles: an idle send
        // runs (queue stays empty) and its optimistic chip clears; a busy send
        // queues and the chip stays. Without this the chip never reconciled.
        queuedInputs: thread.queuedInputs,
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

  private commandEventMeta(command: BackendCommandEnvelope): {
    eventId: string;
    requestId: string;
    emittedAt: string;
  } {
    return {
      eventId: this.nextEventId(),
      requestId: command.requestId,
      emittedAt: this.clock(),
    };
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
