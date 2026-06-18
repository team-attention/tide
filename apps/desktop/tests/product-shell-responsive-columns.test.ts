// Spec: responsive narrow-screen column auto-collapse.
import assert from "node:assert/strict";
import test from "node:test";

import {
  fitColumnsToWidth,
  resizeProductShellColumns,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";

// Mins: left 180, chat 440, workbench 280, fileTree 220 (sum with left = 1120).

test("wide window keeps all requested columns", () => {
  assert.deepEqual(
    fitColumnsToWidth({ windowWidth: 1440, leftRailOpen: true, workbenchOpen: true, fileTreeOpen: true }),
    { workbenchOpen: true, fileTreeOpen: true },
  );
});

test("narrow window drops the FileTree first", () => {
  // 1000 fits left+chat+workbench (900) but not +fileTree (1120).
  assert.deepEqual(
    fitColumnsToWidth({ windowWidth: 1000, leftRailOpen: true, workbenchOpen: true, fileTreeOpen: true }),
    { workbenchOpen: true, fileTreeOpen: false },
  );
});

test("very narrow window drops the Workbench too", () => {
  // 850 can't fit left+chat+workbench (900), so workbench also collapses.
  assert.deepEqual(
    fitColumnsToWidth({ windowWidth: 850, leftRailOpen: true, workbenchOpen: true, fileTreeOpen: true }),
    { workbenchOpen: false, fileTreeOpen: false },
  );
});

test("closing the left rail frees room for more columns", () => {
  // Without the left rail, 940 fits chat+workbench+fileTree.
  assert.deepEqual(
    fitColumnsToWidth({ windowWidth: 1000, leftRailOpen: false, workbenchOpen: true, fileTreeOpen: true }),
    { workbenchOpen: true, fileTreeOpen: true },
  );
});

test("file tree resize redistributes the open workbench and file tree pair", () => {
  const start = { left: 220, workbench: 480, fileTree: 280 };
  assert.deepEqual(
    resizeProductShellColumns({
      edge: "fileTree",
      start,
      dx: -100,
      totalWidth: 1440,
      leftRailOpen: true,
      workbenchOpen: true,
      fileTreeOpen: true,
    }),
    { left: 220, workbench: 380, fileTree: 380 },
  );
});

test("file tree resize clamps against the neighboring workbench minimum", () => {
  const start = { left: 220, workbench: 480, fileTree: 280 };
  assert.deepEqual(
    resizeProductShellColumns({
      edge: "fileTree",
      start,
      dx: -300,
      totalWidth: 1440,
      leftRailOpen: true,
      workbenchOpen: true,
      fileTreeOpen: true,
    }),
    { left: 220, workbench: 320, fileTree: 440 },
  );
});

test("file tree resize clamps against its own minimum and gives space back to workbench", () => {
  const start = { left: 220, workbench: 480, fileTree: 280 };
  assert.deepEqual(
    resizeProductShellColumns({
      edge: "fileTree",
      start,
      dx: 200,
      totalWidth: 1440,
      leftRailOpen: true,
      workbenchOpen: true,
      fileTreeOpen: true,
    }),
    { left: 220, workbench: 520, fileTree: 240 },
  );
});

test("file tree resize first pulls an oversized workbench and file tree pair back inside the viewport budget", () => {
  const start = { left: 220, workbench: 600, fileTree: 420 };
  assert.deepEqual(
    resizeProductShellColumns({
      edge: "fileTree",
      start,
      dx: 0,
      totalWidth: 1440,
      leftRailOpen: true,
      workbenchOpen: true,
      fileTreeOpen: true,
    }),
    { left: 220, workbench: 360, fileTree: 420 },
  );
});
