import type { AgentChatAgentBinding, AgentChatAgentId, AgentChatAgentRuntimeSource } from "./types.ts";
import {
  AGENT_DESCRIPTORS,
  agentDescriptor,
  type AgentPermissionConfig,
} from "../../../../../shared/agent-descriptors.ts";
import {
  CLAUDE_PROVIDER_MODELS,
  CODEX_PROVIDER_MODELS,
} from "../../../../../shared/provider-model-catalogs.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

// Codex models are curated in shared code because the CLI accepts free-form model
// ids but does not expose a reliable enumeration command.
export const CODEX_MODELS: CliModelOption[] = CODEX_PROVIDER_MODELS;

export function codexModelLabel(model: string): string {
  return CODEX_MODELS.find((m) => m.value === model)?.label ?? model;
}

export function formatAgentLabel(agentId: string): string {
  return agentDescriptor(agentId)?.displayName ?? agentId;
}

// Permission/approval modes are shared descriptor data. The desktop state layer
// consumes that table instead of keeping a second hand-maintained copy.
type PermissionConfig = AgentPermissionConfig;

export const PERMISSION_OPTIONS: Record<string, PermissionConfig> = Object.fromEntries(
  Object.values(AGENT_DESCRIPTORS).map((descriptor) => [
    descriptor.id,
    clonePermissionConfig(descriptor.permission),
  ]),
) as Record<string, PermissionConfig>;

function clonePermissionConfig(config: AgentPermissionConfig): PermissionConfig {
  return {
    default: config.default,
    options: config.options.map((option) => ({ ...option })),
    ...(config.legacyValueMap !== undefined
      ? { legacyValueMap: { ...config.legacyValueMap } }
      : {}),
  };
}

export function permissionConfigForAgent(agentId: string): PermissionConfig {
  return PERMISSION_OPTIONS[agentId] ?? PERMISSION_OPTIONS.codex;
}

export function normalizePermissionValue(agentId: string, value: string): string {
  const config = permissionConfigForAgent(agentId);
  if (config.options.some((option) => option.value === value)) {
    return value;
  }
  return config.legacyValueMap?.[value] ?? value;
}

// Provider-CLI agents the backend detected on the local system. `null` = not yet
// reported (treat all as available so the menu never flashes all-disabled at startup).
// Set by the Desktop adapter from the thread.listed event. Module-level so it survives
// New-Thread state resets.
let availableProviderAgents: readonly string[] | null = null;

export function setAvailableProviderAgents(agents: readonly string[] | null): void {
  availableProviderAgents = agents;
}

export function isAgentAvailable(agentId: string): boolean {
  return availableProviderAgents === null || availableProviderAgents.includes(agentId);
}

// Whether local-system agent detection has arrived yet (thread.listed). Until it has,
// availableProviderAgents is null and isAgentAvailable optimistically returns true (for the
// start-default pick, which only matters at send-time). The agent menu uses THIS to show a
// neutral "Checking…" during that brief window instead of a misleading "installed" label.
export function isAgentAvailabilityKnown(): boolean {
  return availableProviderAgents !== null;
}

// Agents shown in the composer menu but not yet wired for real use — rendered
// disabled with a "Coming soon" hint, never selectable or chosen as the start
// default. (opencode is now fully wired: ACP runtime + model/vendor/effort
// selection from its own catalog — see opencode-model-vendor-selection.md.)
const COMING_SOON_AGENTS: ReadonlySet<string> = new Set([]);

export function isAgentComingSoon(agentId: string): boolean {
  return COMING_SOON_AGENTS.has(agentId);
}

// Provider-CLI agents offered in the composer menu.
const OFFERED_PROVIDER_AGENTS = ["codex", "claude", "opencode"] as const;

// Pick the agent a new thread should default to. Honors the user's last choice only if
// it is still offered AND detected locally — so a persisted hidden/uninstalled agent
// never resurfaces as the default. Falls back to the first detected offered agent,
// then codex.
export function resolveStartAgentId(preferred: string | undefined): AgentChatAgentId {
  if (
    preferred !== undefined &&
    (OFFERED_PROVIDER_AGENTS as readonly string[]).includes(preferred) &&
    isAgentAvailable(preferred) &&
    !isAgentComingSoon(preferred)
  ) {
    return preferred as AgentChatAgentId;
  }
  const firstAvailable = OFFERED_PROVIDER_AGENTS.find(
    (agentId) => isAgentAvailable(agentId) && !isAgentComingSoon(agentId),
  );
  return (firstAvailable ?? "codex") as AgentChatAgentId;
}

export interface CliModelOption {
  value: string;
  label: string;
  detail?: string;
  // Multi-vendor router models (opencode) carry their vendor for grouping in the
  // model menu; single-vendor agents (claude/codex) leave it undefined.
  vendor?: string;
}

