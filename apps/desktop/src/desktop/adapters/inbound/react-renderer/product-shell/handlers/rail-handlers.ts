import { archiveProductShellProjectChats, cancelProductShellProjectRename, cancelProductShellThreadRename, cancelProductShellWorktreeCreate, clearProductShellLeftRailTransientState, confirmProductShellThreadArchive, discardProductShellDraftThread, openProductShellLeftRailMenu, openProductShellThreadFromLeftRail, selectProductShellChoiceSurfaceRow, setProductShellListSettings, setProductShellRegisteredProjects, showProductShellThreadArchiveConfirm, startNewProductShellScratchThread, startNewProductShellThread, startProductShellProjectRename, startProductShellThreadRename, startProductShellWorktreeCreate, submitProductShellThreadRename, toggleProductShellLeftRail, toggleProductShellProject, toggleProductShellProjectPin, toggleProductShellThreadPin, moveKeyInOrder, parsePinnedItemKey, selectThreadListViewModel, setProductShellPinnedItemOrder, setProductShellProjectOrder } from "../../../../../application/domains/product-shell/product-shell.ts";
import { persistListSettings, persistRailOrder } from "../settings/settings.tsx";
import { projectCwdById } from "../product-shell.tsx";
import { worktreeRepoRootForCwd } from "../../../../../../shared/worktree/path.ts";
// Extracted from product-shell.ts (entry-module rule follow-up).

import type { ProductShellHandlers } from "../support/types.ts";
import type { ProductShellHandlerContext } from "./context.ts";

