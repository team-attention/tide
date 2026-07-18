import type { AgentSessionBlock } from "../../../application/domains/agent-session/agent-session-block.ts";
import type { AgentId } from "../../../application/domains/thread/thread.ts";
import type { ThreadStorageRecord } from "../../../application/services/thread/thread-persistence-service.ts";
import { parseOpencodeExportText } from "../../../application/services/provider/provider-session-discovery.ts";
import { readTextFile } from "../live/live-backend-fs.ts";
import { runOpencodeExport } from "./opencode-export-command.ts";
import {
  claudeAssistantTextContent,
  claudeThinkingText,
  parseJsonObject,
  recordField,
  stringField,
} from "../live/live-backend-json.ts";
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
  if (ref?.kind === "opencode_session") {
    return rebuildOpencodeConversationFromCli(ref.value, record.threadId, record.agentBinding.agentId);
  }
  const filePath = ref?.transcriptPath;
  if (ref === undefined || filePath === undefined) {
    return [];
  }
  const text = readTextFile(filePath);
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
  deliveryId?: string;
  providerMessageId?: string;
}): AgentSessionBlock {
  return {
    blockId: input.blockId ?? `provider:${input.threadId}:${input.sessionId}:${input.index}`,
    threadId: input.threadId,
    agentId: input.agentId,
    kind: input.isUser ? "user_message" : "agent_message",
    role: input.isUser ? "user" : "agent",
    sourceFrameIds: [],
    ...(input.isUser && (input.deliveryId !== undefined || input.providerMessageId !== undefined)
      ? {
          localProvenance: {
            kind: "provider_user_message",
            deliveryState: "acknowledged",
            ...(input.deliveryId !== undefined ? { deliveryId: input.deliveryId } : {}),
            ...(input.providerMessageId !== undefined ? { providerMessageId: input.providerMessageId } : {}),
          },
        }
      : {}),
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
      blocks.push(conversationBlock({
        threadId,
        sessionId,
        index,
        agentId,
        isUser,
        body,
        timestamp,
        deliveryId:
          stringField(payload, "clientUserMessageId") ??
          stringField(payload, "client_user_message_id") ??
          stringField(payload, "client_id"),
      }));
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
      blocks.push(conversationBlock({
        threadId,
        sessionId,
        index,
        agentId,
        isUser,
        body,
        timestamp,
        deliveryId: isUser ? stringField(record, "uuid") : undefined,
        providerMessageId: stringField(message, "id"),
      }));
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

export function rebuildOpencodeConversationFromExport(
  text: string,
  threadId: string,
  sessionId: string,
  agentId: AgentId,
): AgentSessionBlock[] {
  const exported = parseOpencodeExportText(text);
  if (exported === undefined) {
    return [
      opencodeImportDiagnosticBlock(
        threadId,
        agentId,
        sessionId,
        "opencode export did not return parseable session JSON.",
      ),
    ];
  }
  const blocks: AgentSessionBlock[] = [];
  for (let messageIndex = 0; messageIndex < exported.messages.length; messageIndex += 1) {
    const message = exported.messages[messageIndex];
    const role = stringField(message.info, "role");
    const timestamp = opencodeTimestamp(message.info);
    for (let partIndex = 0; partIndex < message.parts.length; partIndex += 1) {
      const part = message.parts[partIndex];
      const kind = opencodePartKind(part);
      if (kind === "text") {
        const body = opencodePartText(part);
        if ((role === "user" || role === "assistant") && body !== undefined && body.length > 0) {
          blocks.push(
            conversationBlock({
              threadId,
              sessionId,
              index: messageIndex,
              agentId,
              isUser: role === "user",
              body,
              timestamp,
              blockId: `provider:${threadId}:${sessionId}:${messageIndex}:${partIndex}`,
              providerMessageId: stringField(message.info, "id"),
              deliveryId:
                stringField(message.info, "messageId") ??
                stringField(message.info, "clientMessageId"),
            }),
          );
        }
        continue;
      }
      if (kind === "reasoning") {
        const body = opencodePartText(part);
        if (body !== undefined) {
          blocks.push(
            reasoningConversationBlock({
              threadId,
              agentId,
              blockId: `reasoning:${threadId}:${sessionId}:${messageIndex}:${partIndex}`,
              body,
              timestamp,
            }),
          );
        }
        continue;
      }
      if (kind === "tool") {
        const tool = opencodeToolPart(part);
        blocks.push(
          toolConversationBlock({
            threadId,
            agentId,
            blockId: `tool:${threadId}:${sessionId}:${messageIndex}:${partIndex}`,
            kind: tool.completed ? "tool_result" : "tool_call",
            toolName: tool.name,
            callId: tool.callId,
            body: tool.body,
            data: tool.completed ? { ok: true, output: tool.body } : { arguments: tool.body },
            timestamp,
          }),
        );
        continue;
      }
      if (kind === "step-start" || kind === "step-finish") {
        const useful = opencodePartText(part) ?? opencodeUsefulJson(part);
        if (useful !== undefined) {
          blocks.push(rawConversationBlock({
            threadId,
            agentId,
            blockId: `raw:${threadId}:${sessionId}:${messageIndex}:${partIndex}`,
            title: kind,
            body: useful,
            timestamp,
          }));
        }
        continue;
      }
      blocks.push(rawConversationBlock({
        threadId,
        agentId,
        blockId: `raw:${threadId}:${sessionId}:${messageIndex}:${partIndex}`,
        title: kind ?? "opencode part",
        body: boundedJson(part),
        timestamp,
      }));
    }
  }
  return blocks;
}

export function rebuildOpencodeConversationFromCli(
  sessionId: string,
  threadId: string,
  agentId: AgentId,
): AgentSessionBlock[] {
  const exported = runOpencodeExport(sessionId);
  if (exported === undefined) {
    return [
      opencodeImportDiagnosticBlock(
        threadId,
        agentId,
        sessionId,
        "opencode export failed; Tide could not import this local session history.",
      ),
    ];
  }
  return rebuildOpencodeConversationFromExport(exported, threadId, sessionId, agentId);
}

export function opencodeImportDiagnosticBlock(
  threadId: string,
  agentId: AgentId,
  sessionId: string,
  message: string,
): AgentSessionBlock {
  const timestamp = new Date().toISOString();
  return {
    blockId: `opencode-import-diagnostic:${threadId}:${sessionId}`,
    threadId,
    agentId,
    kind: "raw_block",
    role: "runtime",
    sourceFrameIds: [],
    status: "failed",
    title: "opencode import",
    body: message,
    rawFallback: message,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function rawConversationBlock(input: {
  threadId: string;
  agentId: AgentId;
  blockId: string;
  title: string;
  body: string;
  timestamp: string;
}): AgentSessionBlock {
  return {
    blockId: input.blockId,
    threadId: input.threadId,
    agentId: input.agentId,
    kind: "raw_block",
    role: "runtime",
    sourceFrameIds: [],
    status: "complete",
    title: input.title,
    body: input.body,
    rawFallback: input.body,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

function opencodePartKind(part: Record<string, unknown>): string | undefined {
  return stringField(part, "type") ?? stringField(part, "kind");
}

function opencodePartText(part: Record<string, unknown>): string | undefined {
  return stringField(part, "text") ??
    stringField(part, "content") ??
    stringField(part, "message") ??
    stringField(part, "reasoning");
}

function opencodeToolPart(part: Record<string, unknown>): {
  name: string;
  callId: string;
  completed: boolean;
  body: string;
} {
  const state = stringField(part, "state") ?? stringField(part, "status");
  const name =
    stringField(part, "tool") ??
    stringField(part, "name") ??
    stringField(recordField(part, "tool"), "name") ??
    "tool";
  const callId = stringField(part, "id") ?? stringField(part, "callID") ?? stringField(part, "callId") ?? name;
  const body =
    opencodePartText(part) ??
    stringField(part, "output") ??
    stringField(part, "input") ??
    boundedJson(part);
  return {
    name,
    callId,
    completed: state === "completed" || state === "complete" || part.output !== undefined,
    body: boundedToolText(body),
  };
}

function opencodeUsefulJson(part: Record<string, unknown>): string | undefined {
  if (part.usage === undefined && part.finish === undefined && part.error === undefined) {
    return undefined;
  }
  return boundedJson(part);
}

function opencodeTimestamp(info: Record<string, unknown>): string {
  const time = recordField(info, "time");
  const created = numberField(time, "created") ?? numberField(info, "created");
  if (created === undefined) {
    return new Date().toISOString();
  }
  const ms = created < 10_000_000_000 ? created * 1000 : created;
  return new Date(ms).toISOString();
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return text.length > 8_000 ? `${text.slice(0, 8_000)}\n… truncated …` : text;
}
