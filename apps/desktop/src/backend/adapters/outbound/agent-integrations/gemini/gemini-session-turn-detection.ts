import type { AgentTurnOutcome } from "../../../../application/ports/outbound/agent-integration-port.ts";

// Gemini turn-end detection from its session JSONL
// (~/.gemini/tmp/<cwd-slug>/chats/session-*.jsonl). Gemini writes the same shape as
// the other providers' transcripts: a `{type:"user", content:[{text}]}` record for
// the prompt and a `{type:"gemini", content:"<answer>"}` record for the model's
// reply. The latest `gemini` record after the current turn's user message IS the
// final answer = the turn end. This is gemini's lifecycle knowledge and lives in the
// gemini Agent Integration. See docs_v2/specs/gemini-agent-integration.md.

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
  if (Array.isArray(content)) {
    return content.some(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).text === expectedUserMessage,
    );
  }
  return false;
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
    if (record?.type === "gemini" && typeof record.content === "string") {
      const finalMessage = record.content.trim();
      if (finalMessage.length > 0) {
        return { finalMessage };
      }
    }
  }
  return null;
}
