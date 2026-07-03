import type { ProductShellProjectGroupView, ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { useState, type ReactElement, type ReactNode } from "react";
import { css, keyframes, styled } from "styled-components";
import {
  createSectionHeader,
  LeftRailCollapsible,
  LeftRailCollapsibleInner,
  LeftRailSection,
  LeftRailSectionBody,
} from "./section-header.tsx";
import { ChevronRight, Folder, FolderOpen, MessageSquarePlus, MoreHorizontal } from "lucide-react";
import { menuAnchorFromEvent } from "../chrome/chrome.tsx";
import { createThreadRow } from "./thread-row.tsx";
import { createRailDragItem } from "./rail-drag.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createProjectSection(
  projectGroups: ProductShellProjectGroupView[],
  handlers: ProductShellHandlers,
): ReactElement {
  const collapsed = handlers.isSectionCollapsed("Threads");
  return (
    <LeftRailSection aria-label="Threads">
      {createSectionHeader(
        "Threads",
        projectGroups.length,
        collapsed,
        () => handlers.onToggleSection("Threads"),
        { label: "Add project", onClick: handlers.onAddProject },
      )}
      {/* Kept mounted and height-animated so the section
          expands AND collapses smoothly, like the individual project groups. */}
      <LeftRailCollapsible data-left-rail-collapsible data-expanded={!collapsed}>
        <LeftRailCollapsibleInner>
          <LeftRailSectionBody>
          {/* Project folders are drag-reorderable (spec: left-rail-manual-ordering);
              their nested threads still follow sortBy. */}
          {projectGroups.map((project) =>
            createRailDragItem(
              project.projectId,
              handlers.onReorderProject,
              createProjectGroup(project, handlers),
            ),
          )}
          </LeftRailSectionBody>
        </LeftRailCollapsibleInner>
      </LeftRailCollapsible>
    </LeftRailSection>
  );
}

// One expandable Project group: the project row (toggle + folder + actions) and,
// when expanded, its Thread rows. Shared by the Projects and Pinned sections.
export function createProjectGroup(
  project: ProductShellProjectGroupView,
  handlers: ProductShellHandlers,
): ReactElement {
  return (
    <ProjectGroup key={project.projectId} data-project-group={project.projectId}>
      <ProjectRowWrap>
        <ProjectRowFrame
          $menuOpen={project.contextMenuOpen}
          $running={project.running}
          $attention={project.attention}
          data-left-row-kind="project"
          data-project-row={project.projectId}
          data-project-menu-open={project.contextMenuOpen ? "true" : undefined}
          data-expanded={project.expanded}
          data-running={project.running ? "true" : undefined}
          data-attention={project.attention ? "true" : undefined}
        >
          <ProjectToggleButton
            type="button"
            aria-label={project.expanded ? "Collapse project" : "Expand project"}
            aria-expanded={project.expanded}
            onClick={() => handlers.onProjectToggle(project.projectId)}
          >
            <ProjectChevron
              size={13}
              strokeWidth={2}
              $expanded={project.expanded}
              data-project-chevron
              aria-hidden
            />
            {project.expanded ? (
              <FolderOpen size={16} strokeWidth={1.85} aria-hidden />
            ) : (
              <Folder size={16} strokeWidth={1.85} aria-hidden />
            )}
            {project.renaming ? (
              <ProjectRenameInput
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
              <ProjectRenameInput
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
              <ProjectTitle data-project-row-title data-rail-title>{project.name}</ProjectTitle>
            )}
            {/* When collapsed, bubble a child thread's attention or unread marker to the project row. */}
            {!project.expanded && project.attention ? (
              <ProjectStatusBubble
                $kind="attention"
                data-project-status-bubble="attention"
                aria-label="A thread in this project needs attention or has unread updates"
              />
            ) : null}
            {/* Likewise bubble live running activity so background work is visible. */}
            {!project.expanded && project.running && !project.attention ? (
              <ProjectStatusBubble
                $kind="running"
                data-project-status-bubble="running"
                aria-label="A thread in this project is running"
              />
            ) : null}
          </ProjectToggleButton>
          <ProjectActions>
            {createProjectActionButton(
              "Project menu",
              <MoreHorizontal size={15} strokeWidth={1.9} />,
              (event) =>
                handlers.onLeftRailMenuOpen(
                  { kind: "project", projectId: project.projectId },
                  menuAnchorFromEvent(event),
                ),
              "menu",
            )}
            {createProjectActionButton(
              "New thread in project",
              <MessageSquarePlus size={15} strokeWidth={1.9} />,
              () => handlers.onNewThreadInProject(project.projectId),
              "new-thread",
            )}
          </ProjectActions>
        </ProjectRowFrame>
      </ProjectRowWrap>
      {/* Kept mounted and height-animated (grid-rows) so the folder expands AND
          collapses smoothly in both directions. */}
      <LeftRailCollapsible data-left-rail-collapsible data-expanded={project.expanded}>
        <LeftRailCollapsibleInner>
          <ProjectThreadList threads={project.threads} handlers={handlers} />
        </LeftRailCollapsibleInner>
      </LeftRailCollapsible>
    </ProjectGroup>
  );
}

