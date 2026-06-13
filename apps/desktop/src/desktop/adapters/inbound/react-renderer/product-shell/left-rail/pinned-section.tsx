import type { ProductShellPinnedProjectView, ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { createSectionHeader } from "./section-header.tsx";
import { createProjectGroup } from "./project-section.tsx";
import { createThreadRow } from "./thread-row.tsx";
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
  return (
    <section className="left-rail-section" aria-label="Pinned">
      {createSectionHeader("Pinned", total, collapsed, () => handlers.onToggleSection("Pinned"))}
      {collapsed
        ? null
        : [
            ...pinnedProjects.map((project) => createProjectGroup(project, handlers)),
            ...pinnedThreads.map((thread) => createThreadRow(thread, handlers, true)),
          ]}
    </section>
  );
}
