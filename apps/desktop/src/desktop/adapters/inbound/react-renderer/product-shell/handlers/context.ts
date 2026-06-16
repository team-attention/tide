// Extracted from product-shell.ts (entry-module rule follow-up): the closure
// context the handler factories receive. Built fresh each render by the shell
// so capture semantics are identical to the original inline object literal.

import type { Dispatch, SetStateAction } from "react";
import type {
  ProductShellBackendCommand,
  ProductShellState,
  ProductShellViewModel,
} from "../../../../../application/domains/product-shell/product-shell.ts";
import type { AgentChatBackendEvent } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import type { TideThemePreference } from "../../support/theme.ts";
import type { MenuAnchorRect, TideProductShellProps } from "../support/types.ts";
import type { WorktreeDeleteTarget } from "../dialogs/worktree-delete-dialog.tsx";
import type { BranchDeleteTarget } from "../dialogs/branch-delete-dialog.tsx";

export interface ProductShellHandlerContext {
  props: TideProductShellProps;
  shellState: ProductShellState;
  setShellState: Dispatch<SetStateAction<ProductShellState>>;
  viewModel: ProductShellViewModel;
  dispatchBackendCommand: (command: ProductShellBackendCommand | null) => void;
  applyBackendEvents: (events: AgentChatBackendEvent[] | undefined) => void;
  themePref: TideThemePreference;
  setThemePref: Dispatch<SetStateAction<TideThemePreference>>;
  menuAnchor: MenuAnchorRect | null;
  setMenuAnchor: Dispatch<SetStateAction<MenuAnchorRect | null>>;
  collapsedSections: Record<string, boolean>;
  setCollapsedSections: Dispatch<SetStateAction<Record<string, boolean>>>;
  columnWidths: { left: number; workbench: number; fileTree: number };
  setColumnWidths: Dispatch<SetStateAction<{ left: number; workbench: number; fileTree: number }>>;
  setIsResizing: Dispatch<SetStateAction<boolean>>;
  quickOpenVisible: boolean;
  setQuickOpenVisible: Dispatch<SetStateAction<boolean>>;
  contentSearchVisible: boolean;
  setContentSearchVisible: Dispatch<SetStateAction<boolean>>;
  worktreeCreate: { baseCwd: string } | null;
  setWorktreeCreate: Dispatch<SetStateAction<{ baseCwd: string } | null>>;
  worktreeDelete: WorktreeDeleteTarget | null;
  setWorktreeDelete: Dispatch<SetStateAction<WorktreeDeleteTarget | null>>;
  branchDelete: BranchDeleteTarget | null;
  setBranchDelete: Dispatch<SetStateAction<BranchDeleteTarget | null>>;
  windowWidth: number;
  bodyRef: { current: HTMLDivElement | null };
  lastSubmitAtRef: { current: number };
  openFolderAsProject: () => Promise<void>;
  openFolderForScope: () => Promise<void>;
  submitWorktreeCreate: (name: string, baseBranch: string) => void;
  openWorktreeDeleteByCwd: (cwd: string) => void;
  confirmWorktreeDelete: (keepBranch: boolean) => void;
  openBranchDeleteByName: (cwd: string, branch: string) => void;
  confirmBranchDelete: () => void;
  startColumnResize: (
    edge: "left" | "workbench" | "fileTree",
    event: { clientX: number; preventDefault: () => void },
  ) => void;
}
