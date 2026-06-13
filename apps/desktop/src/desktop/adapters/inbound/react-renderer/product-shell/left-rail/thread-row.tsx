import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { createIconButton, menuAnchorFromEvent } from "../chrome/chrome.tsx";
import { AgentIdentityIcon } from "../support/agent-identity.tsx";
import { threadScopeLabel } from "./thread-section.tsx";
import { GitBranch, MoreHorizontal } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createThreadRow(
  thread: ProductShellThreadView,
  handlers: ProductShellHandlers,
  // Pinned rows are pulled out of their project group, so show which project/dir
  // they belong to as a subtitle.
  showScope = false,
): ReactElement {
  return (
    <div key={thread.threadId} className="thread-row-wrap">
      <div
        className={[
          "thread-row",
          thread.active ? "thread-row--active" : "",
          thread.contextMenuOpen ? "thread-row--menu-open" : "",
          thread.archiveConfirming ? "thread-row--archive-confirming" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-left-row-kind="thread"
        data-thread-row={thread.threadId}
        data-active={thread.active}
        onMouseLeave={thread.archiveConfirming ? handlers.onLeftRailTransientClear : undefined}
        // Right-click anywhere on the row opens the same Thread context menu as
        // the ⋯ overflow button (Pin / Archive / Delete worktree).
        onContextMenu={(event: { preventDefault: () => void; currentTarget: HTMLElement }) => {
          event.preventDefault();
          handlers.onLeftRailMenuOpen(
            { kind: "thread", threadId: thread.threadId },
            menuAnchorFromEvent(event),
          );
        }}
      >
        {thread.renaming ? (
          <input
            className="thread-row__rename-input"
            aria-label="Rename thread"
            defaultValue={thread.title}
            autoFocus
            onClick={(event: { stopPropagation: () => void }) => event.stopPropagation()}
            onKeyDown={(event: {
              key: string;
              currentTarget: { value: string };
              preventDefault: () => void;
            }) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handlers.onThreadRenameSubmit(thread.threadId, event.currentTarget.value);
              } else if (event.key === "Escape") {
                event.preventDefault();
                handlers.onThreadRenameCancel();
              }
            }}
            onBlur={(event: { currentTarget: { value: string } }) =>
              handlers.onThreadRenameSubmit(thread.threadId, event.currentTarget.value)
            }
          />
        ) : (
          <button
            className="thread-row__main"
            type="button"
            aria-pressed={thread.active}
            onClick={() => handlers.onThreadSelect(thread.threadId)}
            onDoubleClick={() => handlers.onThreadRenameStart(thread.threadId)}
          >
            <AgentIdentityIcon agentId={thread.agentId} />
            {showScope ? (
              <span className="thread-row__label">
                <span className="thread-row__title">{thread.title}</span>
                <span className="thread-row__scope">{threadScopeLabel(thread.scope)}</span>
              </span>
            ) : thread.worktreeBranch !== undefined ? (
              <span className="thread-row__title-row">
                <span className="thread-row__title">{thread.title}</span>
                <span className="thread-row__branch" title={`Worktree: ${thread.worktreeBranch}`}>
                  <GitBranch size={11} strokeWidth={1.9} aria-hidden />
                  <span className="thread-row__branch-name">{thread.worktreeBranch}</span>
                </span>
              </span>
            ) : (
              <span className="thread-row__title">{thread.title}</span>
            )}
          </button>
        )}
        {thread.archiveConfirming ? (
          <button
            className="thread-row__confirm"
            type="button"
            aria-label="Confirm Archive Thread"
            onClick={() => handlers.onThreadArchiveConfirm(thread.threadId)}
          >
            Confirm
          </button>
        ) : (
          [
            thread.attention ? <span key="attention" className="thread-row__attention" /> : null,
            thread.running && !thread.attention ? (
              <span key="running" className="thread-row__running" aria-label="Agent is running" />
            ) : null,
            <span key="time" className="thread-row__time">
              {thread.time}
            </span>,
            <span key="actions" className="thread-row__actions">
              {/* One ⋯ overflow opens the Thread context menu (Pin / Archive /
                  Delete worktree), mirroring the project row's menu pattern. */}
              {createIconButton(
                "Thread menu",
                <MoreHorizontal size={15} strokeWidth={1.9} />,
                (event) =>
                  handlers.onLeftRailMenuOpen(
                    { kind: "thread", threadId: thread.threadId },
                    menuAnchorFromEvent(event),
                  ),
                "thread-row__action",
              )}
            </span>,
          ]
        )}
      </div>
    </div>
  );
}
