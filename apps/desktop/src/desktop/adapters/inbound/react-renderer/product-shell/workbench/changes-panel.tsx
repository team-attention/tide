import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { GitBranch, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { createDiffView } from "./diff-pane.tsx";
import type { GitChangeStatus, GitChangesViewResult } from "../support/types.ts";
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
}): ReactElement {
  const { cwd, onGitChanges, onGitFileDiff } = props;
  const [data, setData] = useState<GitChangesViewResult>({ isGitRepo: true, branch: null, files: [] });
  const [nonce, setNonce] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [loadingDiff, setLoadingDiff] = useState(false);
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
  }, [selected, cwd]);

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

  return (
    <div className="changes-pane" role="group" aria-label="Working tree changes">
      <header className="changes-panel__header">
        {files.length > 0 ? (
          <button
            type="button"
            className="changes-panel__action"
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
          </button>
        ) : null}
        <span className="changes-panel__branch" title={branch ?? undefined}>
          <GitBranch size={13} strokeWidth={1.9} aria-hidden />
          <span>{branch ?? "detached"}</span>
        </span>
        {files.length === 0 ? (
          <span className="changes-panel__count">{isGitRepo ? "No changes" : "Not a git repo"}</span>
        ) : (
          <span className="changes-panel__stat">
            {totalAdd > 0 ? <span className="changes-panel__add">{`+${totalAdd}`}</span> : null}
            {totalDel > 0 ? <span className="changes-panel__del">{`−${totalDel}`}</span> : null}
            <span className="changes-panel__count">{`${files.length} file${files.length === 1 ? "" : "s"}`}</span>
          </span>
        )}
        <span className="changes-panel__spacer" />
        <button
          type="button"
          className="changes-panel__action"
          title="Refresh"
          aria-label="Refresh changes"
          onClick={() => setNonce((value) => value + 1)}
        >
          <RefreshCw size={14} strokeWidth={1.9} aria-hidden />
        </button>
      </header>
      <div
        className={`changes-panel__body${listCollapsed ? " changes-panel__body--list-collapsed" : ""}`}
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
        <ul className="changes-panel__files" aria-hidden={listCollapsed || undefined} inert={listCollapsed}>
          {files.length === 0 ? (
            <li className="changes-panel__clean">
              {isGitRepo ? "Working tree clean — no uncommitted changes." : "Not a git repository."}
            </li>
          ) : (
            files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={`changes-panel__file${file.path === selected ? " changes-panel__file--active" : ""}`}
                  onClick={() => setSelected(file.path)}
                  title={file.path}
                >
                  <span
                    className={`changes-panel__status changes-panel__status--${file.status}`}
                    aria-hidden
                  >
                    {STATUS_LABEL[file.status]}
                  </span>
                  <span className="changes-panel__file-name">{fileName(file.path)}</span>
                  {fileDir(file.path) ? (
                    <span className="changes-panel__file-dir">{fileDir(file.path)}</span>
                  ) : null}
                  {(file.additions ?? 0) > 0 || (file.deletions ?? 0) > 0 ? (
                    <span className="changes-panel__file-stat">
                      {(file.additions ?? 0) > 0 ? (
                        <span className="changes-panel__add">{`+${file.additions}`}</span>
                      ) : null}
                      {(file.deletions ?? 0) > 0 ? (
                        <span className="changes-panel__del">{`−${file.deletions}`}</span>
                      ) : null}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <div
          className="changes-panel__resize"
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
        <div className="changes-panel__diff">
          {selected === null ? (
            <div className="changes-panel__diff-empty">Select a file to view its diff.</div>
          ) : loadingDiff ? (
            <div className="changes-panel__diff-empty">Loading diff…</div>
          ) : diff.trim().length === 0 ? (
            <div className="changes-panel__diff-empty">No textual diff (binary or empty).</div>
          ) : (
            createDiffView(diff)
          )}
        </div>
      </div>
    </div>
  );
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function fileDir(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}
