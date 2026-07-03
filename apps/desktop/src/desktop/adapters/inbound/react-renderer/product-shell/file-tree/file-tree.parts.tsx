import { ChevronRight } from "lucide-react";
import { css, keyframes, styled } from "styled-components";

import type { GitChangeStatus } from "../support/types.ts";
import { ColumnTopRow, ColumnTopRowTrailing } from "../support/column-top-row.parts.tsx";

const fileTreeRowIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(-3px);
  }

  to {
    opacity: 1;
    transform: none;
  }
`;

const fileTreeSkeletonShimmer = keyframes`
  0% {
    background-position: 100% 50%;
  }

  100% {
    background-position: 0 50%;
  }
`;

function fileTreeGitColor(status: GitChangeStatus | "none"): string {
  switch (status) {
    case "modified":
    case "renamed":
      return "var(--tide-warn)";
    case "added":
    case "untracked":
      return "var(--tide-diff-add)";
    case "deleted":
      return "var(--tide-danger)";
    case "none":
      return "var(--tide-muted)";
  }
}

const fileTreeRowLayout = css`
  width: 100%;
  height: 28px;
  flex: 0 0 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  border: 0;
  border-radius: 7px;
  padding: 0 8px 0 calc(8px + (var(--file-tree-depth) * 18px));
  background: transparent;
  color: var(--tide-text);
  font: inherit;
  font-size: 13px;
  line-height: 28px;
  text-align: left;
  transition: background-color 0.12s ease;
  animation: ${fileTreeRowIn} 0.16s ease;
`;

export const FileTreeColumnFrame = styled.aside`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 52px minmax(0, 1fr);
  border-left: 1px solid var(--tide-line);
  background: var(--tide-bg);
`;

export const FileTreeTopRow = styled(ColumnTopRow)`
  padding: 0 12px;
`;

export const FileTreeToolbar = styled(ColumnTopRowTrailing)`
  gap: 2px;
`;

export const FileTreeToolbarButton = styled.button`
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;

export const FileTreeNotice = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 10px;
  border-radius: 8px;
  padding: 6px 10px;
  background: rgba(var(--tide-danger-rgb), 0.12);
  color: var(--tide-danger);
  font-size: 12px;
  line-height: 1.3;
`;

export const FileTreeNoticeDismiss = styled.button`
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.75;

  &:hover {
    opacity: 1;
  }
`;

export const FileTreeBody = styled.div`
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
`;

export const FileTreeSearch = styled.label`
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--tide-line);
  border-radius: 9px;
  padding: 0 10px;
  color: var(--tide-muted);
  font-size: 14px;

  &:focus-within {
    border-color: var(--tide-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--tide-accent) 14%, transparent);
  }
`;

export const FileTreeSearchInput = styled.input`
  min-width: 0;
  height: 30px;
  flex: 1 1 auto;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--tide-text);
  font: inherit;

  &::placeholder {
    color: var(--tide-muted);
  }
`;

export const FileTreeSearchClear = styled.button`
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;

export const FileTreeEntries = styled.div`
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const FileTreeEmpty = styled.div`
  padding: 10px 8px;
  color: var(--tide-muted);
  font-size: 12px;
  line-height: 16px;
`;

export const FileTreeRowButton = styled.button<{
  $active: boolean;
  $syntheticDeleted: boolean;
}>`
  ${fileTreeRowLayout}
  cursor: pointer;
  background: ${({ $active }) =>
    $active ? "color-mix(in srgb, var(--tide-selection) 84%, var(--tide-action) 5%)" : "transparent"};
  box-shadow: ${({ $active }) =>
    $active ? "inset 0 0 0 1px color-mix(in srgb, var(--tide-action) 24%, var(--tide-line))" : "none"};
  color: ${({ $active, $syntheticDeleted }) =>
    $active ? "var(--tide-action)" : $syntheticDeleted ? "var(--tide-muted)" : "var(--tide-text)"};
  font-weight: ${({ $active }) => ($active ? "560" : "400")};

  &:hover {
    background: var(--tide-selection);
  }

  &[data-drag-over="true"] {
    background: var(--tide-selection);
    box-shadow: inset 0 0 0 1px var(--tide-accent);
  }

  & svg {
    flex: 0 0 auto;
    color: ${({ $active }) => ($active ? "var(--tide-action)" : "var(--tide-muted)")};
  }
`;

export const FileTreeLoadingRow = styled.div`
  ${fileTreeRowLayout}
`;

export const FileTreeEditingRow = styled.div`
  ${fileTreeRowLayout}
  cursor: default;
  animation: none;
`;

export const FileTreeChevron = styled(ChevronRight)<{ $expanded: boolean }>`
  flex: 0 0 auto;
  color: var(--tide-muted);
  transform: ${({ $expanded }) => ($expanded ? "rotate(90deg)" : "rotate(0deg)")};

  @media (prefers-reduced-motion: no-preference) {
    transition: transform 0.18s ease;
  }
`;

export const FileTreeChevronSpacer = styled.span`
  width: 12px;
  flex: 0 0 auto;
`;

export const FileTreeRowName = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  ${FileTreeRowButton}[data-git-status="modified"] &,
  ${FileTreeRowButton}[data-git-status="renamed"] & {
    color: var(--tide-warn);
  }

  ${FileTreeRowButton}[data-git-status="added"] &,
  ${FileTreeRowButton}[data-git-status="untracked"] & {
    color: var(--tide-diff-add);
  }

  ${FileTreeRowButton}[data-git-status="deleted"] & {
    color: var(--tide-danger);
  }

  ${FileTreeRowButton}[data-synthetic-deleted="true"] & {
    text-decoration: line-through;
    text-decoration-thickness: 1px;
    text-decoration-color: color-mix(in srgb, var(--tide-danger) 58%, transparent);
  }
`;

export const FileTreeGitDot = styled.span<{ $status: GitChangeStatus }>`
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  margin-left: 2px;
  border-radius: 50%;
  background: ${({ $status }) => fileTreeGitColor($status)};
`;

export const FileTreeInlineInputField = styled.input`
  min-width: 0;
  height: 22px;
  flex: 1 1 auto;
  border: 1px solid var(--tide-accent);
  border-radius: 6px;
  outline: none;
  padding: 0 6px;
  background: var(--tide-surface, var(--tide-bg));
  color: var(--tide-text);
  font: inherit;
  font-size: 13px;
`;

export const FileTreeSkeleton = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
`;

export const FileTreeSkeletonRow = styled.div`
  height: 26px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 12px;
  padding-left: calc(10px + var(--depth, 0) * 14px);
`;

const FileTreeSkeletonBlock = styled.span`
  background: linear-gradient(
    90deg,
    rgba(var(--tide-ink-rgb), 0.06) 25%,
    rgba(var(--tide-ink-rgb), 0.13) 37%,
    rgba(var(--tide-ink-rgb), 0.06) 63%
  );
  background-size: 400% 100%;
  animation: ${fileTreeSkeletonShimmer} 1.4s ease infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export const FileTreeSkeletonIcon = styled(FileTreeSkeletonBlock)`
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  border-radius: 4px;
`;

export const FileTreeSkeletonLabel = styled(FileTreeSkeletonBlock)`
  height: 9px;
  border-radius: 4px;
`;
