import { join } from "node:path";

import type { ProviderCliAgentId } from "../../application/domains/thread/thread.ts";
import { readBoundedTail } from "./live-backend-fs.ts";
import {
  inputTextContentEquals,
  parseJsonObject,
  recordField,
  stringField,
} from "./live-backend-json.ts";
import {
  claudeProviderSessionRefFromTranscriptPath,
  codexProviderSessionRefFromRolloutPath,
  type DiscoveredProviderSessionRef,
} from "./provider-session-ref.ts";
import {
  recentClaudeTranscripts,
  recentCodexRollouts,
} from "./recent-provider-files.ts";

// Reads the Tide hook-signal spool into runtime-keyed frames, plus the
// ADOPTION-time provider session discovery (find sessions Tide never ran, to
// import them as threads). The LIVE per-provider history readers live in each
// provider's Agent Integration (ProviderHistoryConnector) — see
// docs_v2/specs/provider-history-connector.md.

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

export function readProviderSignalFramesFromSpool(input: {
  spoolDir: string;
  threadId: string;
  agentId: ProviderCliAgentId;
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

// Confirms a codex rollout / claude transcript actually contains the turn's
// expected user message, so ADOPTION-time discovery binds the right file (not
// just the most recently touched one). Bounded tail read; pure.
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
