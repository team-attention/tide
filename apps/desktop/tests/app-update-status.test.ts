import assert from "node:assert/strict";
import test from "node:test";

import {
  mapAutoUpdaterEvent,
  shouldRunAutoUpdater,
  shouldRunScheduledCheck,
} from "../src/desktop/infrastructure/electron/main/auto-update-status.ts";

// Spec: version-management.md (Lane 1). The pure core of app self-update.

test("mapAutoUpdaterEvent: checking → checking", () => {
  assert.deepEqual(mapAutoUpdaterEvent({ kind: "checking-for-update" }), { phase: "checking" });
});

test("mapAutoUpdaterEvent: available waits for the user (autoDownload off)", () => {
  assert.deepEqual(mapAutoUpdaterEvent({ kind: "update-available", version: "0.1.64" }), {
    phase: "available",
    version: "0.1.64",
  });
});

test("mapAutoUpdaterEvent: not-available → upToDate with current version", () => {
  assert.deepEqual(mapAutoUpdaterEvent({ kind: "update-not-available", currentVersion: "0.1.63" }), {
    phase: "upToDate",
    currentVersion: "0.1.63",
  });
});

test("mapAutoUpdaterEvent: progress is clamped and rounded", () => {
  assert.deepEqual(mapAutoUpdaterEvent({ kind: "download-progress", version: "0.1.64", percent: 42.7 }), {
    phase: "downloading",
    version: "0.1.64",
    percent: 43,
  });
  assert.equal(
    (mapAutoUpdaterEvent({ kind: "download-progress", version: "x", percent: 150 }) as { percent: number }).percent,
    100,
  );
  assert.equal(
    (mapAutoUpdaterEvent({ kind: "download-progress", version: "x", percent: Number.NaN }) as { percent: number }).percent,
    0,
  );
});

test("mapAutoUpdaterEvent: downloaded → ready (the click-to-apply state)", () => {
  assert.deepEqual(mapAutoUpdaterEvent({ kind: "update-downloaded", version: "0.1.64", notes: "fixes" }), {
    phase: "ready",
    version: "0.1.64",
    notes: "fixes",
  });
});

test("mapAutoUpdaterEvent: error carries the message", () => {
  assert.deepEqual(mapAutoUpdaterEvent({ kind: "error", message: "feed unreachable" }), {
    phase: "error",
    message: "feed unreachable",
  });
});

test("shouldRunAutoUpdater: only a packaged, non-dev build runs the updater", () => {
  assert.equal(shouldRunAutoUpdater({ isPackaged: true, isDev: false }), true);
  assert.equal(shouldRunAutoUpdater({ isPackaged: true, isDev: true }), false); // dev run
  assert.equal(shouldRunAutoUpdater({ isPackaged: false, isDev: false }), false); // unpackaged / harness
  assert.equal(shouldRunAutoUpdater({ isPackaged: false, isDev: true }), false);
});

test("shouldRunScheduledCheck: throttles bursts but allows the first check and spaced ones", () => {
  const minGapMs = 2 * 60 * 1000;
  const base = 1_700_000_000_000; // a real wall-clock Date.now()
  // First ever check (lastCheckAt 0, real now) always runs — now - 0 ≫ gap.
  assert.equal(shouldRunScheduledCheck({ lastCheckAt: 0, now: base, minGapMs }), true);
  // A second trigger within the gap (e.g. focus right after the launch check) is suppressed.
  assert.equal(shouldRunScheduledCheck({ lastCheckAt: base, now: base + 10_000, minGapMs }), false);
  // Exactly at the gap boundary it runs again.
  assert.equal(shouldRunScheduledCheck({ lastCheckAt: base, now: base + minGapMs, minGapMs }), true);
  // Well past the gap (e.g. returning focus minutes later) runs.
  assert.equal(shouldRunScheduledCheck({ lastCheckAt: base, now: base + minGapMs * 5, minGapMs }), true);
});
