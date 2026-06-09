export type ProviderCliAgentId = "codex" | "claude" | "antigravity" | "gemini";
export type TideApiAgentId = "openai_api";
export type AgentId = ProviderCliAgentId | TideApiAgentId;

export type AgentRuntimeSourceDto =
  | {
      kind: "provider_cli";
      integrationId: ProviderCliAgentId;
    }
  | {
      kind: "tide_api";
      provider: "openai";
      accountId?: string;
    };

export interface AgentBindingDto {
  agentId: AgentId;
  runtimeSource?: AgentRuntimeSourceDto;
  providerSessionRef?: ProviderSessionRefDto;
}

export interface ProviderSessionRefDto {
  kind:
    | "codex_rollout"
    | "claude_transcript"
    | "antigravity_conversation"
    | "gemini_session"
    | "provider_native";
  value: string;
  transcriptPath?: string;
  logPath?: string;
}
