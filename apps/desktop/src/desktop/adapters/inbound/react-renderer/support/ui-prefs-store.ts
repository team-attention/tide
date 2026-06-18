// Renderer access to persisted UI prefs WITHOUT touching localStorage.
//
// Main reads these prefs from a JSON file and injects them via the preload as
// window.tide.uiPrefs (raw string values keyed by the legacy storage key). Reading that
// injected snapshot is synchronous and instant. WHY this matters: the renderer's FIRST
// synchronous localStorage access at boot blocks ~3.8s while the bundle loads (an Electron
// storage stall) — so the renderer reads prefs from the injected snapshot and writes them
// back to the Main-owned file, never localStorage. See main/ui-prefs.ts and
// docs_v2/specs/thread-list-metadata-first-restore.md.

export function getStoredPref(key: string): string | null {
  const injected = typeof window !== "undefined" ? window.tide?.uiPrefs?.[key] : undefined;
  return typeof injected === "string" ? injected : null;
}

export function setStoredPref(key: string, value: string): void {
  try {
    window.tide?.saveUiPref?.(key, value);
  } catch {
    // non-fatal
  }
}
