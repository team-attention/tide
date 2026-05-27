export type AgentId = "codex" | "claude" | "antigravity";

export interface AgentBindingDto {
  agentId: AgentId;
  providerSessionRef?: ProviderSessionRefDto;
}

export interface ProviderSessionRefDto {
  kind:
    | "codex_rollout"
    | "claude_transcript"
    | "antigravity_conversation"
    | "provider_native";
  value: string;
  transcriptPath?: string;
  logPath?: string;
}
