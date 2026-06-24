import { rateLimitsFromProviderRecord } from "../../../../application/domains/agent-runtime/rate-limit-usage.ts";
import { isRecord } from "./claude-stream-json-shared.ts";
import type { StructuredUsagePayload } from "./structured-usage.ts";

export function claudeUsage(message: Record<string, unknown>): StructuredUsagePayload | undefined {
  const rateLimits = rateLimitsFromProviderRecord(message);
  // modelUsage carries per-model contextWindow (evidence: 01-trivial-turn.jsonl
  // line 13) — the context meter's ground truth in this transport.
  const modelUsage = isRecord(message.modelUsage) ? message.modelUsage : undefined;
  if (modelUsage !== undefined) {
    for (const value of Object.values(modelUsage)) {
      if (!isRecord(value)) {
        continue;
      }
      const inputTokens = numberField(value, "inputTokens");
      const cacheRead = numberField(value, "cacheReadInputTokens") ?? 0;
      const outputTokens = numberField(value, "outputTokens");
      const totalTokens =
        inputTokens !== undefined && outputTokens !== undefined
          ? inputTokens + cacheRead + outputTokens
          : undefined;
      return {
        ...(inputTokens !== undefined ? { inputTokens: inputTokens + cacheRead } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(totalTokens !== undefined ? { contextTokens: totalTokens, totalTokens } : {}),
        ...(numberField(value, "contextWindow") !== undefined
          ? { contextWindow: numberField(value, "contextWindow") }
          : {}),
        ...(rateLimits.length > 0 ? { rateLimits } : {}),
      };
    }
  }
  return rateLimits.length > 0 ? { rateLimits } : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
