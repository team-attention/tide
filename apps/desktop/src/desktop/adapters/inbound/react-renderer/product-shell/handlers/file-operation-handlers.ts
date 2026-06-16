import {
  beginProductShellTreeEdit,
  cancelProductShellTreeEdit,
  cancelProductShellUntitledSaveAs,
  clearProductShellFileTreeNotice,
  closeProductShellFileTreeDelete,
  closeProductShellFileTreeMenu,
  closeProductShellWorkbenchPane,
  newProductShellUntitledFile,
  normalizeRelativeInput,
  openProductShellFileTreeDelete,
  openProductShellFileTreeMenu,
  productShellUntitledSaved,
  reconcileProductShellAfterPathChange,
  refreshProductShellFileTreeCommand,
  relativeParentPath,
  resolveActiveWorkspaceCwd,
  resolveProductShellTreeEdit,
  setProductShellFileTreeNotice,
  setProductShellTreeEditDraft,
} from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellState } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ProductShellHandlerContext } from "./context.ts";

// FileTree file-operation + untitled-file handlers. Structural mutations are Main IPC
// (window.tide.fs*, exposed as props.projectBridge); these handlers orchestrate the
// async call, then reconcile open tabs + refresh the tree through the existing
// reducers. Spec: workbench-filetree-file-operations.
export function createFileOperationHandlers(
  ctx: ProductShellHandlerContext,
): Pick<
  ProductShellHandlers,
  | "onNewUntitledFile"
  | "onUntitledSaveAs"
  | "onUntitledSaveAsCancel"
  | "onFileTreeNewFolder"
  | "onFileTreeRenameStart"
  | "onTreeEditDraftChange"
  | "onTreeEditConfirm"
  | "onTreeEditCancel"
  | "onFileTreeDeleteIntent"
  | "onFileTreeDeleteConfirm"
  | "onFileTreeDeleteCancel"
  | "onFileTreeMenuOpen"
  | "onFileTreeMenuClose"
  | "onFileTreeMove"
  | "onFileTreeRefresh"
  | "onFileTreeNoticeClear"
> {
  const { props, setShellState, dispatchBackendCommand } = ctx;
  const bridge = props.projectBridge;

  // After a mutation that changed paths: drop affected start-page tabs, close affected
  // thread editor panes (backend command), and refresh the tree. Returns the next
  // state; dispatch side effects happen here, matching the editor-handlers pattern.
  const reconcileAndRefresh = (state: ProductShellState, changedPaths: string[]): ProductShellState => {
    const reconciled = reconcileProductShellAfterPathChange(state, changedPaths);
    let next = reconciled.state;
    for (const paneId of reconciled.threadEditorPaneIdsToClose) {
      const closed = closeProductShellWorkbenchPane(next, paneId);
      next = closed.state;
      dispatchBackendCommand(closed.command);
    }
    dispatchBackendCommand(refreshProductShellFileTreeCommand(next));
    return next;
  };

  return {
    onNewUntitledFile: () => setShellState((state) => newProductShellUntitledFile(state)),

    onUntitledSaveAs: (paneId, relativePath) => {
      const file = ctx.shellState.untitledFiles.find((candidate) => candidate.id === paneId);
      const path = normalizeRelativeInput(relativePath);
      if (file === undefined || path.length === 0 || bridge === undefined) {
        return;
      }
      void bridge.fsCreateFile(file.scopeCwd, path, file.draft).then((result) => {
        if (result.ok) {
          setShellState((state) => {
            const saved = productShellUntitledSaved(state, paneId, result.relativePath);
            dispatchBackendCommand(saved.command);
            dispatchBackendCommand(refreshProductShellFileTreeCommand(saved.state));
            return saved.state;
          });
        } else {
          setShellState((state) => setProductShellFileTreeNotice(state, result.message));
        }
      });
    },

    onUntitledSaveAsCancel: () => setShellState((state) => cancelProductShellUntitledSaveAs(state)),

    onFileTreeNewFolder: (parentPath) =>
      setShellState((state) => beginProductShellTreeEdit(state, { kind: "new-folder", parentPath })),

    onFileTreeRenameStart: (relativePath) =>
      setShellState((state) =>
        beginProductShellTreeEdit(state, {
          kind: "rename",
          parentPath: relativeParentPath(relativePath),
          targetPath: relativePath,
        }),
      ),

    onTreeEditDraftChange: (draft) => setShellState((state) => setProductShellTreeEditDraft(state, draft)),

    onTreeEditConfirm: () => {
      const edit = ctx.shellState.fileTreeEdit;
      const resolved = edit ? resolveProductShellTreeEdit(edit) : null;
      const root = resolveActiveWorkspaceCwd(ctx.shellState);
      if (resolved === null || root === null || bridge === undefined) {
        setShellState((state) => cancelProductShellTreeEdit(state));
        return;
      }
      const operation =
        resolved.kind === "new-folder"
          ? bridge.fsCreateFolder(root, resolved.toPath)
          : bridge.fsMove(root, resolved.fromPath as string, resolved.toPath);
      void operation.then((result) => {
        if (result.ok) {
          setShellState((state) => {
            const cleared = cancelProductShellTreeEdit(state);
            // A rename can move a file, so reconcile open tabs against the old path.
            if (resolved.kind === "rename" && resolved.fromPath !== undefined) {
              return reconcileAndRefresh(cleared, [resolved.fromPath]);
            }
            dispatchBackendCommand(refreshProductShellFileTreeCommand(cleared));
            return cleared;
          });
        } else {
          setShellState((state) => setProductShellFileTreeNotice(state, result.message));
        }
      });
    },

    onTreeEditCancel: () => setShellState((state) => cancelProductShellTreeEdit(state)),

    onFileTreeDeleteIntent: (target) =>
      setShellState((state) => openProductShellFileTreeDelete(state, target)),

    onFileTreeDeleteConfirm: () => {
      const target = ctx.shellState.fileTreeDeleteTarget;
      const root = resolveActiveWorkspaceCwd(ctx.shellState);
      if (target === null || target.relativePath.length === 0 || root === null || bridge === undefined) {
        setShellState((state) => closeProductShellFileTreeDelete(state));
        return;
      }
      void bridge.fsTrash(root, target.relativePath).then((result) => {
        setShellState((state) => {
          const closedDialog = closeProductShellFileTreeDelete(state);
          return result.ok
            ? reconcileAndRefresh(closedDialog, [target.relativePath])
            : setProductShellFileTreeNotice(closedDialog, result.message);
        });
      });
    },

    onFileTreeDeleteCancel: () => setShellState((state) => closeProductShellFileTreeDelete(state)),

    onFileTreeMenuOpen: (menu) => setShellState((state) => openProductShellFileTreeMenu(state, menu)),

    onFileTreeMenuClose: () => setShellState((state) => closeProductShellFileTreeMenu(state)),

    onFileTreeMove: (fromRel, toRel) => {
      const root = resolveActiveWorkspaceCwd(ctx.shellState);
      if (root === null || bridge === undefined || fromRel === toRel) {
        return;
      }
      void bridge.fsMove(root, fromRel, toRel).then((result) => {
        if (result.ok) {
          setShellState((state) => reconcileAndRefresh(state, [fromRel]));
        } else {
          setShellState((state) => setProductShellFileTreeNotice(state, result.message));
        }
      });
    },

    onFileTreeRefresh: () =>
      setShellState((state) => {
        dispatchBackendCommand(refreshProductShellFileTreeCommand(state));
        return state;
      }),

    onFileTreeNoticeClear: () => setShellState((state) => clearProductShellFileTreeNotice(state)),
  };
}
