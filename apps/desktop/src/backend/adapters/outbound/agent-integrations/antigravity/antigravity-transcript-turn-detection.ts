// Antigravity turn-end detection from its transcript. Antigravity fires no
// turn-end hook, so the turn boundary is read from the transcript: a
// PLANNER_RESPONSE (source MODEL) that carries visible content and NO tool_calls
// is the agent's final answer = the turn end. This is antigravity's lifecycle
// knowledge and lives in the antigravity Agent Integration, not in shared
// infrastructure. See docs_v2/specs/agent-runtime-event-spine.md.

import type { AgentTurnOutcome } from "../../../../application/ports/outbound/agent-integration-port.ts";

// Uniform turn outcome from the antigravity transcript: the terminal
// PLANNER_RESPONSE (no tool_calls) IS the final answer and the turn end. Returns
// null while the turn is still running (no such record yet). Antigravity has no
// turn-end hook, so this transcript read is its authoritative settle path.
export function antigravityTurnOutcomeFromTranscript(
  transcriptTailText: string,
  _expectedUserMessage: string | undefined,
): AgentTurnOutcome | null {
  const lines = transcriptTailText.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === undefined || line.trim().length === 0) {
      continue;
    }
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (antigravityRecordIsTurnEnd(record)) {
      return { finalMessage: stringField(unknownRecord(record), "content") };
    }
  }
  return null;
}

export function antigravityRecordIsTurnEnd(record: unknown): boolean {
  const value = unknownRecord(record);
  if (value === undefined) {
    return false;
  }
  if (
    stringField(value, "source") !== "MODEL" ||
    stringField(value, "type") !== "PLANNER_RESPONSE"
  ) {
    return false;
  }
  const content = stringField(value, "content");
  if (content === undefined) {
    return false;
  }
  const toolCalls = Array.isArray(value.tool_calls) ? value.tool_calls : [];
  return toolCalls.length === 0;
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
