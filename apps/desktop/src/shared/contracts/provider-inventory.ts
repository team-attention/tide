import type { ProviderCliAgentId } from "./agent.ts";
import type { ProviderReadinessDto } from "./provider-readiness.ts";

export interface ProviderEnvironmentDto {
  version?: string;
  testedWith?: string;
  executablePath?: string;
}

export interface ProviderInventoryAgentDto {
  agentId: ProviderCliAgentId;
  installed: boolean;
  readiness?: ProviderReadinessDto;
  environment?: ProviderEnvironmentDto;
}

export interface ProviderInventoryDto {
  agents: ProviderInventoryAgentDto[];
}
