import type { DropZone, ProductShellWorkbenchViewModel, SplitDirection, WorkbenchSplitNode } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { GitChangesView, ProductShellHandlers } from "../support/types.ts";
import { useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { styled } from "styled-components";
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
// and ProductShellBody's top-right split-pane padding rule.
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
  gitChanges: GitChangesView | null;
}): ReactElement {
  const { tree, viewModel, handlers, paneIcon, gitChanges } = props;
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
      const panes = Array.from(container.querySelectorAll<HTMLElement>("[data-workbench-split-pane]"));
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
    const pane = viewModel.appChrome.openWorkbenchPanes.find((p) => p.paneId === paneId);
    if (pane === undefined) {
      return null;
    }
    const isDropTarget = drop !== null && drop.paneId === paneId;
    return (
      <WorkbenchSplitPane
        key={pane.paneId}
        data-workbench-split-pane="true"
        data-pane-id={pane.paneId}
        data-pane-kind={pane.kind}
        data-corner={pane.paneId === cornerPaneId ? "top-right" : undefined}
        data-active={pane.paneId === viewModel.appChrome.activeWorkbenchPane?.paneId ? "true" : "false"}
        data-dragging={drag !== null && drag.paneId === pane.paneId ? "true" : "false"}
        data-drop-target={isDropTarget ? "true" : "false"}
      >
        {/* The header is the drag handle AND carries the SAME tab chip as Stacked, so
            a pane looks identical whether it's a tab or a split header. Clicking the
            chip focuses the pane; the empty grip area is the drag surface. */}
        <WorkbenchSplitPaneHeader data-workbench-split-pane-header="true" onPointerDown={beginPaneDrag(pane.paneId)}>
          <WorkbenchSplitPaneTab
            data-active={pane.paneId === viewModel.appChrome.activeWorkbenchPane?.paneId}
            data-kind={pane.kind}
            data-workbench-tab="true"
          >
            <WorkbenchSplitPaneTabLabel
              type="button"
              data-workbench-tab-label="true"
              // Focus via this button's own click — stop pointerdown so it doesn't reach
              // the header's beginPaneDrag (no drag from the chip, no double-focus with the
              // grip's onUp focus). The empty grip stays the drag surface.
              onPointerDown={(e: { stopPropagation: () => void }) => e.stopPropagation()}
              onClick={() => handlers.onFocusWorkbenchPane(pane.paneId)}
            >
              <WorkbenchSplitPaneTabIcon aria-hidden>
                {paneIcon(pane.kind)}
              </WorkbenchSplitPaneTabIcon>
              <WorkbenchSplitPaneTabTitle data-workbench-tab-title="true">{pane.title ?? pane.kind}</WorkbenchSplitPaneTabTitle>
            </WorkbenchSplitPaneTabLabel>
            <WorkbenchSplitPaneCloseButton
              type="button"
              data-workbench-tab-close="true"
              title="Close Pane"
              aria-label="Close Pane"
              onPointerDown={(e: { stopPropagation: () => void }) => e.stopPropagation()}
              onClick={() => handlers.onCloseWorkbenchPane(pane.paneId)}
            >
              <X size={14} strokeWidth={2.2} aria-hidden />
            </WorkbenchSplitPaneCloseButton>
          </WorkbenchSplitPaneTab>
          {/* The rest of the strip is the drag surface. (No per-pane maximize — switch
              layout via the top-right ⋯ menu; click a pane to focus it.) */}
          <WorkbenchSplitPaneGrip aria-hidden />
        </WorkbenchSplitPaneHeader>
        <WorkbenchSplitPaneBody>
          {createWorkbenchPaneContent(
            pane,
            handlers,
            viewModel.editorDrafts[pane.paneId],
            gitChanges,
            viewModel.activeThreadId,
          )}
        </WorkbenchSplitPaneBody>
      </WorkbenchSplitPane>
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
      <WorkbenchSplitNodeGroup $dir={node.dir} key={`n-${path.join("") || "root"}`}>
        <WorkbenchSplitSlot style={slotStyle(node.ratio)}>
          {renderNode(node.a, [...path, "a"])}
        </WorkbenchSplitSlot>
        <WorkbenchSplitDivider
          $dir={node.dir}
          role="separator"
          aria-orientation={node.dir === "row" ? "vertical" : "horizontal"}
          onPointerDown={dividerDrag(node.dir, path)}
        />
        <WorkbenchSplitSlot style={slotStyle(1 - node.ratio)}>
          {renderNode(node.b, [...path, "b"])}
        </WorkbenchSplitSlot>
      </WorkbenchSplitNodeGroup>
    );
  };

  return (
    <WorkbenchSplitBoard ref={containerRef}>
      {renderNode(tree, [])}
      {drag !== null ? <WorkbenchSplitDragOverlay /> : null}
      {drop !== null ? (
        <WorkbenchSplitDropPreview
          $zone={drop.zone}
          style={{ left: drop.rect.left, top: drop.rect.top, width: drop.rect.width, height: drop.rect.height } as CSSProperties}
        />
      ) : null}
    </WorkbenchSplitBoard>
  );
}

