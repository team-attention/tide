import { execFileSync } from "node:child_process";

import type { ProviderModelDto } from "../../../../shared/contracts/index.ts";

// Enumerates opencode's AUTHED model catalog by running `opencode models` (a local,
// fast cache lookup — never `--refresh`, which hits the network). opencode is a
// multi-vendor router so its list is per-user (depends on `opencode auth login`);
// it cannot be hand-curated like the single-vendor agents. Output is one
// `provider/model` id per line — we split on the first `/` into vendor + model.
//
// Cached per process with a short TTL so the subprocess is not respawned on every
// thread.list. Synchronous (execFileSync) because thread.listed is built
// synchronously; the call is bounded by a timeout and the result is cached.

const CACHE_TTL_MS = 60_000;

interface OpencodeModelCatalog {
  get: () => ProviderModelDto[];
}

export function parseOpencodeModels(stdout: string): ProviderModelDto[] {
  const models: ProviderModelDto[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.includes(" ")) {
      // Skip blanks and any non-id noise (errors print prose with spaces).
      continue;
    }
    const slash = line.indexOf("/");
    if (slash <= 0) {
      continue;
    }
    const vendor = line.slice(0, slash);
    const model = line.slice(slash + 1);
    models.push({ value: line, label: model, vendor });
  }
  return models;
}

export function createOpencodeModelCatalog(
  resolveExecutable: (command: "opencode") => string | undefined,
): OpencodeModelCatalog {
  let cache: ProviderModelDto[] = [];
  let fetchedAt = 0;

  const refresh = (): void => {
    const executablePath = resolveExecutable("opencode");
    if (executablePath === undefined) {
      cache = [];
      return;
    }
    try {
      const stdout = execFileSync(executablePath, ["models"], {
        encoding: "utf8",
        // `opencode models` is a fast local cache lookup; keep the synchronous call
        // short so a hung/slow CLI can't block the backend for long.
        timeout: 1_000,
        // opencode prints the list to stdout; ignore stderr noise.
        stdio: ["ignore", "pipe", "ignore"],
      });
      cache = parseOpencodeModels(stdout);
    } catch {
      // Not installed / not authed / timed out — leave the menu on its sentinel.
      cache = [];
    }
  };

  return {
    get: () => {
      const now = Date.now();
      if (now - fetchedAt > CACHE_TTL_MS) {
        fetchedAt = now;
        refresh();
      }
      return cache;
    },
  };
}
