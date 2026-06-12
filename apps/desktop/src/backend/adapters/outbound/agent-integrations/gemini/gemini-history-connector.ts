import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import type {
  DiscoveredProviderSessionRef,
  ProviderHistoryConnector,
  ProviderHistoryFrame,
  ProviderHistoryReadInput,
} from "../../../../application/ports/outbound/agent-integration-port.ts";
import {
  boundedToolText,
  joinTextContent,
  parseJsonObject,
  stringField,
  unknownRecord,
} from "../shared/provider-record-json.ts";

// Gemini's history plane: the session JSONL under
// ~/.gemini/tmp/<project>/chats/session-<ts>-<uuid8>.jsonl. Tide mints the session
// id at launch (`--session-id <uuid>`), so binding is deterministic: the launch
// plan carries the ref (value = uuid) and the on-disk file is located by that id
// — never by recency. Gemini hooks additionally confirm the path (every hook
// payload carries session_id + transcript_path).
//
// Record shapes (verified against gemini-cli 0.46 session files):
//   {sessionId, projectHash, startTime, …}                      — header line
//   {"$set": {…}}                                               — patch line (skipped)
//   {type:"user", content: string | [{text}]}                   — user prompt
//   {type:"gemini", content, thoughts:[{subject,description}],
//    toolCalls:[{id,name,args,result:[{functionResponse}]}]}    — model step
//   {type:"error"|"info", content}                              — notices

// Locates the on-disk session file for a minted session id. Injected from the
// infrastructure wiring (the connector itself stays pure).
export type GeminiSessionFileLocator = (sessionId: string) => string | undefined;

export function createGeminiHistoryConnector(input: {
  locateSessionFile: GeminiSessionFileLocator;
}): ProviderHistoryConnector {
  return {
    resolveSessionRef: (assignedSessionRef) => {
      if (assignedSessionRef.transcriptPath !== undefined) {
        return assignedSessionRef;
      }
      const transcriptPath = input.locateSessionFile(assignedSessionRef.value);
      if (transcriptPath === undefined) {
        return undefined;
      }
      return { ...assignedSessionRef, transcriptPath };
    },
    readFrames: readGeminiHistoryFrames,
    sessionRefFromHookPayload: geminiSessionRefFromHookPayload,
  };
}

export function geminiSessionRefFromHookPayload(
  payload: unknown,
): DiscoveredProviderSessionRef | undefined {
  const record = unknownRecord(payload);
  if (record === undefined) {
    return undefined;
  }
  const transcriptPath =
    stringField(record, "transcript_path") ?? stringField(record, "transcriptPath");
  const sessionId = stringField(record, "session_id") ?? stringField(record, "sessionId");
  if (sessionId === undefined) {
    return undefined;
  }
  return {
    agentId: "gemini",
    kind: "gemini_session",
    value: sessionId,
    transcriptPath,
  };
}

function geminiUserRecordMatches(
  record: Record<string, unknown>,
  expectedUserMessage: string,
): boolean {
  if (record.type !== "user") {
    return false;
  }
  const content = record.content;
  if (typeof content === "string") {
    return content === expectedUserMessage;
  }
  return joinTextContent(content) === expectedUserMessage;
}

