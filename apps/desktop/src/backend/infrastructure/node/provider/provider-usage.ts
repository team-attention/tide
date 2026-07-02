import type {
  AgentRuntimeRateLimitDto,
  AgentRuntimeUsageDto,
} from "../../../../shared/contracts/agent-runtime.ts";
import type { AgentId } from "../../../application/domains/thread/thread.ts";
import { rateLimitsFromProviderRecord } from "../../../application/domains/agent-runtime/rate-limit-usage.ts";
import {
  numberField,
  parseJsonObject,
  recordField,
  stringField,
} from "../live/live-backend-json.ts";

// Single responsibility: parse a provider's own transcript text into a
// last-known context/token usage summary (AgentRuntimeUsageDto). Pure. Each
// provider reports a different subset, so missing fields stay undefined and the
// UI shows only what is available.

export function parseProviderUsage(
  text: string,
  agentId: AgentId,
): AgentRuntimeUsageDto | undefined {
  if (agentId === "codex") {
    return parseCodexUsage(text);
  }
  if (agentId === "claude") {
    return parseClaudeUsage(text);
  }
  return undefined;
}

// codex rollout: the latest `event_msg` of type `token_count` carries both a
// cumulative `info.total_token_usage.total_tokens` and the current request's
// `info.last_token_usage.total_tokens`. The context meter must use the latter;
// the cumulative value can grow far past the model context window.
function parseCodexUsage(text: string): AgentRuntimeUsageDto | undefined {
  let totalTokens: number | undefined;
  let contextTokens: number | undefined;
  let contextWindow: number | undefined;
  let model: string | undefined;
  let rateLimits: AgentRuntimeRateLimitDto[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    if (record === undefined) {
      continue;
    }
    const payload = recordField(record, "payload") ?? record;
    const modelCandidate =
      stringField(payload, "model") ?? stringField(record, "model");
    if (modelCandidate !== undefined) {
      model = modelCandidate;
    }
    if (stringField(payload, "type") !== "token_count") {
      continue;
    }
    const info = recordField(payload, "info") ?? payload;
    const total = recordField(info, "total_token_usage");
    const tokens =
      numberField(total ?? {}, "total_tokens") ??
      numberField(info, "total_tokens") ??
      numberField(payload, "total_tokens");
    if (tokens !== undefined) {
      totalTokens = tokens;
    }
    const currentContextTokens = codexContextTokensFromTokenCount(info, payload);
    if (currentContextTokens !== undefined) {
      contextTokens = currentContextTokens;
    }
    const window =
      numberField(info, "model_context_window") ??
      numberField(payload, "model_context_window");
    if (window !== undefined) {
      contextWindow = window;
    }
    const parsedRateLimits = rateLimitsFromProviderRecord(payload);
    if (parsedRateLimits.length > 0) {
      rateLimits = parsedRateLimits;
    }
  }
  return finalizeUsage({ totalTokens, contextTokens, contextWindow, model, rateLimits });
}

function codexContextTokensFromTokenCount(
  info: Record<string, unknown>,
  payload: Record<string, unknown>,
): number | undefined {
  const direct =
    numberField(info, "contextTokens") ??
    numberField(info, "context_tokens") ??
    numberField(payload, "contextTokens") ??
    numberField(payload, "context_tokens");
  if (direct !== undefined) {
    return direct;
  }
  const current =
    recordField(info, "last") ??
    recordField(info, "lastTokenUsage") ??
    recordField(info, "last_token_usage") ??
    recordField(info, "current") ??
    recordField(info, "context") ??
    recordField(info, "contextUsage") ??
    recordField(payload, "last") ??
    recordField(payload, "lastTokenUsage") ??
    recordField(payload, "last_token_usage") ??
    recordField(payload, "current") ??
    recordField(payload, "context") ??
    recordField(payload, "contextUsage");
  const currentTotal = current !== undefined ? recordField(current, "total") : undefined;
  return (
    (current !== undefined ? numberField(current, "totalTokens") : undefined) ??
    (current !== undefined ? numberField(current, "total_tokens") : undefined) ??
    (current !== undefined ? numberField(current, "tokens") : undefined) ??
    (currentTotal !== undefined ? numberField(currentTotal, "totalTokens") : undefined) ??
    (currentTotal !== undefined ? numberField(currentTotal, "total_tokens") : undefined) ??
    numberField(info, "last_total_tokens") ??
    numberField(payload, "last_total_tokens")
  );
}

// claude transcript: the latest assistant message carries `message.usage` with
// input/output token counts. claude does not report a context window in the
// transcript, so percent is left undefined.
function parseClaudeUsage(text: string): AgentRuntimeUsageDto | undefined {
  let totalTokens: number | undefined;
  let model: string | undefined;
  let rateLimits: AgentRuntimeRateLimitDto[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    if (record === undefined) {
      continue;
    }
    const parsedRateLimits = rateLimitsFromProviderRecord(record);
    if (parsedRateLimits.length > 0) {
      rateLimits = parsedRateLimits;
    }
    if (record.type !== "assistant") {
      continue;
    }
    const message = recordField(record, "message");
    if (message === undefined) {
      continue;
    }
    const messageModel = stringField(message, "model");
    if (messageModel !== undefined) {
      model = messageModel;
    }
    const usage = recordField(message, "usage");
    if (usage === undefined) {
      continue;
    }
    const input =
      (numberField(usage, "input_tokens") ?? 0) +
      (numberField(usage, "cache_read_input_tokens") ?? 0) +
      (numberField(usage, "cache_creation_input_tokens") ?? 0);
    const output = numberField(usage, "output_tokens") ?? 0;
    const sum = input + output;
    if (sum > 0) {
      totalTokens = sum;
    }
  }
  return finalizeUsage({ totalTokens, contextTokens: undefined, contextWindow: undefined, model, rateLimits });
}

function finalizeUsage(input: {
  totalTokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  model?: string;
  rateLimits?: AgentRuntimeRateLimitDto[];
}): AgentRuntimeUsageDto | undefined {
  const { totalTokens, contextTokens, contextWindow, model, rateLimits } = input;
  if (
    totalTokens === undefined &&
    contextTokens === undefined &&
    contextWindow === undefined &&
    model === undefined &&
    (rateLimits === undefined || rateLimits.length === 0)
  ) {
    return undefined;
  }
  const usage: AgentRuntimeUsageDto = {};
  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  }
  if (contextTokens !== undefined) {
    usage.contextTokens = contextTokens;
  }
  if (contextWindow !== undefined) {
    usage.contextWindow = contextWindow;
  }
  if (model !== undefined) {
    usage.model = model;
  }
  if (rateLimits !== undefined && rateLimits.length > 0) {
    usage.rateLimits = rateLimits;
  }
  const tokensForContext = contextTokens ?? totalTokens;
  if (tokensForContext !== undefined && contextWindow !== undefined && contextWindow > 0) {
    usage.contextUsedPercent = Math.min(100, Math.round((tokensForContext / contextWindow) * 100));
  }
  return usage;
}
