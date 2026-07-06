import type { ReactElement } from "react";
import { styled } from "styled-components";
import type { GitHunkAction } from "../support/types.ts";
import type { GitDiffHunk } from "./git-diff-hunks.ts";

export function ChangesHunkActionList(props: {
  hunks: GitDiffHunk[];
  gitBusy: boolean;
  onAction: (action: GitHunkAction, hunk: GitDiffHunk) => void;
}): ReactElement {
  return (
    <HunkList aria-label="Hunk actions">
      {props.hunks.map((hunk, index) => (
        <HunkItem key={hunk.hunkId}>
          <HunkMeta>
            <span>{`Hunk ${index + 1}`}</span>
            <code>{hunk.title}</code>
            <HunkStat>
              {hunk.additions > 0 ? <StatAdd>{`+${hunk.additions}`}</StatAdd> : null}
              {hunk.deletions > 0 ? <StatDel>{`−${hunk.deletions}`}</StatDel> : null}
            </HunkStat>
          </HunkMeta>
          <HunkActions>
            <MiniButton
              type="button"
              disabled={props.gitBusy}
              aria-label={`Stage hunk ${index + 1}`}
              onClick={() => props.onAction("stage", hunk)}
            >
              Stage hunk
            </MiniButton>
            <MiniButton
              type="button"
              disabled={props.gitBusy}
              aria-label={`Unstage hunk ${index + 1}`}
              onClick={() => props.onAction("unstage", hunk)}
            >
              Unstage
            </MiniButton>
            <MiniButton
              type="button"
              data-danger="true"
              disabled={props.gitBusy}
              aria-label={`Discard hunk ${index + 1}`}
              onClick={() => props.onAction("discard", hunk)}
            >
              Discard
            </MiniButton>
          </HunkActions>
        </HunkItem>
      ))}
    </HunkList>
  );
}

const HunkList = styled.div`
  flex: 0 0 auto;
  max-height: 176px;
  overflow: auto;
  display: grid;
  gap: 6px;
  padding: 2px;
`;

const HunkItem = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: var(--tide-surface);
`;

const HunkMeta = styled.div`
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--tide-text);
  font-size: 12px;

  code {
    min-width: 0;
    overflow: hidden;
    color: var(--tide-muted);
    font-family: "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const HunkStat = styled.span`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
`;

const HunkActions = styled.div`
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
`;

const MiniButton = styled.button`
  height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  border: 1px solid var(--tide-line);
  border-radius: 6px;
  background: var(--tide-bg);
  color: var(--tide-text);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;

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

const StatAdd = styled.span`
  color: var(--tide-diff-add);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

const StatDel = styled.span`
  color: var(--tide-danger);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;
