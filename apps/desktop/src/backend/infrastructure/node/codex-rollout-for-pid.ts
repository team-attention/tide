import { spawnSync } from "node:child_process";

// Deterministically find the Codex rollout file THIS run's spawned process is
// actually writing — the file the process has open. A process can only hold its
// OWN rollout open, so this can never bind to another run's session (unlike the
// legacy "recent rollout that contains the prompt text" heuristic, which collides
// when several threads run concurrently or send the same prompt). v2 owns the PTY
// host PID; codex is its descendant. Returns undefined if it can't be determined
// yet (caller waits / falls back), never a guess.

const CODEX_ROLLOUT_RE = /\/\.codex\/sessions\/.*\/rollout-[^/]*\.jsonl$/;
// Claude writes one transcript per session at
// ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl and holds it open.
const CLAUDE_TRANSCRIPT_RE = /\/\.claude\/projects\/[^/]+\/[^/]+\.jsonl$/;

export interface CodexRolloutForPidDeps {
  childPidsOf?: (pid: number) => number[];
  openFilesOf?: (pid: number) => string[];
}

export function codexRolloutPathForPid(
  hostPid: number | undefined,
  deps: CodexRolloutForPidDeps = {},
): string | undefined {
  return providerSessionFilePathForPid(hostPid, CODEX_ROLLOUT_RE, deps);
}

// Same deterministic process-ownership rule for Claude: bind the exact transcript
// this run's claude process has open, never a recency/prompt-text guess.
export function claudeTranscriptPathForPid(
  hostPid: number | undefined,
  deps: CodexRolloutForPidDeps = {},
): string | undefined {
  return providerSessionFilePathForPid(hostPid, CLAUDE_TRANSCRIPT_RE, deps);
}

// Find the provider session file matching `pattern` that the run's process (or a
// descendant) has open. A process can only hold its OWN session file open, so this
// can never bind to another run's session — unlike the legacy "recent file that
// contains the prompt text" heuristic, which collides when several threads run
// concurrently or send the same prompt. v2 owns the PTY host PID; the provider CLI
// is its descendant. Returns undefined if not determinable yet (caller waits /
// falls back), never a guess.
function providerSessionFilePathForPid(
  hostPid: number | undefined,
  pattern: RegExp,
  deps: CodexRolloutForPidDeps = {},
): string | undefined {
  if (hostPid === undefined || !Number.isInteger(hostPid)) {
    return undefined;
  }
  const childPidsOf = deps.childPidsOf ?? defaultChildPidsOf;
  const openFilesOf = deps.openFilesOf ?? defaultOpenFilesOf;

  // The PTY host (python) spawns the provider CLI as a child; the CLI holds its
  // session file open. Walk the host + its descendants breadth-first.
  const seen = new Set<number>();
  const queue: number[] = [hostPid];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (seen.has(pid)) {
      continue;
    }
    seen.add(pid);
    const match = openFilesOf(pid).find((path) => pattern.test(path));
    if (match !== undefined) {
      return match;
    }
    for (const child of childPidsOf(pid)) {
      if (!seen.has(child)) {
        queue.push(child);
      }
    }
  }
  return undefined;
}

function defaultChildPidsOf(pid: number): number[] {
  try {
    const result = spawnSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (typeof result.stdout !== "string") {
      return [];
    }
    return result.stdout
      .split("\n")
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((value) => Number.isInteger(value));
  } catch {
    return [];
  }
}

function defaultOpenFilesOf(pid: number): string[] {
  try {
    // -Fn emits one `n<path>` line per open file; -a/-w kept off for portability.
    const result = spawnSync("lsof", ["-p", String(pid), "-Fn"], {
      encoding: "utf8",
      timeout: 2000,
    });
    if (typeof result.stdout !== "string") {
      return [];
    }
    const paths: string[] = [];
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("n")) {
        paths.push(line.slice(1));
      }
    }
    return paths;
  } catch {
    return [];
  }
}
