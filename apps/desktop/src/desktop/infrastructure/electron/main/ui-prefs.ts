import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Renderer UI preferences (theme, left-rail order, list/worktree settings, preferred
// Start Composer, and last-known provider catalog snapshots) owned by MAIN, not renderer localStorage. WHY: the renderer's FIRST
// synchronous localStorage access at boot blocks ~3.8s while the 3 MB module loads (an
// Electron storage-init/contention stall — see thread-list-metadata-first-restore.md). So
// Main reads these prefs from a small JSON file (Node fs, instant); the renderer's preload
// pulls them synchronously over IPC (`tide:get-ui-prefs`) and exposes them as
// `window.tide.uiPrefs` — zero storage access on the boot path. Values are raw strings,
// mirroring the old localStorage entries, so the renderer's existing parse logic is unchanged.

function prefsFilePath(): string {
  // userData in production; TIDE_APP_DATA_ROOT lets the test/verification harness redirect
  // it (mirrors the backend data-root + tide-boot.log override).
  return join(process.env.TIDE_APP_DATA_ROOT ?? app.getPath("userData"), "ui-prefs.json");
}

export function readUiPrefs(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(prefsFilePath(), "utf8")) as unknown;
    if (parsed !== null && typeof parsed === "object") {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string") {
          out[key] = value;
        }
      }
      return out;
    }
  } catch {
    // Missing/corrupt file → no stored prefs yet (first run, or pre-migration).
  }
  return {};
}

// Merge a single key (called from the renderer on a pref change, and during the one-time
// localStorage→file migration). Best-effort; a write failure only loses persistence.
export function saveUiPref(key: string, value: string): void {
  try {
    const current = readUiPrefs();
    current[key] = value;
    writeFileSync(prefsFilePath(), JSON.stringify(current));
  } catch {
    // non-fatal
  }
}
