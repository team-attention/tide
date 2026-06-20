import { applyProductShellWorkbenchDrop, closeProductShellWorkbenchPane, ensureComposerDraftThreadActive, focusProductShellWorkbenchPane, openProductShellBrowserAtUrl, openProductShellWorkbenchLauncher, releaseProductShellAgentBrowserControl, resizeProductShellTerminal, selectProductShellLauncherAction, setProductShellWorkbenchLayout, setProductShellWorkbenchSplitRatio, toggleProductShellWorkbenchFullscreen, toggleProductShellWorkbenchWithLauncher, updateProductShellBackgroundBrowserActionResult, updateProductShellBackgroundBrowserCaptureResult, updateProductShellBackgroundBrowserSnapshot, updateProductShellBrowserActionResult, updateProductShellBrowserCaptureResult, updateProductShellBrowserSnapshot, writeProductShellTerminalInput } from "../../../../../application/domains/product-shell/product-shell.ts";
// Extracted from product-shell.ts (entry-module rule follow-up).

import type { ProductShellHandlers } from "../support/types.ts";
import type { ProductShellHandlerContext } from "./context.ts";

export function createWorkbenchHandlers(ctx: ProductShellHandlerContext): Pick<ProductShellHandlers, "onWorkbenchToggle" | "onWorkbenchFullscreenToggle" | "onWorkbenchSetLayout" | "onWorkbenchMaximizePane" | "onWorkbenchPaneDrop" | "onWorkbenchSplitRatio" | "onNewWorkbenchPane" | "onLauncherAction" | "onFocusWorkbenchPane" | "onCloseWorkbenchPane" | "onReleaseAgentBrowserControl" | "onTerminalInput" | "onTerminalResize" | "onBrowserSnapshot" | "onBrowserActionResult" | "onBrowserCaptureResult" | "onBackgroundBrowserSnapshot" | "onBackgroundBrowserActionResult" | "onBackgroundBrowserCaptureResult" | "onOpenBrowserPane" | "onOpenChanges" | "onGitChanges" | "onGitFileDiff" | "onLoadWorkbenchImage"> {
  const { props, shellState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, startColumnResize } = ctx;
  return {
    onWorkbenchToggle: () =>
      setShellState((state) => {
        const result = toggleProductShellWorkbenchWithLauncher(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    // Open the read-only git Changes pane. On the composer (New Thread) page this
    // first creates the Composer Draft Thread, then opens the backend-owned Changes
    // pane against that thread so it carries into the started Thread.
    onOpenChanges: (cwd) => {
      if (shellState.activeThreadId === null) {
        if (cwd === undefined) {
          return;
        }
        const ensured = ensureComposerDraftThreadActive(shellState);
        const openDiffCommand = {
          kind: "workbench.command" as const,
          payload: { threadId: ensured.state.activeThreadId as string, command: "open_diff" as const },
        };
        setShellState({ ...ensured.state, workbenchOpen: true });
        if (ensured.command !== null) dispatchBackendCommand(ensured.command);
        dispatchBackendCommand(openDiffCommand);
        return;
      }
      setShellState((state) => {
        if (state.activeThreadId === null) {
          return state;
        }
        dispatchBackendCommand({
          kind: "workbench.command",
          payload: { threadId: state.activeThreadId, command: "open_diff" },
        });
        return state.workbenchOpen ? state : { ...state, workbenchOpen: true };
      });
    },
    onGitChanges: async (cwd) => {
      const bridge = props.projectBridge;
      if (bridge === undefined) {
        return { isGitRepo: false, branch: null, files: [] };
      }
      const [context, changes] = await Promise.all([bridge.gitContext(cwd), bridge.gitChanges(cwd)]);
      return { isGitRepo: context.isGitRepo, branch: context.currentBranch, files: changes.files };
    },
    onGitFileDiff: (cwd, relPath) => props.projectBridge?.gitFileDiff(cwd, relPath) ?? Promise.resolve(""),
    onLoadWorkbenchImage: async (cwd, relativePath) => {
      const events = await props.onBackendCommand?.({
        kind: "workspace.readImageFile",
        payload: { cwd, path: relativePath },
      });
      const loaded = events?.find((event) => event.kind === "workspace.imageLoaded")?.payload as
        | { mimeType?: unknown; dataBase64?: unknown; byteLength?: unknown }
        | undefined;
      if (
        typeof loaded?.mimeType !== "string" ||
        typeof loaded.dataBase64 !== "string" ||
        typeof loaded.byteLength !== "number"
      ) {
        return null;
      }
      return {
        mimeType: loaded.mimeType,
        dataBase64: loaded.dataBase64,
        byteLength: loaded.byteLength,
      };
    },
    onWorkbenchFullscreenToggle: () =>
      setShellState((state) => toggleProductShellWorkbenchFullscreen(state)),
    onWorkbenchSetLayout: (mode) =>
      setShellState((state) => {
        const result = setProductShellWorkbenchLayout(state, mode);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    // Maximize a pane: reveal/activate it, then collapse to Stacked. Two backend
    // commands (focus_pane + set_layout_mode), chained through the functional update.
    onWorkbenchMaximizePane: (paneId) =>
      setShellState((state) => {
        const focused = focusProductShellWorkbenchPane(state, paneId);
        dispatchBackendCommand(focused.command);
        const layout = setProductShellWorkbenchLayout(focused.state, "stacked");
        dispatchBackendCommand(layout.command);
        return layout.state;
      }),
    onWorkbenchPaneDrop: (draggedPaneId, targetPaneId, zone) =>
      setShellState((state) => applyProductShellWorkbenchDrop(state, draggedPaneId, targetPaneId, zone)),
    onWorkbenchSplitRatio: (path, ratio) =>
      setShellState((state) => setProductShellWorkbenchSplitRatio(state, path, ratio)),
    onNewWorkbenchPane: () =>
      setShellState((state) => {
        const result = openProductShellWorkbenchLauncher(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onLauncherAction: (actionId) => {
      if (shellState.activeThreadId === null) {
        // Composer (New Thread): make the Draft Thread the active thread first (lazily),
        // then run the NORMAL launcher path against it — it now sees a thread, so
        // Terminal/Editor/Diff/Browser all open as real backend panes and their typing/
        // saving/snapshots route through the active thread like any started thread. The
        // create-draft command is dispatched before the open. See composer-draft-thread.md.
        const ensured = ensureComposerDraftThreadActive(shellState);
        const result = selectProductShellLauncherAction(ensured.state, actionId);
        setShellState(result.state);
        if (ensured.command !== null) dispatchBackendCommand(ensured.command);
        dispatchBackendCommand(result.command);
        return;
      }
      setShellState((state) => {
        const result = selectProductShellLauncherAction(state, actionId);
        dispatchBackendCommand(result.command);
        return result.state;
      });
    },
    onFocusWorkbenchPane: (paneId) =>
      setShellState((state) => {
        const result = focusProductShellWorkbenchPane(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onCloseWorkbenchPane: (paneId) =>
      setShellState((state) => {
        const result = closeProductShellWorkbenchPane(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onReleaseAgentBrowserControl: (paneId) =>
      setShellState((state) => {
        const result = releaseProductShellAgentBrowserControl(state, paneId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onTerminalInput: (paneId, bytes) =>
      setShellState((state) => {
        const result = writeProductShellTerminalInput(state, paneId, bytes);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onTerminalResize: (paneId, cols, rows) =>
      setShellState((state) => {
        const result = resizeProductShellTerminal(state, paneId, cols, rows);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBrowserSnapshot: (paneId, snapshot) =>
      setShellState((state) => {
        const result = updateProductShellBrowserSnapshot(state, paneId, snapshot);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBrowserActionResult: (paneId, actionResult) =>
      setShellState((state) => {
        const result = updateProductShellBrowserActionResult(state, paneId, actionResult);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBrowserCaptureResult: (paneId, captureResult) =>
      setShellState((state) => {
        const result = updateProductShellBrowserCaptureResult(state, paneId, captureResult);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBackgroundBrowserSnapshot: (threadId, paneId, snapshot) =>
      setShellState((state) => {
        const result = updateProductShellBackgroundBrowserSnapshot(state, threadId, paneId, snapshot);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBackgroundBrowserActionResult: (threadId, paneId, actionResult) =>
      setShellState((state) => {
        const result = updateProductShellBackgroundBrowserActionResult(state, threadId, paneId, actionResult);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onBackgroundBrowserCaptureResult: (threadId, paneId, captureResult) =>
      setShellState((state) => {
        const result = updateProductShellBackgroundBrowserCaptureResult(state, threadId, paneId, captureResult);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onOpenBrowserPane: (url, options) => {
      if (shellState.activeThreadId === null) {
        const ensured = ensureComposerDraftThreadActive(shellState);
        const result = openProductShellBrowserAtUrl(ensured.state, url, options);
        setShellState(result.state);
        if (ensured.command !== null) dispatchBackendCommand(ensured.command);
        dispatchBackendCommand(result.command);
        return;
      }
      setShellState((state) => {
        const result = openProductShellBrowserAtUrl(state, url, options);
        dispatchBackendCommand(result.command);
        return result.state;
      });
    },
  };
}
