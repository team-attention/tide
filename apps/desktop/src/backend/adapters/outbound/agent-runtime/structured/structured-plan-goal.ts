// Shared helpers for the thread Goal & live Checklist feature, used by the
// structured provider clients (claude / codex / ACP). Each client maps its
// provider-native plan/todo signal into a uniform PlanEntry list and emits a
// `type: "plan"` content_record with a STABLE blockId (plan:<runtimeId>) so the
// reader upserts one block in place. For goal, providers without a native goal API
// prepend a steering preamble on send. See specs/thread-goal-and-checklist-panel.md.

export type PlanEntryStatus = "pending" | "in_progress" | "done";

export interface PlanEntry {
  text: string;
  status: PlanEntryStatus;
}

export interface PlanContentRecord {
  sourceRef: string;
  payload: Record<string, unknown>;
  body: string;
}

// A short, human-readable body for the plan content_record. The panel renders from
// `entries`; this is only the rawFallback / log line.
export function planBody(entries: PlanEntry[]): string {
  if (entries.length === 0) {
    return "Plan cleared";
  }
  const done = entries.filter((entry) => entry.status === "done").length;
  return `Plan: ${done}/${entries.length} done`;
}

// Prepend the thread goal as a steering preamble for providers that have no native
// goal mechanism (claude over stream-json, ACP). No goal set ⇒ the value is returned
// unchanged (byte-identical to before).
export function withGoalPreamble(goalObjective: string, value: string): string {
  const goal = goalObjective.trim();
  if (goal.length === 0) {
    return value;
  }
  return `[Ongoing goal for this thread: ${goal}]\n\n${value}`;
}

export function acpPlanContentRecord(runtimeId: string, entries: unknown): PlanContentRecord {
  return planContentRecord(runtimeId, acpPlanEntries(entries));
}

export function claudeTodoWritePlanContentRecord(runtimeId: string, input: unknown): PlanContentRecord {
  return planContentRecord(runtimeId, todoWriteEntries(input));
}

export function codexPlanContentRecord(runtimeId: string, params: Record<string, unknown>): PlanContentRecord {
  return planContentRecord(
    runtimeId,
    codexPlanEntries(params.plan),
    stringField(params, "explanation"),
  );
}

function planContentRecord(
  runtimeId: string,
  entries: PlanEntry[],
  title?: string,
): PlanContentRecord {
  const blockId = `plan:${runtimeId}`;
  return {
    sourceRef: blockId,
    payload: {
      type: "plan",
      blockId,
      entries,
      ...(title !== undefined ? { title } : {}),
      status: "complete",
      sourceRuntimeId: runtimeId,
    },
    body: planBody(entries),
  };
}

function acpPlanEntries(value: unknown): PlanEntry[] {
  const list = Array.isArray(value) ? value : [];
  const entries: PlanEntry[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const text = stringField(entry, "content");
    if (text === undefined) continue;
    const raw = stringField(entry, "status");
    const status = raw === "completed" ? "done" : raw === "in_progress" ? "in_progress" : "pending";
    entries.push({ text, status });
  }
  return entries;
}

function todoWriteEntries(input: unknown): PlanEntry[] {
  if (!isRecord(input) || !Array.isArray(input.todos)) return [];
  const entries: PlanEntry[] = [];
  for (const todo of input.todos) {
    if (!isRecord(todo)) continue;
    const text = stringField(todo, "content");
    if (text === undefined || text.trim().length === 0) continue;
    const raw = stringField(todo, "status");
    const status = raw === "completed" ? "done" : raw === "in_progress" ? "in_progress" : "pending";
    entries.push({ text, status });
  }
  return entries;
}

function codexPlanEntries(value: unknown): PlanEntry[] {
  const steps = Array.isArray(value) ? value : [];
  const entries: PlanEntry[] = [];
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const text = stringField(step, "step");
    if (text === undefined) continue;
    const raw = stringField(step, "status");
    const status = raw === "completed" ? "done" : raw === "inProgress" ? "in_progress" : "pending";
    entries.push({ text, status });
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
