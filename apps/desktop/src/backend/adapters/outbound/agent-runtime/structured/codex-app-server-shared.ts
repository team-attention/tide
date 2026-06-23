import type { AgentRuntimeRateLimitDto } from "../../../../../shared/contracts/agent-runtime.ts";
import { rateLimitsFromProviderRecord } from "../../../../application/domains/agent-runtime/rate-limit-usage.ts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function codexRateLimitsFromUsage(
  usage: Record<string, unknown> | undefined,
): AgentRuntimeRateLimitDto[] {
  return usage !== undefined ? rateLimitsFromProviderRecord(usage) : [];
}

export function bounded(text: string): string {
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}
