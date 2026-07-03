import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { styled } from "styled-components";
import { ClipboardCheck, GitBranch, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { createDiffView } from "./diff-pane.tsx";
import { extractGitDiffHunks, type GitDiffHunk } from "./git-diff-hunks.ts";
import { ChangesHunkActionList } from "./changes-hunk-actions.tsx";
import type { GitChangeStatus, GitChangesViewResult, GitHunkAction } from "../support/types.ts";
// First-class read-only git "Changes" Workbench pane (spec: git-changes-view): the repo's
// uncommitted files (vs HEAD) on the left, the selected file's diff on the right. It's a
// real backend pane (tabs/split/close like the others) that self-fetches its data from
// the pane's cwd via Main-process git. No staging/commit. The file list is resizable +
// collapsible (GitHub Files-changed parity) so the diff can take the full pane width.

const STATUS_LABEL: Record<GitChangeStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

const MIN_LIST_WIDTH = 140;
const MAX_LIST_WIDTH = 520;
const DEFAULT_LIST_WIDTH = 240;
const RESIZE_HANDLE_WIDTH = 6;

export function ChangesPanel(props: {
  cwd: string;
  onGitChanges: (cwd: string) => Promise<GitChangesViewResult>;
  onGitFileDiff: (cwd: string, relPath: string) => Promise<string>;
  onOpenReview: (cwd: string) => void;
  onGitStageFile: (cwd: string, relPath: string) => Promise<{ ok: boolean; message: string }>;
  onGitUnstageFile: (cwd: string, relPath: string) => Promise<{ ok: boolean; message: string }>;
  onGitDiscardFile: (cwd: string, relPath: string) => Promise<{ ok: boolean; message: string }>;
  onGitApplyHunk: (cwd: string, relPath: string, patch: string, action: GitHunkAction) => Promise<{ ok: boolean; message: string }>;
  onGitCommit: (cwd: string, message: string) => Promise<{ ok: boolean; message: string }>;
  onGitPush: (cwd: string) => Promise<{ ok: boolean; message: string }>;
}): ReactElement {
  const {
    cwd,
    onGitChanges,
    onGitFileDiff,
    onOpenReview,
    onGitStageFile,
    onGitUnstageFile,
    onGitDiscardFile,
    onGitApplyHunk,
    onGitCommit,
    onGitPush,
  } = props;
  const [data, setData] = useState<GitChangesViewResult>({ isGitRepo: true, branch: null, files: [] });
  const [nonce, setNonce] = useState(0);
  const [diffNonce, setDiffNonce] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitNotice, setGitNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  // GitHub-style file tree: drag the divider to resize it, or collapse it so the diff
  // takes the full pane width. Renderer-local view state (not persisted).
  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH);
  const [listCollapsed, setListCollapsed] = useState(false);
  // Active resize drag: pointer x + list width captured at pointerdown, null when idle.
  // Drives the live width and gates the collapse transition (the animation must not fight
  // a live drag, or the divider rubber-bands over the 220ms ease).
  const [dragStart, setDragStart] = useState<{ x: number; width: number } | null>(null);
  const { isGitRepo, branch, files } = data;
  const totalAdd = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const totalDel = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const diffHunks = useMemo(() => extractGitDiffHunks(diff), [diff]);

  // Fetch the changed-file list for this cwd (on mount, cwd change, or refresh).
  useEffect(() => {
    let cancelled = false;
    onGitChanges(cwd)
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, nonce]);

  // Keep a valid selection as the file list changes (after a refresh / cwd change).
  useEffect(() => {
    if (files.length === 0) {
      setSelected(null);
    } else if (selected === null || !files.some((file) => file.path === selected)) {
      setSelected(files[0].path);
    }
  }, [files, selected]);

  // Load the selected file's diff on demand.
  useEffect(() => {
    if (selected === null) {
      setDiff("");
      return undefined;
    }
    let cancelled = false;
    setLoadingDiff(true);
    onGitFileDiff(cwd, selected)
      .then((text) => {
        if (!cancelled) {
          setDiff(text);
          setLoadingDiff(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiff("");
          setLoadingDiff(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, cwd, diffNonce]);

  // Drag the divider to resize the file list (clamped so it can't crowd out the diff or
  // shrink past legibility). Pointer capture — rather than window listeners — keeps the
  // handle receiving move/up events even when the pointer leaves its thin width, and lets
  // React tear these element handlers down on unmount, so a drag interrupted by the pane
  // closing can't leak a window listener. pointercancel ends the drag like pointerup.
  function startResize(event: ReactPointerEvent): void {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({ x: event.clientX, width: listWidth });
  }

  function moveResize(event: ReactPointerEvent): void {
    if (dragStart === null) {
      return;
    }
    const next = dragStart.width + (event.clientX - dragStart.x);
    setListWidth(Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, next)));
  }

  function endResize(): void {
    setDragStart(null);
  }

  async function runFileGitAction(action: "stage" | "unstage" | "discard"): Promise<void> {
    if (selected === null || gitBusy) {
      return;
    }
    if (
      action === "discard" &&
      !window.confirm(`Discard changes in ${selected}? This cannot be undone from Tide.`)
    ) {
      return;
    }
    setGitBusy(true);
    const result =
      action === "stage"
        ? await onGitStageFile(cwd, selected)
        : action === "unstage"
          ? await onGitUnstageFile(cwd, selected)
          : await onGitDiscardFile(cwd, selected);
    setGitNotice(result);
    setGitBusy(false);
    setNonce((value) => value + 1);
    setDiffNonce((value) => value + 1);
  }

  async function runHunkGitAction(action: GitHunkAction, hunk: GitDiffHunk): Promise<void> {
    if (selected === null || gitBusy) {
      return;
    }
    if (
      action === "discard" &&
      !window.confirm(`Discard this hunk in ${selected}? This cannot be undone from Tide.`)
    ) {
      return;
    }
    setGitBusy(true);
    const result = await onGitApplyHunk(cwd, selected, hunk.patch, action);
    setGitNotice(result);
    setGitBusy(false);
    setNonce((value) => value + 1);
    setDiffNonce((value) => value + 1);
  }

  async function commitChanges(): Promise<void> {
    const message = commitMessage.trim();
    if (message.length === 0 || gitBusy) {
      return;
    }
    setGitBusy(true);
    const result = await onGitCommit(cwd, message);
    setGitNotice(result);
    if (result.ok) {
      setCommitMessage("");
    }
    setGitBusy(false);
    setNonce((value) => value + 1);
    setDiffNonce((value) => value + 1);
  }

  async function pushBranch(): Promise<void> {
    if (gitBusy || !window.confirm(`Push ${branch ?? "current branch"} from ${cwd}?`)) {
      return;
    }
    setGitBusy(true);
    const result = await onGitPush(cwd);
    setGitNotice(result);
    setGitBusy(false);
  }

  return (
    <ChangesPaneFrame role="group" aria-label="Working tree changes">
      <ChangesHeader>
        {files.length > 0 ? (
          <ChangesIconButton
            type="button"
            title={listCollapsed ? "Show file list" : "Hide file list"}
            aria-label={listCollapsed ? "Show file list" : "Hide file list"}
            aria-pressed={listCollapsed}
            onClick={() => setListCollapsed((value) => !value)}
          >
            {listCollapsed ? (
              <PanelLeftOpen size={15} strokeWidth={1.9} aria-hidden />
            ) : (
              <PanelLeftClose size={15} strokeWidth={1.9} aria-hidden />
            )}
          </ChangesIconButton>
        ) : null}
        <ChangesBranch title={branch ?? undefined}>
          <GitBranch size={13} strokeWidth={1.9} aria-hidden />
          <span>{branch ?? "detached"}</span>
        </ChangesBranch>
        {files.length === 0 ? (
          <ChangesCount>{isGitRepo ? "No changes" : "Not a git repo"}</ChangesCount>
        ) : (
          <ChangesStat>
            {totalAdd > 0 ? <ChangesAdd>{`+${totalAdd}`}</ChangesAdd> : null}
            {totalDel > 0 ? <ChangesDel>{`−${totalDel}`}</ChangesDel> : null}
            <ChangesCount>{`${files.length} file${files.length === 1 ? "" : "s"}`}</ChangesCount>
          </ChangesStat>
        )}
        <ChangesHeaderSpacer />
        <ChangesActionButton
          type="button"
          title="Review changes"
          aria-label="Review changes"
          disabled={!isGitRepo}
          onClick={() => onOpenReview(cwd)}
        >
          <ClipboardCheck size={14} strokeWidth={1.9} aria-hidden />
          <span>Review</span>
        </ChangesActionButton>
        <ChangesIconButton
          type="button"
          title="Refresh"
          aria-label="Refresh changes"
          onClick={() => {
            setNonce((value) => value + 1);
            setDiffNonce((value) => value + 1);
          }}
        >
          <RefreshCw size={14} strokeWidth={1.9} aria-hidden />
        </ChangesIconButton>
      </ChangesHeader>
      <ChangesHandoffBar>
        <ChangesActionButton
          type="button"
          disabled={!isGitRepo || selected === null || gitBusy}
          onClick={() => void runFileGitAction("stage")}
        >
          <span>Stage</span>
        </ChangesActionButton>
        <ChangesActionButton
          type="button"
          disabled={!isGitRepo || selected === null || gitBusy}
          onClick={() => void runFileGitAction("unstage")}
        >
          <span>Unstage</span>
        </ChangesActionButton>
        <ChangesActionButton
          type="button"
          data-danger="true"
          disabled={!isGitRepo || selected === null || gitBusy}
          onClick={() => void runFileGitAction("discard")}
        >
          <span>Discard</span>
        </ChangesActionButton>
        <ChangesCommitInput
          aria-label="Commit message"
          placeholder="Commit message"
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.currentTarget.value)}
          disabled={!isGitRepo || gitBusy}
        />
        <ChangesActionButton
          type="button"
          disabled={!isGitRepo || gitBusy || commitMessage.trim().length === 0}
          onClick={() => void commitChanges()}
        >
          <span>Commit</span>
        </ChangesActionButton>
        <ChangesActionButton
          type="button"
          disabled={!isGitRepo || gitBusy}
          onClick={() => void pushBranch()}
        >
          <span>Push</span>
        </ChangesActionButton>
      </ChangesHandoffBar>
      {gitNotice !== null ? (
        <ChangesNotice data-ok={gitNotice.ok ? "true" : "false"}>{gitNotice.message}</ChangesNotice>
      ) : null}
      <ChangesBody
        data-list-collapsed={listCollapsed ? "true" : "false"}
        style={{
          // Always three tracks so the collapse interpolates (3↔1 track counts can't).
          // Collapsed shrinks the list + handle to 0; the diff (1fr) grows to fill.
          gridTemplateColumns: listCollapsed
            ? "0px 0px 1fr"
            : `${listWidth}px ${RESIZE_HANDLE_WIDTH}px 1fr`,
          transition: dragStart ? "none" : undefined,
        }}
      >
        {/* The list + handle stay mounted (so they can animate); when collapsed they clip
            to a 0-width track, fade out, and drop out of the focus/AT tree via inert. */}
        <ChangesFileList aria-hidden={listCollapsed || undefined} inert={listCollapsed}>
          {files.length === 0 ? (
            <ChangesCleanState>
              {isGitRepo ? "Working tree clean — no uncommitted changes." : "Not a git repository."}
            </ChangesCleanState>
          ) : (
            files.map((file) => (
              <li key={file.path}>
                <ChangesFileButton
                  type="button"
                  data-active={file.path === selected ? "true" : "false"}
                  onClick={() => setSelected(file.path)}
                  title={file.path}
                >
                  <ChangesStatusMark
                    data-status={file.status}
                    aria-hidden
                  >
                    {STATUS_LABEL[file.status]}
                  </ChangesStatusMark>
                  <ChangesFileName>{fileName(file.path)}</ChangesFileName>
                  {fileDir(file.path) ? (
                    <ChangesFileDir>{fileDir(file.path)}</ChangesFileDir>
                  ) : null}
                  {(file.additions ?? 0) > 0 || (file.deletions ?? 0) > 0 ? (
                    <ChangesFileStat>
                      {(file.additions ?? 0) > 0 ? (
                        <ChangesAdd>{`+${file.additions}`}</ChangesAdd>
                      ) : null}
                      {(file.deletions ?? 0) > 0 ? (
                        <ChangesDel>{`−${file.deletions}`}</ChangesDel>
                      ) : null}
                    </ChangesFileStat>
                  ) : null}
                </ChangesFileButton>
              </li>
            ))
          )}
        </ChangesFileList>
        <ChangesResizeHandle
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file list"
          aria-hidden={listCollapsed || undefined}
          inert={listCollapsed}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
        <ChangesDiffPane>
          {selected === null ? (
            <ChangesDiffEmpty>Select a file to view its diff.</ChangesDiffEmpty>
          ) : loadingDiff ? (
            <ChangesDiffEmpty>Loading diff…</ChangesDiffEmpty>
          ) : diff.trim().length === 0 ? (
            <ChangesDiffEmpty>No textual diff (binary or empty).</ChangesDiffEmpty>
          ) : (
            <ChangesDiffStack>
              {diffHunks.length > 0 ? (
                <ChangesHunkActionList
                  hunks={diffHunks}
                  gitBusy={gitBusy}
                  onAction={(action, hunk) => void runHunkGitAction(action, hunk)}
                />
              ) : null}
              {createDiffView(diff)}
            </ChangesDiffStack>
          )}
        </ChangesDiffPane>
      </ChangesBody>
    </ChangesPaneFrame>
  );
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function fileDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

const ChangesPaneFrame = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--tide-bg);
`;

const ChangesHeader = styled.header`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--tide-line);
`;

const ChangesIconButton = styled.button`
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