const WorkbenchSplitBoard = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: row;
  background: var(--tide-bg);
`;

const WorkbenchSplitNodeGroup = styled.div<{ $dir: SplitDirection }>`
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: ${({ $dir }) => ($dir === "row" ? "row" : "column")};
  overflow: hidden;
`;

const WorkbenchSplitSlot = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const WorkbenchSplitPane = styled.section`
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &[data-dragging="true"] {
    opacity: 0.5;
  }

  &[data-active="true"] {
    box-shadow: inset 0 2px 0 var(--tide-action);
  }

  &[data-active="true"] > [data-workbench-split-pane-header] {
    background: var(--tide-bg);
  }

  &:not([data-active="true"]) > [data-workbench-split-pane-header] {
    opacity: 0.62;
  }
`;

const WorkbenchSplitPaneHeader = styled.div`
  height: 52px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  border-bottom: 1px solid var(--tide-line);
  background: var(--tide-surface);
  cursor: grab;
  user-select: none;

  &:active {
    cursor: grabbing;
  }
`;

const WorkbenchSplitPaneTab = styled.div`
  max-width: none;
  flex: 0 3 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px 0 9px;
  color: var(--tide-muted);
  transition: background 0.12s ease, box-shadow 0.12s ease, color 0.12s ease;

  &[data-active="true"] {
    color: var(--tide-text);
  }
`;

const WorkbenchSplitPaneTabLabel = styled.button`
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 520;

  ${WorkbenchSplitPaneTab}[data-active="true"] & {
    font-weight: 590;
  }
`;

const WorkbenchSplitPaneTabIcon = styled.span`
  flex: 0 0 auto;
  display: inline-flex;
  color: var(--tide-muted);

  ${WorkbenchSplitPaneTab}[data-active="true"] & {
    color: var(--tide-text);
  }
`;

const WorkbenchSplitPaneTabTitle = styled.span`
  min-width: 0;
  max-width: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const WorkbenchSplitPaneCloseButton = styled.button`
  width: 0;
  height: 22px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, width 0.12s ease, background 0.12s ease, color 0.12s ease;

  ${WorkbenchSplitPaneTab}:hover &,
  ${WorkbenchSplitPaneTab}[data-active="true"] &,
  &:focus-visible {
    width: 22px;
    opacity: 1;
  }

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;

const WorkbenchSplitPaneGrip = styled.span`
  flex: 1 1 auto;
  align-self: stretch;
`;

const WorkbenchSplitPaneBody = styled.div`
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const WorkbenchSplitDivider = styled.div<{ $dir: SplitDirection }>`
  flex: 0 0 auto;
  background: var(--tide-line);
  transition: background 0.12s ease;
  z-index: 1;
  ${({ $dir }) => ($dir === "row" ? "width: 6px; cursor: col-resize;" : "height: 6px; cursor: row-resize;")}

  &:hover {
    background: var(--tide-action);
  }
`;

const WorkbenchSplitDragOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 50;
  cursor: grabbing;
`;

const WorkbenchSplitDropPreview = styled.div<{ $zone: DropZone }>`
  position: absolute;
  z-index: 60;
  pointer-events: none;
  border: 2px solid var(--tide-action);
  border-radius: 6px;
  background: ${({ $zone }) =>
    $zone === "center"
      ? "color-mix(in srgb, var(--tide-action) 14%, transparent)"
      : "color-mix(in srgb, var(--tide-action) 22%, transparent)"};
  border-style: ${({ $zone }) => ($zone === "center" ? "dashed" : "solid")};
  transition: left 0.08s ease, top 0.08s ease, width 0.08s ease, height 0.08s ease;
`;
