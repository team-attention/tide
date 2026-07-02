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

export function codexContextTokensFromUsage(usage: Record<string, unknown>): number | undefined {
  const direct =
    numberField(usage, "contextTokens") ??
    numberField(usage, "context_tokens");
  if (direct !== undefined) {
    return direct;
  }
  const current =
    recordField(usage, "last") ??
    recordField(usage, "lastTokenUsage") ??
    recordField(usage, "last_token_usage") ??
    recordField(usage, "current") ??
    recordField(usage, "context") ??
    recordField(usage, "contextUsage");
  if (current === undefined) {
    return undefined;
  }
  const currentTotal = recordField(current, "total");
  return (
    numberField(current, "totalTokens") ??
    numberField(current, "total_tokens") ??
    numberField(current, "tokens") ??
    (currentTotal !== undefined ? numberField(currentTotal, "totalTokens") : undefined) ??
    (currentTotal !== undefined ? numberField(currentTotal, "total_tokens") : undefined)
  );
}

export function bounded(text: string): string {
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) ? value : undefined;
}
