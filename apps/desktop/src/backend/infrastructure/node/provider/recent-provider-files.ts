import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { isSymlink } from "../live/live-backend-fs.ts";
import { providerBootstrapArtifactsForHome } from "./provider-bootstrap-artifacts.ts";

// Scans each provider's history directory for recently-modified transcript/rollout
// files (bounded by depth, entry count, recency, and a per-provider name match),
// returning the most recent paths. Used to discover live/adopted provider sessions.
// Extracted from live-backend.ts.

export function recentCodexRollouts(homeDir: string, sinceMs: number): string[] {
  const realSessionsDir = join(homeDir, ".codex", "sessions");
  const overlaySessionsDir = join(
    providerBootstrapArtifactsForHome({ homeDir }).codexHome,
    "sessions",
  );
  const rolloutPaths = recentProviderFiles({
    rootDir: realSessionsDir,
    sinceMs,
    maxDepth: 4,
    matches: (name) => /^rollout-.+\.jsonl$/.test(name),
  });
  if (!isSymlink(overlaySessionsDir)) {
    rolloutPaths.push(
      ...recentProviderFiles({
        rootDir: overlaySessionsDir,
        sinceMs,
        maxDepth: 4,
        matches: (name) => /^rollout-.+\.jsonl$/.test(name),
      }),
    );
  }
  return [...new Set(rolloutPaths)];
}

export function recentClaudeTranscripts(homeDir: string, sinceMs: number): string[] {
  return recentProviderFiles({
    rootDir: join(homeDir, ".claude", "projects"),
    sinceMs,
    maxDepth: 2,
    matches: (name) => /^[0-9a-f-]+\.jsonl$/i.test(name),
  });
}

export function recentProviderFiles(input: {
  rootDir: string;
  sinceMs: number;
  maxDepth: number;
  matches: (name: string) => boolean;
}): string[] {
  const filePaths: { path: string; mtimeMs: number }[] = [];
  let visitedEntries = 0;
  const maxEntries = 3000;

  const visit = (dir: string, depth: number): void => {
    if (visitedEntries >= maxEntries || depth > input.maxDepth) {
      return;
    }

    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (visitedEntries >= maxEntries) {
        return;
      }
      visitedEntries += 1;
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !input.matches(entry.name)) {
        continue;
      }

      try {
        const stat = statSync(entryPath);
        if (stat.mtimeMs >= input.sinceMs) {
          filePaths.push({ path: entryPath, mtimeMs: stat.mtimeMs });
        }
      } catch {
        // Ignore unreadable provider history files.
      }
    }
  };

  visit(input.rootDir, 0);

  return filePaths
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .slice(-8)
    .map((entry) => entry.path);
}
