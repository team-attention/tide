import type { ProductShellChatColumnViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { styled } from "styled-components";
import { threadScopeLabel } from "../left-rail/thread-section.tsx";
import { createTrafficControls } from "../chrome/chrome.tsx";
import { Folder, GitBranch, PanelLeftOpen, Pin } from "lucide-react";
import { AgentChatShell } from "../../agent-chat/agent-chat.tsx";
import {
  ColumnTopRow,
  ColumnTopRowLeading,
  ColumnTopRowScope,
  ColumnTopRowTitle,
  ColumnTopRowTrailing,
  TopRowButton,
} from "../support/column-top-row.parts.tsx";
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
    <AgentChatStage aria-label="Agent Chat" data-column="agent-chat">
      <AgentChatTopRow aria-label="Agent Chat Top Row">
        <ColumnTopRowLeading>
          {viewModel.leftRailOpen ? null : createTrafficControls()}
          {viewModel.leftRailOpen ? null : (
            <TopRowButton type="button" title="Open Left Rail" aria-label="Open Left Rail" onClick={handlers.onLeftRailToggle}>
              <PanelLeftOpen size={15} strokeWidth={1.9} aria-hidden />
            </TopRowButton>
          )}
          <Pin size={14} strokeWidth={1.9} aria-hidden />
          <ColumnTopRowTitle>{title}</ColumnTopRowTitle>
          {scopeLabel === null ? null : (
            <ColumnTopRowScope title={scopePath}>
              <Folder size={12} strokeWidth={1.9} aria-hidden />
              <span>{scopeLabel}</span>
            </ColumnTopRowScope>
          )}
          {gitBadge === null ? null : (
            <HeaderGitBadge
              type="button"
              title={`${gitBadge.branch ?? "detached HEAD"} · ${gitBadge.fileCount} file${gitBadge.fileCount === 1 ? "" : "s"} changed (+${gitBadge.additions} −${gitBadge.deletions}) — view changes`}
              aria-label="View working tree changes"
              onClick={() => handlers.onOpenChanges(gitBadge.cwd)}
            >
              <GitBranch size={12} strokeWidth={1.9} aria-hidden />
              <HeaderGitBranch>{gitBadge.branch ?? "detached"}</HeaderGitBranch>
              {gitBadge.additions > 0 || gitBadge.deletions > 0 ? (
                <HeaderGitStat>
                  {gitBadge.additions > 0 ? (
                    <HeaderGitAdd>{`+${gitBadge.additions}`}</HeaderGitAdd>
                  ) : null}
                  {gitBadge.deletions > 0 ? (
                    <HeaderGitDel>{`−${gitBadge.deletions}`}</HeaderGitDel>
                  ) : null}
                </HeaderGitStat>
              ) : gitBadge.fileCount > 0 ? (
                <HeaderGitCount>{gitBadge.fileCount}</HeaderGitCount>
              ) : null}
            </HeaderGitBadge>
          )}
        </ColumnTopRowLeading>
        {/* Trailing kept as a spacer; the Workbench/FileTree toggles now live in the
            fixed window-level cluster at the top-right. */}
        <ColumnTopRowTrailing />
      </AgentChatTopRow>
      <AgentChatShell
        viewModel={viewModel.agentChat}
        showThreadHeader={false}
        onDraftChange={handlers.onDraftChange}
        onSubmit={handlers.onSubmit}
        onInterrupt={handlers.onInterrupt}
        onRunQueuedInputNow={handlers.onRunQueuedInputNow}
        onSetGoal={handlers.onSetGoal}
        onEditQueued={handlers.onEditQueued}
        onRemoveQueued={handlers.onRemoveQueued}
        onResend={handlers.onResend}
        onQuote={handlers.onQuote}
        onComposerSurfaceChange={handlers.onComposerSurfaceChange}
        onChoiceSurfaceRowSelect={handlers.onChoiceSurfaceRowSelect}
        onChoiceSurfaceInputSubmit={handlers.onChoiceSurfaceInputSubmit}
        onOpencodeConnectApiKey={handlers.onOpencodeConnectApiKey}
        onOpenFile={handlers.onOpenFile}
        onOpenBrowserPane={handlers.onOpenBrowserPane}
        onAddAttachment={handlers.onAddAttachment}
        onRemoveAttachment={handlers.onRemoveAttachment}
        onRemoveContextChip={handlers.onRemoveContextChip}
        onSetContextChipComment={handlers.onSetContextChipComment}
        onAnswerPromptText={handlers.onAnswerPromptText}
        onAnswerPromptSteps={handlers.onAnswerPromptSteps}
      />
    </AgentChatStage>
  );
}

const AgentChatStage = styled.section`
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 52px minmax(0, 1fr);
  background: var(--tide-bg);
`;

const agentChatTopRowAttrs = (): Record<string, string> => ({
  "data-agent-chat-top-row": "true",
});

const AgentChatTopRow = styled(ColumnTopRow).attrs(agentChatTopRowAttrs)`
  padding: 0 12px;
`;

const HeaderGitBadge = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  max-width: 190px;
  padding: 0 7px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--tide-muted);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;

const HeaderGitBranch = styled.span`
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HeaderGitCount = styled.span`
  min-width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--tide-action);
  color: var(--tide-on-action, var(--tide-bg));
  font-size: 10px;
  font-weight: 600;
`;

const HeaderGitStat = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  font-variant-numeric: tabular-nums;
`;

const HeaderGitAdd = styled.span`
  color: var(--tide-diff-add);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

const HeaderGitDel = styled.span`
  color: var(--tide-danger);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;
