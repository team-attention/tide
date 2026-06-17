import { useEffect, useState } from "react";
import type { ReactElement } from "react";

// App self-update pill (spec: version-management.md, Lane 1). A small floating
// affordance, sibling to GlobalZoomIndicator: it appears only once Main reports a
// downloaded update ("ready") and a click applies it (quitAndInstall — no silent
// restart). While still downloading it shows a quiet progress hint; otherwise it
// renders nothing. In dev / unpackaged / test the updater is inert, so this stays
// hidden because Main never pushes a non-idle status.

type AppUpdateStatus =
  | { phase: "idle" }
  | { phase: "checking" }
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

  if (status.phase === "ready") {
    return (
      <button
        type="button"
        className="app-update-pill app-update-pill--ready"
        title={`Tide ${status.version} is ready to install`}
        aria-label={`Tide ${status.version} is ready — update and restart`}
        onClick={() => window.tide?.applyAppUpdate?.()}
      >
        {`Update to ${status.version} & Restart`}
      </button>
    );
  }

  if (status.phase === "downloading") {
    return (
      <span
        className="app-update-pill app-update-pill--downloading"
        title={`Downloading Tide ${status.version}…`}
        aria-label={`Downloading Tide ${status.version}, ${status.percent} percent`}
      >
        {`Downloading update… ${status.percent}%`}
      </span>
    );
  }

  return null;
}
