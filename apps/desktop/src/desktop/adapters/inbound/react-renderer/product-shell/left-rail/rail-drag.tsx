import type { ReactElement, ReactNode } from "react";

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
    <div
      key={itemKey}
      className="rail-drag-item"
      draggable
      data-rail-key={itemKey}
      onDragStart={(event: { dataTransfer: DataTransfer; currentTarget: HTMLElement }) => {
        event.dataTransfer.setData(RAIL_DRAG_MIME, itemKey);
        event.dataTransfer.effectAllowed = "move";
        // Drag image: a compact labeled chip instead of the browser's bulky translucent
        // snapshot of the whole (often nested) row/group. Falls back to the native image
        // if there's no label or the platform ignores setDragImage.
        const label =
          event.currentTarget.querySelector(".project-row__title, .thread-row__title")?.textContent?.trim() ?? "";
        if (label !== "") {
          const ghost = document.createElement("div");
          ghost.className = "rail-drag-ghost";
          ghost.textContent = label;
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
        event.currentTarget.classList.add("rail-drag-item--over");
      }}
      onDragLeave={(event: { currentTarget: HTMLElement }) => {
        event.currentTarget.classList.remove("rail-drag-item--over");
      }}
      onDrop={(event: { preventDefault: () => void; dataTransfer: DataTransfer; currentTarget: HTMLElement }) => {
        event.preventDefault();
        event.currentTarget.classList.remove("rail-drag-item--over");
        const draggedKey = event.dataTransfer.getData(RAIL_DRAG_MIME);
        if (draggedKey !== "" && draggedKey !== itemKey) {
          onReorder(draggedKey, itemKey);
        }
      }}
    >
      {children}
    </div>
  );
}
