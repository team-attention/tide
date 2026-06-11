// A binary split-tree layout for the Workbench split mode — the model the Tide
// Terminal workspace uses, ported to TS. A pane is a Leaf; a Split divides its
// area into two children along a direction at a ratio. Dragging a pane onto
// another pane's edge inserts a new Split (top/bottom => column, left/right =>
// row); dropping on the center swaps the two panes. The tree is reconciled
// against the live visible-pane set so opening/closing panes keeps it valid.
//
// Pure + framework-free so it is fully unit-testable without React.

export type SplitDirection = "row" | "col";
export type DropZone = "left" | "right" | "top" | "bottom" | "center";

export type WorkbenchSplitNode =
  | { type: "leaf"; paneId: string }
  | { type: "split"; dir: SplitDirection; ratio: number; a: WorkbenchSplitNode; b: WorkbenchSplitNode };

const MIN_RATIO = 0.12;

export function leaf(paneId: string): WorkbenchSplitNode {
  return { type: "leaf", paneId };
}

// All pane ids present in the tree, left-to-right / top-to-bottom.
export function paneIdsInTree(node: WorkbenchSplitNode | null): string[] {
  if (node === null) {
    return [];
  }
  if (node.type === "leaf") {
    return [node.paneId];
  }
  return [...paneIdsInTree(node.a), ...paneIdsInTree(node.b)];
}

// A balanced-ish row of leaves for `paneIds` (used when first entering split
// mode, before any manual arrangement).
export function buildLinearTree(paneIds: string[], dir: SplitDirection = "row"): WorkbenchSplitNode | null {
  if (paneIds.length === 0) {
    return null;
  }
  if (paneIds.length === 1) {
    return leaf(paneIds[0]);
  }
  const mid = Math.floor(paneIds.length / 2);
  return {
    type: "split",
    dir,
    ratio: mid / paneIds.length,
    a: buildLinearTree(paneIds.slice(0, mid), dir),
    b: buildLinearTree(paneIds.slice(mid), dir),
  } as WorkbenchSplitNode;
}

// Remove a pane, collapsing the split that held it (its sibling takes the space).
export function removePane(node: WorkbenchSplitNode | null, paneId: string): WorkbenchSplitNode | null {
  if (node === null) {
    return null;
  }
  if (node.type === "leaf") {
    return node.paneId === paneId ? null : node;
  }
  const a = removePane(node.a, paneId);
  const b = removePane(node.b, paneId);
  if (a === null) {
    return b;
  }
  if (b === null) {
    return a;
  }
  return { ...node, a, b };
}

// Reconcile the tree with the live visible-pane set: drop panes that closed,
// append panes that opened (as a row split at the root), and rebuild from
// scratch when there is no tree yet.
export function reconcileTree(
  node: WorkbenchSplitNode | null,
  visiblePaneIds: string[],
): WorkbenchSplitNode | null {
  const visible = new Set(visiblePaneIds);
  let next = node;
  for (const paneId of paneIdsInTree(node)) {
    if (!visible.has(paneId)) {
      next = removePane(next, paneId);
    }
  }
  const present = new Set(paneIdsInTree(next));
  for (const paneId of visiblePaneIds) {
    if (!present.has(paneId)) {
      next = next === null ? leaf(paneId) : { type: "split", dir: "row", ratio: 0.5, a: next, b: leaf(paneId) };
    }
  }
  return next;
}

// Set the ratio of the split whose path matches `path` (sequence of "a"/"b").
export function setRatioAtPath(
  node: WorkbenchSplitNode,
  path: ("a" | "b")[],
  ratio: number,
): WorkbenchSplitNode {
  const clamped = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, ratio));
  if (path.length === 0) {
    return node.type === "split" ? { ...node, ratio: clamped } : node;
  }
  if (node.type !== "split") {
    return node;
  }
  const [head, ...rest] = path;
  return head === "a"
    ? { ...node, a: setRatioAtPath(node.a, rest, ratio) }
    : { ...node, b: setRatioAtPath(node.b, rest, ratio) };
}

// Drop `draggedPaneId` onto `targetPaneId` in `zone`. Center swaps the two; an
// edge zone removes the dragged pane and re-inserts it as a new split beside the
// target (left/top => dragged first; right/bottom => dragged second).
export function applyDrop(
  node: WorkbenchSplitNode,
  draggedPaneId: string,
  targetPaneId: string,
  zone: DropZone,
): WorkbenchSplitNode {
  if (draggedPaneId === targetPaneId) {
    return node;
  }
  if (zone === "center") {
    return swapPanes(node, draggedPaneId, targetPaneId);
  }
  const without = removePane(node, draggedPaneId);
  if (without === null) {
    return node;
  }
  const dir: SplitDirection = zone === "left" || zone === "right" ? "row" : "col";
  const draggedFirst = zone === "left" || zone === "top";
  const inserted = insertBeside(without, targetPaneId, draggedPaneId, dir, draggedFirst);
  return inserted ?? node;
}

function swapPanes(node: WorkbenchSplitNode, x: string, y: string): WorkbenchSplitNode {
  if (node.type === "leaf") {
    if (node.paneId === x) return leaf(y);
    if (node.paneId === y) return leaf(x);
    return node;
  }
  return { ...node, a: swapPanes(node.a, x, y), b: swapPanes(node.b, x, y) };
}

function insertBeside(
  node: WorkbenchSplitNode,
  targetPaneId: string,
  newPaneId: string,
  dir: SplitDirection,
  newFirst: boolean,
): WorkbenchSplitNode | null {
  if (node.type === "leaf") {
    if (node.paneId !== targetPaneId) {
      return null;
    }
    const target = leaf(targetPaneId);
    const added = leaf(newPaneId);
    return {
      type: "split",
      dir,
      ratio: 0.5,
      a: newFirst ? added : target,
      b: newFirst ? target : added,
    };
  }
  const a = insertBeside(node.a, targetPaneId, newPaneId, dir, newFirst);
  if (a !== null) {
    return { ...node, a };
  }
  const b = insertBeside(node.b, targetPaneId, newPaneId, dir, newFirst);
  if (b !== null) {
    return { ...node, b };
  }
  return null;
}
