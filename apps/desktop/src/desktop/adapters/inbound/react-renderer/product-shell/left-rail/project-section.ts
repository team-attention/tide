import type { ProductShellProjectGroupView, ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell-state.ts";
import type { ProductShellHandlers } from "../types.ts";
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { createSectionHeader } from "./section-header.ts";
import { ChevronRight, Folder, FolderOpen, MessageSquarePlus, MoreHorizontal } from "lucide-react";
import { createIconButton, menuAnchorFromEvent } from "../chrome.ts";
import { createThreadRow } from "./thread-row.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createProjectSection(
  projectGroups: ProductShellProjectGroupView[],
  handlers: ProductShellHandlers,
): ReactElement {
  const collapsed = handlers.isSectionCollapsed("Projects");
  return createElement(
    "section",
    { className: "left-ui-section", "aria-label": "Projects" },
    createSectionHeader(
      "Projects",
      projectGroups.length,
      collapsed,
      () => handlers.onToggleSection("Projects"),
      { label: "Add project", onClick: handlers.onAddProject },
    ),
    collapsed ? null : projectGroups.map((project) => createProjectGroup(project, handlers)),
  );
}

// One expandable Project group: the project row (toggle + folder + actions) and,
// when expanded, its Thread rows. Shared by the Projects and Pinned sections.
export function createProjectGroup(
  project: ProductShellProjectGroupView,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "div",
    { key: project.projectId, className: "project-group" },
    createElement(
      "div",
      { className: "project-row-wrap" },
      createElement(
        "div",
        {
          className: `project-row${project.contextMenuOpen ? " project-row--menu-open" : ""}`,
          "data-left-row-kind": "project",
          "data-project-row": project.projectId,
          "data-expanded": project.expanded,
        },
        createElement(
          "button",
          {
            className: "project-row__toggle",
            type: "button",
            "aria-label": project.expanded ? "Collapse project" : "Expand project",
            "aria-expanded": project.expanded,
            onClick: () => handlers.onProjectToggle(project.projectId),
          },
          createElement(ChevronRight, {
            size: 13,
            strokeWidth: 2,
            className: `project-row__chevron${project.expanded ? " project-row__chevron--expanded" : ""}`,
            "aria-hidden": true,
          }),
          project.expanded
            ? createElement(FolderOpen, { size: 16, strokeWidth: 1.85, "aria-hidden": true })
            : createElement(Folder, { size: 16, strokeWidth: 1.85, "aria-hidden": true }),
          project.renaming
            ? createElement("input", {
                className: "project-row__rename-input",
                "aria-label": "Rename project",
                defaultValue: project.name,
                autoFocus: true,
                onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
                onKeyDown: (event: {
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
                },
                onBlur: (event: { currentTarget: { value: string } }) =>
                  handlers.onProjectRenameSubmit(project.projectId, event.currentTarget.value),
              })
            : project.creatingWorktree
              ? createElement("input", {
                  className: "project-row__rename-input",
                  "aria-label": "New worktree name",
                  placeholder: "worktree name…",
                  autoFocus: true,
                  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
                  onKeyDown: (event: {
                    key: string;
                    currentTarget: { value: string };
                    preventDefault: () => void;
                  }) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handlers.onProjectCreateWorktreeSubmit(
                        project.projectId,
                        event.currentTarget.value,
                      );
                    } else if (event.key === "Escape") {
                      handlers.onProjectCreateWorktreeCancel();
                    }
                  },
                  onBlur: () => handlers.onProjectCreateWorktreeCancel(),
                })
              : createElement("span", { className: "project-row__title" }, project.name),
          // When collapsed, bubble a child thread's attention to the project row.
          !project.expanded && project.attention
            ? createElement("span", {
                className: "project-row__attention",
                "aria-label": "A thread in this project needs attention",
              })
            : null,
          // Likewise bubble live running activity so background work is visible.
          !project.expanded && project.running && !project.attention
            ? createElement("span", {
                className: "project-row__running",
                "aria-label": "A thread in this project is running",
              })
            : null,
        ),
        createElement(
          "span",
          { className: "project-row__actions" },
          createIconButton(
            "Project menu",
            createElement(MoreHorizontal, { size: 15, strokeWidth: 1.9 }),
            (event) =>
              handlers.onLeftUiMenuOpen(
                { kind: "project", projectId: project.projectId },
                menuAnchorFromEvent(event),
              ),
            "project-row__action",
          ),
          createIconButton(
            "New thread in project",
            createElement(MessageSquarePlus, { size: 15, strokeWidth: 1.9 }),
            () => handlers.onNewThreadInProject(project.projectId),
            "project-row__action",
          ),
        ),
      ),
    ),
    // Kept mounted and height-animated (grid-rows) so the folder expands AND
    // collapses smoothly in both directions.
    createElement(
      "div",
      { className: "collapsible", "data-expanded": project.expanded },
      createElement(
        "div",
        { className: "collapsible__inner" },
        createElement(ProjectThreadList, { threads: project.threads, handlers }),
      ),
    ),
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
    return createElement(
      "div",
      { className: "project-group__threads" },
      createElement("p", { className: "project-group__empty" }, "No threads yet"),
    );
  }
  const visible = showAll ? threads : threads.slice(0, THREAD_PREVIEW_LIMIT);
  const hidden = threads.length - visible.length;
  return createElement(
    "div",
    { className: "project-group__threads" },
    ...visible.map((thread) => createThreadRow(thread, handlers)),
    hidden > 0
      ? createElement(
          "button",
          {
            key: "show-more",
            type: "button",
            className: "project-group__show-more",
            onClick: () => setShowAll(true),
          },
          `Show ${hidden} more`,
        )
      : showAll && threads.length > THREAD_PREVIEW_LIMIT
        ? createElement(
            "button",
            {
              key: "show-less",
              type: "button",
              className: "project-group__show-more",
              onClick: () => setShowAll(false),
            },
            "Show less",
          )
        : null,
  );
}
