import { execFileSync } from "node:child_process";

import type { OpencodeEnvironmentDto, OpencodeVendorDto } from "../../../../shared/contracts/index.ts";

// The opencode vendor on-ramp's backend source (spec: opencode-vendor-onramp.md).
// Reads opencode's OWN machine-global auth (`opencode auth list`,
// ~/.local/share/opencode/auth.json — shared with the terminal CLI, so terminal
// sign-ins are already connected here) and version (`opencode --version`). Both are
// fast local calls, bounded by a timeout and cached per process with a short TTL so
// a new `opencode auth login` is picked up without a restart, mirroring
// opencode-model-catalog.ts.

// The opencode release Tide's on-ramp is verified against. Drives an optional,
// non-blocking "newer than tested" note in the UI; never gates.
export const OPENCODE_TESTED_WITH = "1.17";

// Curated popular vendor tiles (id ↔ label). `id` is exactly what
// `opencode auth login -p <id>` expects (the models.dev provider id). opencode's
// long tail stays reachable via the "All providers…" action (`opencode auth login`
// with no -p); connected-but-uncurated vendors are appended from `auth list`, so
// nothing the user authed is hidden.
export const CURATED_OPENCODE_VENDORS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google" },
  { id: "github-copilot", label: "GitHub Copilot" },
  { id: "groq", label: "Groq" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "xai", label: "xAI" },
];

// Trailing tokens on an `auth list` row that name the auth METHOD (not the vendor).
const METHOD_KEYWORDS = new Set(["oauth", "api", "apikey", "key", "access", "wellknown", "well-known"]);

// opencode renders `auth list` as a styled TUI box; drop SGR color codes (whether
// the capture kept the ESC byte or left a bare `[90m`) and any stray ESC.
const SGR_PATTERN = /\x1b?\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(SGR_PATTERN, "").replace(/\x1b/g, "");
}

export interface OpencodeAuthEntry {
  name: string;
  method?: string;
}

// Parse `opencode auth list` into connected entries: the `●  <Name…>  <method>`
// rows, ignoring the frame (┌ │ └) and the header/footer. Vendor names may contain
// spaces ("GitHub Copilot"); the method is the trailing keyword token when present.
export function parseOpencodeAuthList(stdout: string): OpencodeAuthEntry[] {
  const entries: OpencodeAuthEntry[] = [];
  for (const raw of stripAnsi(stdout).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("●")) {
      continue;
    }
    const rest = line.slice(1).trim();
    if (rest.length === 0) {
      continue;
    }
    const tokens = rest.split(/\s+/);
    const last = tokens[tokens.length - 1];
    if (tokens.length >= 2 && METHOD_KEYWORDS.has(last.toLowerCase())) {
      entries.push({ name: tokens.slice(0, -1).join(" "), method: last.toLowerCase() });
    } else {
      entries.push({ name: rest });
    }
  }
  return entries;
}

function vendorIdFromName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

// Merge the curated tiles with `auth list` entries. A curated tile is connected when
// an entry's name (or derived id) matches it case-insensitively; connected entries
// matching no curated tile are appended (popular:false) so long-tail logins show.
export function buildOpencodeVendors(entries: OpencodeAuthEntry[]): OpencodeVendorDto[] {
  const matched = new Set<number>();
  const vendors: OpencodeVendorDto[] = CURATED_OPENCODE_VENDORS.map((curated) => {
    const idx = entries.findIndex(
      (entry, i) =>
        !matched.has(i) &&
        (entry.name.toLowerCase() === curated.label.toLowerCase() ||
          vendorIdFromName(entry.name) === curated.id),
    );
    if (idx >= 0) {
      matched.add(idx);
      return { id: curated.id, label: curated.label, connected: true, method: entries[idx].method, popular: true };
    }
    return { id: curated.id, label: curated.label, connected: false, popular: true };
  });
  entries.forEach((entry, i) => {
    if (!matched.has(i)) {
      vendors.push({
        id: vendorIdFromName(entry.name),
        label: entry.name,
        connected: true,
        method: entry.method,
        popular: false,
      });
    }
  });
  return vendors;
}

const CACHE_TTL_MS = 60_000;

export interface OpencodeVendorCatalog {
  get: () => OpencodeVendorDto[];
  environment: () => OpencodeEnvironmentDto;
  // Drop cached vendor/version so the next call re-reads `opencode auth list` (e.g.
  // right after a new vendor sign-in).
  invalidate: () => void;
}

export function createOpencodeVendorCatalog(
  resolveExecutable: (command: "opencode") => string | undefined,
): OpencodeVendorCatalog {
  let vendorCache: OpencodeVendorDto[] = buildOpencodeVendors([]);
  let vendorFetchedAt = 0;
  let versionCache: string | undefined;
  let versionFetchedAt = 0;

  const run = (executablePath: string, args: string[]): string =>
    execFileSync(executablePath, args, {
      encoding: "utf8",
      // Both `auth list` and `--version` are fast local calls; keep the synchronous
      // call short so a hung CLI can't block the backend for long.
      timeout: 1_000,
      stdio: ["ignore", "pipe", "ignore"],
    });

  return {
    get: () => {
      const executablePath = resolveExecutable("opencode");
      if (executablePath === undefined) {
        vendorCache = buildOpencodeVendors([]);
        return vendorCache;
      }
      const now = Date.now();
      if (now - vendorFetchedAt > CACHE_TTL_MS) {
        vendorFetchedAt = now;
        try {
          vendorCache = buildOpencodeVendors(parseOpencodeAuthList(run(executablePath, ["auth", "list"])));
        } catch {
          // Not installed / errored / timed out — curated tiles, none connected.
          vendorCache = buildOpencodeVendors([]);
        }
      }
      return vendorCache;
    },
    environment: () => {
      const executablePath = resolveExecutable("opencode");
      if (executablePath === undefined) {
        return { testedWith: OPENCODE_TESTED_WITH };
      }
      const now = Date.now();
      if (now - versionFetchedAt > CACHE_TTL_MS) {
        versionFetchedAt = now;
        try {
          versionCache = run(executablePath, ["--version"])
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0);
        } catch {
          versionCache = undefined;
        }
      }
      return { version: versionCache, testedWith: OPENCODE_TESTED_WITH, executablePath };
    },
    invalidate: () => {
      vendorFetchedAt = 0;
      versionFetchedAt = 0;
    },
  };
}
