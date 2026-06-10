import type {
  DiscoveredProviderSessionRef,
  ProviderHistoryConnector,
  ProviderHistoryFrame,
  ProviderHistoryReadInput,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import { antigravityRecordIsTurnEnd } from "./antigravity-transcript-turn-detection.ts";
import {
  boundedToolText,
  numberField,
  parseJsonObject,
  stringField,
  unknownRecord,
} from "../shared/provider-record-json.ts";

// Antigravity's history plane: the conversation transcript under
// ~/.gemini/antigravity-cli/.../<conversation>/.system_generated/logs/transcript.jsonl,
// bound from the runtime-keyed hook payload. Antigravity emits no turn-end hook;
// the terminal PLANNER_RESPONSE record is the turn boundary (turnComplete frame).

export function createAntigravityHistoryConnector(): ProviderHistoryConnector {
  return {
    readFrames: readAntigravityHistoryFrames,
    sessionRefFromHookPayload: antigravitySessionRefFromHookPayload,
  };
}

export function antigravitySessionRefFromHookPayload(
  payload: unknown,
): DiscoveredProviderSessionRef | undefined {
  const record = unknownRecord(payload);
  if (record === undefined) {
    return undefined;
  }
  const transcriptPath =
    stringField(record, "transcript_path") ?? stringField(record, "transcriptPath");
  const conversationId =
    stringField(record, "conversationId") ??
    stringField(record, "conversation_id") ??
    (transcriptPath === undefined
      ? undefined
      : antigravityConversationIdFromTranscriptPath(transcriptPath));
  if (conversationId === undefined) {
    return undefined;
  }
  return {
    agentId: "antigravity",
    kind: "antigravity_conversation",
    value: conversationId,
    transcriptPath,
  };
}

export function antigravityProviderSessionRefFromTranscriptPath(
  transcriptPath: string,
): DiscoveredProviderSessionRef {
  return {
    agentId: "antigravity",
    kind: "antigravity_conversation",
    value: antigravityConversationIdFromTranscriptPath(transcriptPath),
    transcriptPath,
  };
}

export function antigravityConversationIdFromTranscriptPath(
  transcriptPath: string,
): string {
  const normalized = transcriptPath.replace(/\\/g, "/");
  const marker = ".system_generated/logs/transcript.jsonl";
  const prefix = normalized.endsWith(marker)
    ? normalized.slice(0, -marker.length - 1)
    : normalized;
  const parts = prefix.split("/");
  return parts[parts.length - 1] ?? "unknown";
}

export function readAntigravityHistoryFrames(
  input: ProviderHistoryReadInput,
): ProviderHistoryFrame[] {
  const frames: ProviderHistoryFrame[] = [];
  const transcriptPath = input.sessionRef.transcriptPath;
  if (transcriptPath === undefined) {
    return frames;
  }
  const conversationId = input.sessionRef.value;

  // The live reader projects agent activity only (user prompts are added
  // locally with local provenance). Tool calls live on PLANNER_RESPONSE
  // entries; their results are the following typed MODEL entries.
  for (const item of antigravityConversationItems(input.tailText, { includeUser: false })) {
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

  return frames;
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
