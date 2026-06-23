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
