import { useEffect, useState } from "react";
import type { ReactElement } from "react";

// Global app zoom (Cmd +/-/0). Main zooms the host window's webContents and broadcasts
// the factor; we MIRROR that factor onto every embedded <webview> guest — guests do
// NOT inherit host-window zoom, so without this the embedded pages would stay put while
// the rest of the UI scaled (and pre-fix, the native zoom roles did the inverse: only
// the focused webview zoomed). A small floating indicator shows the current % and resets
// to 100% on click. Spec: host-zoom-shortcuts.

// Module-scoped so newly-mounted webviews (for example an HTML preview after a zoom change)
// can read the current factor from the MutationObserver path below.
let currentZoomFactor = 1;

type ZoomableWebview = HTMLElement & { setZoomFactor?: (factor: number) => void };

function applyZoomToWebview(element: Element | null): void {
  const webview = element as ZoomableWebview | null;
  if (webview?.setZoomFactor === undefined) {
    return;
  }
  try {
    webview.setZoomFactor(currentZoomFactor);
  } catch {
    // The guest isn't attached yet; the dom-ready handler re-applies once it is.
  }
}

function applyZoomToAllWebviews(): void {
  document.querySelectorAll("webview").forEach(applyZoomToWebview);
}

// Apply the current factor now and again on dom-ready: a fresh guest reports zoom 1
// until attached, and setZoomFactor is a no-op before then. Guarded by a WeakSet so a
// webview that's re-observed (e.g. a pane moved between the active/background hosts)
// doesn't accumulate duplicate dom-ready listeners.
const trackedWebviews = new WeakSet<Element>();

function trackWebview(element: Element): void {
  if (trackedWebviews.has(element)) {
    return;
  }
  trackedWebviews.add(element);
  applyZoomToWebview(element);
  element.addEventListener("dom-ready", () => applyZoomToWebview(element));
}

export function GlobalZoomIndicator(): ReactElement | null {
  const [factor, setFactor] = useState(1);
  useEffect(() => {
    let disposed = false;
    const sync = (next: number) => {
      currentZoomFactor = next;
      if (!disposed) {
        setFactor(next);
      }
      applyZoomToAllWebviews();
    };
    // Host zoom persists across a renderer reload but our React state resets to 1 — read
    // the live factor back so the indicator and webviews start in sync.
    void window.tide
      ?.getZoom?.()
      .then((value) => {
        if (typeof value === "number") {
          sync(value);
        }
      })
      .catch(() => {});
    const off = window.tide?.onZoomChanged?.((next) => sync(next));
    // Mirror onto webviews that exist now and any that mount later (new Browser Panes).
    document.querySelectorAll("webview").forEach(trackWebview);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) {
            return;
          }
          if (node.tagName === "WEBVIEW") {
            trackWebview(node);
          } else {
            node.querySelectorAll?.("webview").forEach(trackWebview);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      disposed = true;
      observer.disconnect();
      off?.();
    };
  }, []);

  // Hidden at 100% — like a browser, the indicator only appears once you've zoomed.
  if (Math.abs(factor - 1) < 0.001) {
    return null;
  }
  const percent = Math.round(factor * 100);
  return (
    <button
      type="button"
      className="zoom-indicator"
      title="Reset zoom to 100%"
      aria-label={`Zoom ${percent} percent — click to reset to 100%`}
      onClick={() => window.tide?.resetZoom?.()}
    >
      {`${percent}%`}
    </button>
  );
}
