import type { WebContents } from "electron";
// Extracted from app-menu.ts so the ladder math is pure + unit-testable.

// Discrete zoom stops (factor = percent / 100), mirroring a browser's zoom ladder so
// the indicator shows clean round percentages (50%, 67%, 75%, … 100% … 300%) instead
// of the 1.2^level steps Electron's native zoom roles produce.
export const ZOOM_FACTORS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

const EPSILON = 0.001;

// Step one stop along the ladder: zoom-in (+1) picks the first stop strictly above the
// current factor, zoom-out (-1) the last strictly below — clamped at the ends. Works
// even if `current` sits off-ladder (e.g. a persisted value), so a press always lands
// on a clean stop.
export function steppedZoomFactor(current: number, direction: 1 | -1): number {
  if (direction === 1) {
    return ZOOM_FACTORS.find((factor) => factor > current + EPSILON) ?? ZOOM_FACTORS[ZOOM_FACTORS.length - 1];
  }
  let previous = ZOOM_FACTORS[0];
  for (const factor of ZOOM_FACTORS) {
    if (factor < current - EPSILON) {
      previous = factor;
    } else {
      break;
    }
  }
  return previous;
}

// Set the HOST window's zoom factor and tell its renderer the new value. We zoom the
// host webContents directly (not via the focused-webContents zoom roles) so Cmd +/-
// scales the Tide UI even when a Browser Pane <webview> has focus; the renderer mirrors
// the broadcast factor onto each <webview> guest (which doesn't inherit host zoom) so
// the WHOLE app scales together. Spec: host-zoom-shortcuts.
export function applyHostZoom(host: WebContents, factor: number): void {
  if (host.isDestroyed()) {
    return;
  }
  host.setZoomFactor(factor);
  host.send("tide:zoom-changed", factor);
}
