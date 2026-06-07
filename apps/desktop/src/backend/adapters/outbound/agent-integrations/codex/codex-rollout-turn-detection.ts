// Codex turn-end detection from the provider-owned rollout JSONL. This is the
// codex provider's lifecycle knowledge — it belongs in the codex Agent
// Integration, not in shared infrastructure. It is the pure core of the codex
// AgentRuntimeEventSource: given the rollout tail text and the current turn's
// expected user message, decide whether the current turn has ended.
//
// Codex writes a typed `event_msg` whose payload type is `task_complete` on a
// normal finish and `turn_aborted` on a limit / error / interrupt. We only honor
// `task_complete` once the current turn's `user_message` is located, so a prior
// turn's completion cannot end this one early. No regex / free-text matching.
// See docs_v2/specs/agent-runtime-event-spine.md.

export type CodexTurnEndReason = "completed" | "aborted";

export interface CodexTurnEndDetection {
  ended: boolean;
  reason?: CodexTurnEndReason;
}

export function detectCodexRolloutTurnEnd(
  rolloutTailText: string,
  expectedUserMessage: string | undefined,
): CodexTurnEndDetection {
  const lines = rolloutTailText.split(/\r?\n/);

  let latestUserIndex = -1;
  if (expectedUserMessage !== undefined) {
    for (let i = 0; i < lines.length; i += 1) {
      const record = parseJsonObject(lines[i] ?? "");
      const payload = recordField(record, "payload");
      if (record?.type !== "event_msg" || payload?.type !== "user_message") {
        continue;
      }
      const content = payload.content;
      if (
        stringField(payload, "message") === expectedUserMessage ||
        (Array.isArray(content) &&
          content.some((item) => inputTextContentEquals(item, expectedUserMessage)))
      ) {
        latestUserIndex = i;
      }
    }
  }
  const sawCurrentUserMessage = latestUserIndex >= 0;

  for (let i = lines.length - 1; i > latestUserIndex; i -= 1) {
    const record = parseJsonObject(lines[i] ?? "");
    if (record?.type !== "event_msg") {
      continue;
    }
    const payloadType = recordField(record, "payload")?.type;
    if (payloadType === "turn_aborted") {
      return { ended: true, reason: "aborted" };
    }
    if (payloadType === "task_complete" && sawCurrentUserMessage) {
      return { ended: true, reason: "completed" };
    }
  }
  return { ended: false };
}

// Boolean convenience matching the prior live-backend signature.
export function codexRolloutTurnEnded(
  rolloutTailText: string,
  expectedUserMessage: string | undefined,
): boolean {
  return detectCodexRolloutTurnEnd(rolloutTailText, expectedUserMessage).ended;
}

function inputTextContentEquals(item: unknown, expectedUserMessage: string): boolean {
  const record = unknownRecord(item);
  if (record === undefined) {
    return false;
  }
  return (
    stringField(record, "text") === expectedUserMessage ||
    stringField(record, "input_text") === expectedUserMessage
  );
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

function unknownRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
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
