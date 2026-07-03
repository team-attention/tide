import type { ProductShellPinnedItemView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import {
  createSectionHeader,
  LeftRailCollapsible,
  LeftRailCollapsibleInner,
  LeftRailSection,
  LeftRailSectionBody,
} from "./section-header.tsx";
import { createProjectGroup } from "./project-section.tsx";
import { createThreadRow } from "./thread-row.tsx";
import { createRailDragItem } from "./rail-drag.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// The Pinned section: ONE manually-ordered, intermixed list of pinned projects and
// pinned threads (spec: left-rail-manual-ordering). Each top-level item is drag-
// reorderable. Hidden entirely when nothing is pinned (per the empty-Pinned rule).
export function createPinnedSection(
  pinnedItems: ProductShellPinnedItemView[],
  handlers: ProductShellHandlers,
): ReactElement | null {
  if (pinnedItems.length === 0) {
    return null;
  }
  const collapsed = handlers.isSectionCollapsed("Pinned");
  return (
    <LeftRailSection aria-label="Pinned">
      {createSectionHeader("Pinned", pinnedItems.length, collapsed, () => handlers.onToggleSection("Pinned"))}
      {/* Height-animated so collapsing the section is smooth while rows stay mounted. */}
      <LeftRailCollapsible data-left-rail-collapsible data-expanded={!collapsed}>
        <LeftRailCollapsibleInner>
          <LeftRailSectionBody>
          {pinnedItems.map((item) =>
            item.kind === "project"
              ? createRailDragItem(
                  `p:${item.project.projectId}`,
                  handlers.onReorderPinnedItem,
                  createProjectGroup(item.project, handlers),
                )
              : createRailDragItem(
                  `t:${item.thread.threadId}`,
                  handlers.onReorderPinnedItem,
                  createThreadRow(item.thread, handlers),
                ),
          )}
          </LeftRailSectionBody>
        </LeftRailCollapsibleInner>
      </LeftRailCollapsible>
    </LeftRailSection>
  );
}
