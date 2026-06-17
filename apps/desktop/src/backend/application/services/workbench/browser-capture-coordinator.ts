import type { BrowserPaneScreenshot } from "../../domains/workbench/workbench.ts";

// Correlates an observe-time pixel-capture request with the renderer's response. observe sets
// a Browser Pane's `pendingCapture` (captureId) and broadcasts it; the renderer host captures
// the live <webview> and reports back via update_browser_capture_result, which resolves the
// matching captureId here. A capture that never reports (pane closed, guest not painting)
// times out to `undefined` so observe degrades to the last cached screenshot / DOM text
// instead of hanging the agent's tool call.
// Spec: docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.

interface PendingCapture {
  resolve: (screenshot: BrowserPaneScreenshot | undefined) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BrowserCaptureCoordinatorDeps {
  setTimeoutFn?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class BrowserCaptureCoordinator {
  private readonly pending = new Map<string, PendingCapture>();
  private readonly setTimeoutFn: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => void;

  constructor(deps: BrowserCaptureCoordinatorDeps = {}) {
    this.setTimeoutFn = deps.setTimeoutFn ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimeoutFn = deps.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
  }

  // Await the renderer's capture for captureId. Resolves with the screenshot when the renderer
  // reports it, or `undefined` after timeoutMs. A second request for the same captureId (should
  // not happen — captureIds are unique) supersedes the first with `undefined`.
  request(captureId: string, timeoutMs: number): Promise<BrowserPaneScreenshot | undefined> {
    return new Promise((resolve) => {
      const existing = this.pending.get(captureId);
      if (existing !== undefined) {
        this.clearTimeoutFn(existing.timer);
        existing.resolve(undefined);
      }
      const timer = this.setTimeoutFn(() => {
        this.pending.delete(captureId);
        resolve(undefined);
      }, timeoutMs);
      // Don't let a pending capture timer keep the backend process alive on its own.
      (timer as { unref?: () => void }).unref?.();
      this.pending.set(captureId, { resolve, timer });
    });
  }

  // Resolve a waiting request with the renderer's captured screenshot (or undefined if the
  // renderer could not capture). Returns false when no request is waiting (already timed out or
  // unknown captureId) so the caller can ignore a late/duplicate report.
  resolve(captureId: string, screenshot: BrowserPaneScreenshot | undefined): boolean {
    const entry = this.pending.get(captureId);
    if (entry === undefined) {
      return false;
    }
    this.clearTimeoutFn(entry.timer);
    this.pending.delete(captureId);
    entry.resolve(screenshot);
    return true;
  }
}
