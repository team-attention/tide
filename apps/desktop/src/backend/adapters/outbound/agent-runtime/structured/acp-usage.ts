import { rateLimitsFromProviderRecord } from "../../../../application/domains/agent-runtime/rate-limit-usage.ts";
import { isRecord } from "./claude-stream-json-shared.ts";
import type { StructuredUsagePayload } from "./structured-usage.ts";

// ACP turn/usage records carry token + quota data either at the top
// level or nested under `_meta.quota`. We resolve the quota container, read token counts
// from its `token_count`, and pull the 5h + weekly rate-limit windows from the whole
// record — rateLimitsFromProviderRecord descends `_meta`/quota for the nested limits.
export function acpUsageFromRecord(record: Record<string, unknown>): StructuredUsagePayload | undefined {
  const meta = recordField(record, "_meta");
  const quota = recordField(record, "quota") ?? recordField(meta, "quota") ?? record;
  const tokenCount =
    recordField(quota, "token_count") ??
    recordField(quota, "tokenCount") ??
    recordField(record, "token_count") ??
    recordField(record, "tokenCount");
  const inputTokens =
    tokenCount !== undefined
      ? numberField(tokenCount, "input_tokens") ?? numberField(tokenCount, "inputTokens")
      : numberField(record, "input_tokens") ?? numberField(record, "inputTokens");
  const outputTokens =
    tokenCount !== undefined
      ? numberField(tokenCount, "output_tokens") ?? numberField(tokenCount, "outputTokens")
      : numberField(record, "output_tokens") ?? numberField(record, "outputTokens");
  const totalTokens =
    tokenCount !== undefined
      ? numberField(tokenCount, "total_tokens") ?? numberField(tokenCount, "totalTokens")
      : numberField(record, "total_tokens") ?? numberField(record, "totalTokens");
  const contextWindow =
    numberField(quota, "context_window") ??
    numberField(quota, "contextWindow") ??
    numberField(record, "context_window") ??
    numberField(record, "contextWindow");
  const rateLimits = rateLimitsFromProviderRecord(record);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    contextWindow === undefined &&
    rateLimits.length === 0
  ) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(rateLimits.length > 0 ? { rateLimits } : {}),
  };
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordField(
  record: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (record === undefined) {
    return undefined;
  }
  const value = record[key];
  return isRecord(value) ? value : undefined;
}
