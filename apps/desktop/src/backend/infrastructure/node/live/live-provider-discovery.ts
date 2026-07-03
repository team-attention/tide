import { claudeProjectTranscriptsDir } from "../../../adapters/outbound/agent-integrations/claude/claude-history-connector.ts";
import { resolveExecutable } from "../../../adapters/outbound/agent-integrations/shared/provider-cli-commands.ts";
import { spawnSync } from "node:child_process";

import { readBoundedHead, readTextFile } from "./live-backend-fs.ts";

import { basename, join } from "node:path";

import {
  adoptedThreadSeedsFromSessions,
  discoverLocalSessions,
  parseOpencodeSessionListText,
} from "../../../application/services/provider/provider-session-discovery.ts";

import type { DiscoveryFs } from "../../../application/services/provider/provider-session-discovery.ts";

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

import { recentCodexRollouts } from "../provider/recent-provider-files.ts";

import type { ThreadStorageRecord } from "../../../application/services/thread/thread-persistence-service.ts";

import type { ThreadSeed } from "../../../application/services/thread/thread-runtime-service.ts";

import type { AgentSessionBlock } from "../../../application/domains/agent-session/agent-session-block.ts";

import {
  rebuildClaudeConversation,
  rebuildCodexConversation,
  rebuildOpencodeConversationFromCli,
} from "../provider/provider-conversation-rebuilders.ts";

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

function createDiscoveryFs(homeDir: string, codexHome?: string): DiscoveryFs {
  return {
    listClaudeTranscripts: (cwd) => {
      const dir = claudeProjectTranscriptsDir(homeDir, cwd);
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
      recentCodexRollouts(homeDir, 0, codexHome).flatMap((path) => {
        try {
          return [{ path, mtimeMs: statSync(path).mtimeMs }];
        } catch {
          return [];
        }
      }),
    listOpencodeSessions: () => {
      const result = runOpencodeCli(["session", "list", "--format", "json", "--max-count", "200"], 2 * 1024 * 1024);
      return result === undefined ? [] : parseOpencodeSessionListText(result);
    },
    exportOpencodeSession: (sessionId) => runOpencodeCli(["export", sessionId], 8 * 1024 * 1024),
    readText: (path) => readBoundedHead(path, 256 * 1024),
  };
}

function runOpencodeCli(args: string[], maxBuffer: number): string | undefined {
  const executablePath = resolveExecutable("opencode");
  if (executablePath === undefined) {
    return undefined;
  }
  try {
    const result = spawnSync(executablePath, args, {
      encoding: "utf8",
      timeout: 8_000,
      maxBuffer,
    });
    if (result.status !== 0 || result.error !== undefined) {
      return undefined;
    }
    return result.stdout;
  } catch {
    return undefined;
  }
}

export function discoverAdoptedThreadSeeds(input: {
  homeDir: string;
  codexHome?: string;
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
    fs: createDiscoveryFs(input.homeDir, input.codexHome),
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
  if (ref?.kind === "opencode_session") {
    return rebuildOpencodeConversationFromCli(ref.value, seed.threadId, seed.agentBinding.agentId);
  }
  const filePath = ref?.transcriptPath;
  if (ref === undefined || filePath === undefined) {
    return [];
  }
  const text = readTextFile(filePath);
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
