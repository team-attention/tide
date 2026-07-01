import type { Dispatch, ReactElement, SetStateAction } from "react";
import type {
  LocalBranchCheckoutTarget,
} from "../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "./support/types.ts";
import { BranchCheckoutDialog } from "./dialogs/branch-checkout-dialog.tsx";
import { BranchDeleteDialog, type BranchDeleteTarget } from "./dialogs/branch-delete-dialog.tsx";
import { WorktreeDeleteDialog, type WorktreeDeleteTarget } from "./dialogs/worktree-delete-dialog.tsx";

export function createProductShellGitDialogs(input: {
  worktreeDelete: WorktreeDeleteTarget | null;
  worktreeDeleting: boolean;
  setWorktreeDelete: Dispatch<SetStateAction<WorktreeDeleteTarget | null>>;
  setWorktreeDeleting: Dispatch<SetStateAction<boolean>>;
  branchDelete: BranchDeleteTarget | null;
  branchDeleting: boolean;
  branchDeleteError: string | null;
  setBranchDelete: Dispatch<SetStateAction<BranchDeleteTarget | null>>;
  setBranchDeleting: Dispatch<SetStateAction<boolean>>;
  setBranchDeleteError: Dispatch<SetStateAction<string | null>>;
  branchCheckout: LocalBranchCheckoutTarget | null;
  branchCheckoutBusy: boolean;
  confirmWorktreeDelete: (keepBranch: boolean) => void;
  confirmBranchDelete: () => void;
  handlers: ProductShellHandlers;
}): ReactElement {
  return (
    <>
      {input.worktreeDelete !== null ? (
        <WorktreeDeleteDialog
          target={input.worktreeDelete}
          deleting={input.worktreeDeleting}
          onConfirm={input.confirmWorktreeDelete}
          onClose={() => {
            input.setWorktreeDelete(null);
            input.setWorktreeDeleting(false);
          }}
        />
      ) : null}
      {input.branchDelete !== null ? (
        <BranchDeleteDialog
          target={input.branchDelete}
          deleting={input.branchDeleting}
          error={input.branchDeleteError}
          onConfirm={input.confirmBranchDelete}
          onClose={() => {
            input.setBranchDelete(null);
            input.setBranchDeleting(false);
            input.setBranchDeleteError(null);
          }}
        />
      ) : null}
      {input.branchCheckout !== null ? (
        <BranchCheckoutDialog
          target={input.branchCheckout}
          checkingOut={input.branchCheckoutBusy}
          onConfirm={input.handlers.onBranchCheckoutConfirm}
          onClose={input.handlers.onBranchCheckoutCancel}
        />
      ) : null}
    </>
  );
}