export function readGeminiHistoryFrames(
  input: ProviderHistoryReadInput,
): ProviderHistoryFrame[] {
  // The session file holds the whole session; without the current turn's anchor,
  // prior turns' replies would leak in. No anchor → no frames.
  if (input.expectedUserMessage === undefined) {
    return [];
  }
  const frames: ProviderHistoryFrame[] = [];
  const sessionPath = input.sessionRef.transcriptPath;
  if (sessionPath === undefined) {
    return frames;
  }
  const sessionId = input.sessionRef.value;
  const lines = input.tailText.split(/\r?\n/);

  // Only the reply to the CURRENT turn: emit model records after the latest
  // occurrence of the expected user message.
  let latestUserIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const record = parseJsonObject(lines[i] ?? "");
    if (record !== undefined && geminiUserRecordMatches(record, input.expectedUserMessage)) {
      latestUserIndex = i;
    }
  }
  if (latestUserIndex < 0) {
    return frames;
  }

  // Gemini RE-APPENDS a record (same `id`) as its content accumulates while the
  // turn streams (thoughts first, then toolCalls, then content — verified live).
  // So frames are keyed by RECORD ID, never by line index: an updated copy emits
  // a fresh frame whose blockId is the same, and the reader UPSERTS the existing
  // block instead of rendering a duplicate.
  const pushFrame = (
    seenKey: string,
    payload: Record<string, unknown>,
    body: string,
  ): void => {
    const frameKey = `${sessionPath}:${seenKey}`;
    if (input.seenKeys.has(frameKey)) {
      return;
    }
    input.seenKeys.add(frameKey);
    frames.push({
      source: "provider_history",
      sourceRef: sessionPath,
      payloadKind: "provider_record",
      payload,
      body,
    });
  };

  for (let index = latestUserIndex + 1; index < lines.length; index += 1) {
    const record = parseJsonObject(lines[index] ?? "");
    if (record === undefined || "$set" in record) {
      continue;
    }
    const recordId = stringField(record, "id") ?? `line-${index}`;
    const blockId = `provider:${input.threadId}:${sessionId}:${recordId}`;
    if (record.type === "gemini") {
      // thoughts → reasoning, toolCalls → tool_call + tool_result, content → message.
      const thoughts = Array.isArray(record.thoughts) ? record.thoughts : [];
      const thoughtText = thoughts
        .map((thought) => {
          const t = unknownRecord(thought);
          const subject = stringField(t, "subject");
          const description = stringField(t, "description");
          return subject !== undefined && description !== undefined
            ? `${subject}\n${description}`
            : (description ?? subject);
        })
        .filter((text): text is string => typeof text === "string" && text.length > 0)
        .join("\n\n");
      if (thoughtText.length > 0) {
        pushFrame(
          `${recordId}:thoughts:${hashText(thoughtText)}`,
          {
            type: "reasoning",
            role: "reasoning",
            status: "complete",
            blockId: `reasoning:${input.threadId}:${sessionId}:${recordId}`,
            body: thoughtText,
            sourceRuntimeId: input.runtimeId,
          },
          thoughtText,
        );
      }
      const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
      toolCalls.forEach((call, callIndex) => {
        const callRecord = unknownRecord(call);
        if (callRecord === undefined) {
          return;
        }
        const callId = stringField(callRecord, "id") ?? `${recordId}:call:${callIndex}`;
        const toolName = stringField(callRecord, "name") ?? "tool";
        const argsText =
          callRecord.args === undefined ? "" : JSON.stringify(callRecord.args);
        pushFrame(
          `${recordId}:tool_call:${callId}:${hashText(argsText)}`,
          {
            type: "tool_call",
            toolName,
            callId,
            arguments: argsText,
            body: boundedToolText(argsText),
            status: "complete",
            blockId: `${blockId}:call:${callId}`,
            sourceRuntimeId: input.runtimeId,
          },
          boundedToolText(argsText),
        );
        const output = geminiToolResultText(callRecord.result);
        if (output !== undefined) {
          pushFrame(
            `${recordId}:tool_result:${callId}:${hashText(output)}`,
            {
              type: "tool_result",
              toolName,
              callId,
              ok: true,
              output,
              body: boundedToolText(output),
              status: "complete",
              blockId: `${blockId}:result:${callId}`,
              sourceRuntimeId: input.runtimeId,
            },
            boundedToolText(output),
          );
        }
      });
      const content = typeof record.content === "string" ? record.content.trim() : "";
      if (content.length > 0) {
        pushFrame(
          `${recordId}:message:${hashText(content)}`,
          {
            type: "message",
            role: "agent",
            status: "complete",
            blockId,
            body: content,
            sourceRuntimeId: input.runtimeId,
          },
          content,
        );
      }
      continue;
    }
    if (record.type === "error") {
      const content = typeof record.content === "string" ? record.content.trim() : "";
      if (content.length > 0) {
        pushFrame(
          `${recordId}:error:${hashText(content)}`,
          {
            type: "notice",
            status: "failed",
            blockId,
            body: content,
            sourceRuntimeId: input.runtimeId,
          },
          content,
        );
      }
    }
  }
  return frames;
}

function hashText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

// A gemini tool call's `result` is an array of {functionResponse:{response:{output}}}
// parts; extract readable output text.
function geminiToolResultText(result: unknown): string | undefined {
  if (!Array.isArray(result)) {
    return undefined;
  }
  const parts = result
    .map((part) => {
      const functionResponse = unknownRecord(unknownRecord(part)?.functionResponse);
      const response = unknownRecord(functionResponse?.response);
      return stringField(response ?? {}, "output") ?? joinTextContent(response?.parts);
    })
    .filter((text): text is string => typeof text === "string" && text.length > 0);
  const joined = parts.join("\n");
  return joined.length > 0 ? joined : undefined;
}

// Relocated from infrastructure (audit A5/5.2).
export function locateGeminiSessionFile(
  homeDir: string,
  sessionId: string,
): string | undefined {
  const tmpRoot = join(homeDir, ".gemini", "tmp");
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(tmpRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  const idFragment = sessionId.slice(0, 8);
  for (const project of projectDirs) {
    const chatsDir = join(tmpRoot, project, "chats");
    let names: string[];
    try {
      names = readdirSync(chatsDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("session-") || !/\.jsonl?$/.test(name)) {
        continue;
      }
      // The filename embeds the first 8 chars of the session id; the header line
      // carries the full id. Both must match.
      if (!name.includes(idFragment)) {
        continue;
      }
      const path = join(chatsDir, name);
      try {
        const headerLine = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
        const header = JSON.parse(headerLine) as Record<string, unknown>;
        if (header.sessionId === sessionId) {
          return path;
        }
      } catch {
        // Skip unreadable/partial files; the next poll retries.
      }
    }
  }
  return undefined;
}
