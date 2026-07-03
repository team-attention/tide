import { useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  WorktreeDeleteCheck,
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
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// The worktree being deleted (branch + git/merge facts from worktreeInfo, plus
// the threads-here/running facts from product-shell state).
export interface WorktreeDeleteTarget {
  cwd: string;
  branch: string;
  branchMerged: boolean;
  threadCount: number;
  anyRunning: boolean;
}

// Confirm dialog for deleting a worktree (and, by default, its branch). Blocks
// while an agent runs in it; warns before discarding unmerged commits; a "Keep
// branch" checkbox removes only the directory. See
// docs_v2/specs/worktree-branch-deletion.md.
export function WorktreeDeleteDialog(props: {
  target: WorktreeDeleteTarget;
  onConfirm: (keepBranch: boolean) => void;
  onClose: () => void;
  // While the delete runs (git worktree remove + branch delete can take a moment), the
  // dialog stays open showing progress instead of vanishing with nothing happening.
  deleting?: boolean;
}): ReactElement {
  const [keepBranch, setKeepBranch] = useState(false);
  const { branch, branchMerged, threadCount, anyRunning } = props.target;
  const deleting = props.deleting === true;
  const willDeleteBranch = !keepBranch;
  const unmerged = willDeleteBranch && !branchMerged;
  const body = anyRunning
    ? `An agent is still running in this worktree. Stop it first, then delete.`
    : threadCount > 0
      ? `${threadCount} thread${threadCount === 1 ? "" : "s"} run in this worktree — they'll become unavailable (their history is kept).`
      : `This removes the worktree directory on disk.`;
  return (
    <WorktreeDialogBackdrop
      role="dialog"
      aria-label="Delete worktree"
      data-worktree-dialog="delete-worktree"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget && !deleting) {
          props.onClose();
        }
      }}
    >
      <WorktreeDialogPanel>
        <WorktreeDialogTitle>
          <Trash2 size={15} strokeWidth={1.9} aria-hidden />
          {`Delete worktree · ${branch}`}
        </WorktreeDialogTitle>
        <WorktreeDialogPreview data-kind="sentence">{body}</WorktreeDialogPreview>
        {anyRunning ? null : (
          <WorktreeDeleteCheck>
            <input
              type="checkbox"
              checked={keepBranch}
              disabled={deleting}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setKeepBranch(event.currentTarget.checked)}
            />
            <span>{`Keep branch ${branch}`}</span>
          </WorktreeDeleteCheck>
        )}
        {unmerged ? (
          <WorktreeDialogWarning>
            {`Branch "${branch}" has unmerged commits — deleting it discards them.`}
          </WorktreeDialogWarning>
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
            data-variant="danger"
            disabled={anyRunning || deleting}
            onClick={() => props.onConfirm(keepBranch)}
          >
            {deleting ? (
              <>
                <WorktreeDialogSpinner aria-hidden>
                  <Loader2 size={14} strokeWidth={2} />
                </WorktreeDialogSpinner>
                Deleting…
              </>
            ) : willDeleteBranch ? (
              "Delete worktree + branch"
            ) : (
              "Delete worktree"
            )}
          </WorktreeDialogConfirmButton>
        </WorktreeDialogActions>
      </WorktreeDialogPanel>
    </WorktreeDialogBackdrop>
  );
}
