import { executableForAgent } from "../../../adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";
import { PROVIDER_CLI_AGENT_IDS } from "../../../../shared/contracts/index.ts";
import type {
  OpencodeEnvironmentDto,
  OpencodeVendorDto,
  ProviderCliAgentId,
  ProviderModelDto,
} from "../../../../shared/contracts/index.ts";
import { createOpencodeModelCatalog } from "./opencode-model-catalog.ts";
import { createOpencodeVendorCatalog, reconcileVendorUsability } from "./opencode-vendor-catalog.ts";
import { createOpencodeAuthServer } from "./opencode-auth-server.ts";

// The local-system provider detection surfaced on thread.listed: which provider-CLI
// agents are installed (executable resolves + an integration exists) and opencode's
// authed model catalog. Extracted from live-backend so that god-file stays at the cap.

export interface ProviderDetection {
  detectAvailableAgents: () => ProviderCliAgentId[];
  enumerateOpencodeModels: () => ProviderModelDto[];
  // opencode vendor tiles (curated + connected-state from `opencode auth list`) and
  // its environment (version + executable path), for the vendor on-ramp.
  enumerateOpencodeVendors: () => OpencodeVendorDto[];
  opencodeEnvironment: () => OpencodeEnvironmentDto;
  // Set an opencode vendor's API key via opencode's own server (the canonical path), then
  // drop the cached vendor/model catalogs so the next thread.listed reflects it.
  connectOpencodeApiKey: (vendorId: string, key: string) => Promise<void>;
}

export function createProviderDetection(input: {
  hasIntegration: (agentId: ProviderCliAgentId) => boolean;
  resolveExecutable: (command: string) => string | undefined;
}): ProviderDetection {
  const opencodeCatalog = createOpencodeModelCatalog((command) => input.resolveExecutable(command));
  const opencodeVendorCatalog = createOpencodeVendorCatalog((command) => input.resolveExecutable(command));
  const opencodeAuthServer = createOpencodeAuthServer({
    resolveExecutable: (command) => input.resolveExecutable(command),
  });
  return {
    detectAvailableAgents: () =>
      PROVIDER_CLI_AGENT_IDS.filter(
        (agentId) =>
          input.hasIntegration(agentId) &&
          input.resolveExecutable(executableForAgent(agentId)) !== undefined,
      ),
    enumerateOpencodeModels: () => opencodeCatalog.get(),
    // Mark connected-but-unusable vendors (e.g. expired auth) by cross-referencing the
    // model catalog, so the on-ramp can offer "Reconnect" (spec: opencode-vendor-reconnect.md).
    enumerateOpencodeVendors: () => reconcileVendorUsability(opencodeVendorCatalog.get(), opencodeCatalog.get()),
    opencodeEnvironment: () => opencodeVendorCatalog.environment(),
    connectOpencodeApiKey: async (vendorId, key) => {
      await opencodeAuthServer.setApiKey(vendorId, key);
      opencodeCatalog.invalidate();
      opencodeVendorCatalog.invalidate();
    },
  };
}
