import { isProviderCliAgentId } from "../../../../../shared/agent-descriptors.ts";
import {
  createCommandCompletedEvent,
  createContractErrorEvent,
  createContractErrorPayload,
  type BackendCommandEnvelope,
  type BackendEventEnvelope,
  type ContractErrorCode,
  type JsonObject,
  type ProviderCatalogSnapshotDto,
  type ProviderCliAgentId,
  type ProviderInventoryDto,
} from "../../../../../shared/contracts/index.ts";
import { providerCatalogChangedEvent, providerInventoryChangedEvent } from "../dto/provider-dtos.ts";

export interface ProviderCatalogPorts {
  detectAvailableAgents?: () => ProviderCliAgentId[];
  getProviderCatalog?: (input: {
    agentId: ProviderCliAgentId;
    scope?: { cwd?: string };
  }) => Promise<ProviderCatalogSnapshotDto>;
  getProviderInventory?: () => ProviderInventoryDto | Promise<ProviderInventoryDto>;
}

export interface ProviderCommandContext extends ProviderCatalogPorts {
  nextEventId: () => string;
  emittedAt: () => string;
}

export async function resolveProviderCatalog(
  input: { agentId: ProviderCliAgentId; scope?: { cwd?: string } },
  ports: ProviderCatalogPorts,
): Promise<ProviderCatalogSnapshotDto> {
  if (ports.getProviderCatalog !== undefined) {
    return ports.getProviderCatalog(input);
  }
  return {
    agentId: input.agentId,
    status: "unavailable",
    scope: input.scope,
    models: [],
    defaultModel: `${input.agentId} default`,
    error: {
      code: "provider_failed",
      message: "Provider catalog is not configured.",
      retryable: true,
    },
  };
}

export async function resolveProviderInventory(
  ports: ProviderCatalogPorts,
): Promise<ProviderInventoryDto> {
  if (ports.getProviderInventory !== undefined) {
    return ports.getProviderInventory();
  }
  return {
    agents: (ports.detectAvailableAgents?.() ?? []).map((agentId) => ({
      agentId,
      installed: true,
    })),
  };
}

export async function handleProviderInventoryGetCommand(
  command: BackendCommandEnvelope<"provider.inventory.get">,
  context: ProviderCommandContext,
): Promise<BackendEventEnvelope[]> {
  return [
    providerInventoryChangedEvent({
      eventId: context.nextEventId(),
      requestId: command.requestId,
      emittedAt: context.emittedAt(),
      inventory: await resolveProviderInventory(context),
    }),
    commandCompletedEvent(command, context),
  ];
}

export async function handleProviderCatalogGetCommand(
  command: BackendCommandEnvelope<"provider.catalog.get">,
  context: ProviderCommandContext,
): Promise<BackendEventEnvelope[]> {
  if (!isProviderCliAgentId(command.payload.agentId)) {
    return [
      contractErrorEvent(context, {
        requestId: command.requestId,
        code: "invalid_command",
        message: "provider.catalog.get requires a Provider CLI agentId.",
        retryable: false,
      }),
    ];
  }
  return [
    providerCatalogChangedEvent({
      eventId: context.nextEventId(),
      requestId: command.requestId,
      emittedAt: context.emittedAt(),
      catalog: await resolveProviderCatalog({
        agentId: command.payload.agentId,
        scope: command.payload.scope,
      }, context),
    }),
    commandCompletedEvent(command, context),
  ];
}

function commandCompletedEvent(
  command: BackendCommandEnvelope,
  context: ProviderCommandContext,
  result?: JsonObject,
): BackendEventEnvelope<"command.completed"> {
  return createCommandCompletedEvent(command, {
    eventId: context.nextEventId(),
    emittedAt: context.emittedAt(),
    result,
  });
}

function contractErrorEvent(
  context: ProviderCommandContext,
  input: {
    requestId?: string;
    code: ContractErrorCode;
    message: string;
    retryable: boolean;
  },
): BackendEventEnvelope<"contract.error"> {
  return createContractErrorEvent({
    eventId: context.nextEventId(),
    requestId: input.requestId,
    emittedAt: context.emittedAt(),
    error: createContractErrorPayload({
      code: input.code,
      message: input.message,
      severity: "error",
      retryable: input.retryable,
    }),
  });
}
