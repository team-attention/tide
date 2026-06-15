import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { GitBranch, RefreshCw, X } from "lucide-react";
import { createDiffView } from "./diff-pane.tsx";
import type { GitChangeStatus } from "../support/types.ts";
// Read-only "Changes" view (spec: git-changes-view): the active repo/worktree's
// uncommitted files (vs HEAD) on the left, the selected file's diff on the right.
// Opened from the top-bar git badge; an overlay over the stage (no staging/commit).

interface ChangedFile {
  path: string;
  status: GitChangeStatus;
  additions?: number;
  deletions?: number;
}

const STATUS_LABEL: Record<GitChangeStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

export function ChangesPanel(props: {
  isGitRepo: boolean;
  branch: string | null;
  files: ChangedFile[];
  loadDiff: (relPath: string) => Promise<string>;
  onRefresh: () => void;
  onClose: () => void;
}): ReactElement {
  const { isGitRepo, branch, files, loadDiff, onRefresh, onClose } = props;
  const totalAdd = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const totalDel = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const [selected, setSelected] = useState<string | null>(files[0]?.path ?? null);
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Keep a valid selection as the file list changes (e.g. after a refresh).
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
    setLoading(true);
    loadDiff(selected)
      .then((text) => {
        if (!cancelled) {
          setDiff(text);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDiff("");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return (
    <div className="changes-pane" role="group" aria-label="Working tree changes">
        <header className="changes-panel__header">
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
            onClick={() => onRefresh()}
          >
            <RefreshCw size={14} strokeWidth={1.9} aria-hidden />
          </button>
          <button
            type="button"
            className="changes-panel__action"
            title="Close"
            aria-label="Close changes"
            onClick={() => onClose()}
          >
            <X size={15} strokeWidth={1.9} aria-hidden />
          </button>
        </header>
        <div className="changes-panel__body">
          <ul className="changes-panel__files">
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
          <div className="changes-panel__diff">
            {selected === null ? (
              <div className="changes-panel__diff-empty">Select a file to view its diff.</div>
            ) : loading ? (
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
