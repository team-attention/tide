import { useEffect, useState } from "react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export type ProductShellColumnWidths = { left: number; workbench: number; fileTree: number };
export type ProductShellResizeEdge = "left" | "workbench" | "fileTree";
export const PRODUCT_SHELL_CHAT_MIN = 440;

// Slightly longer than the CSS grid transition (260ms) so a closing column stays
// mounted until its collapse animation finishes, then unmounts.
const COLUMN_TRANSITION_MS = 300;

// Animated presence for a layout column: keeps it mounted through an exit
// transition so opening/closing animates the grid track (0 <-> width) smoothly
// instead of snapping. `mounted` gates rendering + the grid track; `visible`
// drives the open (full) vs collapsed (0) track width.
export function useColumnPresence(open: boolean): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Reveal after the collapsed (0px) track has actually painted, or the grid
      // jumps straight to full width with no transition. A single rAF runs before
      // paint (React batches setVisible into the same frame), so use a double rAF:
      // frame 1 lets 0px paint, frame 2 flips to full width -> the track animates.
      // No rAF in tests -> reveal immediately.
      if (typeof requestAnimationFrame === "undefined") {
        setVisible(true);
        return;
      }
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        // Force the collapsed (0px) track to commit to layout BEFORE revealing.
        // Without this, the very first open after launch can coalesce the 0px and
        // full-width frames into one paint, so the grid snaps instead of animating
        // (subsequent opens are already warmed up). A reflow read fixes the first.
        if (typeof document !== "undefined" && document.body) {
          void document.body.offsetHeight;
        }
        inner = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setVisible(false);
    const timer = setTimeout(() => setMounted(false), COLUMN_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return { mounted, visible };
}

// Min widths used to decide which columns fit (mirrors the body grid minmax).
const COLUMN_MINS = { left: 180, chat: PRODUCT_SHELL_CHAT_MIN, workbench: 280, fileTree: 220 } as const;
const RESIZE_MINS = { left: 200, chat: PRODUCT_SHELL_CHAT_MIN, workbench: 320, fileTree: 240 } as const;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function resizeProductShellColumns(input: {
  edge: ProductShellResizeEdge;
  start: ProductShellColumnWidths;
  dx: number;
  totalWidth: number;
  leftRailOpen: boolean;
  workbenchOpen: boolean;
  fileTreeOpen: boolean;
}): ProductShellColumnWidths {
  const total = Math.max(0, input.totalWidth);
  const leftWidth = input.leftRailOpen ? input.start.left : 0;

  if (input.edge === "left") {
    const reserved =
      (input.workbenchOpen ? input.start.workbench : 0) +
      (input.fileTreeOpen ? input.start.fileTree : 0);
    const max = Math.max(RESIZE_MINS.left, total - reserved - RESIZE_MINS.chat);
    return { ...input.start, left: clamp(input.start.left + input.dx, RESIZE_MINS.left, max) };
  }

  if (input.edge === "workbench") {
    const reserved = leftWidth + (input.fileTreeOpen ? input.start.fileTree : 0);
    const max = Math.max(RESIZE_MINS.workbench, total - reserved - RESIZE_MINS.chat);
    return {
      ...input.start,
      workbench: clamp(input.start.workbench - input.dx, RESIZE_MINS.workbench, max),
    };
  }

  if (input.workbenchOpen && input.fileTreeOpen) {
    const budget = total - leftWidth - RESIZE_MINS.chat;
    const minPair = RESIZE_MINS.workbench + RESIZE_MINS.fileTree;
    const pairWidth = Math.max(
      minPair,
      Math.min(input.start.workbench + input.start.fileTree, budget),
    );
    const fileTree = clamp(
      input.start.fileTree - input.dx,
      RESIZE_MINS.fileTree,
      pairWidth - RESIZE_MINS.workbench,
    );
    return {
      ...input.start,
      workbench: pairWidth - fileTree,
      fileTree,
    };
  }

  const reserved = leftWidth + (input.workbenchOpen ? input.start.workbench : 0);
  const max = Math.max(RESIZE_MINS.fileTree, total - reserved - RESIZE_MINS.chat);
  return {
    ...input.start,
    fileTree: clamp(input.start.fileTree - input.dx, RESIZE_MINS.fileTree, max),
  };
}

// Responsive auto-collapse: given the window width and the user's open/closed
// intent, returns which of Workbench/FileTree actually fit. Drops the lowest
// priority first (FileTree, then Workbench). Intent is preserved by the caller,
// so columns reappear when the window widens again.
export function fitColumnsToWidth(input: {
  windowWidth: number;
  leftRailOpen: boolean;
  workbenchOpen: boolean;
  fileTreeOpen: boolean;
}): { workbenchOpen: boolean; fileTreeOpen: boolean } {
  const base = (input.leftRailOpen ? COLUMN_MINS.left : 0) + COLUMN_MINS.chat;
  const fits = (wb: boolean, ft: boolean): boolean =>
    base + (wb ? COLUMN_MINS.workbench : 0) + (ft ? COLUMN_MINS.fileTree : 0) <= input.windowWidth;
  let workbenchOpen = input.workbenchOpen;
  let fileTreeOpen = input.fileTreeOpen;
  if (!fits(workbenchOpen, fileTreeOpen)) {
    fileTreeOpen = false;
  }
  if (!fits(workbenchOpen, fileTreeOpen)) {
    workbenchOpen = false;
  }
  return { workbenchOpen, fileTreeOpen };
}
