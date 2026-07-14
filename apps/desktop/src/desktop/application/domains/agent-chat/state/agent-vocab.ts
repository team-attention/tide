import type { AgentChatAgentBinding, AgentChatAgentId, AgentChatAgentRuntimeSource, AgentChatProviderCatalog, AgentChatProviderInventory } from "./types.ts";
import {
  AGENT_DESCRIPTORS,
  agentDescriptor,
  type AgentPermissionConfig,
} from "../../../../../shared/agent-descriptors.ts";
// Extracted from agent-chat-shell-state.ts (spec: navigable-source-structure).

// Codex visible model catalog, verified from `npx -y @openai/codex@latest
// debug models` (codex-cli 0.144.4). codex's --model is free-form, so custom
// provider-native ids remain valid even when they are not listed here.
export const CODEX_MODELS: CliModelOption[] = [
  { value: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
  { value: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6-Luna" },
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
  { value: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark" },
];

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
const OFFERED_PROVIDER_AGENTS = ["codex", "claude", "opencode"] as const;

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

// A maintained, provider-native model list per CLI agent (models change rarely).
// Claude values are accepted `--model` ids/aliases; "Claude default" passes no
// --model and lets the CLI/account resolve its recommended default.
export function cliModelOptionsForAgent(agentId: string): CliModelOption[] {
  switch (agentId) {
    case "claude":
      // Verified against Claude Code model configuration docs and `claude --help`
      // 2.1.202. The explicit rows use current Anthropic API model ids.
      return [
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
      ];
    case "opencode":
      return [];
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
      return "gpt-5.6-sol";
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
  return model;
}

function modelRowIdForAgent(agentId: string): string {
  switch (agentId) {
    case "claude":
      return "claude-default";
    default:
      return "gpt-56-sol";
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
