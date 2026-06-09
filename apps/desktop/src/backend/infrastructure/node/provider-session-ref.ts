import { basename, join } from "node:path";

import type { ProviderSessionRefRecord } from "../../application/services/thread-persistence-service.ts";
import type { ProviderCliAgentId } from "../../application/domains/thread/thread.ts";
import { stringField, unknownRecord } from "./live-backend-json.ts";

// Derives a provider-owned session reference (codex rollout id / claude transcript
// id / antigravity conversation id) from a transcript path or a provider signal
// payload. Pure path/id parsing. Extracted from live-backend.ts.

export type DiscoveredProviderSessionRef = Omit<ProviderSessionRefRecord, "observedAt">;

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

export function providerSessionRefFromProviderSignalPayload(
  agentId: ProviderCliAgentId,
  payload: unknown,
): DiscoveredProviderSessionRef | undefined {
  const record = unknownRecord(payload);
  if (record === undefined) {
    return undefined;
  }

  const transcriptPath =
    stringField(record, "transcript_path") ?? stringField(record, "transcriptPath");
  if (agentId === "codex") {
    const sessionId =
      stringField(record, "session_id") ??
      stringField(record, "sessionId") ??
      (transcriptPath === undefined
        ? undefined
        : codexSessionIdFromRolloutPath(transcriptPath));
    return sessionId === undefined
      ? undefined
      : {
          agentId: "codex",
          kind: "codex_rollout",
          value: sessionId,
          transcriptPath,
        };
  }

  if (agentId === "claude") {
    const sessionId =
      stringField(record, "session_id") ??
      stringField(record, "sessionId") ??
      (transcriptPath === undefined
        ? undefined
        : claudeSessionIdFromTranscriptPath(transcriptPath));
    return sessionId === undefined
      ? undefined
      : {
          agentId: "claude",
          kind: "claude_transcript",
          value: sessionId,
          transcriptPath,
        };
  }

  const conversationId =
    stringField(record, "conversationId") ??
    stringField(record, "conversation_id") ??
    (transcriptPath === undefined
      ? undefined
      : antigravityConversationIdFromTranscriptPath(transcriptPath));
  return conversationId === undefined
    ? undefined
    : {
        agentId: "antigravity",
        kind: "antigravity_conversation",
        value: conversationId,
        transcriptPath,
      };
}

export function antigravityConversationIdFromTranscriptPath(
  transcriptPath: string,
): string {
  const marker = `${join(".system_generated", "logs", "transcript.jsonl")}`;
  const prefix = transcriptPath.endsWith(marker)
    ? transcriptPath.slice(0, -marker.length - 1)
    : transcriptPath;
  const parts = prefix.split(/[\\/]/);
  return parts[parts.length - 1] ?? "unknown";
}

export function codexSessionIdFromRolloutPath(rolloutPath: string): string {
  const name = basename(rolloutPath);
  const match = name.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/);
  if (match?.[1] !== undefined) {
    return match[1];
  }
  return name.replace(/^rollout-/, "").replace(/\.jsonl$/, "");
}

export function claudeSessionIdFromTranscriptPath(transcriptPath: string): string {
  return basename(transcriptPath).replace(/\.jsonl$/, "");
}
