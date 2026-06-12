import { spawnSync } from "node:child_process";
import { readBoundedHead, readBoundedTail, readTextFile } from "./live-backend-fs.ts";
import { basename, join } from "node:path";
import { adoptedThreadSeedsFromSessions, discoverLocalSessions } from "../../application/services/provider/provider-session-discovery.ts";
import type { DiscoveryFs } from "../../application/services/provider/provider-session-discovery.ts";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { recentCodexRollouts } from "./recent-provider-files.ts";
import type { ThreadStorageRecord } from "../../application/services/thread/thread-persistence-service.ts";
import type { ThreadSeed } from "../../application/services/thread/thread-runtime-service.ts";
import type { AgentSessionBlock } from "../../application/domains/agent-session/agent-session-block.ts";
import { rebuildClaudeConversation, rebuildCodexConversation } from "./provider-conversation-rebuilders.ts";
// Extracted from live-backend.ts (spec: navigable-source-structure).

// Provider CLI command names: pure registry data, the only place infrastructure
// may know a provider-specific value.
const providerCliCommands = {
  codex: "codex",
  claude: "claude",
  gemini: "gemini",
  opencode: "opencode",
} as const;

export function executableForAgent(
  agentId: "codex" | "claude" | "gemini" | "opencode",
): string {
  return providerCliCommands[agentId];
}

export function resolveExecutable(command: string): string | undefined {
  const result = spawnSync("which", [command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return undefined;
  }
  const resolved = result.stdout.trim();
  return resolved.length > 0 ? resolved : undefined;
}

// Reads the leading bytes of a file (codex session_meta and the first user turn
// live near the top), bounded so large transcripts stay cheap to scan.

// Encodes a cwd into Claude's project directory name (path separators and dots
// become dashes, e.g. /Users/x/tide -> -Users-x-tide).
function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

interface RegisteredProjectEntry {
  projectId: string;
  name: string;
  cwd: string;
}

function readRegisteredProjects(appDataRoot: string): RegisteredProjectEntry[] {
  const raw = readTextFile(join(appDataRoot, "project-registry.json"));
  if (raw === undefined) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap((entry) => {
      const cwd = typeof entry?.cwd === "string" ? entry.cwd : undefined;
      const projectId = typeof entry?.projectId === "string" ? entry.projectId : undefined;
      if (cwd === undefined || projectId === undefined) {
        return [];
      }
      return [{ projectId, name: typeof entry?.name === "string" ? entry.name : projectId, cwd }];
    });
  } catch {
    return [];
  }
}

function createDiscoveryFs(homeDir: string): DiscoveryFs {
  return {
    listClaudeTranscripts: (cwd) => {
      const dir = join(homeDir, ".claude", "projects", claudeProjectDirName(cwd));
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return [];
      }
      const out: { path: string; sessionId: string; mtimeMs: number }[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !/^[0-9a-f-]+\.jsonl$/i.test(entry.name)) {
          continue;
        }
        const path = join(dir, entry.name);
        try {
          out.push({ path, sessionId: entry.name.replace(/\.jsonl$/i, ""), mtimeMs: statSync(path).mtimeMs });
        } catch {
          // Skip transcripts that vanished between listing and stat.
        }
      }
      return out;
    },
    listCodexRollouts: () =>
      recentCodexRollouts(homeDir, 0).flatMap((path) => {
        try {
          return [{ path, mtimeMs: statSync(path).mtimeMs }];
        } catch {
          return [];
        }
      }),
    readText: (path) => readBoundedHead(path, 256 * 1024),
  };
}

