import type { AgentBindingDto } from "./agent.ts";
import type { ProjectId, ThreadId } from "./ids.ts";

export interface ThreadSummaryDto {
  threadId: ThreadId;
  title: string;
  agentBinding: AgentBindingDto;
  scope: ThreadScopeDto;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  lastKnownState: LastKnownStateDto;
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
