import type { AgentRuntimeUsageDto } from "../../../shared/contracts/agent-runtime.ts";
import type { AgentId } from "../../application/domains/thread/thread.ts";
import {
  numberField,
  parseJsonObject,
  recordField,
  stringField,
} from "./live-backend-json.ts";

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

// codex rollout: the latest `event_msg` of type `token_count` carries
// `info.total_token_usage.total_tokens` and `info.model_context_window`. A
// `session_meta`/`turn_context` line may carry the model label.
function parseCodexUsage(text: string): AgentRuntimeUsageDto | undefined {
  let totalTokens: number | undefined;
  let contextWindow: number | undefined;
  let model: string | undefined;
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
    const window =
      numberField(info, "model_context_window") ??
      numberField(payload, "model_context_window");
    if (window !== undefined) {
      contextWindow = window;
    }
  }
  return finalizeUsage({ totalTokens, contextWindow, model });
}

// claude transcript: the latest assistant message carries `message.usage` with
// input/output token counts. claude does not report a context window in the
// transcript, so percent is left undefined.
function parseClaudeUsage(text: string): AgentRuntimeUsageDto | undefined {
  let totalTokens: number | undefined;
  let model: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    if (record === undefined || record.type !== "assistant") {
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
  return finalizeUsage({ totalTokens, contextWindow: undefined, model });
}

function finalizeUsage(input: {
  totalTokens?: number;
  contextWindow?: number;
  model?: string;
}): AgentRuntimeUsageDto | undefined {
  const { totalTokens, contextWindow, model } = input;
  if (totalTokens === undefined && contextWindow === undefined && model === undefined) {
    return undefined;
  }
  const usage: AgentRuntimeUsageDto = {};
  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  }
  if (contextWindow !== undefined) {
    usage.contextWindow = contextWindow;
  }
  if (model !== undefined) {
    usage.model = model;
  }
  if (totalTokens !== undefined && contextWindow !== undefined && contextWindow > 0) {
    usage.contextUsedPercent = Math.min(100, Math.round((totalTokens / contextWindow) * 100));
  }
  return usage;
}
