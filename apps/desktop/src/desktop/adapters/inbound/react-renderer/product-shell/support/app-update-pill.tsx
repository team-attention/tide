import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { keyframes, styled } from "styled-components";

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
      <AppUpdateControl
        type="button"
        data-app-update-control="true"
        data-phase="available"
        title={`Tide ${status.version} is available. Download update.`}
        aria-label={`Download Tide ${status.version} update`}
        onClick={() => requestDownload(status.version)}
      >
        <Download size={15} strokeWidth={1.9} aria-hidden />
      </AppUpdateControl>
    );
  }

  if (status.phase === "downloading") {
    const percent = Math.max(0, Math.min(100, Math.round(status.percent)));
    return (
      <AppUpdateControl
        type="button"
        data-app-update-control="true"
        data-phase="downloading"
        title={`Downloading Tide ${status.version}: ${percent}%`}
        aria-label={`Downloading Tide ${status.version}: ${percent}%`}
        disabled
        style={{ "--app-update-progress": `${percent}%` } as CSSProperties}
      >
        <Download size={15} strokeWidth={1.9} aria-hidden />
        <AppUpdateProgress aria-hidden />
      </AppUpdateControl>
    );
  }

  if (status.phase === "ready") {
    return (
      <AppUpdateControl
        type="button"
        data-app-update-control="true"
        data-phase="ready"
        title={`Tide ${status.version} is ready. Restart to update.`}
        aria-label={`Restart Tide to install version ${status.version}`}
        onClick={() => window.tide?.applyAppUpdate?.()}
      >
        <RefreshCw size={15} strokeWidth={1.9} aria-hidden />
      </AppUpdateControl>
    );
  }

  if (status.phase === "error") {
    return (
      <AppUpdateControl
        type="button"
        data-app-update-control="true"
        data-phase="error"
        title={`Update failed: ${status.message}. Retry.`}
        aria-label={`Update failed: ${status.message}. Retry update check.`}
        onClick={() => window.tide?.checkForAppUpdate?.()}
      >
        <Download size={15} strokeWidth={1.9} aria-hidden />
      </AppUpdateControl>
    );
  }

  return null;
}

const appUpdateSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const AppUpdateControl = styled.button`
  position: relative;
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  overflow: hidden;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }

  &:focus-visible {
    outline: 2px solid var(--tide-action);
    outline-offset: 2px;
  }

  &[data-phase="available"] {
    color: var(--tide-action);
  }

  &[data-phase="ready"] {
    background: var(--tide-text);
    color: var(--tide-bg);
  }

  &[data-phase="ready"]:hover {
    background: color-mix(in srgb, var(--tide-text) 88%, var(--tide-bg));
    color: var(--tide-bg);
  }

  &[data-phase="error"] {
    color: var(--tide-danger);
  }

  &[data-phase="error"]:hover {
    background: rgba(var(--tide-danger-rgb), 0.12);
    color: var(--tide-danger);
  }

  &[data-phase="downloading"] {
    color: var(--tide-action);
    cursor: default;
    opacity: 0.95;
  }

  &[data-phase="downloading"]:disabled {
    color: var(--tide-action);
  }

  &[data-phase="downloading"] svg {
    opacity: 0.45;
  }

  &[data-phase="downloading"]::after {
    content: "";
    position: absolute;
    inset: 6px;
    border: 1.5px solid color-mix(in srgb, currentColor 24%, transparent);
    border-top-color: currentColor;
    border-radius: 999px;
    animation: ${appUpdateSpin} 800ms linear infinite;
  }
`;

const AppUpdateProgress = styled.span`
  position: absolute;
  left: 5px;
  bottom: 4px;
  width: var(--app-update-progress, 0%);
  max-width: calc(100% - 10px);
  height: 2px;
  border-radius: 999px;
  background: currentColor;
  transition: width 160ms ease;
`;
