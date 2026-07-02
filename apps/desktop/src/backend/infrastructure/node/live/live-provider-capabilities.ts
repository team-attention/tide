import type { ProviderCapability } from "../../../application/domains/native-agent/provider-capability.ts";
import type { BackendEventEnvelope, ProviderCliAgentId } from "../../../../shared/contracts/index.ts";
import { CONTRACT_VERSION } from "../../../../shared/contracts/index.ts";
import {
  mergeProviderCapabilityCatalog,
  providerCapabilitiesToDtos,
} from "../../../adapters/outbound/agent-integrations/provider-capability-catalog.ts";

export function createLiveProviderCapabilityEmitter(input: {
  onEvent?: (event: BackendEventEnvelope) => void;
  nextEventId: () => string;
}) {
  const capabilitiesByThread = new Map<string, ProviderCapability[]>();

  return {
    emitCapabilitiesChanged(
      threadId: string,
      agentId: ProviderCliAgentId,
      capabilities: ProviderCapability[],
    ): void {
      const merged = mergeProviderCapabilityCatalog(
        agentId,
        capabilitiesByThread.get(threadId) ?? [],
        capabilities,
      );
      capabilitiesByThread.set(threadId, merged);
      input.onEvent?.({
        contractVersion: CONTRACT_VERSION,
        eventId: input.nextEventId(),
        kind: "agentRuntime.capabilitiesChanged",
        emittedAt: new Date().toISOString(),
        payload: {
          threadId,
          agentId,
          capabilities: providerCapabilitiesToDtos(merged),
        },
      });
    },
  };
}
