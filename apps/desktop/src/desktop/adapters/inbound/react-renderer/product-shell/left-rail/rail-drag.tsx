import type { ReactElement, ReactNode } from "react";
import { styled } from "styled-components";

// Drag-and-drop wrapper for a manually-orderable top-level rail item (spec:
// left-rail-manual-ordering). The whole wrapper is the drag source AND drop target;
// dropping `dragged` onto this item calls onReorder(draggedKey, thisKey). `itemKey` is
// `t:<threadId>` / `p:<projectId>` in the Pinned section, or a bare projectId in the
// Projects section — the matching handler interprets it.
const RAIL_DRAG_MIME = "text/tide-rail-key";

export function createRailDragItem(
  itemKey: string,
  onReorder: (draggedKey: string, targetKey: string) => void,
  children: ReactNode,
): ReactElement {
  return (
    <RailDragItemFrame
      key={itemKey}
      draggable
      data-rail-key={itemKey}
      onDragStart={(event: { dataTransfer: DataTransfer; currentTarget: HTMLElement }) => {
        event.dataTransfer.setData(RAIL_DRAG_MIME, itemKey);
        event.dataTransfer.effectAllowed = "move";
        // Drag image: a compact labeled chip instead of the browser's bulky translucent
        // snapshot of the whole (often nested) row/group. Falls back to the native image
        // if there's no label or the platform ignores setDragImage.
        const label =
          event.currentTarget.querySelector("[data-rail-title]")?.textContent?.trim() ?? "";
        if (label !== "") {
          const ghost = document.createElement("div");
          ghost.textContent = label;
          styleRailDragGhost(ghost);
          document.body.appendChild(ghost);
          event.dataTransfer.setDragImage(ghost, 12, 14);
          // The browser snapshots the chip synchronously once this handler returns; drop
          // it on the next frame.
          requestAnimationFrame(() => ghost.remove());
        }
      }}
      onDragOver={(event: { preventDefault: () => void; dataTransfer: DataTransfer; currentTarget: HTMLElement }) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        event.currentTarget.dataset.railDragOver = "true";
      }}
      onDragLeave={(event: { currentTarget: HTMLElement }) => {
        delete event.currentTarget.dataset.railDragOver;
      }}
      onDrop={(event: { preventDefault: () => void; dataTransfer: DataTransfer; currentTarget: HTMLElement }) => {
        event.preventDefault();
        delete event.currentTarget.dataset.railDragOver;
        const draggedKey = event.dataTransfer.getData(RAIL_DRAG_MIME);
        if (draggedKey !== "" && draggedKey !== itemKey) {
          onReorder(draggedKey, itemKey);
        }
      }}
    >
      {children}
    </RailDragItemFrame>
  );
}

function styleRailDragGhost(ghost: HTMLDivElement): void {
  Object.assign(ghost.style, {
    position: "fixed",
    top: "0",
    left: "-9999px",
    display: "inline-flex",
    alignItems: "center",
    maxWidth: "220px",
    padding: "6px 12px",
    borderRadius: "8px",
    background: "var(--tide-surface)",
    color: "var(--tide-text)",
    fontSize: "13px",
    fontWeight: "500",
    lineHeight: "1",
    whiteSpace: "nowrap",
    boxShadow: "0 8px 20px -8px rgba(0, 0, 0, 0.35)",
    border: "1px solid var(--tide-line)",
    pointerEvents: "none",
  });
}

const RailDragItemFrame = styled.div`
  position: relative;

  &[data-rail-drag-over="true"]::after {
    content: "";
    position: absolute;
    right: 10px;
    bottom: -2px;
    left: 10px;
    height: 2px;
    border-radius: 999px;
    background: var(--tide-action);
    pointer-events: none;
  }
`;
