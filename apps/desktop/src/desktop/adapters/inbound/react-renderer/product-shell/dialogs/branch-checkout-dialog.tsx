import type { ReactElement } from "react";
import { AlertTriangle, GitBranch, Loader2 } from "lucide-react";
import type { LocalBranchCheckoutTarget } from "../../../../../application/domains/product-shell/product-shell.ts";
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

// Confirmation/error dialog for switching the shared Local folder branch before
// starting a Thread. Reuses the compact worktree dialog chrome.
export function BranchCheckoutDialog(props: {
  target: LocalBranchCheckoutTarget;
  checkingOut: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): ReactElement {
  const { target, checkingOut } = props;
  const hasError = target.error !== undefined && target.error.length > 0;
  const running = target.runningThreadCount;
  return (
    <WorktreeDialogBackdrop
      role="dialog"
      aria-label={hasError ? "Branch checkout failed" : "Switch branch"}
      data-worktree-dialog="branch-checkout"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget && !checkingOut) {
          props.onClose();
        }
      }}
    >
      <WorktreeDialogPanel>
        <WorktreeDialogTitle>
          {hasError ? (
            <AlertTriangle size={15} strokeWidth={1.9} aria-hidden />
          ) : (
            <GitBranch size={15} strokeWidth={1.9} aria-hidden />
          )}
          {hasError ? "Branch checkout failed" : `Switch branch · ${target.branch}`}
        </WorktreeDialogTitle>
        <WorktreeDialogPreview data-kind="sentence">
          {hasError
            ? target.error
            : `Tide will switch this local folder from ${target.currentBranch ?? "detached HEAD"} to ${target.branch} before starting.`}
        </WorktreeDialogPreview>
        {!hasError && running > 0 ? (
          <WorktreeDialogWarning>
            {`${running} running thread${running === 1 ? "" : "s"} use this same folder and may see the branch change.`}
          </WorktreeDialogWarning>
        ) : null}
        <WorktreeDialogActions>
          <WorktreeDialogCancelButton
            type="button"
            disabled={checkingOut}
            onClick={() => props.onClose()}
          >
            {hasError ? "Close" : "Cancel"}
          </WorktreeDialogCancelButton>
          {hasError ? null : (
            <WorktreeDialogConfirmButton
              type="button"
              disabled={checkingOut}
              onClick={() => props.onConfirm()}
            >
              {checkingOut ? (
                <>
                  <WorktreeDialogSpinner aria-hidden>
                    <Loader2 size={14} strokeWidth={2} />
                  </WorktreeDialogSpinner>
                  Switching...
                </>
              ) : (
                "Switch and start"
              )}
            </WorktreeDialogConfirmButton>
          )}
        </WorktreeDialogActions>
      </WorktreeDialogPanel>
    </WorktreeDialogBackdrop>
  );
}
