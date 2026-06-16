import type { ReactElement } from "react";
import type { ProductShellState } from "../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "./support/types.ts";
import { FileTreeDeleteDialog } from "./dialogs/file-tree-delete-dialog.tsx";
import { UntitledSaveAsDialog } from "./dialogs/untitled-save-as-dialog.tsx";
// The FileTree delete-confirm and untitled Save-As modals, rendered at the shell
// level from shell state (always mounted, so Save As works with the tree closed).
// Split out of product-shell.tsx (file-size ratchet). Spec:
// workbench-filetree-file-operations.
export function createProductShellFileDialogs(
  shellState: ProductShellState,
  handlers: ProductShellHandlers,
): ReactElement {
  // VSCode-style Save As: prompt for the untitled file's name on first save.
  const untitled =
    shellState.untitledSaveAsPaneId === null
      ? undefined
      : shellState.untitledFiles.find((file) => file.id === shellState.untitledSaveAsPaneId);
  return (
    <>
      {shellState.fileTreeDeleteTarget !== null ? (
        <FileTreeDeleteDialog
          target={shellState.fileTreeDeleteTarget}
          onConfirm={() => handlers.onFileTreeDeleteConfirm()}
          onClose={() => handlers.onFileTreeDeleteCancel()}
        />
      ) : null}
      {untitled === undefined ? null : (
        <UntitledSaveAsDialog
          title={untitled.title}
          scopeCwd={untitled.scopeCwd}
          notice={shellState.fileTreeNotice}
          onSave={(relativePath) => handlers.onUntitledSaveAs(untitled.id, relativePath)}
          onClose={() => handlers.onUntitledSaveAsCancel()}
        />
      )}
    </>
  );
}
