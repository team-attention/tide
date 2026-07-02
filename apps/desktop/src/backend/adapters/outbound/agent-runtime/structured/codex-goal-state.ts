import type { StructuredGoalState } from "./structured-runtime-events.ts";
import { numberField, stringField } from "./codex-app-server-shared.ts";

export function codexGoalState(goal: Record<string, unknown> | undefined): StructuredGoalState | undefined {
  if (goal === undefined) {
    return undefined;
  }
  const objective = stringField(goal, "objective");
  const status = codexGoalStatus(stringField(goal, "status"));
  if (objective === undefined || status === undefined) {
    return undefined;
  }
  const tokenBudget = nullableNumberField(goal, "tokenBudget");
  return {
    objective,
    status,
    provider: "codex",
    ...(isoFromCodexTime(numberField(goal, "createdAt")) !== undefined
      ? { createdAt: isoFromCodexTime(numberField(goal, "createdAt")) }
      : {}),
    updatedAt: isoFromCodexTime(numberField(goal, "updatedAt")) ?? new Date().toISOString(),
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    ...(numberField(goal, "tokensUsed") !== undefined ? { tokensUsed: numberField(goal, "tokensUsed") } : {}),
    ...(numberField(goal, "timeUsedSeconds") !== undefined ? { timeUsedSeconds: numberField(goal, "timeUsedSeconds") } : {}),
  };
}

function codexGoalStatus(status: string | undefined): StructuredGoalState["status"] | undefined {
  switch (status) {
    case "active":
    case "paused":
    case "blocked":
    case "complete":
      return status;
    case "usageLimited":
      return "usage_limited";
    case "budgetLimited":
      return "budget_limited";
    default:
      return undefined;
  }
}

function nullableNumberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isoFromCodexTime(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  const millis = value > 1_000_000_000_000 ? value : value * 1000;
  return new Date(millis).toISOString();
}
