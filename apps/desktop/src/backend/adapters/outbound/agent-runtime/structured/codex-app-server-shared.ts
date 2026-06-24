import type { AgentRuntimeRateLimitDto } from "../../../../../shared/contracts/agent-runtime.ts";
import { rateLimitsFromProviderRecord } from "../../../../application/domains/agent-runtime/rate-limit-usage.ts";
import type { StructuredUsagePayload } from "./structured-usage.ts";

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

export function codexStructuredUsageFromTokenUsage(
  usage: Record<string, unknown>,
  rememberedRateLimits: AgentRuntimeRateLimitDto[] | undefined,
): { usage: StructuredUsagePayload; rateLimits?: AgentRuntimeRateLimitDto[] } {
  const total = isRecord(usage.total) ? usage.total : undefined;
  const last = isRecord(usage.last)
    ? usage.last
    : isRecord(usage.lastTokenUsage)
      ? usage.lastTokenUsage
      : isRecord(usage.last_token_usage)
        ? usage.last_token_usage
        : undefined;
  const rateLimits = codexRateLimitsFromUsage(usage);
  const nextRateLimits = rateLimits.length > 0 ? rateLimits : rememberedRateLimits;
  const contextTokens =
    last !== undefined
      ? numberField(last, "totalTokens") ??
        numberField(last, "total_tokens") ??
        sumTokenFields(last)
      : undefined;
  return {
    usage: {
      ...(total !== undefined ? { inputTokens: numberField(total, "inputTokens") } : {}),
      ...(total !== undefined ? { outputTokens: numberField(total, "outputTokens") } : {}),
      ...(total !== undefined ? { totalTokens: numberField(total, "totalTokens") } : {}),
      ...(contextTokens !== undefined ? { contextTokens } : {}),
      ...(numberField(usage, "modelContextWindow") !== undefined
        ? { contextWindow: numberField(usage, "modelContextWindow") }
        : {}),
      ...(nextRateLimits !== undefined ? { rateLimits: nextRateLimits } : {}),
    },
    ...(rateLimits.length > 0 ? { rateLimits } : {}),
  };
}

function sumTokenFields(record: Record<string, unknown>): number | undefined {
  const input = numberField(record, "inputTokens") ?? numberField(record, "input_tokens");
  const output = numberField(record, "outputTokens") ?? numberField(record, "output_tokens") ?? 0;
  return input !== undefined ? input + output : undefined;
}

export function bounded(text: string): string {
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}
