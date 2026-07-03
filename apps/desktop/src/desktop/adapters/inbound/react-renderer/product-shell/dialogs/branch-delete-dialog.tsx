import type { ReactElement } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  WorktreeDialogActions,
  WorktreeDialogBackdrop,
  WorktreeDialogCancelButton,
  WorktreeDialogConfirmButton,
  WorktreeDialogPanel,
  WorktreeDialogPreview,
  WorktreeDialogSpinner,
  WorktreeDialogTitle,
  WorktreeDialogWarning,
} from "./worktree-dialog.parts.tsx";
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
    <WorktreeDialogBackdrop
      role="dialog"
      aria-label="Delete branch"
      data-worktree-dialog="delete-branch"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget && !deleting) {
          props.onClose();
        }
      }}
    >
      <WorktreeDialogPanel>
        <WorktreeDialogTitle>
          <Trash2 size={15} strokeWidth={1.9} aria-hidden />
          {`Delete branch · ${branch}`}
        </WorktreeDialogTitle>
        <WorktreeDialogPreview data-kind="sentence">This permanently deletes the local branch.</WorktreeDialogPreview>
        {unmerged ? (
          <WorktreeDialogWarning>
            {`Branch "${branch}" has unmerged commits — deleting it discards them.`}
          </WorktreeDialogWarning>
        ) : null}
        {props.error ? (
          <WorktreeDialogWarning>{props.error}</WorktreeDialogWarning>
        ) : null}
        <WorktreeDialogActions>
          <WorktreeDialogCancelButton
            type="button"
            disabled={deleting}
            onClick={() => props.onClose()}
          >
            Cancel
          </WorktreeDialogCancelButton>
          <WorktreeDialogConfirmButton
            type="button"
            $variant="danger"
            disabled={deleting}
            onClick={() => props.onConfirm()}
          >
            {deleting ? (
              <>
                <WorktreeDialogSpinner aria-hidden>
                  <Loader2 size={14} strokeWidth={2} />
                </WorktreeDialogSpinner>
                Deleting…
              </>
            ) : (
              "Delete branch"
            )}
          </WorktreeDialogConfirmButton>
        </WorktreeDialogActions>
      </WorktreeDialogPanel>
    </WorktreeDialogBackdrop>
  );
}
