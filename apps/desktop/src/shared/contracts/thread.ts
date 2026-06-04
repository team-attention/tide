import type { AgentBindingDto } from "./agent.ts";
import type { ProjectId, ThreadId } from "./ids.ts";
import type { JsonObject } from "./json.ts";

export interface ThreadSummaryDto {
  threadId: ThreadId;
  title: string;
  agentBinding: AgentBindingDto;
  scope: ThreadScopeDto;
  launchOptions?: JsonObject;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  lastKnownState: LastKnownStateDto;
  // When the current turn started running (set at each turn start). Lets the
  // Working indicator show elapsed-since-turn-start even after reopening a thread.
  runtimeStartedAt?: string;
}

export type ThreadScopeDto =
  | { kind: "project"; projectId: ProjectId; cwd: string }
  | { kind: "scratch"; scratchCwd: string };

export type LastKnownStateDto =
  | "idle"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "failed"
  | "archived";
