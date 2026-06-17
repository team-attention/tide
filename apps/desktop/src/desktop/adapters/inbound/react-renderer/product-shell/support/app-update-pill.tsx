import { useEffect, useState } from "react";
import type { ReactElement } from "react";

// App self-update pill (spec: version-management.md, Lane 1). A small floating
// affordance, sibling to GlobalZoomIndicator. The flow is user-driven and visible:
//   • available   → "Download" button (autoDownload is off; the click starts the pull)
//   • downloading → live progress bar + percent
//   • ready       → "Restart to update" button (quitAndInstall — no silent restart)
//   • error       → "Retry" button (re-check)
// idle / checking / upToDate render nothing. In dev / unpackaged / test the updater is
// inert, so Main never pushes a non-idle status and this stays hidden.

type AppUpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "ready"; version: string; notes?: string }
  | { phase: "upToDate"; currentVersion: string }
  | { phase: "error"; message: string };

export function AppUpdatePill(): ReactElement | null {
  const [status, setStatus] = useState<AppUpdateStatus>({ phase: "idle" });

  useEffect(() => {
    const off = window.tide?.onAppUpdateChanged?.((next) => setStatus(next));
    return () => off?.();
  }, []);

  if (status.phase === "available") {
    return (
      <button
        type="button"
        className="app-update-pill app-update-pill--available"
        title={`Tide ${status.version} is available — click to download`}
        aria-label={`Update available: Tide ${status.version}. Click to download.`}
        onClick={() => window.tide?.downloadAppUpdate?.()}
      >
        {`↓ Update available — Tide ${status.version}`}
      </button>
    );
  }

  if (status.phase === "downloading") {
    return (
      <div
        className="app-update-pill app-update-pill--downloading"
        title={`Downloading Tide ${status.version}…`}
        role="progressbar"
        aria-label={`Downloading Tide ${status.version}`}
        aria-valuenow={status.percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span className="app-update-pill__label">{`Downloading… ${status.percent}%`}</span>
        <span className="app-update-pill__track">
          <span className="app-update-pill__fill" style={{ width: `${status.percent}%` }} />
        </span>
      </div>
    );
  }

  if (status.phase === "ready") {
    return (
      <button
        type="button"
        className="app-update-pill app-update-pill--ready"
        title={`Tide ${status.version} downloaded — restart to install`}
        aria-label={`Tide ${status.version} downloaded — restart to update`}
        onClick={() => window.tide?.applyAppUpdate?.()}
      >
        {`Restart to update — Tide ${status.version}`}
      </button>
    );
  }

  if (status.phase === "error") {
    return (
      <button
        type="button"
        className="app-update-pill app-update-pill--error"
        title={status.message}
        aria-label={`Update failed: ${status.message}. Click to retry.`}
        onClick={() => window.tide?.checkForAppUpdate?.()}
      >
        {"Update failed — Retry"}
      </button>
    );
  }

  return null;
}
