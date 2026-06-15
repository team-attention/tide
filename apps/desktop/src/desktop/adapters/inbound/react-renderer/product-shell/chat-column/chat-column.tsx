import type { ProductShellChatColumnViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { threadScopeLabel } from "../left-rail/thread-section.tsx";
import { createIconButton, createTrafficControls } from "../chrome/chrome.tsx";
import { Folder, GitBranch, PanelLeftOpen, Pin } from "lucide-react";
import { AgentChatShell } from "../../agent-chat/agent-chat.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createAgentChatColumn(
  viewModel: ProductShellChatColumnViewModel,
  handlers: ProductShellHandlers,
  // Current branch + uncommitted +/- line totals for the active repo/worktree; opens the
  // read-only Changes view. Null when the cwd isn't a git repo. Spec: git-changes-view.
  gitBadge:
    | { branch: string | null; additions: number; deletions: number; fileCount: number; cwd: string }
    | null = null,
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

  return (
    <section className="tide-product-shell__stage" aria-label="Agent Chat" data-column="agent-chat">
      <header className="agent-chat-top-row column-top-row" aria-label="Agent Chat Top Row">
        <div className="column-top-row__leading">
          {viewModel.leftRailOpen ? null : createTrafficControls()}
          {viewModel.leftRailOpen
            ? null
            : createIconButton(
                "Open Left Rail",
                <PanelLeftOpen size={15} strokeWidth={1.9} />,
                handlers.onLeftRailToggle,
                "top-row-button",
              )}
          <Pin size={14} strokeWidth={1.9} aria-hidden />
          <span className="column-top-row__title">{title}</span>
          {scopeLabel === null ? null : (
            <span className="column-top-row__scope" title={scopePath}>
              <Folder size={12} strokeWidth={1.9} aria-hidden />
              <span>{scopeLabel}</span>
            </span>
          )}
          {gitBadge === null ? null : (
            <button
              type="button"
              className="column-top-row__git"
              title={`${gitBadge.branch ?? "detached HEAD"} · ${gitBadge.fileCount} file${gitBadge.fileCount === 1 ? "" : "s"} changed (+${gitBadge.additions} −${gitBadge.deletions}) — view changes`}
              aria-label="View working tree changes"
              onClick={() => handlers.onOpenChanges(gitBadge.cwd)}
            >
              <GitBranch size={12} strokeWidth={1.9} aria-hidden />
              <span className="column-top-row__git-branch">{gitBadge.branch ?? "detached"}</span>
              {gitBadge.additions > 0 || gitBadge.deletions > 0 ? (
                <span className="column-top-row__git-stat">
                  {gitBadge.additions > 0 ? (
                    <span className="column-top-row__git-add">{`+${gitBadge.additions}`}</span>
                  ) : null}
                  {gitBadge.deletions > 0 ? (
                    <span className="column-top-row__git-del">{`−${gitBadge.deletions}`}</span>
                  ) : null}
                </span>
              ) : gitBadge.fileCount > 0 ? (
                <span className="column-top-row__git-count">{gitBadge.fileCount}</span>
              ) : null}
            </button>
          )}
        </div>
        {/* Trailing kept as a spacer; the Workbench/FileTree toggles now live in the
            fixed window-level cluster at the top-right. */}
        <div className="column-top-row__trailing" />
      </header>
      <AgentChatShell
        viewModel={viewModel.agentChat}
        showThreadHeader={false}
        onDraftChange={handlers.onDraftChange}
        onSubmit={handlers.onSubmit}
        onInterrupt={handlers.onInterrupt}
        onEditQueued={handlers.onEditQueued}
        onRemoveQueued={handlers.onRemoveQueued}
        onResend={handlers.onResend}
        onQuote={handlers.onQuote}
        onComposerSurfaceChange={handlers.onComposerSurfaceChange}
        onChoiceSurfaceRowSelect={handlers.onChoiceSurfaceRowSelect}
        onOpenFile={handlers.onOpenFile}
        onOpenBrowserPane={handlers.onOpenBrowserPane}
        onAddAttachment={handlers.onAddAttachment}
        onRemoveAttachment={handlers.onRemoveAttachment}
        onRemoveContextChip={handlers.onRemoveContextChip}
        onSetContextChipComment={handlers.onSetContextChipComment}
        onAnswerPromptText={handlers.onAnswerPromptText}
      />
    </section>
  );
}
