import { join } from "node:path";

import { readBoundedTail } from "./live-backend-fs.ts";
import {
  claudeAssistantTextContent,
  claudeThinkingText,
  inputTextContentEquals,
  parseJsonObject,
  recordField,
  stringField,
} from "./live-backend-json.ts";
import {
  antigravityConversationItems,
  boundedToolText,
  claudeToolResultItems,
  claudeToolUseItems,
  codexReasoningText,
  codexToolFramePayload,
} from "./provider-history-helpers.ts";
import {
  antigravityConversationIdFromTranscriptPath,
  claudeProviderSessionRefFromTranscriptPath,
  claudeSessionIdFromTranscriptPath,
  codexProviderSessionRefFromRolloutPath,
  codexSessionIdFromRolloutPath,
  type DiscoveredProviderSessionRef,
} from "./provider-session-ref.ts";
import {
  recentClaudeTranscripts,
  recentCodexRollouts,
} from "./recent-provider-files.ts";

// Reads each provider's own on-disk history (codex rollout JSONL, claude transcript
// JSONL, antigravity transcript JSONL) and the hook-signal spool into bounded,
// provider-record frames for the live Agent Session event projector. Each reader is
// concurrency-safe: it reads ONLY the file the hook bound this thread to, never a
// recency-scan fallback that could cross-bind two threads to one session. Pure I/O
// (filesystem -> frames). Extracted from live-backend.ts.

export interface AntigravityProviderHistoryFrame {
  source: "provider_history";
  sourceRef: string;
  payloadKind: "provider_record";
  payload: Record<string, unknown>;
  body: string;
  // True when this frame is the terminal agent message of a turn. Antigravity emits
  // no turn-end hook, so the runtime returns to idle off this transcript signal.
  turnComplete?: boolean;
}

export interface CodexProviderHistoryFrame {
  source: "provider_history";
  sourceRef: string;
  payloadKind: "provider_record";
  payload: Record<string, unknown>;
  body: string;
}

export interface ClaudeProviderHistoryFrame {
  source: "provider_history";
  sourceRef: string;
  payloadKind: "provider_record";
  payload: Record<string, unknown>;
  body: string;
}

export interface ProviderSignalSpoolFrame {
  source: "hook_payload";
  sourceRef: string;
  eventName: string;
  payload: unknown;
}

export function readCodexProviderSessionRefsFromHome(input: {
  homeDir: string;
  sinceMs: number;
  seenKeys: Set<string>;
  expectedUserMessage?: string;
}): DiscoveredProviderSessionRef[] {
  const providerSessionRefs: DiscoveredProviderSessionRef[] = [];
  for (const rolloutPath of recentCodexRollouts(input.homeDir, input.sinceMs)) {
    if (
      input.expectedUserMessage !== undefined &&
      !codexRolloutContainsUserMessage(rolloutPath, input.expectedUserMessage)
    ) {
      continue;
    }
    const frameKey = `codex:${rolloutPath}`;
    if (input.seenKeys.has(frameKey)) {
      continue;
    }
    input.seenKeys.add(frameKey);
    providerSessionRefs.push(codexProviderSessionRefFromRolloutPath(rolloutPath));
  }
  return providerSessionRefs;
}

export function readClaudeProviderSessionRefsFromHome(input: {
  homeDir: string;
  sinceMs: number;
  seenKeys: Set<string>;
  expectedUserMessage?: string;
}): DiscoveredProviderSessionRef[] {
  const providerSessionRefs: DiscoveredProviderSessionRef[] = [];
  for (const transcriptPath of recentClaudeTranscripts(input.homeDir, input.sinceMs)) {
    if (
      input.expectedUserMessage !== undefined &&
      !claudeTranscriptContainsUserMessage(
        transcriptPath,
        input.expectedUserMessage,
      )
    ) {
      continue;
    }
    const frameKey = `claude:${transcriptPath}`;
    if (input.seenKeys.has(frameKey)) {
      continue;
    }
    input.seenKeys.add(frameKey);
    providerSessionRefs.push(
      claudeProviderSessionRefFromTranscriptPath(transcriptPath),
    );
  }
  return providerSessionRefs;
}

