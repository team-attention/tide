import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";

// App self-update control (spec: version-management.md, Lane 1). It lives in the
// Left Rail's top row as one icon-only affordance, so update state stays available
// without floating over the user's work.

type AppUpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "ready"; version: string; notes?: string }
  | { phase: "upToDate"; currentVersion: string }
  | { phase: "error"; message: string };

export function AppUpdateButton(): ReactElement | null {
  const [status, setStatus] = useState<AppUpdateStatus>({ phase: "idle" });

  useEffect(() => {
    const off = window.tide?.onAppUpdateChanged?.((next) => setStatus(next));
    return () => off?.();
  }, []);

  const requestDownload = (version: string): void => {
    setStatus({ phase: "downloading", version, percent: 0 });
    window.tide?.downloadAppUpdate?.();
  };

  if (status.phase === "available") {
    return (
      <button
        type="button"
        className="app-update-button app-update-button--available"
        title={`Tide ${status.version} is available. Download update.`}
        aria-label={`Download Tide ${status.version} update`}
        onClick={() => requestDownload(status.version)}
      >
        <Download size={15} strokeWidth={1.9} aria-hidden />
      </button>
    );
  }

  if (status.phase === "downloading") {
    const percent = Math.max(0, Math.min(100, Math.round(status.percent)));
    return (
      <button
        type="button"
        className="app-update-button app-update-button--downloading"
        title={`Downloading Tide ${status.version}: ${percent}%`}
        aria-label={`Downloading Tide ${status.version}: ${percent}%`}
        disabled
        style={{ "--app-update-progress": `${percent}%` } as CSSProperties}
      >
        <Download size={15} strokeWidth={1.9} aria-hidden />
        <span className="app-update-button__progress" aria-hidden />
      </button>
    );
  }

  if (status.phase === "ready") {
    return (
      <button
        type="button"
        className="app-update-button app-update-button--ready"
        title={`Tide ${status.version} is ready. Restart to update.`}
        aria-label={`Restart Tide to install version ${status.version}`}
        onClick={() => window.tide?.applyAppUpdate?.()}
      >
        <RefreshCw size={15} strokeWidth={1.9} aria-hidden />
      </button>
    );
  }

  if (status.phase === "error") {
    return (
      <button
        type="button"
        className="app-update-button app-update-button--error"
        title={`Update failed: ${status.message}. Retry.`}
        aria-label={`Update failed: ${status.message}. Retry update check.`}
        onClick={() => window.tide?.checkForAppUpdate?.()}
      >
        <Download size={15} strokeWidth={1.9} aria-hidden />
      </button>
    );
  }

  return null;
}
