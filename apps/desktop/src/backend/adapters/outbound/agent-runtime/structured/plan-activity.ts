// Plan/todo step progress shared by the codex `plan` item and the ACP `plan`
// session update — both report a list of steps each carrying a `status`. Counts the
// total and the "completed" steps for the Working indicator. Returns undefined when
// there is no usable plan. Spec: live-turn-activity-visibility.md (Slice B′).

import { isRecord, stringField } from "./claude-stream-json-shared.ts";

export function planActivityFromEntries(
  entries: unknown,
): { planTotal: number; planCompleted: number } | undefined {
  if (!Array.isArray(entries)) {
    return undefined;
  }
  const records = entries.filter(isRecord);
  if (records.length === 0) {
    return undefined;
  }
  const planCompleted = records.filter((entry) => stringField(entry, "status") === "completed").length;
  return { planTotal: records.length, planCompleted };
}

export function codexPlanActivityFromItem(
  item: Record<string, unknown>,
): { planTotal: number; planCompleted: number } | undefined {
  const itemType = stringField(item, "type") ?? stringField(item, "itemType");
  const direct = Array.isArray(item.plan) ? item.plan : item.steps;
  if (itemType === "plan" && direct !== undefined) {
    return planActivityFromEntries(direct);
  }
  if (itemType !== "function_call" || stringField(item, "name") !== "update_plan") {
    return undefined;
  }
  const args = typeof item.arguments === "string" ? parseJsonRecord(item.arguments) : item.arguments;
  return isRecord(args)
    ? planActivityFromEntries(Array.isArray(args.plan) ? args.plan : args.steps)
    : undefined;
}

export function planActivityFromTodoToolOutput(
  toolName: string,
  output: string,
): { planTotal: number; planCompleted: number } | undefined {
  if (!toolName.toLowerCase().includes("todo")) {
    return undefined;
  }
  try {
    return planActivityFromEntries(JSON.parse(output) as unknown);
  } catch {
    return undefined;
  }
}

export function planActivityFromToolResultPayload(
  payload: Record<string, unknown> | null | undefined,
): { planTotal: number; planCompleted: number } | undefined {
  if (payload === null || payload === undefined) return undefined;
  if (stringField(payload, "type") !== "tool_result") return undefined;
  const output = stringField(payload, "output") ?? stringField(payload, "body");
  return output === undefined
    ? undefined
    : planActivityFromTodoToolOutput(stringField(payload, "toolName") ?? "", output);
}

function parseJsonRecord(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