export function readCodexProviderHistoryFramesFromHome(input: {
  homeDir: string;
  threadId: string;
  runtimeId: string;
  sinceMs: number;
  seenKeys: Set<string>;
  expectedUserMessage?: string;
  // The rollout THIS thread is bound to (from the hook). When set, read ONLY it so
  // concurrent codex sessions never read each other's rollout.
  boundRolloutPath?: string;
}): CodexProviderHistoryFrame[] {
  const frames: CodexProviderHistoryFrame[] = [];
  // Read ONLY the rollout the hook bound this thread to — no recency-scan fallback,
  // which under concurrency picks another session's (more recent) rollout and binds
  // two threads to one session. Unbound → read nothing; the hook binds within ~1s.
  const rolloutPaths =
    input.boundRolloutPath !== undefined ? [input.boundRolloutPath] : [];
  for (const rolloutPath of rolloutPaths) {
    const sessionId = codexSessionIdFromRolloutPath(rolloutPath);
    const rolloutText = readBoundedTail(rolloutPath, 256 * 1024);
    if (rolloutText === undefined) {
      continue;
    }

    const lines = rolloutText.split(/\r?\n/);
    // Only the reply to the CURRENT turn: emit agent messages that come after the
    // latest occurrence of the expected user message. A codex rollout accumulates
    // the whole session, so without this gate prior turns' replies leak in.
    let latestUserIndex = -1;
    if (input.expectedUserMessage !== undefined) {
      for (let i = 0; i < lines.length; i += 1) {
        const r = parseJsonObject(lines[i]);
        const p = recordField(r, "payload");
        if (r?.type !== "event_msg" || p?.type !== "user_message") {
          continue;
        }
        const content = p.content;
        if (
          stringField(p, "message") === input.expectedUserMessage ||
          (Array.isArray(content) &&
            content.some((item) => inputTextContentEquals(item, input.expectedUserMessage ?? "")))
        ) {
          latestUserIndex = i;
        }
      }
    }
    // Tool calls carry their name on the `function_call`/`custom_tool_call`
    // line; the matching `*_output` line only has the call_id. Track names so a
    // result block can show the same provider-native tool name as its call.
    const toolNameByCallId = new Map<string, string>();
    const pushFrame = (index: number, payload: Record<string, unknown>, body: string): void => {
      const frameKey = `${rolloutPath}:${index}:${payload.type}`;
      if (input.seenKeys.has(frameKey)) {
        return;
      }
      input.seenKeys.add(frameKey);
      frames.push({
        source: "provider_history",
        sourceRef: rolloutPath,
        payloadKind: "provider_record",
        payload,
        body,
      });
    };
    for (let index = 0; index < lines.length; index += 1) {
      if (input.expectedUserMessage !== undefined && index <= latestUserIndex) {
        continue;
      }
      const record = parseJsonObject(lines[index]);
      const payload = recordField(record, "payload");
      if (record?.type === "event_msg") {
        if (payload?.type === "agent_message") {
          const message = stringField(payload, "message");
          if (message === undefined) {
            continue;
          }
          pushFrame(
            index,
            {
              type: "message",
              role: "agent",
              status: "complete",
              blockId: `provider:${input.threadId}:${sessionId}:${index}`,
              body: message,
              sourceRuntimeId: input.runtimeId,
            },
            message,
          );
          continue;
        }
        const reasoning = payload !== undefined ? codexReasoningText(payload) : undefined;
        if (reasoning !== undefined) {
          pushFrame(
            index,
            {
              type: "reasoning",
              role: "reasoning",
              status: "complete",
              blockId: `reasoning:${input.threadId}:${sessionId}:${index}`,
              body: reasoning,
              sourceRuntimeId: input.runtimeId,
            },
            reasoning,
          );
        }
        continue;
      }
      if (record?.type !== "response_item" || payload === undefined) {
        continue;
      }
      const reasoning = codexReasoningText(payload);
      if (reasoning !== undefined) {
        pushFrame(
          index,
          {
            type: "reasoning",
            role: "reasoning",
            status: "complete",
            blockId: `reasoning:${input.threadId}:${sessionId}:${index}`,
            body: reasoning,
            sourceRuntimeId: input.runtimeId,
          },
          reasoning,
        );
        continue;
      }
      const toolFrame = codexToolFramePayload({
        payload,
        threadId: input.threadId,
        sessionId,
        index,
        runtimeId: input.runtimeId,
        toolNameByCallId,
      });
      if (toolFrame !== undefined) {
        pushFrame(index, toolFrame, String(toolFrame.body ?? ""));
      }
    }
  }
  return frames;
}

