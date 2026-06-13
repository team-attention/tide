import { createElement, memo } from "react";
import type { ReactElement } from "react";
import {
  selectChatColumnViewModel,
  selectFileTreeViewModel,
  selectLeftRailViewModel,
  selectWorkbenchViewModel,
} from "../../../../application/domains/product-shell/product-shell.ts";
import { useProductShellSlice } from "./store-context.ts";
import type { MenuAnchorRect, ProductShellHandlers } from "./support/types.ts";
import { createLeftRail } from "./left-rail/left-rail.ts";
import { createAgentChatColumn } from "./chat-column/chat-column.ts";
import { createWorkbenchColumn } from "./workbench/workbench.ts";
import { createFileTreeColumn } from "./file-tree/file-tree.ts";
// Spec: desktop-product-shell-render-isolation.

// Each column subscribes (via useProductShellSlice) to ONLY its area selector, so a
// state change in another area — a streaming chat token, a terminal write — returns the
// same slice reference and this React.memo boundary bails. The editor inside the
// workbench column therefore stops reconfiguring on every unrelated render. `handlers`
// are a stable forwarding object (see product-shell.ts), so they never break the memo.

export const LeftRailColumnView = memo(function LeftRailColumnView(props: {
  handlers: ProductShellHandlers;
  anchor: MenuAnchorRect | null;
}): ReactElement {
  const viewModel = useProductShellSlice(selectLeftRailViewModel);
  const menu = useProductShellSlice((state) => state.leftRailMenu);
  return createLeftRail(viewModel, props.handlers, { menu, anchor: props.anchor });
});

export const AgentChatColumnView = memo(function AgentChatColumnView(props: {
  handlers: ProductShellHandlers;
}): ReactElement {
  const viewModel = useProductShellSlice(selectChatColumnViewModel);
  return createAgentChatColumn(viewModel, props.handlers);
});

export const WorkbenchColumnView = memo(function WorkbenchColumnView(props: {
  handlers: ProductShellHandlers;
}): ReactElement {
  const viewModel = useProductShellSlice(selectWorkbenchViewModel);
  return createWorkbenchColumn(viewModel, props.handlers);
});

export const FileTreeColumnView = memo(function FileTreeColumnView(props: {
  handlers: ProductShellHandlers;
}): ReactElement {
  const fileTree = useProductShellSlice(selectFileTreeViewModel);
  return createFileTreeColumn({ fileTree }, props.handlers);
});
