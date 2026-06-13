import type { ProductShellProjectGroupView, ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { useState } from "react";
import type { ReactElement } from "react";
import { createSectionHeader } from "./section-header.tsx";
import { ChevronRight, Folder, FolderOpen, MessageSquarePlus, MoreHorizontal } from "lucide-react";
import { createIconButton, menuAnchorFromEvent } from "../chrome/chrome.tsx";
import { createThreadRow } from "./thread-row.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createProjectSection(
  projectGroups: ProductShellProjectGroupView[],
  handlers: ProductShellHandlers,
): ReactElement {
  const collapsed = handlers.isSectionCollapsed("Projects");
  return (
    <section className="left-rail-section" aria-label="Projects">
      {createSectionHeader(
        "Projects",
        projectGroups.length,
        collapsed,
        () => handlers.onToggleSection("Projects"),
        { label: "Add project", onClick: handlers.onAddProject },
      )}
      {collapsed ? null : projectGroups.map((project) => createProjectGroup(project, handlers))}
    </section>
  );
}

// One expandable Project group: the project row (toggle + folder + actions) and,
// when expanded, its Thread rows. Shared by the Projects and Pinned sections.
export function createProjectGroup(
  project: ProductShellProjectGroupView,
  handlers: ProductShellHandlers,
): ReactElement {
  return (
    <div key={project.projectId} className="project-group">
      <div className="project-row-wrap">
        <div
          className={`project-row${project.contextMenuOpen ? " project-row--menu-open" : ""}`}
          data-left-row-kind="project"
          data-project-row={project.projectId}
          data-expanded={project.expanded}
        >
          <button
            className="project-row__toggle"
            type="button"
            aria-label={project.expanded ? "Collapse project" : "Expand project"}
            aria-expanded={project.expanded}
            onClick={() => handlers.onProjectToggle(project.projectId)}
          >
            <ChevronRight
              size={13}
              strokeWidth={2}
              className={`project-row__chevron${project.expanded ? " project-row__chevron--expanded" : ""}`}
              aria-hidden
            />
            {project.expanded ? (
              <FolderOpen size={16} strokeWidth={1.85} aria-hidden />
            ) : (
              <Folder size={16} strokeWidth={1.85} aria-hidden />
            )}
            {project.renaming ? (
              <input
                className="project-row__rename-input"
                aria-label="Rename project"
                defaultValue={project.name}
                autoFocus
                onClick={(event: { stopPropagation: () => void }) => event.stopPropagation()}
                onKeyDown={(event: {
                  key: string;
                  currentTarget: { value: string };
                  preventDefault: () => void;
                }) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handlers.onProjectRenameSubmit(project.projectId, event.currentTarget.value);
                  } else if (event.key === "Escape") {
                    handlers.onProjectRenameCancel();
                  }
                }}
                onBlur={(event: { currentTarget: { value: string } }) =>
                  handlers.onProjectRenameSubmit(project.projectId, event.currentTarget.value)
                }
              />
            ) : project.creatingWorktree ? (
              <input
                className="project-row__rename-input"
                aria-label="New worktree name"
                placeholder="worktree name…"
                autoFocus
                onClick={(event: { stopPropagation: () => void }) => event.stopPropagation()}
                onKeyDown={(event: {
                  key: string;
                  currentTarget: { value: string };
                  preventDefault: () => void;
                }) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handlers.onProjectCreateWorktreeSubmit(project.projectId, event.currentTarget.value);
                  } else if (event.key === "Escape") {
                    handlers.onProjectCreateWorktreeCancel();
                  }
                }}
                onBlur={() => handlers.onProjectCreateWorktreeCancel()}
              />
            ) : (
              <span className="project-row__title">{project.name}</span>
            )}
            {/* When collapsed, bubble a child thread's attention to the project row. */}
            {!project.expanded && project.attention ? (
              <span
                className="project-row__attention"
                aria-label="A thread in this project needs attention"
              />
            ) : null}
            {/* Likewise bubble live running activity so background work is visible. */}
            {!project.expanded && project.running && !project.attention ? (
              <span
                className="project-row__running"
                aria-label="A thread in this project is running"
              />
            ) : null}
          </button>
          <span className="project-row__actions">
            {createIconButton(
              "Project menu",
              <MoreHorizontal size={15} strokeWidth={1.9} />,
              (event) =>
                handlers.onLeftRailMenuOpen(
                  { kind: "project", projectId: project.projectId },
                  menuAnchorFromEvent(event),
                ),
              "project-row__action",
            )}
            {createIconButton(
              "New thread in project",
              <MessageSquarePlus size={15} strokeWidth={1.9} />,
              () => handlers.onNewThreadInProject(project.projectId),
              "project-row__action",
            )}
          </span>
        </div>
      </div>
      {/* Kept mounted and height-animated (grid-rows) so the folder expands AND
          collapses smoothly in both directions. */}
      <div className="collapsible" data-expanded={project.expanded}>
        <div className="collapsible__inner">
          <ProjectThreadList threads={project.threads} handlers={handlers} />
        </div>
      </div>
    </div>
  );
}

// How many threads a project shows before collapsing the rest behind "Show more"
// (projects can accumulate many adopted local sessions).
const THREAD_PREVIEW_LIMIT = 8;

// The thread list under a project: shows the first N, with a "Show N more"
// toggle to reveal the rest (and "Show less" to re-collapse).
function ProjectThreadList({
  threads,
  handlers,
}: {
  threads: ProductShellThreadView[];
  handlers: ProductShellHandlers;
}): ReactElement {
  const [showAll, setShowAll] = useState(false);
  if (threads.length === 0) {
    return (
      <div className="project-group__threads">
        <p className="project-group__empty">No threads yet</p>
      </div>
    );
  }
  const visible = showAll ? threads : threads.slice(0, THREAD_PREVIEW_LIMIT);
  const hidden = threads.length - visible.length;
  return (
    <div className="project-group__threads">
      {visible.map((thread) => createThreadRow(thread, handlers))}
      {hidden > 0 ? (
        <button
          key="show-more"
          type="button"
          className="project-group__show-more"
          onClick={() => setShowAll(true)}
        >
          {`Show ${hidden} more`}
        </button>
      ) : showAll && threads.length > THREAD_PREVIEW_LIMIT ? (
        <button
          key="show-less"
          type="button"
          className="project-group__show-more"
          onClick={() => setShowAll(false)}
        >
          Show less
        </button>
      ) : null}
    </div>
  );
}