export function readClaudeProviderHistoryFramesFromHome(input: {
  homeDir: string;
  threadId: string;
  runtimeId: string;
  sinceMs: number;
  seenKeys: Set<string>;
  expectedUserMessage?: string;
  // The transcript THIS thread is bound to (from the hook). When set, read ONLY it
  // so concurrent claude sessions never read each other's transcript.
  boundTranscriptPath?: string;
}): ClaudeProviderHistoryFrame[] {
  const frames: ClaudeProviderHistoryFrame[] = [];
  // Read ONLY the transcript the hook bound this thread to — no recency-scan
  // fallback (it cross-binds concurrent claude sessions to one transcript). Unbound
  // → read nothing; the hook binds within ~1s and the next poll reads it.
  const transcriptPaths =
    input.boundTranscriptPath !== undefined ? [input.boundTranscriptPath] : [];
  for (const transcriptPath of transcriptPaths) {
    const sessionId = claudeSessionIdFromTranscriptPath(transcriptPath);
    const transcriptText = readBoundedTail(transcriptPath, 256 * 1024);
    if (transcriptText === undefined) {
      continue;
    }

    const lines = transcriptText.split(/\r?\n/);
    // Only the reply to the CURRENT turn: emit assistant messages after the latest
    // occurrence of the expected user message (the transcript holds the whole
    // session, so prior turns' replies would otherwise leak in).
    let latestUserIndex = -1;
    if (input.expectedUserMessage !== undefined) {
      for (let i = 0; i < lines.length; i += 1) {
        const r = parseJsonObject(lines[i]);
        if (r?.type !== "user") {
          continue;
        }
        const m = recordField(r, "message");
        if (m?.role !== "user") {
          continue;
        }
        const content = m.content;
        if (
          content === input.expectedUserMessage ||
          (Array.isArray(content) &&
            content.some((item) => inputTextContentEquals(item, input.expectedUserMessage ?? "")))
        ) {
          latestUserIndex = i;
        }
      }
    }
    const toolNameByCallId = new Map<string, string>();
    const pushFrame = (key: string, payload: Record<string, unknown>, body: string): void => {
      const frameKey = `${transcriptPath}:${key}`;
      if (input.seenKeys.has(frameKey)) {
        return;
      }
      input.seenKeys.add(frameKey);
      frames.push({
        source: "provider_history",
        sourceRef: transcriptPath,
        payloadKind: "provider_record",
        payload,
        body,
      });
    };
    for (let index = 0; index < lines.length; index += 1) {
      if (input.expectedUserMessage !== undefined && index <= latestUserIndex) {
        continue;
      }
      const record = parseJsonObject(lines[index]);
      const message = recordField(record, "message");
      const blockId = `provider:${input.threadId}:${sessionId}:${index}`;
      if (record?.type === "assistant" && message?.role === "assistant") {
        // Agent text becomes a message block; tool_use items become tool_call
        // blocks. Both come from the same assistant line, so disambiguate the
        // block ids by call id.
        const thinking = claudeThinkingText(message.content);
        if (thinking !== undefined) {
          pushFrame(
            `${index}:thinking`,
            {
              type: "reasoning",
              role: "reasoning",
              status: "complete",
              blockId: `reasoning:${input.threadId}:${sessionId}:${index}`,
              body: thinking,
              sourceRuntimeId: input.runtimeId,
            },
            thinking,
          );
        }
        const body = claudeAssistantTextContent(message.content);
        if (body !== undefined) {
          pushFrame(
            `${index}:assistant`,
            {
              type: "message",
              role: "agent",
              status: "complete",
              blockId,
              body,
              sourceRuntimeId: input.runtimeId,
            },
            body,
          );
        }
        for (const tool of claudeToolUseItems(message.content)) {
          toolNameByCallId.set(tool.callId, tool.toolName);
          pushFrame(
            `${index}:tool_use:${tool.callId}`,
            {
              type: "tool_call",
              toolName: tool.toolName,
              callId: tool.callId,
              arguments: tool.argumentsText,
              body: boundedToolText(tool.argumentsText),
              status: "complete",
              blockId: `${blockId}:${tool.callId}`,
              sourceRuntimeId: input.runtimeId,
            },
            boundedToolText(tool.argumentsText),
          );
        }
        continue;
      }
      if (record?.type === "user") {
        // Intermediate user turns carry tool_result content; render those as
        // tool_result blocks. Plain user prompts are added locally, not here.
        for (const result of claudeToolResultItems(message?.content)) {
          const toolName = toolNameByCallId.get(result.callId) ?? "tool";
          pushFrame(
            `${index}:tool_result:${result.callId}`,
            {
              type: "tool_result",
              toolName,
              callId: result.callId,
              ok: true,
              output: result.output,
              body: boundedToolText(result.output),
              status: "complete",
              blockId: `${blockId}:${result.callId}`,
              sourceRuntimeId: input.runtimeId,
            },
            boundedToolText(result.output),
          );
        }
      }
    }
  }
  return frames;
}

