import { executableForAgent } from "../../../adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";
import { PROVIDER_CLI_AGENT_IDS } from "../../../../shared/agent-descriptors.ts";
import type {
  OpencodeEnvironmentDto,
  OpencodeVendorDto,
  ProviderCatalogSnapshotDto,
  ProviderCliAgentId,
  ProviderModelDto,
} from "../../../../shared/contracts/index.ts";
import {
  staticProviderCatalogSource,
  staticProviderModelsForAgent,
} from "../../../../shared/provider-model-catalogs.ts";
import { createOpencodeModelCatalog } from "./opencode-model-catalog.ts";
import { createOpencodeVendorCatalog, reconcileVendorUsability } from "./opencode-vendor-catalog.ts";
import { createOpencodeAuthServer } from "./opencode-auth-server.ts";

// The local-system provider detection surfaced on thread.listed: which provider-CLI
// agents are installed (executable resolves + an integration exists) and opencode's
// authed model catalog. Extracted from live-backend so that god-file stays at the cap.

export interface ProviderDetection {
  detectAvailableAgents: () => ProviderCliAgentId[];
  providerCatalog: () => Promise<ProviderCatalogSnapshotDto>;
  // opencode catalog reads spawn the opencode CLI, which can be slow to start — they
  // run asynchronously (off the backend event loop) so they never freeze command
  // delivery, and are surfaced out of band on providerCatalog.changed.
  enumerateOpencodeModels: () => Promise<ProviderModelDto[]>;
  // opencode vendor tiles (curated + connected-state from `opencode auth list`) and
  // its environment (version + executable path), for the vendor on-ramp.
  enumerateOpencodeVendors: () => Promise<OpencodeVendorDto[]>;
  opencodeEnvironment: () => Promise<OpencodeEnvironmentDto>;
  // Set an opencode vendor's API key via opencode's own server (the canonical path), then
  // drop the cached vendor/model catalogs so the next thread.listed reflects it.
  connectOpencodeApiKey: (vendorId: string, key: string) => Promise<void>;
}

export function createProviderDetection(input: {
  hasIntegration: (agentId: ProviderCliAgentId) => boolean;
  resolveExecutable: (command: string) => string | undefined;
  readAuthenticated?: (agentId: ProviderCliAgentId) => boolean | undefined;
}): ProviderDetection {
  const opencodeCatalog = createOpencodeModelCatalog((command) => input.resolveExecutable(command));
  const opencodeVendorCatalog = createOpencodeVendorCatalog((command) => input.resolveExecutable(command));
  const opencodeAuthServer = createOpencodeAuthServer({
    resolveExecutable: (command) => input.resolveExecutable(command),
  });
  const detectAvailableAgents = () =>
    PROVIDER_CLI_AGENT_IDS.filter(
      (agentId) =>
        input.hasIntegration(agentId) &&
        input.resolveExecutable(executableForAgent(agentId)) !== undefined,
    );
  return {
    detectAvailableAgents,
    providerCatalog: async () => {
      const [opencodeModels, opencodeVendors, opencodeEnvironment] = await Promise.all([
        opencodeCatalog.get(),
        opencodeVendorCatalog.get(),
        opencodeVendorCatalog.environment(),
      ]);
      const reconciledOpencodeVendors = reconcileVendorUsability(opencodeVendors, opencodeModels);
      const connectedVendors = reconciledOpencodeVendors.filter((vendor) => vendor.connected).length;
      const totalVendors = reconciledOpencodeVendors.length;
      const installedAgents = new Set(detectAvailableAgents());
      return {
        providers: PROVIDER_CLI_AGENT_IDS.map((agentId) => {
          const authenticated = input.readAuthenticated?.(agentId);
          return {
            agentId,
            installed: installedAgents.has(agentId),
            ...(authenticated !== undefined ? { authenticated } : {}),
            source: staticProviderCatalogSource(agentId),
            models: agentId === "opencode" ? opencodeModels : staticProviderModelsForAgent(agentId),
            ...(agentId === "opencode"
              ? {
                  connectedVendors,
                  totalVendors,
                  ...(opencodeEnvironment.version !== undefined
                    ? { version: opencodeEnvironment.version }
                    : {}),
                }
              : {}),
          };
        }),
        opencodeModels,
        opencodeVendors: reconciledOpencodeVendors,
        opencodeEnvironment,
      };
    },
    enumerateOpencodeModels: () => opencodeCatalog.get(),
    // Mark connected-but-unusable vendors (e.g. expired auth) by cross-referencing the
    // model catalog, so the on-ramp can offer "Reconnect" (spec: opencode-vendor-reconnect.md).
    enumerateOpencodeVendors: async () =>
      reconcileVendorUsability(await opencodeVendorCatalog.get(), await opencodeCatalog.get()),
    opencodeEnvironment: () => opencodeVendorCatalog.environment(),
    connectOpencodeApiKey: async (vendorId, key) => {
      await opencodeAuthServer.setApiKey(vendorId, key);
      opencodeCatalog.invalidate();
      opencodeVendorCatalog.invalidate();
    },
  };
}
