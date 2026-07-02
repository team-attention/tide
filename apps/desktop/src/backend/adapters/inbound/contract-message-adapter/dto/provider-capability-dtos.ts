import type {
  BackendCommandEnvelope,
  BackendEventEnvelope,
  JsonObject,
  ProviderCliAgentId,
  RequestId,
} from "../../../../../shared/contracts/index.ts";
import { CONTRACT_VERSION, createCommandCompletedEvent, sanitizeJsonValue } from "../../../../../shared/contracts/index.ts";
import type { DiscoveredCommand } from "../../../../application/ports/outbound/agent-runtime-port.ts";
import type { InvokeProviderCapabilityResult } from "../../../../application/services/thread/thread-runtime-api.ts";
import {
  providerCapabilitiesToDtos,
  providerCapabilityCatalogFromRuntimeCommands,
} from "../../../outbound/agent-integrations/provider-capability-catalog.ts";

export function providerCommandDiscoveryEvents(input: {
  nextEventId: () => string;
  requestId?: RequestId;
  emittedAt: string;
  agentId: ProviderCliAgentId;
  cwd: string;
  commands: DiscoveredCommand[];
}): Array<
  BackendEventEnvelope<"agentRuntime.capabilitiesChanged"> |
  BackendEventEnvelope<"agentRuntime.commandsChanged">
> {
  const capabilities = providerCapabilitiesToDtos(
    providerCapabilityCatalogFromRuntimeCommands(input.agentId, input.commands),
  );
  return [
    {
      contractVersion: CONTRACT_VERSION,
      eventId: input.nextEventId(),
      requestId: input.requestId,
      kind: "agentRuntime.capabilitiesChanged",
      emittedAt: input.emittedAt,
      payload: {
        agentId: input.agentId,
        cwd: input.cwd,
        capabilities,
      },
    },
    {
      contractVersion: CONTRACT_VERSION,
      eventId: input.nextEventId(),
      requestId: input.requestId,
      kind: "agentRuntime.commandsChanged",
      emittedAt: input.emittedAt,
      payload: {
        agentId: input.agentId,
        cwd: input.cwd,
        commands: input.commands,
      },
    },
  ];
}

export function providerCapabilityInvocationEvents(input: {
  command: BackendCommandEnvelope;
  result: InvokeProviderCapabilityResult;
  nextEventId: () => string;
  emittedAt: string;
}): Array<BackendEventEnvelope<"agentRuntime.stateChanged"> | BackendEventEnvelope<"command.completed">> {
  const completed: JsonObject = { status: input.result.status };
  const nativeResult = sanitizeJsonValue(input.result.result);
  if (nativeResult !== undefined) {
    completed.result = nativeResult;
  }
  return [
    {
      contractVersion: CONTRACT_VERSION,
      eventId: input.nextEventId(),
      requestId: input.command.requestId,
      kind: "agentRuntime.stateChanged",
      emittedAt: input.emittedAt,
      payload: {
        threadId: input.result.thread.threadId,
        state: input.result.runtimeState,
        changedAt: input.result.thread.updatedAt,
        queuedInputs: input.result.thread.queuedInputs,
      },
    },
    createCommandCompletedEvent(input.command, {
      eventId: input.nextEventId(),
      emittedAt: input.emittedAt,
      result: completed,
    }),
  ];
}
