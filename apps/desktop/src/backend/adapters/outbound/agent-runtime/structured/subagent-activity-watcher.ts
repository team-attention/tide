// Polls a Claude `Task` fan-out's on-disk `subagents/` directory and emits live
// counts whenever they change, so the Working indicator can show "N agents · M tool
// calls" for a turn the provider stream says nothing about. Poll (not fs.watch):
// macOS fs.watch on a lazily-created nested dir is flaky, and a 1.5s poll is plenty
// for a human-facing indicator. All side effects (fs, clock, timer) are injected so
// the poll logic is unit-testable. Spec: live-turn-activity-visibility.md (Slice B).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  parseSubagentActivity,
  type SubagentActivityCounts,
} from "../../agent-integrations/claude/claude-subagent-activity.ts";

export interface SubagentFileEntry {
  path: string;
  mtimeMs: number;
}

export interface SubagentActivityWatcherDeps {
  // The current session's `subagents/` dir, or undefined until it is known/created.
  resolveDir: () => string | undefined;
  // List `agent-*.jsonl` files in `dir` with their mtime (empty if the dir is absent).
  listSubagentFiles: (dir: string) => SubagentFileEntry[];
  readFileLines: (path: string) => string[];
  // Injected so tests can drive ticks deterministically; returns a disposer.
  schedule: (callback: () => void, intervalMs: number) => () => void;
}

export interface SubagentActivityWatcher {
  // Begin polling for the turn that started at `turnStartMs` (older subagent files
  // from previous turns are excluded by mtime). Idempotent restart per turn.
  start(turnStartMs: number): void;
  // Stop polling. Does NOT emit a clear — turn-end handling owns clearing.
  stop(): void;
}

const DEFAULT_INTERVAL_MS = 1500;

export function createSubagentActivityWatcher(input: {
  deps: SubagentActivityWatcherDeps;
  emit: (counts: SubagentActivityCounts) => void;
  intervalMs?: number;
}): SubagentActivityWatcher {
  const { deps, emit } = input;
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;
  let dispose: (() => void) | undefined;
  let turnStartMs = 0;
  let last: SubagentActivityCounts | undefined;

  function poll(): void {
    const dir = deps.resolveDir();
    if (dir === undefined) {
      return;
    }
    const files = deps
      .listSubagentFiles(dir)
      .filter((file) => file.mtimeMs >= turnStartMs)
      .map((file) => ({ lines: deps.readFileLines(file.path) }));
    const counts = parseSubagentActivity(files);
    // Only emit on change, and never emit a bare zero (no fan-out → leave the
    // indicator on its plain timer / Slice-A summary).
    if (counts.nestedAgents === 0) {
      return;
    }
    if (last !== undefined && last.nestedAgents === counts.nestedAgents && last.nestedToolCalls === counts.nestedToolCalls) {
      return;
    }
    last = counts;
    emit(counts);
  }

  return {
    start(startMs: number): void {
      this.stop();
      turnStartMs = startMs;
      last = undefined;
      poll();
      dispose = deps.schedule(poll, intervalMs);
    },
    stop(): void {
      if (dispose !== undefined) {
        dispose();
        dispose = undefined;
      }
      last = undefined;
    },
  };
}

// Convenience constructor wiring the real-fs/timer deps, so the runtime client only
// supplies a session→dir resolver and an emit sink. A missing dir (no fan-out yet)
// and raced deletions are swallowed to empty — the watcher just reports nothing.
export function createNodeSubagentActivityWatcher(input: {
  resolveDir: () => string | undefined;
  emit: (counts: SubagentActivityCounts) => void;
  intervalMs?: number;
}): SubagentActivityWatcher {
  return createSubagentActivityWatcher({
    emit: input.emit,
    intervalMs: input.intervalMs,
    deps: {
      resolveDir: input.resolveDir,
      listSubagentFiles: listSubagentFilesFromDisk,
      readFileLines: readFileLinesFromDisk,
      schedule: (callback, intervalMs) => {
        const timer = setInterval(callback, intervalMs);
        timer.unref?.();
        return () => clearInterval(timer);
      },
    },
  });
}

function listSubagentFilesFromDisk(dir: string): SubagentFileEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.startsWith("agent-") && name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const entries: SubagentFileEntry[] = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      entries.push({ path, mtimeMs: statSync(path).mtimeMs });
    } catch {
      // raced deletion between readdir and stat — skip.
    }
  }
  return entries;
}

function readFileLinesFromDisk(path: string): string[] {
  try {
    return readFileSync(path, "utf8").split("\n");
  } catch {
    return [];
  }
}
