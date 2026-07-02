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
  // The user-set thread goal (objective). Tide-owned metadata, persisted across
  // restart, and pushed to the provider's native goal mechanism where one exists
  // (codex thread/goal/set, claude /goal). Empty/absent ⇒ no goal set.
  // See specs/thread-goal-and-checklist-panel.md.
  goal?: string;
  // Provider-native goal runner state. `goal` remains the objective cache for
  // older clients; goalState is the authoritative status when present.
  goalState?: ThreadGoalStateDto;
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

export type ThreadGoalStatusDto =
  | "active"
  | "paused"
  | "blocked"
  | "usage_limited"
  | "budget_limited"
  | "complete";

export type ThreadGoalProviderDto = "codex" | "claude" | "fallback";

export interface ThreadGoalStateDto {
  objective: string;
  status: ThreadGoalStatusDto;
  provider: ThreadGoalProviderDto;
  createdAt?: string;
  updatedAt: string;
  tokenBudget?: number;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  lastReason?: string;
}
