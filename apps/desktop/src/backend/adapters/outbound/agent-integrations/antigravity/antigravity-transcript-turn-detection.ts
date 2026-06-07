// Antigravity turn-end detection from its transcript. Antigravity fires no
// turn-end hook, so the turn boundary is read from the transcript: a
// PLANNER_RESPONSE (source MODEL) that carries visible content and NO tool_calls
// is the agent's final answer = the turn end. This is antigravity's lifecycle
// knowledge and lives in the antigravity Agent Integration, not in shared
// infrastructure. See docs_v2/specs/agent-runtime-event-spine.md.

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
