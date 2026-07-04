export type AgentChatProviderCliAgentId = "codex" | "claude" | "opencode";

export interface AgentChatCommandOption {
  name: string;
  description: string;
  trigger: "/" | "$";
  // Optional provenance, for display/debugging only (NOT used to filter the menu -
  // the menu mirrors the agent's full set). "builtin" = the provider CLI's own
  // command; "project"/"user" = a discovered command/skill file.
  source?: "project" | "user" | "builtin";
}

export interface AgentChatProviderCapabilityOption {
  capabilityId: string;
  kind: string;
  group: string;
  label: string;
  description?: string;
  trigger?: "/" | "$";
  invoke: { kind: string; [key: string]: unknown };
  available: boolean;
}

export type AgentChatProviderCatalogStatus = "ready" | "unavailable" | "error";

export interface AgentChatProviderModelOption {
  value: string;
  label: string;
  vendor?: string;
  effortOptions?: string[];
  detail?: string;
}

export interface AgentChatProviderCatalogVendor {
  id: string;
  label: string;
  connected: boolean;
  method?: string;
  popular?: boolean;
  usable?: boolean;
}

export interface AgentChatProviderAuthMethodOption {
  type: "oauth" | "api";
  label: string;
  promptCount?: number;
}

export interface AgentChatProviderOption {
  id: string;
  label: string;
  source?: "env" | "config" | "custom" | "api";
  env?: string[];
  modelCount: number;
  connected: boolean;
  authMethods?: AgentChatProviderAuthMethodOption[];
}

export interface AgentChatProviderCatalogEnvironment {
  version?: string;
  testedWith?: string;
  executablePath?: string;
}

export interface AgentChatProviderCatalogError {
  code: "not_installed" | "not_authenticated" | "provider_failed" | "timed_out";
  message: string;
  retryable: boolean;
}

export interface AgentChatProviderCatalog {
  agentId: AgentChatProviderCliAgentId;
  status: AgentChatProviderCatalogStatus;
  scope?: { cwd?: string };
  models: AgentChatProviderModelOption[];
  vendors?: AgentChatProviderCatalogVendor[];
  providerOptions?: AgentChatProviderOption[];
  environment?: AgentChatProviderCatalogEnvironment;
  currentModel?: string;
  defaultModel: string;
  error?: AgentChatProviderCatalogError;
}

export interface AgentChatProviderInventoryAgent {
  agentId: AgentChatProviderCliAgentId;
  installed: boolean;
}

export interface AgentChatProviderInventory {
  agents: AgentChatProviderInventoryAgent[];
}
