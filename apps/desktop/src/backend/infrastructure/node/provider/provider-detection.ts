import { executableForAgent } from "../../../adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";
import { PROVIDER_CLI_AGENT_IDS } from "../../../../shared/agent-descriptors.ts";
import type {
  OpencodeEnvironmentDto,
  OpencodeProviderOptionDto,
  OpencodeVendorDto,
  ProviderCatalogSnapshotDto,
  ProviderCliAgentId,
  ProviderInventoryDto,
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
  getProviderInventory: () => ProviderInventoryDto;
  getProviderCatalog: (input: {
    agentId: ProviderCliAgentId;
    scope?: { cwd?: string };
  }) => Promise<ProviderCatalogSnapshotDto>;
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

const STATIC_PROVIDER_MODELS: Record<"codex" | "claude", ProviderModelDto[]> = {
  codex: [
    { value: "gpt-5.5", label: "GPT-5.5" },
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
    { value: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark" },
  ],
  claude: [
    { value: "Claude default", label: "Default", detail: "Recommended" },
    { value: "claude-fable-5", label: "Fable 5" },
    { value: "claude-opus-4-8", label: "Opus 4.8" },
    { value: "claude-sonnet-5", label: "Sonnet 5" },
    { value: "claude-opus-4-8[1m]", label: "Opus 4.8 (1M context)" },
    { value: "claude-haiku-4-5", label: "Haiku 4.5" },
    { value: "claude-sonnet-4-6", label: "Sonnet 4.6", detail: "Legacy" },
    { value: "claude-opus-4-7", label: "Opus 4.7", detail: "Legacy" },
    { value: "claude-opus-4-7[1m]", label: "Opus 4.7 (1M context)", detail: "Legacy" },
    { value: "claude-opus-4-6", label: "Opus 4.6", detail: "Legacy" },
  ],
};

const DEFAULT_PROVIDER_MODEL: Record<ProviderCliAgentId, string> = {
  codex: "gpt-5.5",
  claude: "Claude default",
  opencode: "opencode default",
};

export function createProviderDetection(input: {
  hasIntegration: (agentId: ProviderCliAgentId) => boolean;
  resolveExecutable: (command: string) => string | undefined;
}): ProviderDetection {
  const opencodeCatalog = createOpencodeModelCatalog((command) => input.resolveExecutable(command));
  const opencodeVendorCatalog = createOpencodeVendorCatalog((command) => input.resolveExecutable(command));
  const opencodeAuthServer = createOpencodeAuthServer({
    resolveExecutable: (command) => input.resolveExecutable(command),
  });
  const installedAgents = (): ProviderCliAgentId[] =>
    PROVIDER_CLI_AGENT_IDS.filter(
      (agentId) =>
        input.hasIntegration(agentId) &&
        input.resolveExecutable(executableForAgent(agentId)) !== undefined,
    );
  const opencodeCatalogSnapshot = async (scope?: { cwd?: string }): Promise<ProviderCatalogSnapshotDto> => {
    const executablePath = input.resolveExecutable("opencode");
    if (executablePath === undefined) {
      return {
        agentId: "opencode",
        status: "unavailable",
        scope,
        models: [],
        defaultModel: DEFAULT_PROVIDER_MODEL.opencode,
        error: {
          code: "not_installed",
          message: "opencode executable was not found.",
          retryable: true,
        },
      };
    }
    try {
      const [models, vendors, environment, providerOptions] = await Promise.all([
        opencodeCatalog.get(),
        opencodeVendorCatalog.get(),
        opencodeVendorCatalog.environment(),
        bestEffortOpencodeProviderOptions(() => opencodeAuthServer.listProviderOptions()),
      ]);
      return {
        agentId: "opencode",
        status: "ready",
        scope,
        models,
        vendors: reconcileVendorUsability(vendors, models),
        providerOptions,
        environment,
        defaultModel: DEFAULT_PROVIDER_MODEL.opencode,
      };
    } catch (error) {
      return {
        agentId: "opencode",
        status: "error",
        scope,
        models: [],
        environment: await bestEffortOpencodeEnvironment(opencodeVendorCatalog.environment),
        defaultModel: DEFAULT_PROVIDER_MODEL.opencode,
        error: {
          code: providerCatalogErrorCode(error),
          message: error instanceof Error ? error.message : "opencode catalog read failed.",
          retryable: true,
        },
      };
    }
  };
  return {
    detectAvailableAgents: installedAgents,
    getProviderInventory: () => ({
      agents: PROVIDER_CLI_AGENT_IDS.map((agentId) => ({
        agentId,
        installed:
          input.hasIntegration(agentId) &&
          input.resolveExecutable(executableForAgent(agentId)) !== undefined,
      })),
    }),
    getProviderCatalog: async ({ agentId, scope }) => {
      if (agentId === "opencode") {
        return opencodeCatalogSnapshot(scope);
      }
      return {
        agentId,
        status: "ready",
        scope,
        models: STATIC_PROVIDER_MODELS[agentId],
        defaultModel: DEFAULT_PROVIDER_MODEL[agentId],
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

async function bestEffortOpencodeEnvironment(
  readEnvironment: () => Promise<OpencodeEnvironmentDto>,
): Promise<OpencodeEnvironmentDto | undefined> {
  try {
    return await readEnvironment();
  } catch {
    return undefined;
  }
}

async function bestEffortOpencodeProviderOptions(
  readProviderOptions: () => Promise<OpencodeProviderOptionDto[]>,
): Promise<OpencodeProviderOptionDto[]> {
  try {
    return await readProviderOptions();
  } catch {
    return [];
  }
}

function providerCatalogErrorCode(error: unknown): "provider_failed" | "timed_out" {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("timed out") || message.includes("timeout")
    ? "timed_out"
    : "provider_failed";
}
