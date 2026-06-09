import type { AgentTurnOutcome } from "../../../../application/ports/outbound/agent-integration-port.ts";

// Claude turn-end detection from its transcript JSONL. Like codex (rollout
// task_complete) and antigravity (terminal PLANNER_RESPONSE), claude marks the end of
// a turn IN ITS OWN HISTORY: the assistant message that finishes a turn has
// `stop_reason: "end_turn"` (mid-turn assistant messages that call tools have
// `stop_reason: "tool_use"`). The final answer text lives in that same message, so the
// transcript is the single source — the content reader extracts the answer; this only
// signals that the turn ended. No hook, no finalMessage, no dedup.

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(line);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function claudeUserRecordMatches(
  record: Record<string, unknown> | undefined,
  expectedUserMessage: string,
): boolean {
  const message = record?.message;
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }
  if ((message as Record<string, unknown>).role !== "user") {
    return false;
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") {
    return content === expectedUserMessage;
  }
  if (Array.isArray(content)) {
    return content.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).type === "text" &&
        (item as Record<string, unknown>).text === expectedUserMessage,
    );
  }
  return false;
}

function claudeAssistantStopReason(
  record: Record<string, unknown> | undefined,
): string | undefined {
  const message = record?.message;
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return undefined;
  }
  const m = message as Record<string, unknown>;
  if (m.role !== "assistant") {
    return undefined;
  }
  return typeof m.stop_reason === "string" ? m.stop_reason : undefined;
}

export function claudeTurnOutcomeFromTranscript(
  transcriptTailText: string,
  expectedUserMessage: string | undefined,
): AgentTurnOutcome | null {
  const lines = transcriptTailText.split(/\r?\n/);

  // Scope to the current turn: only an `end_turn` AFTER this turn's user message ends
  // it, so a previous turn's end can't settle the current one early.
  let latestUserIndex = -1;
  if (expectedUserMessage !== undefined) {
    for (let i = 0; i < lines.length; i += 1) {
      if (claudeUserRecordMatches(parseJsonObject(lines[i] ?? ""), expectedUserMessage)) {
        latestUserIndex = i;
      }
    }
    if (latestUserIndex < 0) {
      return null;
    }
  }

  for (let i = lines.length - 1; i > latestUserIndex; i -= 1) {
    if (claudeAssistantStopReason(parseJsonObject(lines[i] ?? "")) === "end_turn") {
      // Turn ended. The answer is rendered from the transcript by the content reader;
      // the outcome carries no message (single source).
      return {};
    }
  }
  return null;
}
