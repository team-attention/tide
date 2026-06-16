import type { DropZone, ProductShellWorkbenchViewModel, SplitDirection, WorkbenchSplitNode } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { X } from "lucide-react";
import { createWorkbenchPaneContent } from "./pane-content.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Split mode: panes arranged in a draggable binary split-tree (the Tide Terminal
// model). Drag a pane's header onto another pane's edge to split (top/bottom =>
// stacked, left/right => side-by-side) or its center to swap; dividers resize the
// two sides. The tree lives in renderer-local product-shell state.
type SplitDragState = { paneId: string };

type SplitDropState = {
  paneId: string;
  zone: DropZone;
  rect: { left: number; top: number; width: number; height: number };
};

// The leaf occupying the top-right CORNER of the split (a row node's right child, a
// col node's top child). Its header is the one the fixed top-right window cluster
// floats over, so it's the pane that must reserve room for the cluster. See chrome.tsx
// + the corner-pane padding rule in product-shell.css.
function topRightLeafPaneId(node: WorkbenchSplitNode): string {
  if (node.type === "leaf") {
    return node.paneId;
  }
  return topRightLeafPaneId(node.dir === "row" ? node.b : node.a);
}

// Nearest-edge drop zone from the cursor's relative position in a pane (center
// band => swap).
function computeDropZone(relX: number, relY: number): DropZone {
  if (relX > 0.34 && relX < 0.66 && relY > 0.34 && relY < 0.66) {
    return "center";
  }
  const dist: [DropZone, number][] = [
    ["left", relX],
    ["right", 1 - relX],
    ["top", relY],
    ["bottom", 1 - relY],
  ];
  dist.sort((a, b) => a[1] - b[1]);
  return dist[0][0];
}

// The highlighted region (relative to the split container) the dragged pane would
// occupy for a given zone over a target pane.
function dropPreviewRect(
  target: DOMRect,
  container: DOMRect,
  zone: DropZone,
): { left: number; top: number; width: number; height: number } {
  let left = target.left - container.left;
  let top = target.top - container.top;
  let width = target.width;
  let height = target.height;
  if (zone === "left") {
    width = width / 2;
  } else if (zone === "right") {
    left += width / 2;
    width = width / 2;
  } else if (zone === "top") {
    height = height / 2;
  } else if (zone === "bottom") {
    top += height / 2;
    height = height / 2;
  }
  return { left, top, width, height };
}

