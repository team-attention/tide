// Spec: responsive narrow-screen column auto-collapse.
import assert from "node:assert/strict";
import test from "node:test";

import { fitColumnsToWidth } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.ts";

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
