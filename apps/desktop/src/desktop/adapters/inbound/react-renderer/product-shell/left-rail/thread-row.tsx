import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { createIconButton, menuAnchorFromEvent } from "../chrome/chrome.tsx";
import { AgentIdentityIcon } from "../support/agent-identity.tsx";
import { threadScopeLabel } from "./thread-section.tsx";
import { Archive, GitBranch, Pin, PinOff, Trash2 } from "lucide-react";
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
        data-running={thread.running ? "true" : undefined}
        data-attention={thread.attention ? "true" : undefined}
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
            // Option+N badge — present in markup for the first 9 threads in Left Rail
            // order (top-9, not just pinned), but CSS-hidden until Option is held (root
            // [data-multitask]), where it replaces the time/dots/actions in the right
            // slot. Spec: multitask-navigation L2 / #2.
            thread.pinNumber !== undefined ? (
              <span key="pin-badge" className="thread-row__pin-badge" aria-hidden>
                {`⌥${thread.pinNumber}`}
              </span>
            ) : null,
            thread.attention ? <span key="attention" className="thread-row__attention" /> : null,
            thread.running && !thread.attention ? (
              <span key="running" className="thread-row__running" aria-label="Agent is running" />
            ) : null,
            <span key="time" className="thread-row__time">
              {thread.time}
            </span>,
            <span key="actions" className="thread-row__actions">
              {/* Up to three direct hover quick-actions: Pin / Archive (every row) and,
                  for worktree threads, Delete worktree. Three buttons fit, so the ⋯
                  overflow is gone — the full menu stays on right-click for parity.
                  Spec: thread-row-quick-actions. */}
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
              {/* Worktree threads only: Delete worktree opens the confirm dialog (removes
                  the dir + branch, with safety checks). Destructive → danger style. */}
              {thread.worktreeBranch !== undefined
                ? createIconButton(
                    "Delete worktree",
                    <Trash2 size={15} strokeWidth={1.9} />,
                    () => handlers.onThreadDeleteWorktree(thread.threadId),
                    "thread-row__action thread-row__action--danger",
                  )
                : null}
            </span>,
          ]
        )}
      </div>
    </div>
  );
}
