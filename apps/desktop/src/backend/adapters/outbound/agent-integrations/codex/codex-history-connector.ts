import type {
  DiscoveredProviderSessionRef,
  ProviderHistoryConnector,
  ProviderHistoryFrame,
  ProviderHistoryReadInput,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import {
  boundedToolText,
  inputTextContentEquals,
  joinTextContent,
  parseJsonObject,
  recordField,
  stringField,
  unknownRecord,
} from "../shared/provider-record-json.ts";

// Codex's history plane: the rollout JSONL this runtime is bound to (binding
// arrives from the runtime-keyed hook payload's rollout path; codex has no
// assignable session id). Parses event_msg/response_item records into
// message / reasoning / tool frames for the current turn.

export function createCodexHistoryConnector(): ProviderHistoryConnector {
  return {
    readFrames: readCodexHistoryFrames,
    sessionRefFromHookPayload: codexSessionRefFromHookPayload,
  };
}

export function codexSessionRefFromHookPayload(
  payload: unknown,
): DiscoveredProviderSessionRef | undefined {
  const record = unknownRecord(payload);
  if (record === undefined) {
    return undefined;
  }
  const transcriptPath =
    stringField(record, "rollout_path") ??
    stringField(record, "transcript_path") ??
    stringField(record, "transcriptPath");
  const sessionId =
    stringField(record, "session_id") ??
    stringField(record, "sessionId") ??
    (transcriptPath === undefined
      ? undefined
      : codexSessionIdFromRolloutPath(transcriptPath));
  if (sessionId === undefined) {
    return undefined;
  }
  return {
    agentId: "codex",
    kind: "codex_rollout",
    value: sessionId,
    transcriptPath,
  };
}

export function codexProviderSessionRefFromRolloutPath(
  rolloutPath: string,
): DiscoveredProviderSessionRef {
  return {
    agentId: "codex",
    kind: "codex_rollout",
    value: codexSessionIdFromRolloutPath(rolloutPath),
    transcriptPath: rolloutPath,
  };
}

export function codexSessionIdFromRolloutPath(rolloutPath: string): string {
  const name = rolloutPath.split(/[\\/]/).pop() ?? rolloutPath;
  const match = name.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/);
  if (match?.[1] !== undefined) {
    return match[1];
  }
  return name.replace(/^rollout-/, "").replace(/\.jsonl$/, "");
}

export function readCodexHistoryFrames(
  input: ProviderHistoryReadInput,
): ProviderHistoryFrame[] {
  // A codex rollout accumulates the whole session; without the current turn's
  // user-message anchor, prior turns' replies would leak in. No anchor → no frames.
  if (input.expectedUserMessage === undefined) {
    return [];
  }
  const frames: ProviderHistoryFrame[] = [];
  const rolloutPath = input.sessionRef.transcriptPath;
  if (rolloutPath === undefined) {
    return frames;
  }
  const sessionId = input.sessionRef.value;
  const lines = input.tailText.split(/\r?\n/);

  // Only the reply to the CURRENT turn: emit agent records that come after the
  // latest occurrence of the expected user message.
  let latestUserIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const r = parseJsonObject(lines[i] ?? "");
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

  // Tool calls carry their name on the `function_call`/`custom_tool_call` line;
  // the matching `*_output` line only has the call_id. Track names so a result
  // block shows the same provider-native tool name as its call.
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
    if (index <= latestUserIndex) {
      continue;
    }
    const record = parseJsonObject(lines[index] ?? "");
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
  return frames;
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
    const value = payload[key];
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
