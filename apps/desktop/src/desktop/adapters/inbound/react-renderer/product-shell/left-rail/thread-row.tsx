import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { css, keyframes, styled } from "styled-components";
import { menuAnchorFromEvent } from "../chrome/chrome.tsx";
import { Archive, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
import { VisuallyHidden } from "../../support/visually-hidden.tsx";
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
  const openThreadMenu = (event: { currentTarget: HTMLElement }) => {
    handlers.onLeftRailMenuOpen(
      threadMenu,
      menuAnchorFromEvent(event),
    );
  };
  return (
    <ThreadRowWrap>
      <ThreadRowFrame
        $active={thread.active && !thread.hydrating}
        $menuOpen={thread.contextMenuOpen}
        $archiveConfirming={thread.archiveConfirming}
        data-left-row-kind="thread"
        data-thread-row={thread.threadId}
        data-thread-menu-open={thread.contextMenuOpen ? "true" : undefined}
        data-thread-archive-confirming={thread.archiveConfirming ? "true" : undefined}
        data-thread-visual-active={thread.active && !thread.hydrating ? "true" : undefined}
        data-active={thread.active}
        data-hydrating={thread.hydrating ? "true" : undefined}
        data-running={thread.running ? "true" : undefined}
        data-attention={showAttention ? "true" : undefined}
        onMouseLeave={thread.archiveConfirming ? handlers.onLeftRailTransientClear : undefined}
        // Right-click anywhere on the row opens the full Thread context menu
        // (Pin / Archive / Delete worktree).
        onContextMenu={(event: { preventDefault: () => void; currentTarget: HTMLElement }) => {
          event.preventDefault();
          openThreadMenu(event);
        }}
      >
        {thread.renaming ? (
          <ThreadRenameInput
            data-thread-rename-input
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
          <ThreadMainButton
            data-thread-row-main
            type="button"
            aria-pressed={thread.active}
            onClick={() => handlers.onThreadSelect(thread.threadId)}
            onDoubleClick={() => handlers.onThreadRenameStart(thread.threadId)}
          >
            {createThreadLeadingStatus(thread, showAttention)}
            {showAttention ? (
              <VisuallyHidden>
                {needsAttention ? "Thread needs attention" : "Thread has unread updates"}
              </VisuallyHidden>
            ) : thread.running ? (
              <VisuallyHidden>Agent is running</VisuallyHidden>
            ) : null}
            <ThreadTitle data-thread-title data-rail-title>{thread.title}</ThreadTitle>
          </ThreadMainButton>
        )}
        {thread.archiveConfirming ? (
          <ThreadConfirmButton
            data-thread-archive-confirm
            type="button"
            aria-label="Confirm Archive Thread"
            onClick={() => handlers.onThreadArchiveConfirm(thread.threadId)}
          >
            Confirm
          </ThreadConfirmButton>
        ) : (
          [
            // Option+N badge — present in markup for the first 9 threads in Left Rail
            // order (top-9, not just pinned), but CSS-hidden until Option is held (root
            // [data-multitask]), where it replaces the time/dots/actions in the right
            // slot. Spec: multitask-navigation L2 / #2.
            thread.pinNumber !== undefined ? (
              <ThreadPinBadge key="pin-badge" data-thread-pin-badge aria-hidden>
                {`⌥${thread.pinNumber}`}
              </ThreadPinBadge>
            ) : null,
            <ThreadTime key="time" data-thread-time>
              {thread.time}
            </ThreadTime>,
            <ThreadActions key="actions" data-thread-actions>
              {createThreadActionButton(
                thread.pinned ? "Unpin" : "Pin",
                thread.pinned ? (
                  <PinOff size={15} strokeWidth={1.9} />
                ) : (
                  <Pin size={15} strokeWidth={1.9} />
                ),
                () => handlers.onThreadPinToggle(thread.threadId),
                "pin",
              )}
              {createThreadActionButton(
                "Archive",
                <Archive size={15} strokeWidth={1.9} />,
                () => handlers.onThreadArchiveIntent(thread.threadId),
                "archive",
              )}
              {worktreeBranch != null
                ? createThreadActionButton(
                    "Delete worktree",
                    <Trash2 size={15} strokeWidth={1.9} />,
                    () => handlers.onThreadDeleteWorktree(thread.threadId),
                    "delete-worktree",
                    true,
                  )
                : null}
              {createThreadActionButton(
                "Thread menu",
                <MoreHorizontal size={15} strokeWidth={1.9} />,
                (event) => openThreadMenu(event),
                "menu",
              )}
            </ThreadActions>,
          ]
        )}
      </ThreadRowFrame>
    </ThreadRowWrap>
  );
}

