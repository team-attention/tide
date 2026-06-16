import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  deleteWorktreeAndRefocus,
  setProductShellGitContext,
  setProductShellRegisteredProjects,
  type ProductShellBackendCommand,
  type ProductShellState,
} from "../../../../../application/domains/product-shell/product-shell.ts";
import { branchDeleteRequest, worktreeDeleteRequest } from "../../../../../../shared/worktree/path.ts";
import type { WorktreeDeleteTarget } from "../dialogs/worktree-delete-dialog.tsx";
import type { BranchDeleteTarget } from "../dialogs/branch-delete-dialog.tsx";
import type { ProjectRegistryBridge } from "./types.ts";

export interface DeleteDialogsController {
  worktreeDelete: WorktreeDeleteTarget | null;
  setWorktreeDelete: Dispatch<SetStateAction<WorktreeDeleteTarget | null>>;
  worktreeDeleting: boolean;
  setWorktreeDeleting: Dispatch<SetStateAction<boolean>>;
  openWorktreeDeleteByCwd: (cwd: string) => void;
  confirmWorktreeDelete: (keepBranch: boolean) => void;
  branchDelete: BranchDeleteTarget | null;
  setBranchDelete: Dispatch<SetStateAction<BranchDeleteTarget | null>>;
  branchDeleting: boolean;
  setBranchDeleting: Dispatch<SetStateAction<boolean>>;
  branchDeleteError: string | null;
  setBranchDeleteError: Dispatch<SetStateAction<string | null>>;
  openBranchDeleteByName: (cwd: string, branch: string) => void;
  confirmBranchDelete: () => void;
}

// Worktree + branch delete-dialog state and orchestration, extracted from the
// product shell so it stays a thin composition root (file-size ratchet). Worktree
// deletion: docs_v2/specs/worktree-branch-deletion.md. Standalone branch deletion:
// docs_v2/specs/branch-deletion-from-picker.md.
export function useDeleteDialogs(input: {
  projectBridge: ProjectRegistryBridge | undefined;
  threads: ProductShellState["threads"];
  setShellState: Dispatch<SetStateAction<ProductShellState>>;
  dispatchBackendCommand: (command: ProductShellBackendCommand | null) => void;
}): DeleteDialogsController {
  const { projectBridge, threads, setShellState, dispatchBackendCommand } = input;
  const [worktreeDelete, setWorktreeDelete] = useState<WorktreeDeleteTarget | null>(null);
  const [worktreeDeleting, setWorktreeDeleting] = useState(false);
  const [branchDelete, setBranchDelete] = useState<BranchDeleteTarget | null>(null);
  const [branchDeleting, setBranchDeleting] = useState(false);
  const [branchDeleteError, setBranchDeleteError] = useState<string | null>(null);

  // Open the worktree delete dialog for a worktree cwd: reads the branch + merged
  // status (Main IPC) and the threads-here/running facts (state). Shared by the
  // Thread-row menu and the Composer worktree-menu trash affordance.
  const openWorktreeDeleteByCwd = (cwd: string) => {
    if (projectBridge === undefined) {
      return;
    }
    const here = threads.filter(
      (entry) => entry.scope.kind === "project" && entry.scope.cwd === cwd,
    );
    const fallbackBranch = cwd.split("/").filter((seg) => seg.length > 0).pop() ?? cwd;
    projectBridge
      .worktreeInfo(cwd)
      .then((info) => {
        // Only worktrees are deletable (never the main repo / a non-worktree cwd).
        if (!info.isWorktree) {
          return;
        }
        setWorktreeDelete({
          cwd,
          branch: info.branch ?? fallbackBranch,
          branchMerged: info.branchMerged,
          threadCount: here.length,
          anyRunning: here.some((entry) => entry.running === true),
        });
      })
      .catch(() => {});
  };

  // Delete the open worktree target: remove the dir and (unless "Keep branch") its
  // branch, forcing only when the user accepted the unmerged warning.
  const confirmWorktreeDelete = (keepBranch: boolean) => {
    const target = worktreeDelete;
    if (target === null || projectBridge === undefined) {
      return;
    }
    // Keep the dialog open with a "Deleting…" spinner while the (slow) git worktree +
    // branch removal runs — it used to close instantly and update only on completion,
    // leaving a confusing gap where nothing seemed to happen.
    setWorktreeDeleting(true);
    projectBridge
      .deleteWorktree(target.cwd, worktreeDeleteRequest({ keepBranch, branchMerged: target.branchMerged }))
      .then((result) => {
        setShellState((state) => {
          // Update the registry from Main's authoritative entries, then archive the
          // Threads that lived in the deleted worktree and drop it from the Composer's
          // worktree list — both reflect the deletion instantly (no manual refresh).
          const withRegistry = setProductShellRegisteredProjects(state, result.entries);
          const archived = deleteWorktreeAndRefocus(withRegistry, target.cwd);
          for (const command of archived.commands) {
            dispatchBackendCommand(command);
          }
          return archived.state;
        });
        setWorktreeDeleting(false);
        setWorktreeDelete(null);
      })
      .catch(() => {
        // Leave the dialog open (re-enabled) so the user can retry or cancel.
        setWorktreeDeleting(false);
      });
  };

  // Open the branch-delete confirm dialog for a safe (local, not checked-out)
  // branch. branchInfo (read-only) tells us whether it's merged so the dialog can
  // warn before discarding commits. See docs_v2/specs/branch-deletion-from-picker.md.
  const openBranchDeleteByName = (cwd: string, branch: string) => {
    if (projectBridge === undefined) {
      return;
    }
    projectBridge
      .branchInfo(cwd, branch)
      .then((info) => {
        if (!info.exists) {
          return;
        }
        setBranchDeleteError(null);
        setBranchDelete({ cwd, branch, branchMerged: info.merged });
      })
      .catch(() => {});
  };

  // Delete the open branch target, forcing (`-D`) only when the user accepted the
  // unmerged warning, then refresh the composer's branch list from git.
  const confirmBranchDelete = () => {
    const target = branchDelete;
    if (target === null || projectBridge === undefined) {
      return;
    }
    setBranchDeleting(true);
    setBranchDeleteError(null);
    projectBridge
      .deleteBranch(target.cwd, target.branch, branchDeleteRequest({ branchMerged: target.branchMerged }))
      .then((result) => {
        if (!result.deleted) {
          // Keep the dialog open with an explanation so the user can retry/cancel.
          setBranchDeleting(false);
          setBranchDeleteError(`Couldn't delete "${target.branch}" — git refused it.`);
          return;
        }
        // Drop the deleted branch from the picker immediately by re-reading git
        // (the trash only ever shows on non-current branches, so the default
        // selection — the current branch — is never the one being deleted).
        projectBridge
          .gitContext(target.cwd)
          .then((context) => {
            setShellState((state) =>
              setProductShellGitContext(state, { branches: context.branches, worktrees: context.worktrees }),
            );
          })
          .catch(() => {});
        setBranchDeleting(false);
        setBranchDelete(null);
      })
      .catch(() => {
        setBranchDeleting(false);
        setBranchDeleteError(`Couldn't delete "${target.branch}".`);
      });
  };

  return {
    worktreeDelete,
    setWorktreeDelete,
    worktreeDeleting,
    setWorktreeDeleting,
    openWorktreeDeleteByCwd,
    confirmWorktreeDelete,
    branchDelete,
    setBranchDelete,
    branchDeleting,
    setBranchDeleting,
    branchDeleteError,
    setBranchDeleteError,
    openBranchDeleteByName,
    confirmBranchDelete,
  };
}
