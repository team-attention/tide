export type ProviderCliAgentId = "codex" | "claude" | "gemini" | "opencode";
export type AgentId = ProviderCliAgentId;

export interface AgentRuntimeSourceDto {
  kind: "provider_cli";
  integrationId: ProviderCliAgentId;
}

export interface AgentBindingDto {
  agentId: AgentId;
  runtimeSource?: AgentRuntimeSourceDto;
  providerSessionRef?: ProviderSessionRefDto;
}

export interface ProviderSessionRefDto {
  kind:
    | "codex_rollout"
    | "claude_transcript"
    | "gemini_session"
    | "opencode_session"
    | "provider_native";
  value: string;
  transcriptPath?: string;
  logPath?: string;
}