export function createRailHandlers(ctx: ProductShellHandlerContext): Pick<ProductShellHandlers, "onNewThread" | "onNewThreadInProject" | "onProjectToggle" | "onThreadSelect" | "onLeftRailToggle" | "onLeftRailMenuOpen" | "onToggleSection" | "onListSettingsChange" | "onProjectRevealInFinder" | "onProjectArchiveChats" | "onProjectRemove" | "onProjectDeleteWorktree" | "onProjectPinToggle" | "onProjectRenameStart" | "onProjectRenameCancel" | "onProjectRenameSubmit" | "onProjectCreateWorktree" | "onProjectCreateWorktreeSubmit" | "onProjectCreateWorktreeCancel" | "onPinnedProjectSelect" | "onAddProject" | "onNewScratchThread" | "onThreadArchiveIntent" | "onThreadArchiveConfirm" | "onThreadPinToggle" | "onThreadDeleteWorktree" | "onThreadRenameStart" | "onThreadRenameSubmit" | "onThreadRenameCancel" | "onLeftRailTransientClear" | "isSectionCollapsed" | "isProjectRemovable" | "isProjectWorktree" | "onReorderPinnedItem" | "onReorderProject" | "threadWorktreeBranch"> {
  const { props, shellState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, startColumnResize } = ctx;
  return {
    onNewThread: () =>
      setShellState((state) => {
        const discard = discardProductShellDraftThread(state);
        if (discard.command !== null) dispatchBackendCommand(discard.command);
        return startNewProductShellThread(discard.state);
      }),
    onNewThreadInProject: (projectId) =>
      setShellState((state) => {
        // Switching the Composer to another project replaces its Draft Thread (its panes,
        // bound to the old cwd, close). See composer-draft-thread.md.
        const discard = discardProductShellDraftThread(state);
        if (discard.command !== null) dispatchBackendCommand(discard.command);
        return startNewProductShellThread(discard.state, projectId);
      }),
    onProjectToggle: (projectId) =>
      setShellState((state) => toggleProductShellProject(state, projectId)),
    onThreadSelect: (threadId) =>
      setShellState((state) => {
        // Leaving the Composer for a thread discards its never-sent Draft Thread (kills any
        // pre-send Terminal PTYs). See composer-draft-thread.md.
        const discard = discardProductShellDraftThread(state);
        if (discard.command !== null) dispatchBackendCommand(discard.command);
        const result = openProductShellThreadFromLeftRail(discard.state, threadId, {
          backendTransportAvailable: props.onBackendCommand !== undefined,
        });
        dispatchBackendCommand(result.command);
        // Populate the FileTree for the newly active thread (the refresh path
        // only fired on manual toggle before, leaving the tree empty on open).
        if (result.state.fileTreeOpen && result.state.activeThreadId) {
          dispatchBackendCommand({
            kind: "workbench.command",
            payload: {
              threadId: result.state.activeThreadId,
              command: "refresh_file_tree",
              // Lazy: load the root level only; folders fetch their children on expand.
              data: { expandedPaths: result.state.expandedFolderPaths, maxEntries: 4000 },
            },
          });
        }
        return result.state;
      }),
    onLeftRailToggle: () => setShellState((state) => toggleProductShellLeftRail(state)),
    onLeftRailMenuOpen: (menu, rect) => {
      setMenuAnchor(rect ?? null);
      setShellState((state) => openProductShellLeftRailMenu(state, menu));
    },
    onToggleSection: (title) =>
      setCollapsedSections((current) => ({ ...current, [title]: !current[title] })),
    onListSettingsChange: (patch) =>
      setShellState((state) => {
        const next = setProductShellListSettings(state, patch);
        persistListSettings(next.listSettings);
        return next;
      }),
    // Drag-reorder of the Pinned section's top-level items (spec:
    // left-rail-manual-ordering). Compute the new order from the LIVE visual list so a
    // partial/empty stored order self-heals, then persist.
    onReorderPinnedItem: (draggedKey, targetKey) =>
      setShellState((state) => {
        const keys = selectThreadListViewModel(state).pinnedItems.map((item) =>
          item.kind === "thread" ? `t:${item.thread.threadId}` : `p:${item.project.projectId}`,
        );
        const order = moveKeyInOrder(keys, draggedKey, targetKey).flatMap((key) => {
          const ref = parsePinnedItemKey(key);
          return ref === null ? [] : [ref];
        });
        const next = setProductShellPinnedItemOrder(state, order);
        persistRailOrder({ pinnedItemOrder: next.pinnedItemOrder, projectOrder: next.projectOrder });
        return next;
      }),
    // Drag-reorder of the Projects section's folders (nested threads keep sortBy).
    onReorderProject: (draggedProjectId, targetProjectId) =>
      setShellState((state) => {
        const keys = selectThreadListViewModel(state).projectGroups.map((group) => group.projectId);
        const next = setProductShellProjectOrder(
          state,
          moveKeyInOrder(keys, draggedProjectId, targetProjectId),
        );
        persistRailOrder({ pinnedItemOrder: next.pinnedItemOrder, projectOrder: next.projectOrder });
        return next;
      }),
    onProjectRevealInFinder: (projectId) => {
      const cwd = projectCwdById(shellState, projectId);
      if (cwd !== undefined) {
        props.projectBridge?.revealInFinder(cwd);
      }
      setShellState((state) => openProductShellLeftRailMenu(state, null));
    },
    onProjectArchiveChats: (projectId) =>
      setShellState((state) => {
        const result = archiveProductShellProjectChats(state, projectId);
        for (const command of result.commands) {
          dispatchBackendCommand(command);
        }
        return result.state;
      }),
    onProjectRemove: (projectId) => {
      const cwd = projectCwdById(shellState, projectId);
      const bridge = props.projectBridge;
      if (cwd !== undefined && bridge !== undefined) {
        bridge
          .unregisterProject(cwd)
          .then((entries) => setShellState((state) => setProductShellRegisteredProjects(state, entries)))
          .catch(() => {});
      }
      setShellState((state) => openProductShellLeftRailMenu(state, null));
    },
    onProjectDeleteWorktree: (projectId) => {
      const cwd = projectCwdById(shellState, projectId);
      const bridge = props.projectBridge;
      setShellState((state) => openProductShellLeftRailMenu(state, null));
      if (cwd === undefined || bridge === undefined) {
        return;
      }
      const threadsHere = shellState.threads.filter(
        (thread) => thread.scope.kind === "project" && thread.scope.cwd === cwd,
      ).length;
      const message =
        threadsHere > 0
          ? `Delete this worktree? ${threadsHere} thread${threadsHere === 1 ? "" : "s"} run in it — they'll become unavailable (their history is kept).`
          : "Delete this worktree directory? The branch is kept.";
      if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(message)) {
        return;
      }
      bridge
        .removeWorktree(cwd)
        .then((result) => setShellState((state) => setProductShellRegisteredProjects(state, result.entries)))
        .catch(() => {});
    },
    onProjectPinToggle: (projectId) =>
      setShellState((state) => toggleProductShellProjectPin(state, projectId)),
    onProjectRenameStart: (projectId) =>
      setShellState((state) => startProductShellProjectRename(state, projectId)),
    onProjectRenameCancel: () =>
      setShellState((state) => cancelProductShellProjectRename(state)),
    onProjectRenameSubmit: (projectId, name) => {
      const cwd = projectCwdById(shellState, projectId);
      const bridge = props.projectBridge;
      const trimmed = name.trim();
      if (cwd !== undefined && bridge !== undefined && trimmed.length > 0) {
        bridge
          .renameProject(cwd, trimmed)
          .then((entries) => setShellState((state) => setProductShellRegisteredProjects(state, entries)))
          .catch(() => {});
      }
      setShellState((state) => cancelProductShellProjectRename(state));
    },
    onProjectCreateWorktree: (projectId) =>
      setShellState((state) => startProductShellWorktreeCreate(state, projectId)),
    onProjectCreateWorktreeSubmit: (projectId, name) => {
      const trimmed = name.trim();
      const cwd = projectCwdById(shellState, projectId);
      const bridge = props.projectBridge;
      if (trimmed.length > 0 && cwd !== undefined && bridge !== undefined) {
        const { baseDirPattern, copyFiles } = shellState.worktreeSettings;
        bridge
          .createWorktree(cwd, trimmed, { baseDirPattern, copyFiles })
          .then((result) =>
            setShellState((state) => setProductShellRegisteredProjects(state, result.entries)),
          )
          .catch(() => {});
      }
      setShellState((state) => cancelProductShellWorktreeCreate(state));
    },
    onProjectCreateWorktreeCancel: () =>
      setShellState((state) => cancelProductShellWorktreeCreate(state)),
    onPinnedProjectSelect: (projectId) =>
      setShellState((state) => {
        const result = selectProductShellChoiceSurfaceRow(
          state,
          "project_menu",
          `project:${projectId}`,
        );
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onAddProject: () => openFolderAsProject(),
    onNewScratchThread: () =>
      setShellState((state) => {
        const discard = discardProductShellDraftThread(state);
        if (discard.command !== null) dispatchBackendCommand(discard.command);
        return startNewProductShellScratchThread(discard.state);
      }),
    onThreadArchiveIntent: (threadId) =>
      setShellState((state) => showProductShellThreadArchiveConfirm(state, threadId)),
    onThreadArchiveConfirm: (threadId) =>
      setShellState((state) => {
        const result = confirmProductShellThreadArchive(state, threadId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onThreadPinToggle: (threadId) =>
      setShellState((state) => {
        const result = toggleProductShellThreadPin(state, threadId);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onThreadDeleteWorktree: (threadId) => {
      const thread = shellState.threads.find((entry) => entry.threadId === threadId);
      setShellState((state) => openProductShellLeftRailMenu(state, null));
      if (thread !== undefined && thread.scope.kind === "project") {
        openWorktreeDeleteByCwd(thread.scope.cwd);
      }
    },
    onThreadRenameStart: (threadId) =>
      setShellState((state) => startProductShellThreadRename(state, threadId)),
    onThreadRenameSubmit: (threadId, title) =>
      setShellState((state) => {
        const result = submitProductShellThreadRename(state, threadId, title);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onThreadRenameCancel: () =>
      setShellState((state) => cancelProductShellThreadRename(state)),
    onLeftRailTransientClear: () =>
      setShellState((state) => clearProductShellLeftRailTransientState(state)),
    isSectionCollapsed: (title) => collapsedSections[title] === true,
    isProjectRemovable: (projectId) =>
      !shellState.threads.some(
        (thread) => thread.scope.kind === "project" && thread.scope.projectId === projectId,
      ),
    isProjectWorktree: (projectId) => worktreeRepoRootForCwd(projectId) !== null,
    threadWorktreeBranch: (threadId) => {
      const thread = shellState.threads.find((entry) => entry.threadId === threadId);
      if (thread === undefined || thread.scope.kind !== "project") {
        return null;
      }
      return worktreeRepoRootForCwd(thread.scope.cwd) !== null
        ? (thread.scope.cwd.split("/").filter((seg) => seg.length > 0).pop() ?? null)
        : null;
    },
  };
}