export function discoverAdoptedThreadSeeds(input: {
  homeDir: string;
  appDataRoot: string;
  persistedRecords: ThreadStorageRecord[];
}): ThreadSeed[] {
  const registry = readRegisteredProjects(input.appDataRoot);
  const projectIdByCwd = new Map(registry.map((entry) => [entry.cwd, entry.projectId]));
  const cwds = new Set<string>(registry.map((entry) => entry.cwd));
  for (const record of input.persistedRecords) {
    if (record.scope.kind === "project") {
      cwds.add(record.scope.cwd);
      projectIdByCwd.set(record.scope.cwd, record.scope.projectId);
    }
  }
  if (cwds.size === 0) {
    return [];
  }

  const existingRefValues = new Set<string>();
  for (const record of input.persistedRecords) {
    const value = record.providerSessionRef?.value ?? record.agentBinding.providerSessionRef?.value;
    if (value !== undefined) {
      existingRefValues.add(value);
    }
  }
  const existingThreadIds = new Set(input.persistedRecords.map((record) => record.threadId));

  const sessions = discoverLocalSessions({
    cwds: [...cwds],
    fs: createDiscoveryFs(input.homeDir),
  });
  return adoptedThreadSeedsFromSessions({
    sessions,
    projectIdForCwd: (cwd) => projectIdByCwd.get(cwd) ?? basename(cwd),
    existingRefValues,
    existingThreadIds,
  });
}

export function rebuildAdoptedConversation(seed: ThreadSeed): AgentSessionBlock[] {
  const ref = seed.agentBinding.providerSessionRef;
  const filePath = ref?.transcriptPath;
  if (ref === undefined || filePath === undefined) {
    return [];
  }
  const text = readBoundedTail(filePath, 1024 * 1024);
  if (text === undefined) {
    return [];
  }
  const agentId = seed.agentBinding.agentId;
  if (ref.kind === "codex_rollout") {
    return rebuildCodexConversation(text, seed.threadId, ref.value, agentId);
  }
  if (ref.kind === "claude_transcript") {
    return rebuildClaudeConversation(text, seed.threadId, ref.value, agentId);
  }
  return [];
}

// Locates the on-disk gemini session file for a Tide-minted session id:
// ~/.gemini/tmp/<project>/chats/session-<ts>-<uuid8>.jsonl whose header line
// carries the full sessionId. Deterministic — keyed by the assigned id, never by
// recency — so concurrent same-prompt threads can never swap sessions.
// Locates the on-disk claude transcript for a Tide-minted session id:
// ~/.claude/projects/<munged-cwd>/<session-id>.jsonl. Deterministic — keyed by
// the assigned id (the filename IS the id), never by recency. The project dir is
// scanned because claude munges its OWN canonical cwd, which can differ from
// Tide's spelling via symlinks (/var -> /private/var) or casing.
export function locateClaudeTranscriptFile(
  homeDir: string,
  sessionId: string,
): string | undefined {
  const projectsRoot = join(homeDir, ".claude", "projects");
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  for (const project of projectDirs) {
    const candidate = join(projectsRoot, project, `${sessionId}.jsonl`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function locateGeminiSessionFile(
  homeDir: string,
  sessionId: string,
): string | undefined {
  const tmpRoot = join(homeDir, ".gemini", "tmp");
  let projectDirs: string[];
  try {
    projectDirs = readdirSync(tmpRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }
  const idFragment = sessionId.slice(0, 8);
  for (const project of projectDirs) {
    const chatsDir = join(tmpRoot, project, "chats");
    let names: string[];
    try {
      names = readdirSync(chatsDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.startsWith("session-") || !/\.jsonl?$/.test(name)) {
        continue;
      }
      // The filename embeds the first 8 chars of the session id; the header line
      // carries the full id. Both must match.
      if (!name.includes(idFragment)) {
        continue;
      }
      const path = join(chatsDir, name);
      try {
        const headerLine = readFileSync(path, "utf8").split("\n", 1)[0] ?? "";
        const header = JSON.parse(headerLine) as Record<string, unknown>;
        if (header.sessionId === sessionId) {
          return path;
        }
      } catch {
        // Skip unreadable/partial files; the next poll retries.
      }
    }
  }
  return undefined;
}

function latestUserMessageForProviderHistory(
  thread: { cachedBlocks: Array<{ kind: string; body?: string }> },
): string | undefined {
  for (let index = thread.cachedBlocks.length - 1; index >= 0; index -= 1) {
    const block = thread.cachedBlocks[index];
    if (block?.kind === "user_message" && typeof block.body === "string") {
      return block.body;
    }
  }
  return undefined;
}
