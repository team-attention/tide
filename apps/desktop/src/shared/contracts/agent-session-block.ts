import type { AgentId } from "./agent.ts";
import type { ThreadId } from "./ids.ts";
import type { JsonObject } from "./json.ts";

export type AgentSessionBlockRoleDto =
  | "user"
  | "agent"
  | "tool"
  | "system"
  | "runtime";

export interface AgentSessionBlockDto {
  blockId: string;
  threadId: ThreadId;
  agentId?: AgentId;
  kind: string;
  role?: AgentSessionBlockRoleDto;
  sourceFrameIds?: string[];
  localProvenance?: JsonObject;
  status: "pending" | "streaming" | "complete" | "failed" | "needs_input";
  title?: string;
  body?: string;
  data?: JsonObject;
  rawFallback?: string;
  createdAt?: string;
  updatedAt: string;
}
