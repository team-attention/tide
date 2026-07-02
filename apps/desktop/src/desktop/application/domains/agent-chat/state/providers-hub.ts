import {
  cliModelOptionsForAgent,
  defaultModelValueForAgent,
  formatAgentLabel,
  isAgentAvailable,
  permissionConfigForAgent,
} from "./agent-vocab.ts";
import { getOpencodeEnvironment, getOpencodeVendors } from "./opencode-onramp.ts";
import { PROVIDER_CLI_AGENT_IDS } from "../../../../../shared/agent-descriptors.ts";

// The data layer for the Settings "Providers & Models" hub: one row per provider-CLI
// agent with its install status, model catalog (the same catalog the composer menu
// renders — dynamic for opencode, curated for claude/codex), permission modes,
// and Tide-resolved default model. Pure + view-only so it is fully unit-testable; the
// Settings section renders it. See cross-provider-model-catalog-and-hub.md (P4).

export interface ProvidersHubModelView {
  value: string;
  label: string;
  vendor?: string;
  detail?: string;
}

export interface ProvidersHubAgentView {
  agentId: string;
  label: string;
  // Installed locally (its CLI resolves). Drives the "Installed / Not installed"
  // status chip; not-installed agents still list their (static) models.
  installed: boolean;
  status: "installed" | "not_installed";
  models: ProvidersHubModelView[];
  permissionModes: Array<{ value: string; label: string }>;
  defaultModel: string;
  // Multi-vendor (opencode) → the hub shows a vendor filter + an "Add provider" action.
  multiVendor: boolean;
  // opencode only: vendor sign-in summary (from `opencode auth list`) and version, for
  // the on-ramp status. Absent for single-vendor agents.
  connectedVendors?: number;
  totalVendors?: number;
  version?: string;
}

const HUB_AGENTS = PROVIDER_CLI_AGENT_IDS;

export function buildProvidersHubViewModel(): ProvidersHubAgentView[] {
  return HUB_AGENTS.map((agentId) => {
    const models = cliModelOptionsForAgent(agentId).map((option) => ({
      value: option.value,
      label: option.label,
      vendor: option.vendor,
      detail: option.detail,
    }));
    const installed = isAgentAvailable(agentId);
    const vendors = agentId === "opencode" ? getOpencodeVendors() : [];
    return {
      agentId,
      label: formatAgentLabel(agentId),
      installed,
      status: installed ? "installed" : "not_installed",
      models,
      permissionModes: permissionConfigForAgent(agentId).options.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      defaultModel: defaultModelValueForAgent(agentId),
      multiVendor: models.some((model) => model.vendor !== undefined),
      ...(agentId === "opencode"
        ? {
            connectedVendors: vendors.filter((vendor) => vendor.connected).length,
            totalVendors: vendors.length,
            version: getOpencodeEnvironment()?.version,
          }
        : {}),
    };
  });
}
