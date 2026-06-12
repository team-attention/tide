// Provider session reference derivation lives with each provider's Agent
// Integration (the history connector owns its hook-payload and path shapes).
// This module re-exports them for the infra-side consumers (adoption-time
// discovery, conversation rebuilders) plus the persistence-coupled record type.
// See docs_v2/specs/provider-history-connector.md.

import type { ProviderSessionRefRecord } from "../../application/services/thread/thread-persistence-service.ts";

export type DiscoveredProviderSessionRef = Omit<ProviderSessionRefRecord, "observedAt">;

export {
  codexProviderSessionRefFromRolloutPath,
  codexSessionIdFromRolloutPath,
} from "../../adapters/outbound/agent-integrations/codex/codex-history-connector.ts";
export {
  claudeProviderSessionRefFromTranscriptPath,
  claudeSessionIdFromTranscriptPath,
} from "../../adapters/outbound/agent-integrations/claude/claude-history-connector.ts";
