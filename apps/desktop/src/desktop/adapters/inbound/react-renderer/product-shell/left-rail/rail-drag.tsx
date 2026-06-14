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
      onDragStart={(event: { dataTransfer: DataTransfer }) => {
        event.dataTransfer.setData(RAIL_DRAG_MIME, itemKey);
        event.dataTransfer.effectAllowed = "move";
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
