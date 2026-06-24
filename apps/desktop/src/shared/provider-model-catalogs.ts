import type { ProviderCliAgentId, ProviderModelDto } from "./contracts/index.ts";

// Curated static catalogs for providers that do not expose reliable model
// enumeration. Dynamic providers (currently opencode) arrive through backend
// providerCatalog.changed events.
export const CODEX_PROVIDER_MODELS: ProviderModelDto[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3-Codex" },
  { value: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark" },
  { value: "gpt-5.2", label: "GPT-5.2" },
];

export const CLAUDE_PROVIDER_MODELS: ProviderModelDto[] = [
  { value: "Claude default", label: "Default", detail: "Opus 4.8" },
  { value: "claude-fable-5", label: "Fable 5" },
  { value: "claude-opus-4-8", label: "Opus 4.8" },
  { value: "claude-opus-4-8[1m]", label: "Opus 4.8 (1M context)" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { value: "claude-haiku-4-5", label: "Haiku 4.5" },
  { value: "claude-opus-4-7", label: "Opus 4.7", detail: "Legacy" },
  { value: "claude-opus-4-7[1m]", label: "Opus 4.7 (1M context)", detail: "Legacy" },
  { value: "claude-opus-4-6", label: "Opus 4.6", detail: "Legacy" },
];

export function staticProviderModelsForAgent(agentId: ProviderCliAgentId): ProviderModelDto[] {
  switch (agentId) {
    case "codex":
      return CODEX_PROVIDER_MODELS.map((model) => ({ ...model }));
    case "claude":
      return CLAUDE_PROVIDER_MODELS.map((model) => ({ ...model }));
    default:
      return [];
  }
}

export function staticProviderCatalogSource(agentId: ProviderCliAgentId): "static" | "dynamic" {
  return agentId === "opencode" ? "dynamic" : "static";
}