export function WorkbenchSplitView(props: {
  tree: WorkbenchSplitNode;
  viewModel: ProductShellWorkbenchViewModel;
  handlers: ProductShellHandlers;
  paneIcon: (kind: string) => ReactElement;
}): ReactElement {
  const { tree, viewModel, handlers, paneIcon } = props;
  const cornerPaneId = topRightLeafPaneId(tree);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dropRef = useRef<SplitDropState | null>(null);
  const [drag, setDrag] = useState<SplitDragState | null>(null);
  const [drop, setDrop] = useState<SplitDropState | null>(null);
  const commitDrop = (next: SplitDropState | null): void => {
    dropRef.current = next;
    setDrop(next);
  };

  // Pane header = drag handle. Pointer-based (not HTML5 DnD) so it works over the
  // webview/terminal panes; a full-cover overlay (mounted once active) keeps
  // pointer events flowing even above an embedded <webview>.
  const beginPaneDrag = (paneId: string) => (event: {
    button: number;
    clientX: number;
    clientY: number;
    preventDefault: () => void;
  }): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    const onMove = (e: PointerEvent): void => {
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 6) {
          return;
        }
        active = true;
        setDrag({ paneId });
      }
      const container = containerRef.current;
      if (container === null) {
        return;
      }
      const panes = Array.from(container.querySelectorAll<HTMLElement>(".workbench-split__pane"));
      const hit = panes.find((p) => {
        const r = p.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      const targetId = hit?.getAttribute("data-pane-id") ?? null;
      if (hit === undefined || targetId === null || targetId === paneId) {
        commitDrop(null);
        return;
      }
      const r = hit.getBoundingClientRect();
      const zone = computeDropZone((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      commitDrop({ paneId: targetId, zone, rect: dropPreviewRect(r, container.getBoundingClientRect(), zone) });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const landed = dropRef.current;
      if (active && landed !== null) {
        handlers.onWorkbenchPaneDrop(paneId, landed.paneId, landed.zone);
      } else if (!active) {
        // A click (no drag) anywhere on the header focuses the pane — the WHOLE header
        // bar is the focus target, not just the chip label. The close button stops
        // propagation on pointerdown, so beginPaneDrag never starts there and this
        // never fires for a close.
        handlers.onFocusWorkbenchPane(paneId);
      }
      setDrag(null);
      commitDrop(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Divider between the two children of the split at `path`; drag sets that
  // split's ratio from the cursor position within the parent node element.
  const dividerDrag = (dir: SplitDirection, path: ("a" | "b")[]) => (event: {
    currentTarget: HTMLElement;
    pointerId: number;
    preventDefault: () => void;
  }): void => {
    event.preventDefault();
    const nodeEl = event.currentTarget.parentElement;
    if (nodeEl === null) {
      return;
    }
    // Capture the pointer on the divider so move/up keep firing even when the cursor
    // crosses a <webview> pane — otherwise the webview swallows the events and the
    // release never registers (the divider "sticks" to the cursor).
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // setPointerCapture can throw if the pointer is already gone; ignore.
    }
    const onMove = (e: PointerEvent): void => {
      const r = nodeEl.getBoundingClientRect();
      const ratio = dir === "row" ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
      handlers.onWorkbenchSplitRatio(path, ratio);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const renderPaneCard = (paneId: string): ReactElement | null => {
    const pane = viewModel.appChrome.visibleWorkbenchPanes.find((p) => p.paneId === paneId);
    if (pane === undefined) {
      return null;
    }
    const isDropTarget = drop !== null && drop.paneId === paneId;
    return (
      <section
        key={pane.paneId}
        className={
          "workbench-split__pane" +
          (pane.paneId === viewModel.appChrome.activeWorkbenchPane?.paneId ? " is-active" : "") +
          (drag !== null && drag.paneId === pane.paneId ? " is-dragging" : "") +
          (isDropTarget ? " is-drop-target" : "")
        }
        data-pane-id={pane.paneId}
        data-pane-kind={pane.kind}
        data-corner={pane.paneId === cornerPaneId ? "top-right" : undefined}
      >
        {/* The header is the drag handle AND carries the SAME tab chip as Stacked, so
            a pane looks identical whether it's a tab or a split header. Clicking the
            chip focuses the pane; the empty grip area is the drag surface. */}
        <div className="workbench-split__pane-header" onPointerDown={beginPaneDrag(pane.paneId)}>
          <div
            className="workbench-tab workbench-split__pane-tab"
            data-active={pane.paneId === viewModel.appChrome.activeWorkbenchPane?.paneId}
            data-kind={pane.kind}
          >
            <button
              className="workbench-tab__label"
              type="button"
              onClick={() => handlers.onFocusWorkbenchPane(pane.paneId)}
            >
              <span className="workbench-tab__icon" aria-hidden>
                {paneIcon(pane.kind)}
              </span>
              <span className="workbench-tab__title">{pane.title ?? pane.kind}</span>
            </button>
            <button
              className="workbench-tab__close"
              type="button"
              title="Close Pane"
              aria-label="Close Pane"
              onPointerDown={(e: { stopPropagation: () => void }) => e.stopPropagation()}
              onClick={() => handlers.onCloseWorkbenchPane(pane.paneId)}
            >
              <X size={14} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
          {/* The rest of the strip is the drag surface. (No per-pane maximize — switch
              layout via the top-right ⋯ menu; click a pane to focus it.) */}
          <span className="workbench-split__pane-grip" aria-hidden />
        </div>
        <div className="workbench-split__pane-body">
          {createWorkbenchPaneContent(pane, handlers, viewModel.editorDrafts[pane.paneId])}
        </div>
      </section>
    );
  };

  const renderNode = (node: WorkbenchSplitNode, path: ("a" | "b")[]): ReactElement | null => {
    if (node.type === "leaf") {
      return renderPaneCard(node.paneId);
    }
    const slotStyle = (grow: number): CSSProperties => ({
      flexGrow: grow,
      flexBasis: "0",
      flexShrink: 1,
      minWidth: "0",
      minHeight: "0",
      display: "flex",
    });
    return (
      <div
        className={`workbench-split__node workbench-split__node--${node.dir}`}
        key={`n-${path.join("") || "root"}`}
      >
        <div className="workbench-split__slot" style={slotStyle(node.ratio)}>
          {renderNode(node.a, [...path, "a"])}
        </div>
        <div
          className={`workbench-split__divider workbench-split__divider--${node.dir}`}
          role="separator"
          aria-orientation={node.dir === "row" ? "vertical" : "horizontal"}
          onPointerDown={dividerDrag(node.dir, path)}
        />
        <div className="workbench-split__slot" style={slotStyle(1 - node.ratio)}>
          {renderNode(node.b, [...path, "b"])}
        </div>
      </div>
    );
  };

  return (
    <div className="workbench-split" ref={containerRef}>
      {renderNode(tree, [])}
      {drag !== null ? <div className="workbench-split__drag-overlay" /> : null}
      {drop !== null ? (
        <div
          className={`workbench-split__drop-preview workbench-split__drop-preview--${drop.zone}`}
          style={{ left: drop.rect.left, top: drop.rect.top, width: drop.rect.width, height: drop.rect.height } as CSSProperties}
        />
      ) : null}
    </div>
  );
}
