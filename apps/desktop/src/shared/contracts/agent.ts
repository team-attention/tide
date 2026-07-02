export type ProviderCliAgentId = "codex" | "claude" | "opencode" | "qwen";
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
    | "opencode_session"
    | "qwen_session"
    | "provider_native";
  value: string;
  transcriptPath?: string;
  logPath?: string;
}
