import type { ProviderCliAgentId } from "../thread/thread.ts";

export type LocalProviderInventoryKind = "plugin" | "skill" | "mcp";

export interface LocalProviderInventoryItem {
  agentId: ProviderCliAgentId;
  kind: LocalProviderInventoryKind;
  id: string;
  label: string;
  source: "local_file";
  path?: string;
  description?: string;
  enabled?: boolean;
  version?: string;
  nativePayload?: unknown;
}
