import type { AgentTurnOutcome } from "../../../../application/ports/outbound/agent-integration-port.ts";
import { joinTextContent, parseJsonObject } from "../shared/provider-record-json.ts";

// Gemini turn-end detection from its session JSONL — the adapter-internal
// FALLBACK behind the AfterAgent hook (the authoritative turn-end signal; see
// gemini-agent-integration). Settle-only: content renders exclusively via the
// gemini history frame reader (single content source), so this never returns a
// finalMessage.
//
// Turn boundary rule (mirrors antigravity): a `gemini` record carrying visible
// content and NO toolCalls is the final answer of a turn. A mid-turn model step
// (toolCalls present) must not settle the turn early.

function geminiUserRecordMatches(
  record: Record<string, unknown> | undefined,
  expectedUserMessage: string,
): boolean {
  if (record?.type !== "user") {
    return false;
  }
  const content = record.content;
  if (typeof content === "string") {
    return content === expectedUserMessage;
  }
  return joinTextContent(content) === expectedUserMessage;
}

export function geminiTurnOutcomeFromSession(
  sessionTailText: string,
  expectedUserMessage: string | undefined,
): AgentTurnOutcome | null {
  const lines = sessionTailText.split(/\r?\n/);

  // Honored-once guard: locate the latest occurrence of this turn's user message so a
  // prior turn's answer can't settle the current turn early.
  let latestUserIndex = -1;
  if (expectedUserMessage !== undefined) {
    for (let i = 0; i < lines.length; i += 1) {
      if (geminiUserRecordMatches(parseJsonObject(lines[i] ?? ""), expectedUserMessage)) {
        latestUserIndex = i;
      }
    }
    if (latestUserIndex < 0) {
      return null;
    }
  }

  for (let i = lines.length - 1; i > latestUserIndex; i -= 1) {
    const record = parseJsonObject(lines[i] ?? "");
    if (record?.type !== "gemini") {
      continue;
    }
    const toolCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
    if (toolCalls.length > 0) {
      // Mid-turn model step — the turn is still running.
      return null;
    }
    if (typeof record.content === "string" && record.content.trim().length > 0) {
      // Final answer record. Content renders via the history reader; only settle.
      return {};
    }
  }
  return null;
}
