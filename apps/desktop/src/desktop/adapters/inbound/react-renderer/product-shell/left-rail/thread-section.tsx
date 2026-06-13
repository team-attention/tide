import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { createSectionHeader } from "./section-header.tsx";
import { createThreadRow } from "./thread-row.tsx";
import type { AgentChatThreadScope } from "../../../../../application/domains/agent-chat/agent-chat.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createThreadSection(
  title: string,
  threads: ProductShellThreadView[],
  handlers: ProductShellHandlers,
): ReactElement | null {
  // The Pinned section is hidden entirely when nothing is pinned.
  if (title === "Pinned" && threads.length === 0) {
    return null;
  }
  const collapsed = handlers.isSectionCollapsed(title);
  return (
    <section className="left-rail-section" aria-label={title}>
      {createSectionHeader(
        title,
        threads.length,
        collapsed,
        () => handlers.onToggleSection(title),
        title === "Scratch"
          ? { label: "New scratch thread", onClick: handlers.onNewScratchThread }
          : undefined,
      )}
      {collapsed ? null : threads.map((thread) => createThreadRow(thread, handlers))}
    </section>
  );
}

export function threadScopeLabel(scope: AgentChatThreadScope): string {
  return scope.kind === "project"
    ? scope.cwd.split("/").filter((seg: string) => seg.length > 0).pop() ?? scope.cwd
    : "Scratch";
}
