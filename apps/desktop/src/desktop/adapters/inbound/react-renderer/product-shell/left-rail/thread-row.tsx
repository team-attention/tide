import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { createIconButton, menuAnchorFromEvent } from "../chrome/chrome.tsx";
import { Archive, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

interface ThreadRowProps {
  thread: ProductShellThreadView;
  handlers: ProductShellHandlers;
}

export function createThreadRow(
  thread: ProductShellThreadView,
  handlers: ProductShellHandlers,
): ReactElement {
  return <ThreadRow key={thread.threadId} thread={thread} handlers={handlers} />;
}

function ThreadRow({ thread, handlers }: ThreadRowProps): ReactElement {
  const needsAttention = thread.attention === true;
  const hasUnread = thread.unread === true;
  const showAttention = needsAttention || hasUnread;
  const worktreeBranch = handlers.threadWorktreeBranch(thread.threadId);
  const threadMenu = {
    kind: "thread" as const,
    threadId: thread.threadId,
  };
  return (
    <div className="thread-row-wrap">
      <div
        className={[
          "thread-row",
          thread.active && !thread.hydrating ? "thread-row--active" : "",
          thread.contextMenuOpen ? "thread-row--menu-open" : "",
          thread.archiveConfirming ? "thread-row--archive-confirming" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-left-row-kind="thread"
        data-thread-row={thread.threadId}
        data-active={thread.active}
        data-hydrating={thread.hydrating ? "true" : undefined}
        data-running={thread.running ? "true" : undefined}
        data-attention={showAttention ? "true" : undefined}
        onMouseLeave={thread.archiveConfirming ? handlers.onLeftRailTransientClear : undefined}
        // Right-click anywhere on the row opens the full Thread context menu
        // (Pin / Archive / Delete worktree).
        onContextMenu={(event: { preventDefault: () => void; currentTarget: HTMLElement }) => {
          event.preventDefault();
          handlers.onLeftRailMenuOpen(
            threadMenu,
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
            {createThreadLeadingStatus(thread, showAttention)}
            {showAttention ? (
              <span className="visually-hidden">
                {needsAttention ? "Thread needs attention" : "Thread has unread updates"}
              </span>
            ) : thread.running ? (
              <span className="visually-hidden">Agent is running</span>
            ) : null}
            <span className="thread-row__title">{thread.title}</span>
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
            // Option+N badge — present in markup for the first 9 threads in Left Rail
            // order (top-9, not just pinned), but CSS-hidden until Option is held (root
            // [data-multitask]), where it replaces the time/dots/actions in the right
            // slot. Spec: multitask-navigation L2 / #2.
            thread.pinNumber !== undefined ? (
              <span key="pin-badge" className="thread-row__pin-badge" aria-hidden>
                {`⌥${thread.pinNumber}`}
              </span>
            ) : null,
            <span key="time" className="thread-row__time">
              {thread.time}
            </span>,
            <span key="actions" className="thread-row__actions">
              {createIconButton(
                thread.pinned ? "Unpin" : "Pin",
                thread.pinned ? (
                  <PinOff size={15} strokeWidth={1.9} />
                ) : (
                  <Pin size={15} strokeWidth={1.9} />
                ),
                () => handlers.onThreadPinToggle(thread.threadId),
                "thread-row__action",
              )}
              {createIconButton(
                "Archive",
                <Archive size={15} strokeWidth={1.9} />,
                () => handlers.onThreadArchiveIntent(thread.threadId),
                "thread-row__action",
              )}
              {worktreeBranch !== null
                ? createIconButton(
                    "Delete worktree",
                    <Trash2 size={15} strokeWidth={1.9} />,
                    () => handlers.onThreadDeleteWorktree(thread.threadId),
                    "thread-row__action thread-row__action--danger",
                  )
                : null}
              {createIconButton(
                "Thread menu",
                <MoreHorizontal size={15} strokeWidth={1.9} />,
                (event) =>
                  handlers.onLeftRailMenuOpen(
                    threadMenu,
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

function createThreadLeadingStatus(
  thread: ProductShellThreadView,
  showAttention: boolean,
): ReactElement | null {
  const isRunning = thread.running === true && !showAttention;

  if (!isRunning && !showAttention) {
    return null;
  }
  const className = [
    "thread-row__leading",
    isRunning ? "thread-row__leading--running" : "",
    showAttention ? "thread-row__leading--attention" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return <span className={className} aria-hidden />;
}
