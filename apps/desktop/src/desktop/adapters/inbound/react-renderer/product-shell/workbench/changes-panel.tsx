import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { ClipboardCheck, GitBranch, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import {
  ChangesActionButton,
  ChangesAdd,
  ChangesBody,
  ChangesBranch,
  ChangesCleanState,
  ChangesCommitInput,
  ChangesCount,
  ChangesDel,
  ChangesDiffEmpty,
  ChangesDiffPane,
  ChangesDiffStack,
  ChangesFileButton,
  ChangesFileDir,
  ChangesFileList,
  ChangesFileName,
  ChangesFileStat,
  ChangesHandoffBar,
  ChangesHeader,
  ChangesHeaderSpacer,
  ChangesIconButton,
  ChangesNotice,
  ChangesPaneFrame,
  ChangesPartialBar,
  ChangesPushTarget,
  ChangesResizeHandle,
  ChangesStat,
  ChangesStatusMark,
} from "./changes-panel.styles.ts";
import { createDiffView } from "./diff-pane.tsx";
import { extractGitDiffHunks, type GitDiffHunk } from "./git-diff-hunks.ts";
import { ChangesHunkActionList } from "./changes-hunk-actions.tsx";
import { errorMessage, fileDir, fileName, pushTargetLabel, pushTargetTitle } from "./changes-panel-helpers.ts";
import type { GitActionResult, GitChangeStatus, GitChangesViewResult, GitGeneratedCommitMessageResult, GitHunkAction, GitPushTargetResult } from "../support/types.ts";
// First-class git Changes Workbench pane (spec: git-changes-view): self-fetches
// status/diffs from the pane cwd and routes mutations through Main-process IPC.

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
  onGitStageFile: (cwd: string, relPath: string) => Promise<GitActionResult>;
  onGitUnstageFile: (cwd: string, relPath: string) => Promise<GitActionResult>;
  onGitDiscardFile: (cwd: string, relPath: string) => Promise<GitActionResult>;
  onGitApplyHunk: (cwd: string, relPath: string, patch: string, action: GitHunkAction) => Promise<GitActionResult>;
  onGitGenerateCommitMessage: (cwd: string) => Promise<GitGeneratedCommitMessageResult>;
  onGitCommit: (cwd: string, message: string) => Promise<GitActionResult>;
  onGitAmend: (cwd: string, message: string) => Promise<GitActionResult>;
  onGitPushTarget: (cwd: string) => Promise<GitPushTargetResult>;
  onGitPush: (cwd: string, remote: string, branch: string) => Promise<GitActionResult>;
  onGitCreatePullRequest: (cwd: string) => Promise<GitActionResult>;
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
    onGitGenerateCommitMessage,
    onGitCommit,
    onGitAmend,
    onGitPushTarget,
    onGitPush,
    onGitCreatePullRequest,
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
  const [generatingCommitMessage, setGeneratingCommitMessage] = useState(false);
  const [pushTarget, setPushTarget] = useState<GitPushTargetResult | null>(null);
  const [showPartialChanges, setShowPartialChanges] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    setPushTarget(null);
    onGitPushTarget(cwd)
      .then((result) => {
        if (!cancelled) {
          setPushTarget(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPushTarget({ ok: false, message: "Push target unavailable." });
        }
      });
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

  async function runGitMutation(
    run: () => Promise<GitActionResult>,
    fallback: string,
    refresh = true,
  ): Promise<GitActionResult | null> {
    setGitBusy(true);
    try {
      const result = await run();
      setGitNotice(result);
      if (refresh) {
        setNonce((value) => value + 1);
        setDiffNonce((value) => value + 1);
      }
      return result;
    } catch (error) {
      setGitNotice({ ok: false, message: errorMessage(error, fallback) });
      return null;
    } finally {
      setGitBusy(false);
    }
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
    await runGitMutation(
      () =>
        action === "stage"
          ? onGitStageFile(cwd, selected)
          : action === "unstage"
            ? onGitUnstageFile(cwd, selected)
            : onGitDiscardFile(cwd, selected),
      "Git action failed.",
    );
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
    await runGitMutation(() => onGitApplyHunk(cwd, selected, hunk.patch, action), "Git hunk action failed.");
  }

  async function commitChanges(): Promise<void> {
    const message = commitMessage.trim();
    if (message.length === 0 || gitBusy) {
      return;
    }
    const result = await runGitMutation(() => onGitCommit(cwd, message), "Commit failed.");
    if (result?.ok) {
      setCommitMessage("");
    }
  }

  async function amendChanges(): Promise<void> {
    if (
      gitBusy ||
      (files.length === 0 && commitMessage.trim().length === 0) ||
      !window.confirm("Amend the last commit? This rewrites the previous commit.")
    ) {
      return;
    }
    const result = await runGitMutation(() => onGitAmend(cwd, commitMessage.trim()), "Amend failed.");
    if (result?.ok) {
      setCommitMessage("");
    }
  }

  async function generateCommitMessage(): Promise<void> {
    if (gitBusy || generatingCommitMessage) {
      return;
    }
    setGeneratingCommitMessage(true);
    try {
      const result = await onGitGenerateCommitMessage(cwd);
      if (result.ok) {
        setCommitMessage(result.message);
        setGitNotice({
          ok: true,
          message:
            result.source === "staged"
              ? "Generated commit message from staged changes."
              : "Generated commit message from working-tree changes.",
        });
      } else {
        setGitNotice(result);
      }
    } catch {
      setGitNotice({ ok: false, message: "Failed to generate commit message." });
    } finally {
      setGeneratingCommitMessage(false);
    }
  }

  async function pushBranch(): Promise<void> {
    if (
      gitBusy ||
      pushTarget?.ok !== true ||
      !window.confirm(`Push ${pushTarget.currentBranch} to ${pushTarget.label} from ${cwd}?`)
    ) {
      return;
    }
    await runGitMutation(() => onGitPush(cwd, pushTarget.remote, pushTarget.branch), "Push failed.", false);
  }

  async function createPullRequest(): Promise<void> {
    if (
      gitBusy ||
      pushTarget?.ok !== true ||
      !window.confirm(`Create a pull request for ${pushTarget.currentBranch}?`)
    ) {
      return;
    }
    await runGitMutation(() => onGitCreatePullRequest(cwd), "Create PR failed.", false);
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
          disabled={!isGitRepo || gitBusy || generatingCommitMessage}
        />
        <ChangesActionButton
          type="button"
          disabled={!isGitRepo || gitBusy || generatingCommitMessage}
          onClick={() => void generateCommitMessage()}
        >
          <span>{generatingCommitMessage ? "Generating" : "Generate"}</span>
        </ChangesActionButton>
        <ChangesActionButton
          type="button"
          disabled={!isGitRepo || gitBusy || commitMessage.trim().length === 0}
          onClick={() => void commitChanges()}
        >
          <span>Commit</span>
        </ChangesActionButton>
        <ChangesActionButton
          type="button"
          disabled={!isGitRepo || gitBusy || (files.length === 0 && commitMessage.trim().length === 0)}
          onClick={() => void amendChanges()}
        >
          <span>Amend</span>
        </ChangesActionButton>
        <ChangesPushTarget title={pushTargetTitle(pushTarget)}>{pushTargetLabel(pushTarget)}</ChangesPushTarget>
        <ChangesActionButton
          type="button"
          disabled={!isGitRepo || gitBusy || pushTarget?.ok !== true}
          onClick={() => void pushBranch()}
        >
          <span>Push</span>
        </ChangesActionButton>
        <ChangesActionButton
          type="button"
          disabled={!isGitRepo || gitBusy || pushTarget?.ok !== true}
          onClick={() => void createPullRequest()}
        >
          <span>Create PR</span>
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
                <ChangesPartialBar>
                  <ChangesActionButton
                    type="button"
                    aria-expanded={showPartialChanges}
                    onClick={() => setShowPartialChanges((value) => !value)}
                  >
                    <span>{showPartialChanges ? "Hide partial changes" : "Partial changes"}</span>
                  </ChangesActionButton>
                  <ChangesCount>
                    {`${diffHunks.length} change block${diffHunks.length === 1 ? "" : "s"}`}
                  </ChangesCount>
                </ChangesPartialBar>
              ) : null}
              {showPartialChanges && diffHunks.length > 0 ? (
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
