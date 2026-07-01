import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type ReactElement } from "react";
import { createIconButton, menuAnchorFromEvent } from "../chrome/chrome.tsx";
import { AgentIdentityIcon } from "../support/agent-identity.tsx";
import { worktreeRepoRootForCwd } from "../../../../../../shared/worktree/path.ts";
import { Archive, Pin, PinOff, Trash2 } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

interface ThreadRowContextItem {
  kind: "scope" | "worktree" | "branch" | "status";
  label: string;
  value: string;
  title?: string;
}

interface ThreadRowContextAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface ThreadRowProps {
  thread: ProductShellThreadView;
  handlers: ProductShellHandlers;
}

const THREAD_ROW_CONTEXT_OPEN_EVENT = "tide-thread-row-context-open";

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
  const contextItems = createThreadRowContextItems(thread);
  const contextPopoverId = `thread-row-context-${thread.threadId}`;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextAnchor, setContextAnchor] = useState<ThreadRowContextAnchor | null>(null);
  const cancelContextClose = () => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const updateContextAnchor = () => {
    cancelContextClose();
    const rect = rowRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    if (typeof document !== "undefined") {
      document.dispatchEvent(
        new CustomEvent(THREAD_ROW_CONTEXT_OPEN_EVENT, {
          detail: { threadId: thread.threadId },
        }),
      );
    }
    setContextAnchor({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    });
  };
  const clearContextAnchor = () => {
    cancelContextClose();
    setContextAnchor(null);
  };
  const scheduleContextClose = () => {
    cancelContextClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setContextAnchor(null);
    }, 180);
  };
  const onContextBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    scheduleContextClose();
  };
  useEffect(() => {
    if (typeof document === "undefined") {
      return () => cancelContextClose();
    }
    const closeWhenAnotherRowOpens = (event: Event) => {
      const openedThreadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId;
      if (openedThreadId === thread.threadId) {
        return;
      }
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setContextAnchor(null);
    };
    document.addEventListener(THREAD_ROW_CONTEXT_OPEN_EVENT, closeWhenAnotherRowOpens);
    return () => {
      document.removeEventListener(THREAD_ROW_CONTEXT_OPEN_EVENT, closeWhenAnotherRowOpens);
      cancelContextClose();
    };
  }, [thread.threadId]);
  const visibleContextAnchor =
    contextAnchor ?? (typeof window === "undefined" ? fallbackThreadRowContextAnchor() : null);
  return (
    <div
      className="thread-row-wrap"
      onMouseEnter={updateContextAnchor}
      onMouseLeave={scheduleContextClose}
      onFocus={updateContextAnchor}
      onBlur={onContextBlur}
    >
      <div
        ref={rowRef}
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
            aria-describedby={contextPopoverId}
            onClick={() => handlers.onThreadSelect(thread.threadId)}
            onDoubleClick={() => handlers.onThreadRenameStart(thread.threadId)}
          >
            <AgentIdentityIcon agentId={thread.agentId} />
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
            showAttention ? (
              <span
                key="attention"
                className="thread-row__attention"
                role="img"
                aria-label={needsAttention ? "Thread needs attention" : "Thread has unread updates"}
              />
            ) : null,
            thread.running && !showAttention ? (
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
        {visibleContextAnchor !== null ? (
          <div
            id={contextPopoverId}
            className="thread-row__context-popover"
            role="tooltip"
            style={threadRowContextPopoverStyle(visibleContextAnchor, contextItems)}
            onMouseEnter={cancelContextClose}
            onMouseLeave={scheduleContextClose}
          >
            {contextItems.map((item) => (
              <span key={item.kind} className="thread-row__context-row">
                <span className="thread-row__context-kind">{item.label}</span>
                <span className="thread-row__context-value" title={item.title ?? item.value}>
                  {item.value}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function threadRowContextPopoverStyle(
  anchor: ThreadRowContextAnchor,
  items: ThreadRowContextItem[],
): CSSProperties {
  const gap = 8;
  const margin = 8;
  const width = 300;
  const viewportW = typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportH = typeof window === "undefined" ? 900 : window.innerHeight;
  const estimatedHeight = 18 + items.length * 18;
  const openLeft = anchor.right + gap + width > viewportW - margin;
  const left = openLeft
    ? Math.max(margin, anchor.left - width - gap)
    : Math.min(anchor.right + gap, viewportW - width - margin);
  const top = Math.max(
    margin,
    Math.min(anchor.top - 2, viewportH - estimatedHeight - margin),
  );
  return {
    left,
    top,
    width,
  };
}

function fallbackThreadRowContextAnchor(): ThreadRowContextAnchor {
  return {
    left: 90,
    right: 346,
    top: 302,
    bottom: 332,
  };
}

function createThreadRowContextItems(thread: ProductShellThreadView): ThreadRowContextItem[] {
  const items: ThreadRowContextItem[] = [createScopeContextItem(thread)];
  const worktree = worktreeContextValue(thread);
  if (worktree !== null) {
    items.push(worktree);
  }
  const branch = launchOptionString(thread, "branch");
  if (branch !== null) {
    items.push({ kind: "branch", label: "Branch", value: branch });
  }
  const status = threadStatusContextValue(thread);
  if (status !== null) {
    items.push({ kind: "status", label: "Status", value: status });
  }
  return items;
}

function createScopeContextItem(thread: ProductShellThreadView): ThreadRowContextItem {
  if (thread.scope.kind !== "project") {
    return {
      kind: "scope",
      label: "Scope",
      value: thread.scope.scratchCwd || "Scratch",
    };
  }
  const worktreeRepoRoot = worktreeRepoRootForCwd(thread.scope.cwd);
  if (worktreeRepoRoot !== null) {
    return {
      kind: "scope",
      label: "Project",
      value: basenameLabel(worktreeRepoRoot) ?? thread.scope.projectId,
      title: worktreeRepoRoot,
    };
  }
  const cwdLabel = basenameLabel(thread.scope.cwd);
  return {
    kind: "scope",
    label: "Project",
    value:
      cwdLabel === null || cwdLabel === thread.scope.projectId
        ? thread.scope.projectId
        : `${thread.scope.projectId} / ${cwdLabel}`,
    title: thread.scope.cwd,
  };
}

function worktreeContextValue(thread: ProductShellThreadView): ThreadRowContextItem | null {
  const scopedWorktree =
    thread.scope.kind === "project" && worktreeRepoRootForCwd(thread.scope.cwd) !== null
      ? (thread.worktreeBranch ?? basenameLabel(thread.scope.cwd))
      : null;
  if (scopedWorktree !== null && scopedWorktree.length > 0) {
    return {
      kind: "worktree",
      label: "Worktree",
      value: scopedWorktree,
      title: thread.scope.kind === "project" ? thread.scope.cwd : undefined,
    };
  }
  const launchWorktree = launchOptionString(thread, "worktree");
  if (launchWorktree === null || launchWorktree === "current folder") {
    return null;
  }
  if (launchWorktree === "new") {
    return { kind: "worktree", label: "Worktree", value: "New worktree" };
  }
  return {
    kind: "worktree",
    label: "Worktree",
    value: basenameLabel(launchWorktree) ?? launchWorktree,
    title: launchWorktree,
  };
}

function threadStatusContextValue(thread: ProductShellThreadView): string | null {
  if (thread.running === true) {
    return "Running";
  }
  if (thread.attention === true) {
    return "Needs attention";
  }
  if (thread.unread === true) {
    return "Unread";
  }
  if (thread.live === true) {
    return "Live";
  }
  return null;
}

function launchOptionString(
  thread: ProductShellThreadView,
  key: "branch" | "worktree",
): string | null {
  const value = thread.launchOptions?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function basenameLabel(path: string): string | null {
  return path.split(/[/\\]/).filter((seg: string) => seg.length > 0).pop() ?? null;
}
