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
  // True while an Agent Runtime for this thread is hydrated/alive in the backend
  // process right now (an in-process runtime handle exists), regardless of state
  // (running OR waiting OR idle-but-alive). The multitask switcher's "live set".
  // Distinct from lastKnownState, which is the last OBSERVED/persisted state. Absent
  // on older payloads ⇒ treat as false. See specs/multitask-navigation.md.
  live?: boolean;
  // When the current turn started running (set at each turn start). Lets the
  // Working indicator show elapsed-since-turn-start even after reopening a thread.
  runtimeStartedAt?: string;
  // The Composer follow-up queue (head-first pending message texts), authoritative
  // from the backend. Absent on older payloads → treat as empty.
  queuedInputs?: string[];
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
