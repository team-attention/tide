import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
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

// Claude's history plane: the transcript JSONL under
// ~/.claude/projects/<munged-cwd>/<session-id>.jsonl. The session id is minted by
// Tide at launch (`--session-id`), so the transcript path is known at plan time;
// the Stop/Notification hooks carry the same id and confirm it.

export function createClaudeHistoryConnector(input?: {
  // Locates the on-disk transcript for a minted session id (deterministic — by
  // id, never by recency). Claude munges its OWN canonical cwd into the project
  // directory name, so the path cannot be guessed from Tide's cwd spelling.
  locateSessionFile?: (sessionId: string) => string | undefined;
}): ProviderHistoryConnector {
  const locateSessionFile = input?.locateSessionFile;
  return {
    ...(locateSessionFile !== undefined
      ? {
          resolveSessionRef: (assignedSessionRef) => {
            if (assignedSessionRef.transcriptPath !== undefined) {
              return assignedSessionRef;
            }
            const transcriptPath = locateSessionFile(assignedSessionRef.value);
            if (transcriptPath === undefined) {
              return undefined;
            }
            return { ...assignedSessionRef, transcriptPath };
          },
        }
      : {}),
    readFrames: readClaudeHistoryFrames,
    sessionRefFromHookPayload: claudeSessionRefFromHookPayload,
  };
}

export function claudeSessionRefFromHookPayload(
  payload: unknown,
): DiscoveredProviderSessionRef | undefined {
  const record = unknownRecord(payload);
  if (record === undefined) {
    return undefined;
  }
  const transcriptPath =
    stringField(record, "transcript_path") ?? stringField(record, "transcriptPath");
  const sessionId =
    stringField(record, "session_id") ??
    stringField(record, "sessionId") ??
    (transcriptPath === undefined
      ? undefined
      : claudeSessionIdFromTranscriptPath(transcriptPath));
  if (sessionId === undefined) {
    return undefined;
  }
  return {
    agentId: "claude",
    kind: "claude_transcript",
    value: sessionId,
    transcriptPath,
  };
}

export function claudeProviderSessionRefFromTranscriptPath(
  transcriptPath: string,
): DiscoveredProviderSessionRef {
  return {
    agentId: "claude",
    kind: "claude_transcript",
    value: claudeSessionIdFromTranscriptPath(transcriptPath),
    transcriptPath,
  };
}

export function claudeSessionIdFromTranscriptPath(transcriptPath: string): string {
  const name = transcriptPath.split(/[\\/]/).pop() ?? transcriptPath;
  return name.replace(/\.jsonl$/, "");
}

// Claude Code stores a project's transcripts in a directory named after the cwd
// with every path separator / dot replaced by "-". Must match claude's own
// munging exactly so the plan-time transcript path is correct.
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

// Extracts the text content of a claude assistant message (string or text parts).
function claudeAssistantTextContent(content: unknown): string | undefined {
  if (typeof content === "string" && content.length > 0) {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textParts = content
    .map((item) => stringField(unknownRecord(item), "text"))
    .filter((text): text is string => text !== undefined);
  return textParts.length > 0 ? textParts.join("\n") : undefined;
}

// Extended-thinking content from a claude assistant message: content items of
// type "thinking" carry a `thinking` field (not `text`). Returns the joined
// thinking text, or undefined when the turn has no thinking content.
function claudeThinkingText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const item of content) {
    const record = unknownRecord(item);
    if (record?.type !== "thinking") {
      continue;
    }
    const text = stringField(record, "thinking") ?? stringField(record, "text");
    if (text !== undefined && text.trim().length > 0) {
      parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
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

export function readClaudeHistoryFrames(
  input: ProviderHistoryReadInput,
): ProviderHistoryFrame[] {
  // The transcript holds the whole session; without the current turn's anchor,
  // prior turns' replies would leak in. No anchor → no frames.
  if (input.expectedUserMessage === undefined) {
    return [];
  }
  const frames: ProviderHistoryFrame[] = [];
  const transcriptPath = input.sessionRef.transcriptPath;
  if (transcriptPath === undefined) {
    return frames;
  }
  const sessionId = input.sessionRef.value;
  const lines = input.tailText.split(/\r?\n/);

  // Only the reply to the CURRENT turn: emit assistant messages after the latest
  // occurrence of the expected user message.
  let latestUserIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const r = parseJsonObject(lines[i] ?? "");
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
    if (index <= latestUserIndex) {
      continue;
    }
    const record = parseJsonObject(lines[index] ?? "");
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
  return frames;
}

// Relocated from infrastructure (audit A5/5.2): provider home-path knowledge
// belongs to the adapter that owns the format.
export function claudeProjectTranscriptsDir(homeDir: string, cwd: string): string {
  return join(homeDir, ".claude", "projects", claudeProjectDirName(cwd));
}

// Locates the on-disk gemini session file for a Tide-minted session id:
// ~/.gemini/tmp/<project>/chats/session-<ts>-<uuid8>.jsonl whose header line
// carries the full sessionId. Deterministic — keyed by the assigned id, never by
// recency — so concurrent same-prompt threads can never swap sessions.
// Locates the on-disk claude transcript for a Tide-minted session id:
// ~/.claude/projects/<munged-cwd>/<session-id>.jsonl. Deterministic — keyed by
// the assigned id (the filename IS the id), never by recency. The project dir is
// scanned because claude munges its OWN canonical cwd, which can differ from
// Tide's spelling via symlinks (/var -> /private/var) or casing.
export function locateClaudeTranscriptFile(
  homeDir: string,
  sessionId: string,
): string | undefined {
  const projectsRoot = join(homeDir, ".claude", "projects");
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  for (const project of projectDirs) {
    const candidate = join(projectsRoot, project, `${sessionId}.jsonl`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
