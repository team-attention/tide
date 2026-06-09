import { antigravityRecordIsTurnEnd } from "../../adapters/outbound/agent-integrations/antigravity/antigravity-transcript-turn-detection.ts";
import {
  numberField,
  parseJsonObject,
  stringField,
  unknownRecord,
} from "./live-backend-json.ts";

// Shared parsing helpers that turn a provider's raw history (codex rollout JSONL,
// claude transcript content arrays, antigravity transcript entries) into bounded
// tool-call/result text and ordered conversation items. Used by both the
// provider-history frame readers and the conversation rebuilders. Pure (json
// helpers + the antigravity turn-end rule). Extracted from live-backend.ts.

export function joinTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts = content
    .map((item) => {
      const record = unknownRecord(item);
      return record ? (stringField(record, "text") ?? stringField(record, "input_text")) : undefined;
    })
    .filter((value): value is string => typeof value === "string");
  return parts.length > 0 ? parts.join("") : undefined;
}

// Tool args/output can be large (full file contents, long command output). Keep
// the rendered body bounded so the transcript stays readable and light.
export function boundedToolText(text: string): string {
  const limit = 2000;
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more chars)` : text;
}

// codex tool output is usually a string, but some tools wrap it in
// `{ output: string }` or content parts; extract readable text either way.
export function codexToolOutputText(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  const record = unknownRecord(output);
  if (record !== undefined) {
    return stringField(record, "output") ?? joinTextContent(record.content) ?? "";
  }
  return joinTextContent(output) ?? "";
}

// Extracts readable reasoning/thinking text from a codex rollout payload, whether
// it arrives as an `event_msg` (type "agent_reasoning", carrying `text`) or a
// `response_item` (type "reasoning", carrying a `summary` of summary_text parts).
// Returns undefined when the reasoning is encrypted/empty (nothing to show).
export function codexReasoningText(payload: Record<string, unknown>): string | undefined {
  const type = stringField(payload, "type");
  if (type === "agent_reasoning" || type === "agent_reasoning_delta") {
    const text = stringField(payload, "text");
    return text !== undefined && text.trim().length > 0 ? text : undefined;
  }
  if (type !== "reasoning") {
    return undefined;
  }
  const parts: string[] = [];
  for (const key of ["summary", "content"]) {
    const value = (payload as Record<string, unknown>)[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value) {
      const record = unknownRecord(item);
      const text = record !== undefined ? stringField(record, "text") : undefined;
      if (text !== undefined && text.trim().length > 0) {
        parts.push(text);
      }
    }
  }
  const joined = parts.join("\n\n").trim();
  return joined.length > 0 ? joined : undefined;
}

export function codexToolFramePayload(input: {
  payload: Record<string, unknown>;
  threadId: string;
  sessionId: string;
  index: number;
  runtimeId: string;
  toolNameByCallId: Map<string, string>;
}): Record<string, unknown> | undefined {
  const { payload } = input;
  const type = stringField(payload, "type");
  const callId = stringField(payload, "call_id");
  const blockId = `provider:${input.threadId}:${input.sessionId}:${input.index}`;
  const base = {
    blockId,
    callId: callId ?? blockId,
    status: "complete",
    sourceRuntimeId: input.runtimeId,
  };
  if (type === "function_call" || type === "custom_tool_call") {
    const toolName = stringField(payload, "name") ?? "tool";
    if (callId !== undefined) {
      input.toolNameByCallId.set(callId, toolName);
    }
    // function_call carries a JSON `arguments` string; custom_tool_call an `input`.
    const args = stringField(payload, "arguments") ?? stringField(payload, "input") ?? "";
    return {
      type: "tool_call",
      toolName,
      arguments: args,
      body: boundedToolText(args),
      ...base,
    };
  }
  if (type === "function_call_output" || type === "custom_tool_call_output") {
    const toolName = (callId !== undefined ? input.toolNameByCallId.get(callId) : undefined) ?? "tool";
    const output = codexToolOutputText(payload.output);
    return {
      type: "tool_result",
      toolName,
      ok: true,
      output,
      body: boundedToolText(output),
      ...base,
    };
  }
  return undefined;
}

export function claudeToolUseItems(
  content: unknown,
): { callId: string; toolName: string; argumentsText: string }[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const items: { callId: string; toolName: string; argumentsText: string }[] = [];
  for (const item of content) {
    const record = unknownRecord(item);
    if (record?.type !== "tool_use") {
      continue;
    }
    const callId = stringField(record, "id") ?? `tool:${items.length}`;
    const toolName = stringField(record, "name") ?? "tool";
    const input = record.input;
    const argumentsText =
      typeof input === "string" ? input : input === undefined ? "" : JSON.stringify(input);
    items.push({ callId, toolName, argumentsText });
  }
  return items;
}

// Extracts claude `tool_result` content items (intermediate user message).
export function claudeToolResultItems(
  content: unknown,
): { callId: string; output: string }[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const items: { callId: string; output: string }[] = [];
  for (const item of content) {
    const record = unknownRecord(item);
    if (record?.type !== "tool_result") {
      continue;
    }
    const callId = stringField(record, "tool_use_id") ?? `tool:${items.length}`;
    const output =
      typeof record.content === "string"
        ? record.content
        : joinTextContent(record.content) ?? "";
    items.push({ callId, output });
  }
  return items;
}

export interface AntigravityConversationItem {
  kind: "message" | "tool_call" | "tool_result";
  role: "user" | "agent";
  blockSuffix: string;
  toolName?: string;
  body: string;
  // True for the final agent message of a turn: a PLANNER_RESPONSE with content and
  // no tool_calls. Antigravity fires no turn-end hook, so this is the turn boundary.
  turnEnd?: boolean;
}

// Walks an antigravity transcript into ordered conversation items. A
// PLANNER_RESPONSE (source MODEL) carries tool_calls (the call) and/or content
// (the agent's visible text); the following typed MODEL entry is the call's result.
export function antigravityConversationItems(
  text: string,
  options: { includeUser: boolean },
): AntigravityConversationItem[] {
  const items: AntigravityConversationItem[] = [];
  let pendingToolName: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    if (record === undefined) {
      continue;
    }
    const type = stringField(record, "type");
    const source = stringField(record, "source");
    const step = numberField(record, "step_index") ?? items.length;

    if (type === "USER_INPUT") {
      const body = unwrapAntigravityUserRequest(stringField(record, "content"));
      if (options.includeUser && body.length > 0) {
        items.push({ kind: "message", role: "user", blockSuffix: `${step}`, body });
      }
      continue;
    }
    if (source !== "MODEL") {
      continue;
    }
    if (type === "PLANNER_RESPONSE") {
      const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
      toolCalls.forEach((call, callIndex) => {
        const callRecord = unknownRecord(call);
        if (callRecord === undefined) {
          return;
        }
        const toolName = stringField(callRecord, "name") ?? "tool";
        pendingToolName = toolName;
        const argsText = callRecord.args === undefined ? "" : JSON.stringify(callRecord.args);
        items.push({
          kind: "tool_call",
          role: "agent",
          blockSuffix: `${step}:call:${callIndex}`,
          toolName,
          body: boundedToolText(argsText),
        });
      });
      const content = stringField(record, "content");
      if (content !== undefined && content.length > 0) {
        // The turn-end rule (planner message with content and no tool_calls is the
        // agent's final answer) is owned by the antigravity Agent Integration.
        items.push({
          kind: "message",
          role: "agent",
          blockSuffix: `${step}`,
          body: content,
          turnEnd: antigravityRecordIsTurnEnd(record),
        });
      }
      continue;
    }
    // Any other MODEL-sourced typed entry is the preceding call's result.
    const content = stringField(record, "content");
    if (content === undefined || content.length === 0) {
      continue;
    }
    items.push({
      kind: "tool_result",
      role: "agent",
      blockSuffix: `${step}:result`,
      toolName: pendingToolName ?? type ?? "tool",
      body: boundedToolText(content),
    });
    pendingToolName = undefined;
  }
  return items;
}

// USER_INPUT content is wrapped in <USER_REQUEST>…</USER_REQUEST>; show the
// inner prompt text.
export function unwrapAntigravityUserRequest(content: string | undefined): string {
  if (content === undefined) {
    return "";
  }
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  return (match ? match[1] : content).trim();
}
