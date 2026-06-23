// Pure app self-update status logic (spec: version-management.md, Lane 1). Kept
// free of electron / electron-updater imports so it unit-tests without Electron;
// the thin bridge (auto-update.ts) owns the actual autoUpdater wiring, mirroring
// how notification-policy.ts is the pure core behind notifications.ts.

// The renderer-facing status. A discriminated union so the App Chrome pill renders
// exactly one of: nothing (idle/checking/upToDate), a "Download" affordance
// (available — autoDownload is OFF, so the user starts the download), a progress hint
// (downloading), the "Restart to update" affordance (ready), or a retry (error).
export type AppUpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "ready"; version: string; notes?: string }
  | { phase: "upToDate"; currentVersion: string }
  | { phase: "error"; message: string };

// electron-updater lifecycle events, normalized to a tagged shape at the bridge
// so this mapper stays pure and exhaustively testable.
export type AutoUpdaterEvent =
  | { kind: "checking-for-update" }
  | { kind: "update-available"; version: string }
  | { kind: "update-not-available"; currentVersion: string }
  | { kind: "download-progress"; version: string; percent: number }
  | { kind: "update-downloaded"; version: string; notes?: string }
  | { kind: "error"; message: string };

export function mapAutoUpdaterEvent(event: AutoUpdaterEvent): AppUpdateStatus {
  switch (event.kind) {
    case "checking-for-update":
      return { phase: "checking" };
    // autoDownload is OFF: surface the available update and wait for the user to click
    // Download (which calls autoUpdater.downloadUpdate()) — no surprise background pull.
    case "update-available":
      return { phase: "available", version: event.version };
    case "update-not-available":
      return { phase: "upToDate", currentVersion: event.currentVersion };
    case "download-progress":
      return { phase: "downloading", version: event.version, percent: clampPercent(event.percent) };
    case "update-downloaded":
      return { phase: "ready", version: event.version, notes: event.notes };
    case "error":
      return { phase: "error", message: event.message };
  }
}

function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(percent)));
}

// Whether the auto-updater should run at all. It is inert outside a packaged,
// non-dev build: a dev `electron . --tide-dev-app` run, an unpackaged checkout,
// and the playwright/_electron harness must never check, download, or install
// (no signed feed, and a surprise relaunch would break tests). Mirrors the
// packaged-only gate maybeOfferMoveToApplications already uses.
export function shouldRunAutoUpdater(input: {
  isPackaged: boolean;
  isDev: boolean;
}): boolean {
  return input.isPackaged && !input.isDev;
}

// Throttle automatic checks. The app re-checks for updates on a short periodic poll AND
// whenever the user returns focus to Tide (a new build often lands while it is open). The
// focus event can fire rapidly, so allow a check only when at least minGapMs has elapsed
// since the last one. Explicit user-initiated checks (the error-retry button) bypass this.
export function shouldRunScheduledCheck(input: {
  lastCheckAt: number;
  now: number;
  minGapMs: number;
}): boolean {
  return input.now - input.lastCheckAt >= input.minGapMs;
}
