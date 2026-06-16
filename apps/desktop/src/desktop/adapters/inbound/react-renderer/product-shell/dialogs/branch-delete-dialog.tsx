import type { ReactElement } from "react";
import { Loader2, Trash2 } from "lucide-react";
// Spec: docs_v2/specs/branch-deletion-from-picker.md.

// The branch being deleted (name + merge fact from branchInfo, plus the cwd whose
// repo it lives in). Only safe branches reach here — local, not checked out in the
// repo or any worktree — so the picker never offers this for the current branch.
export interface BranchDeleteTarget {
  cwd: string;
  branch: string;
  branchMerged: boolean;
}

// Confirm dialog for deleting a standalone local branch. Warns before discarding
// unmerged commits (force `-D`); merged branches delete with `-d`. There is no
// "keep" choice — the branch is the thing being deleted.
export function BranchDeleteDialog(props: {
  target: BranchDeleteTarget;
  onConfirm: () => void;
  onClose: () => void;
  // While the delete runs the dialog stays open showing progress.
  deleting?: boolean;
  // A failed delete leaves the dialog open with this message (e.g. git refused it).
  error?: string | null;
}): ReactElement {
  const { branch, branchMerged } = props.target;
  const deleting = props.deleting === true;
  const unmerged = !branchMerged;
  return (
    <div
      className="worktree-create-backdrop"
      role="dialog"
      aria-label="Delete branch"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget && !deleting) {
          props.onClose();
        }
      }}
    >
      <div className="worktree-create worktree-delete">
        <div className="worktree-create__title">
          <Trash2 size={15} strokeWidth={1.9} aria-hidden />
          {`Delete branch · ${branch}`}
        </div>
        <div className="worktree-create__preview">This permanently deletes the local branch.</div>
        {unmerged ? (
          <div className="worktree-delete__warn">
            {`Branch "${branch}" has unmerged commits — deleting it discards them.`}
          </div>
        ) : null}
        {props.error != null && props.error.length > 0 ? (
          <div className="worktree-delete__warn">{props.error}</div>
        ) : null}
        <div className="worktree-create__actions">
          <button
            type="button"
            className="worktree-create__cancel"
            disabled={deleting}
            onClick={() => props.onClose()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="worktree-create__confirm worktree-delete__confirm"
            disabled={deleting}
            onClick={() => props.onConfirm()}
          >
            {deleting ? (
              <>
                <Loader2 size={14} strokeWidth={2} className="worktree-delete__spinner" aria-hidden />
                Deleting…
              </>
            ) : (
              "Delete branch"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