function createProjectActionButton(
  label: string,
  icon: ReactNode,
  onClick: (event: { currentTarget: HTMLElement }) => void,
  action: "menu" | "new-thread",
): ReactElement {
  return (
    <ProjectActionButton
      type="button"
      title={label}
      aria-label={label}
      data-project-action={action}
      onClick={(event) => onClick(event)}
    >
      {icon}
    </ProjectActionButton>
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
      <ProjectThreadListFrame>
        <ProjectEmpty>No threads yet</ProjectEmpty>
      </ProjectThreadListFrame>
    );
  }
  const visible = showAll ? threads : threads.slice(0, THREAD_PREVIEW_LIMIT);
  const hidden = threads.length - visible.length;
  return (
    <ProjectThreadListFrame>
      {visible.map((thread) => createThreadRow(thread, handlers))}
      {hidden > 0 ? (
        <ProjectShowMoreButton
          key="show-more"
          type="button"
          onClick={() => setShowAll(true)}
        >
          {`Show ${hidden} more`}
        </ProjectShowMoreButton>
      ) : showAll && threads.length > THREAD_PREVIEW_LIMIT ? (
        <ProjectShowMoreButton
          key="show-less"
          type="button"
          onClick={() => setShowAll(false)}
        >
          Show less
        </ProjectShowMoreButton>
      ) : null}
    </ProjectThreadListFrame>
  );
}

const projectRunningPulse = keyframes`
  0%,
  100% {
    opacity: 0.35;
  }

  50% {
    opacity: 1;
  }
`;

const ProjectGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ProjectRowWrap = styled.div`
  position: relative;
`;

const ProjectRowFrame = styled.div<{
  $menuOpen: boolean;
  $running: boolean;
  $attention: boolean;
}>`
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 8px;
  padding: 0 8px;
  background: ${({ $menuOpen, $running, $attention }) =>
    $attention
      ? "color-mix(in srgb, var(--tide-warn) 11%, transparent)"
      : $running
        ? "color-mix(in srgb, var(--tide-success) 9%, transparent)"
        : $menuOpen
          ? "var(--tide-selection)"
          : "transparent"};
  color: var(--tide-text);
  box-shadow: none;
  font-size: 14px;
  font-weight: 580;
  text-align: left;
  transition: background-color 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
  }

  & svg {
    flex: 0 0 auto;
    color: var(--tide-muted);
  }
`;

const ProjectToggleButton = styled.button`
  min-width: 0;
  height: 100%;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-weight: 580;
  text-align: left;
  cursor: pointer;
`;

const ProjectChevron = styled(ChevronRight)<{ $expanded: boolean }>`
  flex: 0 0 auto;
  color: var(--tide-muted);
  transform: ${({ $expanded }) => ($expanded ? "rotate(90deg)" : "rotate(0deg)")};

  @media (prefers-reduced-motion: no-preference) {
    transition: transform 0.18s ease;
  }
`;

const ProjectTitle = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ProjectActions = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0;

  ${ProjectRowFrame}:hover & {
    opacity: 1;
  }
`;

const ProjectActionButton = styled.button`
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-action);
  }
`;

const ProjectThreadListFrame = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-left: 18px;
  border-left: 1px solid var(--tide-line);
  padding-left: 8px;
`;

const ProjectEmpty = styled.p`
  margin: 2px 0 4px;
  padding: 0 8px;
  color: var(--tide-muted);
  font-size: 12px;
`;

const ProjectShowMoreButton = styled.button`
  align-self: flex-start;
  height: 24px;
  border: 0;
  border-radius: 6px;
  margin: 2px 0;
  padding: 2px 8px;
  background: transparent;
  color: var(--tide-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-action);
  }
`;

const ProjectStatusBubble = styled.span<{ $kind: "attention" | "running" }>`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  margin-left: 6px;
  border-radius: 999px;
  background: ${({ $kind }) => ($kind === "attention" ? "var(--tide-warn)" : "var(--tide-success)")};
  ${({ $kind }) =>
    $kind === "running"
      ? css`
          animation: ${projectRunningPulse} 1.2s ease-in-out infinite;
        `
      : css`
          animation: none;
        `}
`;

const ProjectRenameInput = styled.input`
  min-width: 0;
  flex: 1 1 auto;
  border: 1px solid var(--tide-action);
  border-radius: 6px;
  padding: 1px 5px;
  background: var(--tide-bg);
  color: var(--tide-text);
  font-size: 13px;
`;
