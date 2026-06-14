import { applyProductShellWorkbenchDrop, closeProductShellWorkbenchPane, focusProductShellWorkbenchPane, openProductShellBrowserAtUrl, openProductShellWorkbenchLauncher, releaseProductShellAgentBrowserControl, resizeProductShellTerminal, selectProductShellLauncherAction, setProductShellWorkbenchLayout, setProductShellWorkbenchSplitRatio, toggleProductShellWorkbenchFullscreen, toggleProductShellWorkbenchWithLauncher, updateProductShellBackgroundBrowserActionResult, updateProductShellBackgroundBrowserSnapshot, updateProductShellBrowserActionResult, updateProductShellBrowserSnapshot, writeProductShellTerminalInput } from "../../../../../application/domains/product-shell/product-shell.ts";
// Extracted from product-shell.ts (entry-module rule follow-up).

import type { ProductShellHandlers } from "../support/types.ts";
import type { ProductShellHandlerContext } from "./context.ts";

export function createWorkbenchHandlers(ctx: ProductShellHandlerContext): Pick<ProductShellHandlers, "onWorkbenchToggle" | "onWorkbenchFullscreenToggle" | "onWorkbenchSetLayout" | "onWorkbenchMaximizePane" | "onWorkbenchPaneDrop" | "onWorkbenchSplitRatio" | "onNewWorkbenchPane" | "onLauncherAction" | "onFocusWorkbenchPane" | "onCloseWorkbenchPane" | "onReleaseAgentBrowserControl" | "onTerminalInput" | "onTerminalResize" | "onBrowserSnapshot" | "onBrowserActionResult" | "onBackgroundBrowserSnapshot" | "onBackgroundBrowserActionResult" | "onOpenBrowserPane"> {
  const { props, shellState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, startColumnResize } = ctx;
  return {
    onWorkbenchToggle: () =>
      setShellState((state) => {
        const result = toggleProductShellWorkbenchWithLauncher(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
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
    onLauncherAction: (actionId) =>
      setShellState((state) => {
        const result = selectProductShellLauncherAction(state, actionId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
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
    onOpenBrowserPane: (url, options) =>
      setShellState((state) => {
        const result = openProductShellBrowserAtUrl(state, url, options);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
  };
}
