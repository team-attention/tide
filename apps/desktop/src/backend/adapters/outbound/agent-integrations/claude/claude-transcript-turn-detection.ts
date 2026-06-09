// Claude turn-end detection from the provider-owned transcript JSONL. This is the
// claude provider's lifecycle knowledge — it belongs in the claude Agent
// Integration, not in shared infrastructure. It is the pure core of the claude
// AgentRuntimeEventSource: given the bound transcript tail text and the current
// turn's expected user message, decide whether the current turn has ended.
//
// Claude writes the turn's real answer, THEN a `system` turn-summary record:
// `subtype:"turn_duration"` (always, once per finished turn) and/or
// `subtype:"stop_hook_summary"` (the agent-idle Stop hook; honored only when it
// did not prevent continuation). Because that record sits AFTER the final
// assistant text in the same file, keying turn-end on it can never settle a turn
// before its answer is on disk — unlike the old race between a hook-poll loop and
// a separate transcript-poll loop. Mid-turn `last-prompt` / `mode` /
// `permission-mode` checkpoint records are session state, never turn-end. No
// free-text scraping. Self-contained (no infrastructure import) like the codex and
// antigravity detection siblings. See docs_v2/specs/claude-runtime-event-source.md.

export type ClaudeTurnEndReason = "completed";

export interface ClaudeTurnEndDetection {
  ended: boolean;
  reason?: ClaudeTurnEndReason;
}

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

function recordField(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const field = value?.[key];
  if (field !== null && typeof field === "object" && !Array.isArray(field)) {
    return field as Record<string, unknown>;
  }
  return undefined;
}

function stringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

// A user content-array item ({type:"text",text} or {input_text}) equal to the
// expected message — Claude user messages can be a plain string or such an array.
function contentItemEquals(item: unknown, expectedUserMessage: string): boolean {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  const record = item as Record<string, unknown>;
  return (
    stringField(record, "text") === expectedUserMessage ||
    stringField(record, "input_text") === expectedUserMessage
  );
}

function isClaudeUserMessageForTurn(
  record: Record<string, unknown> | undefined,
  expectedUserMessage: string,
): boolean {
  if (record?.type !== "user") {
    return false;
  }
  const message = recordField(record, "message");
  if (message?.role !== "user") {
    return false;
  }
  const content = message.content;
  return (
    content === expectedUserMessage ||
    (Array.isArray(content) &&
      content.some((item) => contentItemEquals(item, expectedUserMessage)))
  );
}

// A `system` turn-summary record marking the genuine end of a turn. `turn_duration`
// is unconditional; `stop_hook_summary` ends the turn only when it did not block
// continuation (a Stop hook can decline to stop, which keeps the turn running).
function isClaudeTurnEndRecord(
  record: Record<string, unknown> | undefined,
): boolean {
  if (record?.type !== "system") {
    return false;
  }
  const subtype = stringField(record, "subtype");
  if (subtype === "turn_duration") {
    return true;
  }
  if (subtype === "stop_hook_summary") {
    return record.preventedContinuation !== true;
  }
  return false;
}

export function detectClaudeTranscriptTurnEnd(
  transcriptTailText: string,
  expectedUserMessage: string | undefined,
): ClaudeTurnEndDetection {
  const lines = transcriptTailText.split(/\r?\n/);

  // Honored-once guard: locate the LATEST occurrence of this turn's user message,
  // so a prior turn's turn-summary record cannot end the current turn early.
  let latestUserIndex = -1;
  if (expectedUserMessage !== undefined) {
    for (let i = 0; i < lines.length; i += 1) {
      if (
        isClaudeUserMessageForTurn(
          parseJsonObject(lines[i] ?? ""),
          expectedUserMessage,
        )
      ) {
        latestUserIndex = i;
      }
    }
  }
  if (latestUserIndex < 0) {
    return { ended: false };
  }

  for (let i = lines.length - 1; i > latestUserIndex; i -= 1) {
    if (isClaudeTurnEndRecord(parseJsonObject(lines[i] ?? ""))) {
      return { ended: true, reason: "completed" };
    }
  }
  return { ended: false };
}

// Boolean convenience for the live runtime wiring, mirroring codexRolloutTurnEnded:
// given the bound transcript tail and the current turn's user message, has the turn
// ended? Infrastructure reads the file; this adapter owns the decision.
export function claudeTranscriptTurnEnded(
  transcriptTailText: string,
  expectedUserMessage: string | undefined,
): boolean {
  return detectClaudeTranscriptTurnEnd(transcriptTailText, expectedUserMessage).ended;
}
