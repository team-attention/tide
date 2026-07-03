import {
  applyAgentChatBackendEvent,
  createAgentChatShellState,
  createAgentChatShellViewModel,
  defaultPermissionForAgent,
  defaultModelValueForAgent,
  resolveStartAgentId,
  selectAgentChatChoiceSurfaceRow,
  answerPromptText,
  setComposerActiveSurface,
  setComposerFolderScope,
  setComposerNewWorktreeIntent,
  resolveComposerNewWorktreeIntent,
  interruptComposer,
  submitComposer,
  editQueuedInput,
  updateComposerDraft,
  addComposerAttachment,
  removeComposerAttachment,
  addComposerContextChip,
  removeComposerContextChip,
  setComposerContextChipComment,
  type AgentChatComposerAttachment,
  type AgentChatContextChip,
  type AgentChatBackendCommand,
  type AgentChatComposerSurfaceKind,
  type AgentChatBlock,
  type AgentChatBackendEvent,
  type AgentChatAgentBinding,
  type AgentChatPromptState,
  type AgentChatShellState,
  type AgentChatShellViewModel,
  type AgentChatThreadScope,
  type AgentChatThreadSummary,
  type AgentChatChoiceSurfaceView,
  type AgentChatBranchOption,
  type AgentChatWorktreeOption,
  type AgentChatCommandOption,
} from "../agent-chat/agent-chat.ts";

import {
  applyAppChromeBackendEvent,
  closeWorkbenchPane,
  createAppChromeState,
  createAppChromeViewModel,
  focusWorkbenchPane,
  writeWorkbenchTerminalInput,
  resizeWorkbenchTerminal,
  type AppChromeBackendCommand,
  type AppChromeWorkbenchPaneRef,
  type AppChromeState,
  type AppChromeViewModel,
} from "../app-chrome/app-chrome-state.ts";

import { worktreeRepoRootForCwd } from "../../../../shared/worktree/path.ts";

import {
  reconcileTree,
  applyDrop,
  setRatioAtPath,
  type WorkbenchSplitNode,
  type DropZone,
  type SplitDirection,
} from "./state/workbench-split-tree.ts";

export type { WorkbenchSplitNode, DropZone, SplitDirection };

// Decomposed into ./state/ concern modules (spec: navigable-source-structure).
// This path remains the public import surface for product-shell state.
export * from "./state/types.ts";
export * from "./state/create.ts";
export * from "./state/settings.ts";
export * from "./state/view-model.ts";
export * from "./state/search.ts";
export * from "./state/start.ts";
export * from "./state/thread-list.ts";
export * from "./state/attention-notifications.ts";
export * from "./state/review-findings.ts";
export * from "./state/local-branch-checkout.ts";
export * from "./state/workbench.ts";
export * from "./state/workbench-editor.ts";
export * from "./state/file-tree.ts";
export * from "./state/untitled-files.ts";
export * from "./state/composer-bridge.ts";
export * from "./state/events.ts";
export * from "./state/store.ts";
export * from "./state/create-selector.ts";
