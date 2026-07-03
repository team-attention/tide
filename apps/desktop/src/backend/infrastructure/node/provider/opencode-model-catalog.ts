import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { ProviderModelDto } from "../../../../shared/contracts/index.ts";

const execFileAsync = promisify(execFile);

// Enumerates opencode's AUTHED model catalog by running `opencode models` (a local,
// fast cache lookup — never `--refresh`, which hits the network). opencode is a
// multi-vendor router so its list is per-user (depends on `opencode auth login`);
// it cannot be hand-curated like the single-vendor agents. Output is one
// `provider/model` id per line — we split on the first `/` into vendor + model.
//
// Cached per process with a short TTL so the subprocess is not respawned on every
// thread.list. ASYNCHRONOUS (execFile, not execFileSync): opencode's CLI can take a
// couple of seconds to start, and a synchronous spawn here froze the backend event
// loop — delaying delivery of the already-computed thread.list reply and so the cold-
// boot rail skeleton by ~2.5s. The catalog is delivered out of band on
// providerCatalog.changed (never inside thread.listed), so it never needs to block.

const CACHE_TTL_MS = 60_000;
const OPENCODE_MODELS_TIMEOUT_MS = 5_000;

interface OpencodeModelCatalog {
  get: () => Promise<ProviderModelDto[]>;
  // Drop the cached result so the next get() re-runs `opencode models` (e.g. right
  // after a new vendor sign-in).
  invalidate: () => void;
}

type OpencodeCommandRunner = (executablePath: string, args: string[]) => Promise<string>;

async function runOpencodeModelsCommand(executablePath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(executablePath, args, {
    encoding: "utf8",
    // `opencode models` is usually a fast local cache lookup, but cold starts can
    // cross one second. This runs off the event loop and is delivered out of band,
    // so allow enough room for the first spawn while still bounding a hung CLI.
    timeout: OPENCODE_MODELS_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
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
  runCommand: OpencodeCommandRunner = runOpencodeModelsCommand,
): OpencodeModelCatalog {
  let cache: ProviderModelDto[] = [];
  let fetchedAt = 0;
  // Share one in-flight refresh so concurrent get() callers don't each spawn opencode.
  let inflight: Promise<void> | null = null;

  const refresh = async (): Promise<void> => {
    const executablePath = resolveExecutable("opencode");
    if (executablePath === undefined) {
      cache = [];
      return;
    }
    try {
      cache = parseOpencodeModels(await runCommand(executablePath, ["models"]));
    } catch {
      // Not installed / not authed / timed out — leave the menu on its sentinel.
      cache = [];
    }
  };

  return {
    get: async () => {
      const now = Date.now();
      if (now - fetchedAt > CACHE_TTL_MS) {
        fetchedAt = now;
        inflight ??= refresh().finally(() => {
          inflight = null;
        });
        await inflight;
      } else if (inflight !== null) {
        await inflight;
      }
      return cache;
    },
    invalidate: () => {
      fetchedAt = 0;
    },
  };
}
