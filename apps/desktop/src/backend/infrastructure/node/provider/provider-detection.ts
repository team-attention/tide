import { executableForAgent } from "../../../adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";
import { PROVIDER_CLI_AGENT_IDS } from "../../../../shared/contracts/index.ts";
import type { ProviderCliAgentId, ProviderModelDto } from "../../../../shared/contracts/index.ts";
import { createOpencodeModelCatalog } from "./opencode-model-catalog.ts";

// The local-system provider detection surfaced on thread.listed: which provider-CLI
// agents are installed (executable resolves + an integration exists) and opencode's
// authed model catalog. Extracted from live-backend so that god-file stays at the cap.

export interface ProviderDetection {
  detectAvailableAgents: () => ProviderCliAgentId[];
  enumerateOpencodeModels: () => ProviderModelDto[];
}

export function createProviderDetection(input: {
  hasIntegration: (agentId: ProviderCliAgentId) => boolean;
  resolveExecutable: (command: string) => string | undefined;
}): ProviderDetection {
  const opencodeCatalog = createOpencodeModelCatalog((command) => input.resolveExecutable(command));
  return {
    detectAvailableAgents: () =>
      PROVIDER_CLI_AGENT_IDS.filter(
        (agentId) =>
          input.hasIntegration(agentId) &&
          input.resolveExecutable(executableForAgent(agentId)) !== undefined,
      ),
    enumerateOpencodeModels: () => opencodeCatalog.get(),
  };
}
