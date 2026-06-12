import type { AgentSessionBlock } from "../../application/domains/agent-session/agent-session-block.ts";
import type { AgentId } from "../../application/domains/thread/thread.ts";
import type { ThreadStorageRecord } from "../../application/services/thread/thread-persistence-service.ts";
import { readBoundedTail } from "./live-backend-fs.ts";
import {
  claudeAssistantTextContent,
  claudeThinkingText,
  parseJsonObject,
  recordField,
  stringField,
} from "./live-backend-json.ts";
import {
  boundedToolText,
  claudeToolResultItems,
  claudeToolUseItems,
  codexReasoningText,
  codexToolFramePayload,
  joinTextContent,
} from "./provider-history-helpers.ts";

// Rebuilds an Agent Session (ordered AgentSessionBlocks) from a provider's own
// transcript/rollout history, so reopening a Thread shows its prior conversation
// without starting the runtime. Pure (provider history -> blocks). Extracted from
// live-backend.ts. See docs_v2/specs/agent-session-rendering.md (UC-5 reopen).

export function rebuildConversationFromProviderHistory(
  record: ThreadStorageRecord,
): AgentSessionBlock[] {
  const ref = record.providerSessionRef;
  const filePath = ref?.transcriptPath;
  if (ref === undefined || filePath === undefined) {
    return [];
  }
  const text = readBoundedTail(filePath, 1024 * 1024);
  if (text === undefined) {
    return [];
  }
  const agentId = record.agentBinding.agentId;
  if (ref.kind === "codex_rollout") {
    return rebuildCodexConversation(text, record.threadId, ref.value, agentId);
  }
  if (ref.kind === "claude_transcript") {
    return rebuildClaudeConversation(text, record.threadId, ref.value, agentId);
  }
  if (ref.kind === "gemini_session") {
    return rebuildGeminiConversation(text, record.threadId, ref.value, agentId);
  }
  // opencode_session has no rebuilder yet — opencode is still "coming soon"
  // (disabled in the composer), so no real opencode thread exists to restore.
  // Capture its on-disk session format before adding one (evidence discipline).
  return [];
}

