import type { ProviderCapability } from "../../../application/domains/native-agent/provider-capability.ts";
import type { ProviderCliAgentId } from "../../../../shared/contracts/index.ts";
import { providerCapabilityCatalogFromLocalInventory } from "../../../adapters/outbound/agent-integrations/provider-capability-catalog.ts";
import { readLocalProviderInventoryFromHome } from "../provider/provider-local-inventory.ts";

export function localProviderCapabilities(
  agentId: ProviderCliAgentId,
  homeDir: string,
): ProviderCapability[] {
  return providerCapabilityCatalogFromLocalInventory(
    agentId,
    readLocalProviderInventoryFromHome({ homeDir }),
  );
}
