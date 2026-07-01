import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { createSectionHeader } from "./section-header.tsx";
import { createThreadRow } from "./thread-row.tsx";
import type { AgentChatThreadScope } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { worktreeRepoRootForCwd } from "../../../../../../shared/worktree/path.ts";
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
        title === "Chats"
          ? { label: "New chat", onClick: handlers.onNewScratchThread }
          : undefined,
      )}
      {/* Height-animated (.collapsible) so collapsing the section is smooth. */}
      <div className="collapsible" data-expanded={!collapsed}>
        <div className="collapsible__inner left-rail-section__body">
          {threads.map((thread) => createThreadRow(thread, handlers))}
        </div>
      </div>
    </section>
  );
}

export function threadScopeLabel(scope: AgentChatThreadScope): string {
  return scope.kind === "project"
    ? scope.cwd.split("/").filter((seg: string) => seg.length > 0).pop() ?? scope.cwd
    : "Scratch";
}

export function pinnedThreadScopeLabel(scope: AgentChatThreadScope): string {
  if (scope.kind !== "project") {
    return "Scratch";
  }
  const worktreeRepoRoot = worktreeRepoRootForCwd(scope.cwd);
  if (worktreeRepoRoot !== null) {
    const repo = basenameLabel(worktreeRepoRoot) ?? scope.projectId;
    const branch = basenameLabel(scope.cwd);
    return branch === null ? repo : `${repo} / ${branch}`;
  }
  const cwdLabel = basenameLabel(scope.cwd);
  return cwdLabel === null || cwdLabel === scope.projectId
    ? scope.projectId
    : `${scope.projectId} / ${cwdLabel}`;
}

function basenameLabel(path: string): string | null {
  return path.split(/[/\\]/).filter((seg: string) => seg.length > 0).pop() ?? null;
}
