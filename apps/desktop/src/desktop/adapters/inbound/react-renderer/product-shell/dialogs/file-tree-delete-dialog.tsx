import type { ReactElement } from "react";
import { Trash2 } from "lucide-react";
import type { ProductShellFileTreeMenu } from "../../../../../application/domains/product-shell/product-shell.ts";
import { relativeBaseName } from "../../../../../application/domains/product-shell/product-shell.ts";
import {
  WorktreeDialogActions,
  WorktreeDialogBackdrop,
  WorktreeDialogCancelButton,
  WorktreeDialogConfirmButton,
  WorktreeDialogPanel,
  WorktreeDialogPreview,
  WorktreeDialogTitle,
} from "./worktree-dialog.parts.tsx";
// Confirm dialog for deleting a FileTree entry. Delete moves the item to the OS Trash
// (recoverable). Spec: workbench-filetree-file-operations.
export function FileTreeDeleteDialog(props: {
  target: ProductShellFileTreeMenu;
  onConfirm: () => void;
  onClose: () => void;
}): ReactElement {
  const name = relativeBaseName(props.target.relativePath);
  const kindLabel = props.target.kind === "folder" ? "folder" : "file";
  return (
    <WorktreeDialogBackdrop
      role="dialog"
      aria-label="Delete"
      data-worktree-dialog="delete-file-tree-entry"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <WorktreeDialogPanel>
        <WorktreeDialogTitle>
          <Trash2 size={15} strokeWidth={1.9} aria-hidden />
          {`Delete ${kindLabel} · ${name}`}
        </WorktreeDialogTitle>
        <WorktreeDialogPreview data-kind="sentence">
          {props.target.kind === "folder"
            ? `This moves “${props.target.relativePath}” and everything inside it to the Trash. You can restore it from the Trash.`
            : `This moves “${props.target.relativePath}” to the Trash. You can restore it from the Trash.`}
        </WorktreeDialogPreview>
        <WorktreeDialogActions>
          <WorktreeDialogCancelButton type="button" onClick={() => props.onClose()}>
            Cancel
          </WorktreeDialogCancelButton>
          <WorktreeDialogConfirmButton
            type="button"
            $variant="danger"
            onClick={() => props.onConfirm()}
          >
            Move to Trash
          </WorktreeDialogConfirmButton>
        </WorktreeDialogActions>
      </WorktreeDialogPanel>
    </WorktreeDialogBackdrop>
  );
}
