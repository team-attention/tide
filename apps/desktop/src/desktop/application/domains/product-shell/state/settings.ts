import type { ProductShellListSettings, ProductShellState, ProductShellWorktreeSettings } from "./types.ts";
// Extracted from product-shell-state.ts (spec: navigable-source-structure).

export function setProductShellWorktreeSettings(
  state: ProductShellState,
  patch: Partial<ProductShellWorktreeSettings>,
): ProductShellState {
  return { ...state, worktreeSettings: { ...state.worktreeSettings, ...patch } };
}

export function setProductShellSettingsOpen(
  state: ProductShellState,
  open: boolean,
): ProductShellState {
  return { ...state, settingsOpen: open };
}

export function setProductShellListSettings(
  state: ProductShellState,
  patch: Partial<ProductShellListSettings>,
): ProductShellState {
  return { ...state, listSettings: { ...state.listSettings, ...patch } };
}