export function readProviderSignalFramesFromSpool(input: {
  spoolDir: string;
  threadId: string;
  agentId: "codex" | "claude" | "antigravity";
  runtimeId: string;
  seenKeys: Set<string>;
}): ProviderSignalSpoolFrame[] {
  const spoolPath = join(input.spoolDir, `${input.runtimeId}.jsonl`);
  const spoolText = readBoundedTail(spoolPath, 128 * 1024);
  if (spoolText === undefined) {
    return [];
  }

  const frames: ProviderSignalSpoolFrame[] = [];
  const lines = spoolText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const record = parseJsonObject(lines[index]);
    if (record === undefined) {
      continue;
    }
    if (
      stringField(record, "threadId") !== input.threadId ||
      stringField(record, "runtimeId") !== input.runtimeId ||
      stringField(record, "agent") !== input.agentId
    ) {
      continue;
    }
    const eventName = stringField(record, "event");
    if (eventName === undefined) {
      continue;
    }
    const frameKey = `${spoolPath}:${index}`;
    if (input.seenKeys.has(frameKey)) {
      continue;
    }
    input.seenKeys.add(frameKey);
    frames.push({
      source: "hook_payload",
      sourceRef: spoolPath,
      eventName,
      payload: record.payload,
    });
  }
  return frames;
}

export function readAntigravityProviderHistoryFramesFromHome(input: {
  homeDir: string;
  threadId: string;
  runtimeId: string;
  sinceMs: number;
  seenKeys: Set<string>;
  // The transcript THIS thread is bound to (from the hook). When set, read ONLY it
  // so concurrent antigravity sessions never read each other's transcript; the
  // recency scan is just the pre-binding discovery fallback.
  boundTranscriptPath?: string;
}): AntigravityProviderHistoryFrame[] {
  const frames: AntigravityProviderHistoryFrame[] = [];
  // Read ONLY the transcript the hook bound this thread to. No recency-scan
  // fallback: under concurrency the most-recent transcript belongs to ANOTHER
  // session, so scanning cross-binds two threads to one session. If not bound yet,
  // read nothing this cycle — the hook binds within ~1s and the next poll reads it.
  const transcriptPaths =
    input.boundTranscriptPath !== undefined ? [input.boundTranscriptPath] : [];
  for (const transcriptPath of transcriptPaths) {
    const conversationId = antigravityConversationIdFromTranscriptPath(transcriptPath);
    const transcriptText = readBoundedTail(transcriptPath, 128 * 1024);
    if (transcriptText === undefined) {
      continue;
    }

    // The live reader projects agent activity only (user prompts are added
    // locally with local provenance). Tool calls live on PLANNER_RESPONSE
    // entries; their results are the following typed MODEL entries.
    for (const item of antigravityConversationItems(transcriptText, { includeUser: false })) {
      const blockId = `provider:${input.threadId}:${conversationId}:${item.blockSuffix}`;
      const frameKey = `${transcriptPath}:${item.blockSuffix}`;
      if (input.seenKeys.has(frameKey)) {
        continue;
      }
      input.seenKeys.add(frameKey);
      const payload =
        item.kind === "message"
          ? {
              type: "message",
              role: "agent",
              status: "complete",
              blockId,
              body: item.body,
              sourceRuntimeId: input.runtimeId,
            }
          : {
              type: item.kind,
              toolName: item.toolName,
              callId: blockId,
              ...(item.kind === "tool_call" ? { arguments: item.body } : { ok: true, output: item.body }),
              body: item.body,
              status: "complete",
              blockId,
              sourceRuntimeId: input.runtimeId,
            };
      frames.push({
        source: "provider_history",
        sourceRef: transcriptPath,
        payloadKind: "provider_record",
        payload,
        body: item.body,
        ...(item.turnEnd === true ? { turnComplete: true } : {}),
      });
    }
  }

  return frames;
}

// Confirms a codex rollout / claude transcript actually contains the turn's
// expected user message, so session discovery binds the right file (not just the
// most recently touched one). Bounded tail read; pure.
function codexRolloutContainsUserMessage(
  rolloutPath: string,
  expectedUserMessage: string,
): boolean {
  const text = readBoundedTail(rolloutPath, 256 * 1024);
  if (text === undefined) {
    return false;
  }

  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    const payload = recordField(record, "payload");
    if (payload?.type !== "user_message") {
      continue;
    }
    if (stringField(payload, "message") === expectedUserMessage) {
      return true;
    }
    const content = payload.content;
    if (
      Array.isArray(content) &&
      content.some((item) => inputTextContentEquals(item, expectedUserMessage))
    ) {
      return true;
    }
  }
  return false;
}

function claudeTranscriptContainsUserMessage(
  transcriptPath: string,
  expectedUserMessage: string,
): boolean {
  const text = readBoundedTail(transcriptPath, 256 * 1024);
  if (text === undefined) {
    return false;
  }

  for (const line of text.split(/\r?\n/)) {
    const record = parseJsonObject(line);
    if (record?.type !== "user") {
      continue;
    }
    const message = recordField(record, "message");
    if (message?.role !== "user") {
      continue;
    }
    const content = message.content;
    if (content === expectedUserMessage) {
      return true;
    }
    if (
      Array.isArray(content) &&
      content.some((item) => inputTextContentEquals(item, expectedUserMessage))
    ) {
      return true;
    }
  }
  return false;
}