const ChangesBranch = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--tide-text);
  font-size: 13px;
  font-weight: 600;
`;

const ChangesCount = styled.span`
  color: var(--tide-muted);
  font-size: 12px;
`;

const ChangesStat = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
`;

const ChangesAdd = styled.span`
  color: var(--tide-diff-add);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

const ChangesDel = styled.span`
  color: var(--tide-danger);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

const ChangesHeaderSpacer = styled.span`
  flex: 1 1 auto;
`;

const ChangesActionButton = styled.button`
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

const ChangesHandoffBar = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--tide-line);
`;

const ChangesCommitInput = styled.input`
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

const ChangesNotice = styled.div`
  flex: 0 0 auto;
  padding: 7px 14px;
  border-bottom: 1px solid var(--tide-line);
  color: var(--tide-danger);
  font-size: 12px;

  &[data-ok="true"] {
    color: var(--tide-diff-add);
  }
`;

const ChangesBody = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: 240px 6px 1fr;
  transition: grid-template-columns 220ms cubic-bezier(0.4, 0, 0.2, 1);
`;

const ChangesFileList = styled.ul`
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

const ChangesCleanState = styled.li`
  padding: 16px 12px;
  color: var(--tide-muted);
  font-size: 12.5px;
`;

const ChangesFileButton = styled.button`
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

const ChangesStatusMark = styled.span`
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

const ChangesFileName = styled.span`
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ChangesFileDir = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ChangesFileStat = styled.span`
  flex-shrink: 0;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
`;

const ChangesResizeHandle = styled.div`
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

const ChangesDiffPane = styled.div`
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

const ChangesDiffStack = styled.div`
  min-width: 0;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ChangesDiffEmpty = styled.div`
  padding: 24px;
  color: var(--tide-muted);
  font-size: 12.5px;
`;
