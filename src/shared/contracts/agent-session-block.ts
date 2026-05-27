import type { ThreadId } from "./ids.ts";
import type { JsonObject } from "./json.ts";

export interface AgentSessionBlockDto {
  blockId: string;
  threadId: ThreadId;
  kind: string;
  status: "pending" | "streaming" | "complete" | "failed" | "needs_input";
  updatedAt: string;
  body?: string;
  data?: JsonObject;
}
