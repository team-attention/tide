import type { ProviderCliAgentId } from "./agent.ts";

export type AgentRuntimeStateDto =
  | "not_started"
  | "starting"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "idle"
  | "stopping"
  | "stopped"
  | "failed";

// Last-known context/token usage for a Thread's runtime, parsed from the
// provider's own transcript. All fields optional — providers report different
// subsets, and the UI shows only what is available.
export interface AgentRuntimeUsageDto {
  // Cumulative tokens used in the session (input + output) when known.
  totalTokens?: number;
  // Tokens in the currently reported context/request, when the provider reports
  // it separately from the cumulative session total.
  contextTokens?: number;
  // The model's context window size in tokens, when the provider reports it.
  contextWindow?: number;
  // Percent of the context window consumed (0–100), when derivable.
  contextUsedPercent?: number;
  // The provider-native model label, when known (e.g. "gpt-5.5", "sonnet-4.6").
  model?: string;
  // Provider-native account or plan rate-limit windows. For Codex, primary is
  // the 5h window and secondary is the weekly window.
  rateLimits?: AgentRuntimeRateLimitDto[];
}

// Live activity of the in-flight turn that the provider stream does NOT carry —
// today, the count of a Claude `Task` fan-out's nested subagents (derived from the
// on-disk `subagents/*.jsonl` side-channel). Surfaced in the Working indicator so a
// long fan-out reads as alive. All fields are a running snapshot; cleared at turn end.
// See docs_v2/specs/live-turn-activity-visibility.md (Slice B).
export interface LiveTurnActivityDto {
  // Distinct subagents spawned in the current turn's fan-out (Claude, Slice B).
  nestedAgents?: number;
  // Total tool calls across those subagents.
  nestedToolCalls?: number;
  // Plan/todo step progress reported mid-turn (codex/ACP, Slice B′).
  planTotal?: number;
  planCompleted?: number;
}

export interface AgentRuntimeRateLimitDto {
  // Optional provider label. When absent, the UI derives one from windowMinutes.
  label?: string;
  // Percent of this quota window used, as reported by the provider.
  usedPercent?: number;
  // Window size in minutes, when reported (300 => 5h, 10080 => weekly).
  windowMinutes?: number;
  // Provider reset time as Unix seconds, when reported.
  resetsAt?: number;
}

// App-level provider/account quota snapshot, independent of any one Tide Thread.
// Settings consumes these rows; per-thread context/token usage remains on
// agentRuntime.usageChanged.
export interface ProviderUsageSnapshotDto {
  agentId: ProviderCliAgentId;
  usage: AgentRuntimeUsageDto;
  observedAt?: string;
}
