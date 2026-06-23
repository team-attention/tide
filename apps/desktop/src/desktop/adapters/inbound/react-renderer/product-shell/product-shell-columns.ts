import { createElement, memo } from "react";
import type { ReactElement } from "react";
import {
  selectChatColumnViewModel,
  selectFileTreeViewModel,
  selectLeftRailViewModel,
  selectWorkbenchViewModel,
} from "../../../../application/domains/product-shell/product-shell.ts";
import { useProductShellSlice } from "./store-context.ts";
import type { GitChangesView, MenuAnchorRect, ProductShellHandlers } from "./support/types.ts";
import { createLeftRail } from "./left-rail/left-rail.tsx";
import { createAgentChatColumn } from "./chat-column/chat-column.tsx";
import { createWorkbenchColumn } from "./workbench/workbench.tsx";
import { createFileTreeColumn } from "./file-tree/file-tree.tsx";
// Spec: desktop-product-shell-render-isolation.

// Each column subscribes (via useProductShellSlice) to ONLY its area selector, so a
// state change in another area — a streaming chat token, a terminal write — returns the
// same slice reference and this React.memo boundary bails. The editor inside the
// workbench column therefore stops reconfiguring on every unrelated render. `handlers`
// are a stable forwarding object (see product-shell.ts), so they never break the memo.

export const LeftRailColumnView = memo(function LeftRailColumnView(props: {
  handlers: ProductShellHandlers;
  anchor: MenuAnchorRect | null;
  // Section collapse (Pinned/Projects/Scratch) lives in component useState, not the
  // store, so — like `anchor` — it is threaded as a prop: toggling a section changes
  // this object's identity and re-renders this memo'd column (the store slice alone
  // would not). The value is read back through handlers.isSectionCollapsed.
  collapsedSections: Record<string, boolean>;
}): ReactElement {
  const viewModel = useProductShellSlice(selectLeftRailViewModel);
  const menu = useProductShellSlice((state) => state.leftRailMenu);
  return createLeftRail(viewModel, props.handlers, { menu, anchor: props.anchor });
});

export const AgentChatColumnView = memo(function AgentChatColumnView(props: {
  handlers: ProductShellHandlers;
  // Git badge (branch + uncommitted count) lives in component state, not the store, so —
  // like LeftRail's `collapsedSections` — it's threaded as a prop. The caller memoizes the
  // object so it's stable across unrelated (chat-token) renders and this memo bails.
  gitBadge:
    | { branch: string | null; additions: number; deletions: number; fileCount: number; cwd: string }
    | null;
}): ReactElement {
  const viewModel = useProductShellSlice(selectChatColumnViewModel);
  return createAgentChatColumn(viewModel, props.handlers, props.gitBadge);
});

export const WorkbenchColumnView = memo(function WorkbenchColumnView(props: {
  handlers: ProductShellHandlers;
  gitChanges: GitChangesView | null;
}): ReactElement {
  const viewModel = useProductShellSlice(selectWorkbenchViewModel);
  return createWorkbenchColumn(viewModel, props.handlers, props.gitChanges);
});

export const FileTreeColumnView = memo(function FileTreeColumnView(props: {
  handlers: ProductShellHandlers;
  gitChanges: GitChangesView | null;
}): ReactElement {
  const fileTree = useProductShellSlice(selectFileTreeViewModel);
  // Transient FileTree state (inline edit / context menu / error notice) is read as
  // its own slices so the tree re-renders when they change.
  const fileTreeEdit = useProductShellSlice((state) => state.fileTreeEdit);
  const fileTreeMenu = useProductShellSlice((state) => state.fileTreeMenu);
  const fileTreeNotice = useProductShellSlice((state) => state.fileTreeNotice);
  return createFileTreeColumn({ fileTree, fileTreeEdit, fileTreeMenu, fileTreeNotice, gitChanges: props.gitChanges }, props.handlers);
});
