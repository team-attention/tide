import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAppDataRoot } from "./backend-bridge.ts";
import { snapshotFromIndexJson, type InitialThreadListSnapshot } from "./thread-list-snapshot-parse.ts";

export type { InitialThreadListSnapshot };

// Synchronous, index-only snapshot for the first React render (spec:
// thread-list-first-paint-snapshot.md). This intentionally never scans
// threads/*/thread.json; if the index is missing/legacy/corrupt, the renderer shows the
// normal skeleton until the backend's authoritative thread.listed. The pure
// parse/validate lives in thread-list-snapshot-parse.ts (unit-tested).
export function readInitialThreadListSnapshot(): InitialThreadListSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(resolveAppDataRoot(), "threads", "index.json"), "utf8")) as unknown;
  } catch {
    return null;
  }
  return snapshotFromIndexJson(parsed);
}
