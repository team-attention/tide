import { readBoundedTail } from "../live/live-backend-fs.ts";
import {
  inputTextContentEquals,
  parseJsonObject,
  recordField,
  stringField,
} from "../live/live-backend-json.ts";
import {
  claudeProviderSessionRefFromTranscriptPath,
  codexProviderSessionRefFromRolloutPath,
  type DiscoveredProviderSessionRef,
} from "./provider-session-ref.ts";
import {
  recentClaudeTranscripts,
  recentCodexRollouts,
} from "./recent-provider-files.ts";

// ADOPTION-time provider session discovery: find codex/claude sessions Tide never
// ran (to import them as threads), confirming each file by the turn's expected user
// message rather than recency. The LIVE per-provider history readers live in each
// provider's Agent Integration (ProviderHistoryConnector) — see
// docs_v2/specs/provider-history-connector.md.

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
