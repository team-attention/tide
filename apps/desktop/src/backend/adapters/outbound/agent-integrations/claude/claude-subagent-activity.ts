// Pure aggregation of a Claude `Task` fan-out's on-disk subagent transcripts into
// live counts for the Working indicator. Claude streams nothing to the parent during
// a subagent run — it writes each subagent to its own
// `~/.claude/projects/<key>/<sessionId>/subagents/agent-*.jsonl`. This turns a SNAPSHOT
// of those files into `{nestedAgents, nestedToolCalls}`. The infra watcher decides WHICH
// files belong to the current turn (by mtime) and reads them; this function only counts,
// so it stays pure and fully unit-testable. Spec: live-turn-activity-visibility.md (Slice B).

export interface SubagentActivityCounts {
  // Distinct subagent transcripts in the snapshot (one file = one spawned subagent).
  nestedAgents: number;
  // Total tool_use items across all those transcripts.
  nestedToolCalls: number;
}

export interface SubagentTranscriptSnapshot {
  // One `agent-*.jsonl` file's raw lines (each a JSON object, or blank/partial).
  lines: string[];
}

export function parseSubagentActivity(
  files: SubagentTranscriptSnapshot[],
): SubagentActivityCounts {
  let nestedToolCalls = 0;
  for (const file of files) {
    for (const line of file.lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      let record: unknown;
      try {
        record = JSON.parse(trimmed);
      } catch {
        // A trailing partial line while the file is mid-write — skip it.
        continue;
      }
      nestedToolCalls += countToolUses(record);
    }
  }
  return { nestedAgents: files.length, nestedToolCalls };
}

// A subagent transcript line is `{ message: { content: [...] } }`; count the
// `tool_use` content items (one assistant message can carry several).
function countToolUses(record: unknown): number {
  if (typeof record !== "object" || record === null) {
    return 0;
  }
  const message = (record as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) {
    return 0;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return 0;
  }
  return content.filter(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      (item as { type?: unknown }).type === "tool_use",
  ).length;
}
