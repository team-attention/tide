import type { ReactElement } from "react";
import { Trash2 } from "lucide-react";
import type { ProductShellFileTreeMenu } from "../../../../../application/domains/product-shell/product-shell.ts";
import { relativeBaseName } from "../../../../../application/domains/product-shell/product-shell.ts";
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
    <div
      className="worktree-create-backdrop"
      role="dialog"
      aria-label="Delete"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div className="worktree-create worktree-delete">
        <div className="worktree-create__title">
          <Trash2 size={15} strokeWidth={1.9} aria-hidden />
          {`Delete ${kindLabel} · ${name}`}
        </div>
        <div className="worktree-create__preview">
          {props.target.kind === "folder"
            ? `This moves “${props.target.relativePath}” and everything inside it to the Trash. You can restore it from the Trash.`
            : `This moves “${props.target.relativePath}” to the Trash. You can restore it from the Trash.`}
        </div>
        <div className="worktree-create__actions">
          <button type="button" className="worktree-create__cancel" onClick={() => props.onClose()}>
            Cancel
          </button>
          <button
            type="button"
            className="worktree-create__confirm worktree-delete__confirm"
            onClick={() => props.onConfirm()}
          >
            Move to Trash
          </button>
        </div>
      </div>
    </div>
  );
}
