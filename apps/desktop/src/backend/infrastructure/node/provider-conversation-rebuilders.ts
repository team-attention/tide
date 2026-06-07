import type { AgentSessionBlock } from "../../application/domains/agent-session/agent-session-block.ts";
import type { AgentId } from "../../application/domains/thread/thread.ts";
import type { ThreadStorageRecord } from "../../application/services/thread-persistence-service.ts";
import { readBoundedTail } from "./live-backend-fs.ts";
import {
  claudeAssistantTextContent,
  parseJsonObject,
  recordField,
  stringField,
} from "./live-backend-json.ts";
import {
  antigravityConversationItems,
  boundedToolText,
  claudeToolResultItems,
  claudeToolUseItems,
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
  if (ref.kind === "antigravity_conversation") {
    return rebuildAntigravityConversation(text, record.threadId, ref.value, agentId);
  }
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

export function rebuildAntigravityConversation(
  text: string,
  threadId: string,
  conversationId: string,
  agentId: AgentId,
): AgentSessionBlock[] {
  const timestamp = new Date().toISOString();
  return antigravityConversationItems(text, { includeUser: true }).map((item) => {
    const blockId = `provider:${threadId}:${conversationId}:${item.blockSuffix}`;
    if (item.kind === "message") {
      return conversationBlock({
        threadId,
        sessionId: conversationId,
        index: 0,
        agentId,
        isUser: item.role === "user",
        body: item.body,
        timestamp,
        blockId,
      });
    }
    return toolConversationBlock({
      threadId,
      agentId,
      blockId,
      kind: item.kind,
      toolName: item.toolName ?? "tool",
      callId: blockId,
      body: item.body,
      data: item.kind === "tool_call" ? { arguments: item.body } : { ok: true, output: item.body },
      timestamp,
    });
  });
}
