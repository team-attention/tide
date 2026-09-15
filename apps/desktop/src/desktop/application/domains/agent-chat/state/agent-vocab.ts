import type { AgentChatAgentBinding, AgentChatAgentId, AgentChatAgentRuntimeSource, AgentChatProviderCatalog, AgentChatProviderInventory } from "./types.ts";
import {
  AGENT_DESCRIPTORS,
  agentDescriptor,
  type AgentPermissionConfig,
} from "../../../../../shared/agent-descriptors.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

// Before discovery, offer the provider default. The backend replaces this with
// the installed CLI model catalog.
// Existing custom provider-native ids remain valid even when unlisted.
export const CODEX_MODELS: CliModelOption[] = [{ value: "", label: "Default" }];

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

export function isAgentAvailable(
  agentId: string,
  inventory?: AgentChatProviderInventory | null,
): boolean {
  if (inventory === undefined || inventory === null) {
    return true;
  }
  return inventory.agents.find((agent) => agent.agentId === agentId)?.installed === true;
}

export function isAgentAvailabilityKnown(
  inventory?: AgentChatProviderInventory | null,
): boolean {
  return inventory !== undefined && inventory !== null;
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
const OFFERED_PROVIDER_AGENTS = ["codex", "claude", "opencode", "vibe"] as const;

// Pick the agent a new thread should default to. Honors the user's last choice only if
// it is still offered AND detected locally — so a persisted hidden/uninstalled agent
// never resurfaces as the default. Falls back to the first detected offered agent,
// then codex.
export function resolveStartAgentId(
  preferred: string | undefined,
  inventory?: AgentChatProviderInventory | null,
): AgentChatAgentId {
  if (
    preferred !== undefined &&
    (OFFERED_PROVIDER_AGENTS as readonly string[]).includes(preferred) &&
    isAgentAvailable(preferred, inventory) &&
    !isAgentComingSoon(preferred)
  ) {
    return preferred as AgentChatAgentId;
  }
  const firstAvailable = OFFERED_PROVIDER_AGENTS.find(
    (agentId) => isAgentAvailable(agentId, inventory) && !isAgentComingSoon(agentId),
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

// Only provider defaults are available before live discovery completes.
export function cliModelOptionsForAgent(agentId: string): CliModelOption[] {
  if (agentId === "claude") return [{ value: "Claude default", label: "Default" }];
  if (agentId === "vibe") return [{ value: "vibe default", label: "Default" }];
  return [];
}

// Display copy for familiar effort values. This is not a list of supported values;
// providers supply those, and unfamiliar values retain their native label.
export const REASONING_LEVELS: Record<string, { label: string; detail: string }> = {
  off: { label: "Off", detail: "No thinking" },
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
    agentId === "claude" || agentId === "opencode" || agentId === "vibe"
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
    case "vibe":
      return "vibe default";
    case "opencode":
      return "opencode default";
    default:
      return "";
  }
}

export function defaultReasoningValueForAgent(agentId: string, model?: string): string {
  if (agentId === "claude") {
    return "high";
  }
  if (agentId === "codex") {
    switch (model ?? defaultModelValueForAgent("codex")) {
      case "gpt-5.6-sol":
        return "low";
      case "gpt-5.3-codex-spark":
        return "high";
      default:
        return "medium";
    }
  }
  return "high";
}

function defaultModelLabelForAgent(
  agentId: string,
  catalog?: AgentChatProviderCatalog,
): string {
  return modelLabelForAgent(agentId, defaultModelValueForAgent(agentId), catalog);
}

export function modelLabelForAgent(
  agentId: string,
  model: string,
  catalog?: AgentChatProviderCatalog,
): string {
  if (catalog?.status === "ready") {
    const option = catalog.models.find((candidate) => candidate.value === model);
    if (option !== undefined) {
      return option.label;
    }
  }
  if (model === defaultModelValueForAgent(agentId)) {
    switch (agentId) {
      case "codex":
      case "vibe":
      case "claude":
      case "opencode":
        return "Default";
      default:
        break;
    }
  }
  // Show the friendly label for a known CLI model (e.g. "sonnet" -> "Sonnet").
  const option = cliModelOptionsForAgent(agentId).find((candidate) => candidate.value === model);
  if (option !== undefined) {
    return option.label;
  }
  if (agentId === "codex") {
    const codexOption = CODEX_MODELS.find((candidate) => candidate.value === model);
    if (codexOption !== undefined) {
      return codexOption.label;
    }
  }
  return model;
}

function modelRowIdForAgent(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "claude-default";
    default:
      return "gpt-55";
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
