import { setProductShellSearchQuery, setProductShellSettingsOpen, setProductShellWorktreeSettings, toggleProductShellSearch } from "../../../../../application/domains/product-shell/product-shell.ts";
import { persistWorktreeSettings } from "../settings/settings.tsx";
import { applyThemePreference, saveThemePreference } from "../../support/theme.ts";
// Extracted from product-shell.ts (entry-module rule follow-up).

import type { ProductShellHandlers } from "../support/types.ts";
import type { ProductShellHandlerContext } from "./context.ts";

export function createChromeHandlers(ctx: ProductShellHandlerContext): Pick<ProductShellHandlers, "onResizeStart" | "onSearchQueryChange" | "onSearchToggle" | "onOpenSettings" | "onCloseSettings" | "onWorktreeSettingsChange" | "onThemeChange"> {
  const { props, shellState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, startColumnResize } = ctx;
  return {
    onResizeStart: startColumnResize,
    onSearchQueryChange: (query) =>
      setShellState((state) => setProductShellSearchQuery(state, query)),
    onSearchToggle: () =>
      setShellState((state) => toggleProductShellSearch(state)),
    onOpenSettings: () => setShellState((state) => setProductShellSettingsOpen(state, true)),
    onCloseSettings: () => setShellState((state) => setProductShellSettingsOpen(state, false)),
    onWorktreeSettingsChange: (patch) =>
      setShellState((state) => {
        const next = setProductShellWorktreeSettings(state, patch);
        persistWorktreeSettings(next.worktreeSettings);
        return next;
      }),
    onThemeChange: (pref) => {
      setThemePref(pref);
      saveThemePreference(pref);
      applyThemePreference(pref);
    },
  };
}
