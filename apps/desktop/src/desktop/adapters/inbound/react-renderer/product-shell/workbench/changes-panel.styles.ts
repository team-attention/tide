import { styled } from "styled-components";

export const ChangesPaneFrame = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--tide-bg);
`;

export const ChangesHeader = styled.header`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--tide-line);
`;

export const ChangesIconButton = styled.button`
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;

export const ChangesBranch = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 600;
`;

export const ChangesCount = styled.span`
  color: var(--tide-muted);
  font-size: 12px;
`;

export const ChangesStat = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
`;

export const ChangesAdd = styled.span`
  color: var(--tide-diff-add);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

export const ChangesDel = styled.span`
  color: var(--tide-danger);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

export const ChangesHeaderSpacer = styled.span`
  flex: 1 1 auto;
`;

export const ChangesActionButton = styled.button`
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: var(--tide-surface);
  color: var(--tide-text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease, opacity 0.12s ease;

  &:hover:not(:disabled) {
    background: var(--tide-selection);
    color: var(--tide-action);
  }

  &[data-danger="true"]:hover:not(:disabled) {
    color: var(--tide-danger);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

export const ChangesHandoffBar = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--tide-line);
`;

export const ChangesCommitInput = styled.input`
  min-width: 120px;
  flex: 1 1 auto;
  height: 28px;
  padding: 0 9px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: var(--tide-surface);
  color: var(--tide-text);
  font-size: 12.5px;
  outline: none;
`;

export const ChangesPushTarget = styled.span`
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ChangesNotice = styled.div`
  flex: 0 0 auto;
  padding: 7px 14px;
  border-bottom: 1px solid var(--tide-line);
  color: var(--tide-danger);
  font-size: 12px;

  &[data-ok="true"] {
    color: var(--tide-diff-add);
  }
`;

export const ChangesBody = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: 240px 6px 1fr;
  transition: grid-template-columns 220ms cubic-bezier(0.4, 0, 0.2, 1);
`;

export const ChangesFileList = styled.ul`
  overflow-x: hidden;
  overflow-y: auto;
  margin: 0;
  padding: 6px;
  border-right: 1px solid var(--tide-line);
  list-style: none;
  transition: opacity 140ms ease;

  ${ChangesBody}[data-list-collapsed="true"] & {
    opacity: 0;
  }
`;

export const ChangesCleanState = styled.li`
  padding: 16px 12px;
  color: var(--tide-muted);
  font-size: 12.5px;
`;

export const ChangesFileButton = styled.button`
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-text);
  cursor: pointer;
  font-size: 12.5px;
  text-align: left;
  transition: background 0.1s ease;

  &:hover,
  &[data-active="true"] {
    background: var(--tide-selection);
  }
`;

export const ChangesStatusMark = styled.span`
  width: 14px;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  text-align: center;

  &[data-status="modified"] {
    color: var(--tide-warn);
  }

  &[data-status="added"],
  &[data-status="untracked"] {
    color: var(--tide-diff-add);
  }

  &[data-status="deleted"] {
    color: var(--tide-danger);
  }

  &[data-status="renamed"] {
    color: var(--tide-action);
  }
`;

export const ChangesFileName = styled.span`
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ChangesFileDir = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const ChangesFileStat = styled.span`
  flex-shrink: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
`;

export const ChangesResizeHandle = styled.div`
  align-self: stretch;
  background: transparent;
  cursor: col-resize;
  transition: background 0.12s ease, opacity 140ms ease;

  &:hover,
  &:active {
    background: color-mix(in srgb, var(--tide-action) 45%, transparent);
  }

  ${ChangesBody}[data-list-collapsed="true"] & {
    opacity: 0;
  }
`;

export const ChangesDiffPane = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  padding: 8px;

  [data-diff-view] {
    width: 100%;
    height: 100%;
    max-height: none;
    border: none;
    border-radius: 0;
  }

  [data-diff-stat] {
    left: 0;
  }

  [data-diff-body] {
    width: max-content;
    min-width: 100%;
  }

  [data-diff-row] {
    width: 100%;
    min-width: 100%;
  }

  [data-diff-line-text] {
    flex: 0 0 auto;
    white-space: pre;
    word-break: normal;
  }
`;

export const ChangesDiffStack = styled.div`
  min-width: 0;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

export const ChangesPartialBar = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px;
`;

export const ChangesDiffEmpty = styled.div`
  padding: 24px;
  color: var(--tide-muted);
  font-size: 12.5px;
`;
