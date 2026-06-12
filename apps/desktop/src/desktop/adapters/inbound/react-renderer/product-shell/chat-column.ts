import type { ProductShellViewModel } from "../../../../application/domains/product-shell/product-shell-state.ts";
import type { ProductShellHandlers } from "./types.ts";
import { createElement } from "react";
import type { ReactElement } from "react";
import { threadScopeLabel } from "./left-rail/thread-section.ts";
import { createIconButton, createTrafficControls } from "./chrome.ts";
import { Folder, PanelLeftOpen, Pin } from "lucide-react";
import { AgentChatShell } from "../agent-chat/agent-chat.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createAgentChatColumn(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  const title = viewModel.agentChat.thread?.title ?? "New Thread";
  // Which project/directory this thread lives in — so a pinned thread (pulled
  // out of its project group in the left rail) is still identifiable. Shown as a
  // muted breadcrumb after the title, like the Claude app. The chat VM doesn't
  // carry scope, so resolve it from the product-shell thread lists.
  const activeThreadId = viewModel.agentChat.thread?.threadId;
  const activeThread =
    activeThreadId === undefined
      ? undefined
      : [
          ...viewModel.flatThreads,
          ...viewModel.pinnedThreads,
          ...viewModel.projectGroups.flatMap((group) => group.threads),
        ].find((thread) => thread.threadId === activeThreadId);
  const scope = activeThread?.scope;
  const scopeLabel = scope === undefined ? null : threadScopeLabel(scope);
  const scopePath = scope === undefined ? undefined : scope.kind === "project" ? scope.cwd : "Scratch thread";

  return createElement(
    "section",
    {
      className: "tide-product-shell__stage",
      "aria-label": "Agent Chat",
      "data-column": "agent-chat",
    },
    createElement(
      "header",
      { className: "agent-chat-top-row column-top-row", "aria-label": "Agent Chat Top Row" },
      createElement(
        "div",
        { className: "column-top-row__leading" },
        viewModel.leftUiOpen ? null : createTrafficControls(),
        viewModel.leftUiOpen
          ? null
          : createIconButton(
              "Open Left UI",
              createElement(PanelLeftOpen, { size: 15, strokeWidth: 1.9 }),
              handlers.onLeftUiToggle,
              "top-row-button",
            ),
        createElement(Pin, { size: 14, strokeWidth: 1.9, "aria-hidden": true }),
        createElement("span", { className: "column-top-row__title" }, title),
        scopeLabel === null
          ? null
          : createElement(
              "span",
              { className: "column-top-row__scope", title: scopePath },
              createElement(Folder, { size: 12, strokeWidth: 1.9, "aria-hidden": true }),
              createElement("span", null, scopeLabel),
            ),
      ),
      // Trailing kept as a spacer; the Workbench/FileTree toggles now live in the
      // fixed window-level cluster at the top-right.
      createElement("div", { className: "column-top-row__trailing" }),
    ),
    createElement(AgentChatShell, {
      viewModel: viewModel.agentChat,
      showThreadHeader: false,
      onDraftChange: handlers.onDraftChange,
      onSubmit: handlers.onSubmit,
      onInterrupt: handlers.onInterrupt,
      onEditQueued: handlers.onEditQueued,
      onRemoveQueued: handlers.onRemoveQueued,
      onResend: handlers.onResend,
      onQuote: handlers.onQuote,
      onComposerSurfaceChange: handlers.onComposerSurfaceChange,
      onChoiceSurfaceRowSelect: handlers.onChoiceSurfaceRowSelect,
      onOpenFile: handlers.onOpenFile,
      onOpenBrowserPane: handlers.onOpenBrowserPane,
      onAddAttachment: handlers.onAddAttachment,
      onRemoveAttachment: handlers.onRemoveAttachment,
      onRemoveContextChip: handlers.onRemoveContextChip,
      onSetContextChipComment: handlers.onSetContextChipComment,
      onAnswerPromptText: handlers.onAnswerPromptText,
    }),
  );
}
