import { statSync } from "node:fs";

import type { ProviderUsageSnapshotDto } from "../../../../shared/contracts/index.ts";
import { readBoundedTail } from "../live/live-backend-fs.ts";
import { parseProviderUsage } from "./provider-usage.ts";
import { recentClaudeTranscripts, recentCodexRollouts } from "./recent-provider-files.ts";

const ACCOUNT_USAGE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_USAGE_HISTORY_BYTES = 2 * 1024 * 1024;

export function readProviderAccountUsageSnapshotsFromHome(input: {
  homeDir: string;
  codexHome?: string;
  nowMs?: number;
}): ProviderUsageSnapshotDto[] {
  const sinceMs = (input.nowMs ?? Date.now()) - ACCOUNT_USAGE_LOOKBACK_MS;
  const snapshots: ProviderUsageSnapshotDto[] = [];

  const codex = latestAccountUsageFromFiles(
    "codex",
    recentCodexRollouts(input.homeDir, sinceMs, input.codexHome),
  );
  if (codex !== undefined) {
    snapshots.push(codex);
  }

  const claude = latestAccountUsageFromFiles(
    "claude",
    recentClaudeTranscripts(input.homeDir, sinceMs),
  );
  if (claude !== undefined) {
    snapshots.push(claude);
  }

  return snapshots;
}

function latestAccountUsageFromFiles(
  agentId: ProviderUsageSnapshotDto["agentId"],
  paths: string[],
): ProviderUsageSnapshotDto | undefined {
  for (const path of [...paths].reverse()) {
    const text = readBoundedTail(path, MAX_USAGE_HISTORY_BYTES);
    if (text === undefined) {
      continue;
    }
    const usage = parseProviderUsage(text, agentId);
    if (usage === undefined || (usage.rateLimits?.length ?? 0) === 0) {
      continue;
    }
    const observedAt = fileMtimeIso(path);
    return {
      agentId,
      usage,
      ...(observedAt !== undefined ? { observedAt } : {}),
    };
  }
  return undefined;
}

function fileMtimeIso(path: string): string | undefined {
  try {
    return new Date(statSync(path).mtimeMs).toISOString();
  } catch {
    return undefined;
  }
}
