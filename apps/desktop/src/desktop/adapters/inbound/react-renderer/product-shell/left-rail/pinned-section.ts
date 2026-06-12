import type { ProductShellPinnedProjectView, ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell-state.ts";
import type { ProductShellHandlers } from "../types.ts";
import { createElement } from "react";
import type { ReactElement } from "react";
import { createSectionHeader } from "./section-header.ts";
import { createProjectGroup } from "./project-section.ts";
import { createThreadRow } from "./thread-row.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// The Pinned section: pinned project shortcuts (folder icon) then pinned
// threads. Hidden entirely when nothing is pinned (per the empty-Pinned rule).
export function createPinnedSection(
  pinnedProjects: ProductShellPinnedProjectView[],
  pinnedThreads: ProductShellThreadView[],
  handlers: ProductShellHandlers,
): ReactElement | null {
  const total = pinnedProjects.length + pinnedThreads.length;
  if (total === 0) {
    return null;
  }
  const collapsed = handlers.isSectionCollapsed("Pinned");
  return createElement(
    "section",
    { className: "left-ui-section", "aria-label": "Pinned" },
    createSectionHeader("Pinned", total, collapsed, () => handlers.onToggleSection("Pinned")),
    collapsed
      ? null
      : [
          ...pinnedProjects.map((project) => createProjectGroup(project, handlers)),
          ...pinnedThreads.map((thread) => createThreadRow(thread, handlers, true)),
        ],
  );
}
