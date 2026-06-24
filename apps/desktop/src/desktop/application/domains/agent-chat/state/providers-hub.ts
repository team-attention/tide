import {
  cliModelOptionsForAgent,
  defaultModelValueForAgent,
  formatAgentLabel,
  isAgentAvailable,
  permissionConfigForAgent,
  providerCatalogAgent,
} from "./agent-vocab.ts";
import { getOpencodeEnvironment, getOpencodeVendors } from "./opencode-onramp.ts";

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
  authenticated?: boolean;
  status: "installed" | "not_installed" | "signed_in" | "not_signed_in";
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
  source?: "dynamic" | "static";
}

const HUB_AGENTS = ["claude", "codex", "opencode"] as const;

export function buildProvidersHubViewModel(): ProvidersHubAgentView[] {
  return HUB_AGENTS.map((agentId) => {
    const snapshot = providerCatalogAgent(agentId);
    const modelOptions =
      snapshot !== undefined && snapshot.models.length > 0
        ? snapshot.models
        : cliModelOptionsForAgent(agentId);
    const models = modelOptions.map((option) => ({
      value: option.value,
      label: option.label,
      vendor: option.vendor,
      detail: option.detail,
    }));
    const installed = snapshot?.installed ?? isAgentAvailable(agentId);
    const authenticated = snapshot?.authenticated;
    const vendors = agentId === "opencode" ? getOpencodeVendors() : [];
    const status =
      !installed
        ? "not_installed"
        : authenticated === true
          ? "signed_in"
          : authenticated === false
            ? "not_signed_in"
            : "installed";
    return {
      agentId,
      label: formatAgentLabel(agentId),
      installed,
      ...(authenticated !== undefined ? { authenticated } : {}),
      status,
      models,
      permissionModes: permissionConfigForAgent(agentId).options.map((option) => ({
        value: option.value,
        label: option.label,
      })),
      defaultModel: defaultModelValueForAgent(agentId),
      multiVendor: models.some((model) => model.vendor !== undefined),
      ...(agentId === "opencode"
        ? {
            connectedVendors:
              snapshot?.connectedVendors ?? vendors.filter((vendor) => vendor.connected).length,
            totalVendors: snapshot?.totalVendors ?? vendors.length,
            version: snapshot?.version ?? getOpencodeEnvironment()?.version,
          }
        : {}),
      ...(snapshot?.source !== undefined ? { source: snapshot.source } : {}),
    };
  });
}
