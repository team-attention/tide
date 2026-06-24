// Process-boundary DTO for the per-provider model catalog. One shape for every
// provider, populated dynamically where the provider self-reports its models
// (ACP `models`, opencode `opencode models` / configOptions) and statically
// where it cannot (claude/codex curated lists). See
// docs_v2/specs/cross-provider-model-catalog-and-hub.md.
import type { ProviderCliAgentId } from "./agent.ts";

export interface ProviderModelDto {
  // Provider-native model id: claude `--model` alias / codex
  // free-form / opencode "provider/model"; or a "<provider> default" sentinel.
  value: string;
  label: string;
  // Multi-vendor router models (opencode) carry their vendor segment for grouping;
  // single-vendor agents leave it undefined.
  vendor?: string;
  // Reasoning effort values this model exposes (provider-native), when any. Absent
  // ⇒ no effort control for the model.
  effortOptions?: string[];
  // "Legacy" / "free" / cost / context — shown as the row's secondary text.
  detail?: string;
}

export interface ProviderModelCatalogDto {
  agentId: ProviderCliAgentId;
  source: "dynamic" | "static";
  models: ProviderModelDto[];
  // Provider-reported current model (ACP currentModelId / opencode currentValue).
  currentModel?: string;
  // Tide-resolved default (sentinel or concrete id).
  defaultModel: string;
}