function conversationBlock(input: {
  threadId: string;
  sessionId: string;
  index: number;
  agentId: AgentId;
  isUser: boolean;
  body: string;
  timestamp: string;
  blockId?: string;
}): AgentSessionBlock {
  return {
    blockId: input.blockId ?? `provider:${input.threadId}:${input.sessionId}:${input.index}`,
    threadId: input.threadId,
    agentId: input.agentId,
    kind: input.isUser ? "user_message" : "agent_message",
    role: input.isUser ? "user" : "agent",
    sourceFrameIds: [],
    status: "complete",
    body: input.body,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

function reasoningConversationBlock(input: {
  threadId: string;
  agentId: AgentId;
  blockId: string;
  body: string;
  timestamp: string;
}): AgentSessionBlock {
  return {
    blockId: input.blockId,
    threadId: input.threadId,
    agentId: input.agentId,
    kind: "reasoning",
    role: "reasoning",
    sourceFrameIds: [],
    status: "complete",
    title: "Thinking",
    body: input.body,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

function toolConversationBlock(input: {
  threadId: string;
  agentId: AgentId;
  blockId: string;
  kind: "tool_call" | "tool_result";
  toolName: string;
  callId: string;
  body: string;
  data: Record<string, unknown>;
  timestamp: string;
}): AgentSessionBlock {
  return {
    blockId: input.blockId,
    threadId: input.threadId,
    agentId: input.agentId,
    kind: input.kind,
    role: "tool",
    sourceFrameIds: [],
    status: "complete",
    title: input.toolName,
    body: input.body,
    data: { toolName: input.toolName, callId: input.callId, ...input.data },
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export function rebuildCodexConversation(
  text: string,
  threadId: string,
  sessionId: string,
  agentId: AgentId,
): AgentSessionBlock[] {
  const blocks: AgentSessionBlock[] = [];
  const lines = text.split(/\r?\n/);
  const timestamp = new Date().toISOString();
  const toolNameByCallId = new Map<string, string>();
  for (let index = 0; index < lines.length; index += 1) {
    const record = parseJsonObject(lines[index]);
    const payload = recordField(record, "payload");
    if (record?.type === "event_msg") {
      const isUser = payload?.type === "user_message";
      if (!isUser && payload?.type !== "agent_message") {
        const reasoning = payload !== undefined ? codexReasoningText(payload) : undefined;
        if (reasoning !== undefined) {
          blocks.push(
            reasoningConversationBlock({
              threadId,
              agentId,
              blockId: `reasoning:${threadId}:${sessionId}:${index}`,
              body: reasoning,
              timestamp,
            }),
          );
        }
        continue;
      }
      const body = stringField(payload, "message") ?? (isUser ? joinTextContent(payload?.content) : undefined);
      if (body === undefined || body.length === 0) {
        continue;
      }
      blocks.push(conversationBlock({ threadId, sessionId, index, agentId, isUser, body, timestamp }));
      continue;
    }
    if (record?.type !== "response_item" || payload === undefined) {
      continue;
    }
    const reasoning = codexReasoningText(payload);
    if (reasoning !== undefined) {
      blocks.push(
        reasoningConversationBlock({
          threadId,
          agentId,
          blockId: `reasoning:${threadId}:${sessionId}:${index}`,
          body: reasoning,
          timestamp,
        }),
      );
      continue;
    }
    const toolFrame = codexToolFramePayload({
      payload,
      threadId,
      sessionId,
      index,
      runtimeId: "",
      toolNameByCallId,
    });
    if (toolFrame === undefined) {
      continue;
    }
    blocks.push(
      toolConversationBlock({
        threadId,
        agentId,
        blockId: String(toolFrame.blockId),
        kind: toolFrame.type === "tool_call" ? "tool_call" : "tool_result",
        toolName: String(toolFrame.toolName),
        callId: String(toolFrame.callId),
        body: String(toolFrame.body ?? ""),
        data:
          toolFrame.type === "tool_call"
            ? { arguments: toolFrame.arguments }
            : { ok: true, output: toolFrame.output },
        timestamp,
      }),
    );
  }
  return blocks;
}

export function rebuildClaudeConversation(
  text: string,
  threadId: string,
  sessionId: string,
  agentId: AgentId,
): AgentSessionBlock[] {
  const blocks: AgentSessionBlock[] = [];
  const lines = text.split(/\r?\n/);
  const timestamp = new Date().toISOString();
  const toolNameByCallId = new Map<string, string>();
  for (let index = 0; index < lines.length; index += 1) {
    const record = parseJsonObject(lines[index]);
    const isUser = record?.type === "user";
    if (!isUser && record?.type !== "assistant") {
      continue;
    }
    const message = recordField(record, "message");
    if (message?.role !== (isUser ? "user" : "assistant")) {
      continue;
    }
    const blockId = `provider:${threadId}:${sessionId}:${index}`;
    if (!isUser) {
      const thinking = claudeThinkingText(message.content);
      if (thinking !== undefined) {
        blocks.push(
          reasoningConversationBlock({
            threadId,
            agentId,
            blockId: `reasoning:${threadId}:${sessionId}:${index}`,
            body: thinking,
            timestamp,
          }),
        );
      }
    }
    const body = isUser ? joinTextContent(message.content) : claudeAssistantTextContent(message.content);
    if (body !== undefined && body.length > 0) {
      blocks.push(conversationBlock({ threadId, sessionId, index, agentId, isUser, body, timestamp }));
    }
    if (isUser) {
      for (const result of claudeToolResultItems(message.content)) {
        blocks.push(
          toolConversationBlock({
            threadId,
            agentId,
            blockId: `${blockId}:${result.callId}`,
            kind: "tool_result",
            toolName: toolNameByCallId.get(result.callId) ?? "tool",
            callId: result.callId,
            body: boundedToolText(result.output),
            data: { ok: true, output: result.output },
            timestamp,
          }),
        );
      }
      continue;
    }
    for (const tool of claudeToolUseItems(message.content)) {
      toolNameByCallId.set(tool.callId, tool.toolName);
      blocks.push(
        toolConversationBlock({
          threadId,
          agentId,
          blockId: `${blockId}:${tool.callId}`,
          kind: "tool_call",
          toolName: tool.toolName,
          callId: tool.callId,
          body: boundedToolText(tool.argumentsText),
          data: { arguments: tool.argumentsText },
          timestamp,
        }),
      );
    }
  }
  return blocks;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// A gemini tool call's `result` is an array of {functionResponse:{response:{output}}}
// parts (same shape the live history connector reads). Extract readable output.
function geminiToolResultText(result: unknown): string | undefined {
  if (!Array.isArray(result)) {
    return undefined;
  }
  const parts = result
    .map((part) => {
      const functionResponse = asRecord(asRecord(part)?.functionResponse);
      const response = asRecord(functionResponse?.response);
      return stringField(response ?? {}, "output") ?? joinTextContent(response?.parts);
    })
    .filter((text): text is string => typeof text === "string" && text.length > 0);
  const joined = parts.join("\n");
  return joined.length > 0 ? joined : undefined;
}

// Rebuild a gemini conversation from its session JSONL (~/.gemini/tmp/<project>/
// chats/session-*.jsonl). Record shapes match the live gemini history connector:
// {type:"user",content}, {type:"gemini",content,thoughts,toolCalls}, {type:"error"}.
// Unlike the live reader this walks the WHOLE session (no current-turn anchor) to
// reproduce the full prior conversation on reopen.
export function rebuildGeminiConversation(
  text: string,
  threadId: string,
  sessionId: string,
  agentId: AgentId,
): AgentSessionBlock[] {
  const blocks: AgentSessionBlock[] = [];
  const lines = text.split(/\r?\n/);
  const timestamp = new Date().toISOString();
  for (let index = 0; index < lines.length; index += 1) {
    const record = parseJsonObject(lines[index]);
    if (record === undefined || "$set" in record) {
      continue;
    }
    const recordId = stringField(record, "id") ?? `line-${index}`;
    const blockId = `provider:${threadId}:${sessionId}:${recordId}`;
    if (record.type === "user") {
      const body =
        typeof record.content === "string" ? record.content : joinTextContent(record.content);
      if (body !== undefined && body.length > 0) {
        blocks.push(conversationBlock({ threadId, sessionId, index, agentId, isUser: true, body, timestamp }));
      }
      continue;
    }
    if (record.type !== "gemini") {
      continue;
    }
    const thoughts = Array.isArray(record.thoughts) ? record.thoughts : [];
    const thoughtText = thoughts
      .map((thought) => {
        const t = asRecord(thought);
        const subject = stringField(t ?? {}, "subject");
        const description = stringField(t ?? {}, "description");
        return subject !== undefined && description !== undefined
          ? `${subject}\n${description}`
          : (description ?? subject);
      })
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .join("\n\n");
    if (thoughtText.length > 0) {
      blocks.push(
        reasoningConversationBlock({
          threadId,
          agentId,
          blockId: `reasoning:${threadId}:${sessionId}:${recordId}`,
          body: thoughtText,
          timestamp,
        }),
      );
    }
    const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
    toolCalls.forEach((call, callIndex) => {
      const callRecord = asRecord(call);
      if (callRecord === undefined) {
        return;
      }
      const callId = stringField(callRecord, "id") ?? `${recordId}:call:${callIndex}`;
      const toolName = stringField(callRecord, "name") ?? "tool";
      const argsText = callRecord.args === undefined ? "" : JSON.stringify(callRecord.args);
      blocks.push(
        toolConversationBlock({
          threadId,
          agentId,
          blockId: `${blockId}:call:${callId}`,
          kind: "tool_call",
          toolName,
          callId,
          body: boundedToolText(argsText),
          data: { arguments: argsText },
          timestamp,
        }),
      );
      const output = geminiToolResultText(callRecord.result);
      if (output !== undefined) {
        blocks.push(
          toolConversationBlock({
            threadId,
            agentId,
            blockId: `${blockId}:result:${callId}`,
            kind: "tool_result",
            toolName,
            callId,
            body: boundedToolText(output),
            data: { ok: true, output },
            timestamp,
          }),
        );
      }
    });
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (content.length > 0) {
      blocks.push(conversationBlock({ threadId, sessionId, index, agentId, isUser: false, body: content, timestamp }));
    }
  }
  return blocks;
}

