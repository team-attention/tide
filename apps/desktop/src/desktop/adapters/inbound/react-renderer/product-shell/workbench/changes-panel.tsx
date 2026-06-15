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
}

const STATUS_LABEL: Record<GitChangeStatus, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
};

export function ChangesPanel(props: {
  branch: string | null;
  files: ChangedFile[];
  loadDiff: (relPath: string) => Promise<string>;
  onRefresh: () => void;
  onClose: () => void;
}): ReactElement {
  const { branch, files, loadDiff, onRefresh, onClose } = props;
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

  // Escape closes the overlay.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="changes-panel-backdrop"
      role="dialog"
      aria-label="Working tree changes"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="changes-panel">
        <header className="changes-panel__header">
          <span className="changes-panel__branch" title={branch ?? undefined}>
            <GitBranch size={13} strokeWidth={1.9} aria-hidden />
            <span>{branch ?? "detached"}</span>
          </span>
          <span className="changes-panel__count">
            {files.length === 0 ? "No changes" : `${files.length} file${files.length === 1 ? "" : "s"} changed`}
          </span>
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
              <li className="changes-panel__clean">Working tree clean</li>
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