// Provider-reported model catalogs, keyed by agent id. opencode ships its authed
// list on thread.listed (`opencode models`) and can self-report over ACP at session
// start (agentRuntime.modelCatalogChanged). When present, the catalog
// drives the menu instead of the hand-curated static list. Module-level so it
// survives New-Thread state resets, mirroring availableProviderAgents.
const providerModelCatalogs = new Map<string, CliModelOption[]>();
const providerCatalogAgents = new Map<string, ProviderCatalogAgentSnapshot>();

export interface ProviderCatalogAgentSnapshot {
  agentId: string;
  installed: boolean;
  authenticated?: boolean;
  source: "dynamic" | "static";
  models: CliModelOption[];
  connectedVendors?: number;
  totalVendors?: number;
  version?: string;
}

export function setProviderModelCatalog(agentId: string, models: CliModelOption[] | null): void {
  if (models !== null && models.length > 0) {
    providerModelCatalogs.set(agentId, models);
  } else {
    providerModelCatalogs.delete(agentId);
  }
}

// opencode-specific alias kept for the thread.listed wiring.
export function setOpencodeModelCatalog(models: CliModelOption[] | null): void {
  setProviderModelCatalog("opencode", models);
}

export function setProviderCatalogAgents(agents: readonly ProviderCatalogAgentSnapshot[] | null): void {
  for (const agentId of providerCatalogAgents.keys()) {
    providerModelCatalogs.delete(agentId);
  }
  providerCatalogAgents.clear();
  if (agents === null) {
    return;
  }
  for (const agent of agents) {
    providerCatalogAgents.set(agent.agentId, agent);
    setProviderModelCatalog(agent.agentId, agent.models);
  }
}

export function providerCatalogAgent(agentId: string): ProviderCatalogAgentSnapshot | undefined {
  return providerCatalogAgents.get(agentId);
}

// A maintained, provider-native model list per CLI agent (models change rarely).
// Claude values are the real `--model` aliases (verified via `/model`); "Claude
// default" passes no --model (uses the CLI's own default).
export function cliModelOptionsForAgent(agentId: string): CliModelOption[] {
  switch (agentId) {
    case "codex":
      return CODEX_MODELS;
    case "claude":
      // Mirrors the Claude Code app's model list. "Claude default" passes no
      // --model (the CLI's own default, currently Opus 4.8); the rest pass an
      // explicit `--model` id.
      return CLAUDE_PROVIDER_MODELS;
    case "opencode": {
      // opencode is a multi-vendor router: the real model list is whatever the
      // user has authed (`opencode auth login`), enumerated by the backend and
      // cached in opencodeModelCatalog. "opencode default" first = honor opencode's
      // own configured default (no explicit set). Falls back to default-only until
      // the catalog arrives (older backend / not yet enumerated).
      const fallback = { value: "opencode default", label: "Default", detail: "opencode config" };
      const catalog = providerModelCatalogs.get("opencode");
      return catalog === undefined ? [fallback] : [fallback, ...catalog];
    }
    default:
      return [];
  }
}

// Reasoning/thinking effort levels, shared by codex (`model_reasoning_effort`)
// and claude (`--effort`). Codex offers low–xhigh; claude adds "max".
export const REASONING_LEVELS: Record<string, { label: string; detail: string }> = {
  low: { label: "Low", detail: "fastest, least thorough" },
  medium: { label: "Medium", detail: "balanced" },
  high: { label: "High", detail: "slower, more thorough" },
  xhigh: { label: "Extra High", detail: "slowest, most thorough" },
  max: { label: "Max", detail: "maximum effort" },
};

export function runtimeSourceForBinding(binding: AgentChatAgentBinding): AgentChatAgentRuntimeSource {
  return binding.runtimeSource ?? runtimeSourceForAgent(binding.agentId);
}

export function runtimeSourceForAgent(agentId: string): AgentChatAgentRuntimeSource {
  const providerAgent =
    agentId === "claude" || agentId === "opencode"
      ? agentId
      : "codex";
  return {
    kind: "provider_cli",
    integrationId: providerAgent,
  };
}

export function defaultModelValueForAgent(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "Claude default";
    case "opencode":
      return "opencode default";
    default:
      return "gpt-5.5";
  }
}

function defaultModelLabelForAgent(agentId: string): string {
  return modelLabelForAgent(agentId, defaultModelValueForAgent(agentId));
}

export function modelLabelForAgent(agentId: string, model: string): string {
  // Show the friendly label for a known CLI model (e.g. "sonnet" -> "Sonnet").
  const option = cliModelOptionsForAgent(agentId).find((candidate) => candidate.value === model);
  if (option !== undefined) {
    return option.label;
  }
  return model;
}

function modelRowIdForAgent(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "claude-default";
    default:
      return "gpt-55-high";
  }
}

export function defaultPermissionForAgent(agentId: string): string {
  return permissionConfigForAgent(agentId).default;
}

// The friendly label for a permission value (handles legacy raw values too), used
// for the composer permission chip.
export function permissionLabelForValue(agentId: string, value: string): string {
  const config = permissionConfigForAgent(agentId);
  const normalized = normalizePermissionValue(agentId, value);
  return config.options.find((option) => option.value === normalized)?.label ?? value;
}
