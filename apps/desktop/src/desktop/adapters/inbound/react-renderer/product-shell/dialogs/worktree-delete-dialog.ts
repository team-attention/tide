import { createElement, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";
import { Trash2 } from "lucide-react";
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
}): ReactElement {
  const [keepBranch, setKeepBranch] = useState(false);
  const { branch, branchMerged, threadCount, anyRunning } = props.target;
  const willDeleteBranch = !keepBranch;
  const unmerged = willDeleteBranch && !branchMerged;
  const body = anyRunning
    ? `An agent is still running in this worktree. Stop it first, then delete.`
    : threadCount > 0
      ? `${threadCount} thread${threadCount === 1 ? "" : "s"} run in this worktree — they'll become unavailable (their history is kept).`
      : `This removes the worktree directory on disk.`;
  return createElement(
    "div",
    {
      className: "worktree-create-backdrop",
      role: "dialog",
      "aria-label": "Delete worktree",
      onMouseDown: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      },
    },
    createElement(
      "div",
      { className: "worktree-create worktree-delete" },
      createElement(
        "div",
        { className: "worktree-create__title" },
        createElement(Trash2, { size: 15, strokeWidth: 1.9, "aria-hidden": true }),
        `Delete worktree · ${branch}`,
      ),
      createElement("div", { className: "worktree-create__preview" }, body),
      anyRunning
        ? null
        : createElement(
            "label",
            { className: "worktree-delete__check" },
            createElement("input", {
              type: "checkbox",
              checked: keepBranch,
              onChange: (event: ChangeEvent<HTMLInputElement>) => setKeepBranch(event.currentTarget.checked),
            }),
            createElement("span", null, `Keep branch ${branch}`),
          ),
      unmerged
        ? createElement(
            "div",
            { className: "worktree-delete__warn" },
            `Branch "${branch}" has unmerged commits — deleting it discards them.`,
          )
        : null,
      createElement(
        "div",
        { className: "worktree-create__actions" },
        createElement(
          "button",
          { type: "button", className: "worktree-create__cancel", onClick: () => props.onClose() },
          "Cancel",
        ),
        createElement(
          "button",
          {
            type: "button",
            className: "worktree-create__confirm worktree-delete__confirm",
            disabled: anyRunning,
            onClick: () => props.onConfirm(keepBranch),
          },
          willDeleteBranch ? "Delete worktree + branch" : "Delete worktree",
        ),
      ),
    ),
  );
}
