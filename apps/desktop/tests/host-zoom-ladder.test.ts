import test from "node:test";
import assert from "node:assert/strict";

import { ZOOM_FACTORS, steppedZoomFactor, applyHostZoom } from "../src/desktop/infrastructure/electron/main/zoom.ts";

test("zoom-in steps to the next higher ladder stop", () => {
  assert.equal(steppedZoomFactor(1, 1), 1.1);
  assert.equal(steppedZoomFactor(1.1, 1), 1.25);
  assert.equal(steppedZoomFactor(0.5, 1), 0.67);
});

test("zoom-out steps to the next lower ladder stop", () => {
  assert.equal(steppedZoomFactor(1, -1), 0.9);
  assert.equal(steppedZoomFactor(1.25, -1), 1.1);
  assert.equal(steppedZoomFactor(3, -1), 2.5);
});

test("stepping clamps at the ends of the ladder", () => {
  const max = ZOOM_FACTORS[ZOOM_FACTORS.length - 1];
  const min = ZOOM_FACTORS[0];
  assert.equal(steppedZoomFactor(max, 1), max);
  assert.equal(steppedZoomFactor(min, -1), min);
});

test("an off-ladder current factor still lands on a clean neighbouring stop", () => {
  // e.g. a persisted 1.2 (between 1.1 and 1.25): up → 1.25, down → 1.1.
  assert.equal(steppedZoomFactor(1.2, 1), 1.25);
  assert.equal(steppedZoomFactor(1.2, -1), 1.1);
});

test("applyHostZoom sets the host factor and broadcasts it to the renderer", () => {
  const calls: { setZoomFactor: number[]; send: Array<[string, number]> } = { setZoomFactor: [], send: [] };
  const host = {
    isDestroyed: () => false,
    setZoomFactor: (factor: number) => calls.setZoomFactor.push(factor),
    send: (channel: string, factor: number) => calls.send.push([channel, factor]),
  };
  // The stub stands in for an Electron WebContents (only the members applyHostZoom uses).
  applyHostZoom(host as unknown as Parameters<typeof applyHostZoom>[0], 1.5);
  assert.deepEqual(calls.setZoomFactor, [1.5]);
  assert.deepEqual(calls.send, [["tide:zoom-changed", 1.5]]);
});

test("applyHostZoom is a no-op on a destroyed host", () => {
  let touched = false;
  const host = {
    isDestroyed: () => true,
    setZoomFactor: () => {
      touched = true;
    },
    send: () => {
      touched = true;
    },
  };
  applyHostZoom(host as unknown as Parameters<typeof applyHostZoom>[0], 2);
  assert.equal(touched, false);
});
