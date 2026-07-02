import type { StructuredProviderEvent } from "./structured-runtime-events.ts";
import { isRecord } from "./claude-stream-json-shared.ts";

export function claudeGoalUserMessage(objective: string): Record<string, unknown> {
  const goal = objective.trim();
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: goal.length > 0 ? `/goal ${goal}` : "/goal clear" }],
    },
  };
}

export function claudeGoalSetEvent(objective: string): StructuredProviderEvent | undefined {
  const goal = objective.trim();
  if (goal.length === 0) {
    return undefined;
  }
  return {
    kind: "goal_updated",
    goal: {
      objective: goal,
      status: "active",
      provider: "claude",
      updatedAt: new Date().toISOString(),
    },
  };
}

export function claudeGoalEventsFromMessage(
  message: Record<string, unknown>,
  currentObjective: string,
): { events: StructuredProviderEvent[]; objective: string } {
  const inner = isRecord(message.message) ? message.message : undefined;
  if (inner === undefined) {
    return { events: [], objective: currentObjective };
  }
  return claudeGoalEventsFromTexts(messageContentTexts(inner.content), currentObjective);
}

export function claudeGoalEventsFromText(
  text: string,
  currentObjective: string,
): { events: StructuredProviderEvent[]; objective: string } {
  return claudeGoalEventsFromTexts([text], currentObjective);
}

function claudeGoalEventsFromTexts(
  texts: string[],
  currentObjective: string,
): { events: StructuredProviderEvent[]; objective: string } {
  let objective = currentObjective;
  const events: StructuredProviderEvent[] = [];
  for (const rawText of texts) {
    const parsed = claudeGoalEventFromText(rawText, objective);
    if (parsed === undefined) {
      continue;
    }
    objective = parsed.objective;
    events.push(...parsed.events);
  }
  return { events, objective };
}

function claudeGoalEventFromText(
  rawText: string,
  currentObjective: string,
): { events: StructuredProviderEvent[]; objective: string } | undefined {
  const text = stripClaudeLocalCommandTags(rawText).trim();
  const setMatch =
    text.match(/^Goal set:\s*([\s\S]+)$/i) ??
    text.match(/Stop hook is now active with condition:\s*"([^"]+)"/i);
  if (setMatch !== null) {
    const objective = (setMatch[1] ?? "").trim();
    const event = claudeGoalSetEvent(objective);
    return event === undefined ? undefined : { events: [event], objective };
  }
  if (/^(Goal cleared|No goal set)\b/i.test(text)) {
    return { events: [{ kind: "goal_cleared" }], objective: "" };
  }
  if (/^Goal (achieved|complete|completed)\b/i.test(text)) {
    const objective = currentObjective.trim();
    const event = objective.length > 0
      ? {
          kind: "goal_updated" as const,
          goal: {
            objective,
            status: "complete" as const,
            provider: "claude" as const,
            updatedAt: new Date().toISOString(),
          },
        }
      : undefined;
    return event === undefined ? undefined : { events: [event], objective };
  }
  return undefined;
}

function messageContentTexts(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((item) =>
    isRecord(item) && typeof item.text === "string" ? [item.text] : [],
  );
}

function stripClaudeLocalCommandTags(text: string): string {
  return text
    .replace(/^<local-command-stdout>/, "")
    .replace(/<\/local-command-stdout>$/, "")
    .trim();
}
