import type { ReactElement } from "react";
import { AlertTriangle, GitBranch, Loader2 } from "lucide-react";
import type { LocalBranchCheckoutTarget } from "../../../../../application/domains/product-shell/product-shell.ts";

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
    <div
      className="worktree-create-backdrop"
      role="dialog"
      aria-label={hasError ? "Branch checkout failed" : "Switch branch"}
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget && !checkingOut) {
          props.onClose();
        }
      }}
    >
      <div className="worktree-create worktree-delete">
        <div className="worktree-create__title">
          {hasError ? (
            <AlertTriangle size={15} strokeWidth={1.9} aria-hidden />
          ) : (
            <GitBranch size={15} strokeWidth={1.9} aria-hidden />
          )}
          {hasError ? "Branch checkout failed" : `Switch branch · ${target.branch}`}
        </div>
        <div className="worktree-create__preview">
          {hasError
            ? target.error
            : `Tide will switch this local folder from ${target.currentBranch ?? "detached HEAD"} to ${target.branch} before starting.`}
        </div>
        {!hasError && running > 0 ? (
          <div className="worktree-delete__warn">
            {`${running} running thread${running === 1 ? "" : "s"} use this same folder and may see the branch change.`}
          </div>
        ) : null}
        <div className="worktree-create__actions">
          <button
            type="button"
            className="worktree-create__cancel"
            disabled={checkingOut}
            onClick={() => props.onClose()}
          >
            {hasError ? "Close" : "Cancel"}
          </button>
          {hasError ? null : (
            <button
              type="button"
              className="worktree-create__confirm"
              disabled={checkingOut}
              onClick={() => props.onConfirm()}
            >
              {checkingOut ? (
                <>
                  <Loader2 size={14} strokeWidth={2} className="worktree-delete__spinner" aria-hidden />
                  Switching...
                </>
              ) : (
                "Switch and start"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
