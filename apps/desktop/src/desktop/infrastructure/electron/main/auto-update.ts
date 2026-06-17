import { app, BrowserWindow, ipcMain } from "electron";
import electronUpdater from "electron-updater";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  mapAutoUpdaterEvent,
  shouldRunAutoUpdater,
  type AppUpdateStatus,
} from "./auto-update-status.ts";
// App self-update bridge (spec: version-management.md, Lane 1). The thin Electron
// shell over the pure auto-update-status core, mirroring notifications.ts over
// notification-policy.ts. electron-updater downloads in the background; the
// renderer's "Update & Restart" click is what actually applies it (quitAndInstall).
// No silent forced restart.

// electron-updater is CommonJS; under NodeNext the default import is the module
// namespace, and `autoUpdater` is the configured singleton off it.
const { autoUpdater } = electronUpdater;

// First check shortly after launch (let the window settle), then periodically.
const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Append-only breadcrumb for the self-update RELAUNCH — a packaged-only path no unit
// test can exercise. The OLD instance logs at apply time; EVERY instance logs the
// single-instance-lock result at startup. Both write to the same userData file, so after
// an update we can tell whether the relaunched instance even started and whether it got
// the lock (lock=false ⇒ the race below; no new startup line ⇒ Squirrel never relaunched).
// Best-effort: diagnostics must never throw or block the app.
export function logUpdateEvent(message: string): void {
  try {
    const line = `${new Date().toISOString()} [v${app.getVersion()}] ${message}\n`;
    appendFileSync(join(app.getPath("userData"), "tide-update.log"), line);
  } catch {
    // never break startup/quit for a log line
  }
}

// Wire app self-update. `getWindow` is called at delivery time so a torn-down
// window is never captured (same pattern as registerNotificationBridge). The
// IPC handlers are always registered so the renderer code is uniform; when the
// updater is inert (dev / unpackaged / test harness) apply and check are no-ops.
export function registerAutoUpdate(getWindow: () => BrowserWindow | undefined): void {
  const isDev = process.argv.includes("--tide-dev-app");
  const active = shouldRunAutoUpdater({ isPackaged: app.isPackaged, isDev });

  ipcMain.handle("tide:app-version", () => app.getVersion());
  ipcMain.handle("tide:app-update-apply", () => {
    if (active) {
      // Release the single-instance lock BEFORE quitting. Squirrel relaunches the new
      // build the instant the old process exits; if the lock is still held, the
      // relaunched instance fails requestSingleInstanceLock() (electron-main.ts) and
      // quits at once — the "Update & Restart closed the app but it never came back"
      // bug. Releasing here frees the lock so the relaunch can acquire it.
      logUpdateEvent("apply: release single-instance lock, quitAndInstall(false, true)");
      app.releaseSingleInstanceLock();
      // isSilent=false keeps the standard installer UX; isForceRunAfter=true
      // relaunches Tide into the new version after install.
      autoUpdater.quitAndInstall(false, true);
    }
  });
  ipcMain.handle("tide:app-update-check", () => {
    if (active) {
      void autoUpdater.checkForUpdates().catch(() => undefined);
    }
  });

  if (!active) {
    return;
  }

  const push = (status: AppUpdateStatus): void => {
    const window = getWindow();
    if (window !== undefined && !window.isDestroyed()) {
      window.webContents.send("tide:app-update-changed", status);
    }
  };

  // The download-progress event carries no version, so remember the version the
  // available/downloaded events report and thread it through the progress status.
  let pendingVersion = "";

  autoUpdater.autoDownload = true;
  // Harmless fallback only: if the user ignores the banner and later quits, the
  // already-downloaded update installs on the next launch. The primary path is
  // still the explicit "Update & Restart" click — never a surprise restart.
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    push(mapAutoUpdaterEvent({ kind: "checking-for-update" }));
  });
  autoUpdater.on("update-available", (info) => {
    pendingVersion = info.version;
    push(mapAutoUpdaterEvent({ kind: "update-available", version: info.version }));
  });
  autoUpdater.on("update-not-available", (info) => {
    push(mapAutoUpdaterEvent({ kind: "update-not-available", currentVersion: info.version }));
  });
  autoUpdater.on("download-progress", (progress) => {
    push(mapAutoUpdaterEvent({ kind: "download-progress", version: pendingVersion, percent: progress.percent }));
  });
  autoUpdater.on("update-downloaded", (info) => {
    pendingVersion = info.version;
    push(
      mapAutoUpdaterEvent({
        kind: "update-downloaded",
        version: info.version,
        notes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
      }),
    );
  });
  autoUpdater.on("error", (error) => {
    push(mapAutoUpdaterEvent({ kind: "error", message: error?.message ?? String(error) }));
  });

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  }, FIRST_CHECK_DELAY_MS);
  setInterval(() => {
    void autoUpdater.checkForUpdates().catch(() => undefined);
  }, CHECK_INTERVAL_MS).unref?.();
}
