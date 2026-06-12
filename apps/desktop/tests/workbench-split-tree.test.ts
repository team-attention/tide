import test from "node:test";
import assert from "node:assert/strict";

import {
  leaf,
  paneIdsInTree,
  buildLinearTree,
  removePane,
  reconcileTree,
  applyDrop,
  setRatioAtPath,
  type WorkbenchSplitNode,
} from "../src/desktop/application/domains/product-shell/state/workbench-split-tree.ts";

test("buildLinearTree keeps every pane, in order", () => {
  const tree = buildLinearTree(["a", "b", "c"]);
  assert.deepEqual(paneIdsInTree(tree), ["a", "b", "c"]);
});

test("removePane collapses the holding split into its sibling", () => {
  const tree: WorkbenchSplitNode = { type: "split", dir: "row", ratio: 0.5, a: leaf("a"), b: leaf("b") };
  assert.deepEqual(removePane(tree, "a"), leaf("b"));
});

test("reconcileTree drops closed panes and appends opened ones", () => {
  const tree = buildLinearTree(["a", "b"]);
  const next = reconcileTree(tree, ["b", "c"]); // a closed, c opened
  assert.deepEqual(paneIdsInTree(next).sort(), ["b", "c"]);
});

test("reconcileTree builds a tree from nothing", () => {
  assert.deepEqual(paneIdsInTree(reconcileTree(null, ["a", "b"])).sort(), ["a", "b"]);
});

test("applyDrop on an edge zone splits beside the target in the right direction/order", () => {
  const tree = buildLinearTree(["a", "b"]); // row split a|b
  // Drop b to the TOP of a => a column split with b above a, b removed from old spot.
  const next = applyDrop(tree, "b", "a", "top");
  assert.deepEqual(paneIdsInTree(next), ["b", "a"]);
  assert.equal(next.type === "split" && next.dir, "col");
  assert.equal(next.type === "split" && next.a.type === "leaf" && next.a.paneId, "b");
});

test("applyDrop right zone keeps the dragged pane second, as a row", () => {
  const tree = buildLinearTree(["a", "b", "c"]);
  const next = applyDrop(tree, "a", "c", "right");
  // a removed from front, re-inserted to the right of c.
  assert.deepEqual(paneIdsInTree(next), ["b", "c", "a"]);
});

test("applyDrop center swaps the two panes in place", () => {
  const tree = buildLinearTree(["a", "b", "c"]);
  const next = applyDrop(tree, "a", "c", "center");
  assert.deepEqual(paneIdsInTree(next), ["c", "b", "a"]);
});

test("applyDrop onto itself is a no-op", () => {
  const tree = buildLinearTree(["a", "b"]);
  assert.deepEqual(applyDrop(tree, "a", "a", "left"), tree);
});

test("setRatioAtPath clamps and updates the addressed split", () => {
  const tree: WorkbenchSplitNode = { type: "split", dir: "row", ratio: 0.5, a: leaf("a"), b: leaf("b") };
  assert.equal((setRatioAtPath(tree, [], 0.9) as { ratio: number }).ratio < 0.9, true); // clamped
  assert.equal((setRatioAtPath(tree, [], 0.3) as { ratio: number }).ratio, 0.3);
});