function createThreadActionButton(
  label: string,
  icon: ReactElement,
  onClick: (event: { currentTarget: HTMLElement }) => void,
  action: "pin" | "archive" | "delete-worktree" | "menu",
  danger = false,
): ReactElement {
  return (
    <ThreadActionButton
      type="button"
      title={label}
      aria-label={label}
      data-thread-action={action}
      data-danger={danger ? "true" : undefined}
      $danger={danger}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => onClick(event)}
    >
      {icon}
    </ThreadActionButton>
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
  return (
    <ThreadLeadingStatus
      aria-hidden
      data-thread-leading-status={isRunning ? "running" : "attention"}
      $running={isRunning}
      $attention={showAttention}
    />
  );
}

const threadRowStatusSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const ThreadRowWrap = styled.div`
  position: relative;
`;

const ThreadRowFrame = styled.div<{
  $active: boolean;
  $menuOpen: boolean;
  $archiveConfirming: boolean;
}>`
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  padding: 0 10px;
  background: ${({ $active, $menuOpen, $archiveConfirming }) =>
    $active
      ? "color-mix(in srgb, var(--tide-selection) 78%, transparent)"
      : $menuOpen || $archiveConfirming
        ? "var(--tide-selection)"
        : "transparent"};
  color: ${({ $active }) =>
    $active ? "var(--tide-action)" : "color-mix(in srgb, var(--tide-text) 76%, transparent)"};
  box-shadow: none;
  cursor: pointer;
  font-size: 13px;
  line-height: 16px;
  text-align: left;
  transition: background-color 0.18s ease, color 0.12s ease;

  &:hover {
    background: ${({ $active }) =>
      $active ? "color-mix(in srgb, var(--tide-selection) 78%, transparent)" : "var(--tide-selection)"};
  }
`;

const ThreadMainButton = styled.button`
  min-width: 0;
  flex: 1 1 auto;
  align-self: stretch;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
`;

const ThreadLeadingStatus = styled.span<{
  $running: boolean;
  $attention: boolean;
}>`
  width: ${({ $attention }) => ($attention ? "8px" : "16px")};
  height: ${({ $attention }) => ($attention ? "8px" : "16px")};
  margin: ${({ $attention }) => ($attention ? "0 4px" : "0")};
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: ${({ $attention }) =>
    $attention ? "0" : "2px solid color-mix(in srgb, var(--tide-muted) 38%, transparent)"};
  border-top-color: ${({ $running }) =>
    $running
      ? "var(--tide-success)"
      : "color-mix(in srgb, var(--tide-muted) 38%, transparent)"};
  border-radius: 999px;
  background: ${({ $attention }) => ($attention ? "var(--tide-accent)" : "transparent")};
  color: var(--tide-muted);
  ${({ $running }) =>
    $running
      ? css`
          animation: ${threadRowStatusSpin} 0.9s linear infinite;
        `
      : css`
          animation: none;
        `}
`;

const ThreadRenameInput = styled.input`
  min-width: 0;
  flex: 1 1 auto;
  height: 24px;
  border: 1px solid var(--tide-line-strong);
  border-radius: 6px;
  padding: 0 6px;
  background: var(--tide-bg);
  color: var(--tide-text);
  font: inherit;

  &:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--tide-action) 38%, var(--tide-line));
  }
`;

const ThreadTitle = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  [data-thread-visual-active="true"] & {
    font-weight: 500;
  }
`;

const ThreadPinBadge = styled.span`
  display: none;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  padding: 0 5px;
  border-radius: 6px;
  background: var(--tide-bg);
  color: var(--tide-action);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  font-weight: 600;

  [data-multitask] & {
    display: inline-flex;
  }
`;

const ThreadTime = styled.span`
  flex: 0 0 auto;
  color: var(--tide-muted);
  font-size: 12px;

  [data-thread-row]:hover &,
  [data-thread-menu-open="true"] &,
  [data-multitask] &,
  [data-multitask] [data-thread-row]:hover & {
    display: none;
  }
`;

const ThreadActions = styled.span`
  display: none;
  align-items: center;
  gap: 2px;
  color: var(--tide-muted);

  [data-thread-row]:hover &,
  [data-thread-menu-open="true"] & {
    display: inline-flex;
  }

  [data-multitask] &,
  [data-multitask] [data-thread-row]:hover & {
    display: none;
  }
`;

const ThreadActionButton = styled.button<{ $danger: boolean }>`
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${({ $danger }) => ($danger ? "var(--tide-danger)" : "var(--tide-muted)")};
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;

  &:hover {
    background: var(--tide-bg);
    color: ${({ $danger }) => ($danger ? "var(--tide-danger)" : "var(--tide-action)")};
  }

  [data-thread-menu-open="true"] & {
    background: var(--tide-bg);
    color: var(--tide-action);
  }

  [data-thread-menu-open="true"] &:hover {
    color: ${({ $danger }) => ($danger ? "var(--tide-danger)" : "var(--tide-action)")};
  }
`;

const ThreadConfirmButton = styled.button`
  height: 24px;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  padding: 0 12px;
  background: color-mix(in srgb, var(--tide-selection) 84%, var(--tide-action) 8%);
  color: var(--tide-action);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
`;
