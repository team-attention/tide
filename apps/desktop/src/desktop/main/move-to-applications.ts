import { app, dialog } from "electron";
// Extracted from electron-main.ts (spec: navigable-source-structure).

// First-run install UX: when a packaged build is launched from the dmg or
// Downloads (i.e. NOT already in /Applications — the case where a user
// double-clicks the app icon inside the dmg instead of dragging it), offer to
// move it into Applications and relaunch from there. Avoids leaving the app
// running off a read-only mounted dmg (and the leftover mounted volumes). Gated
// to packaged macOS, so `electron .` dev runs and the _electron test harness
// (app.isPackaged === false) never see this prompt. Returns true if a move was
// started — the process then quits and relaunches, so startup should bail.
export function maybeOfferMoveToApplications(): boolean {
  if (process.platform !== "darwin" || !app.isPackaged) {
    return false;
  }
  let alreadyInApplications = true;
  try {
    alreadyInApplications = app.isInApplicationsFolder();
  } catch {
    return false;
  }
  if (alreadyInApplications) {
    return false;
  }
  const choice = dialog.showMessageBoxSync({
    type: "question",
    buttons: ["Move to Applications", "Not Now"],
    defaultId: 0,
    cancelId: 1,
    message: "Move Tide to your Applications folder?",
    detail:
      "Tide isn't in your Applications folder yet. Move it there now so it installs cleanly, updates reliably, and you can eject the disk image.",
  });
  if (choice !== 0) {
    return false;
  }
  try {
    // Moves the .app into /Applications and relaunches from there; on success
    // this process quits. Replace an older copy if one exists, but never clobber
    // a copy that is currently running.
    return app.moveToApplicationsFolder({
      conflictHandler: (conflictType) => conflictType === "exists",
    });
  } catch {
    // Best-effort — if the move fails (permissions etc.), just launch in place.
    return false;
  }
}
