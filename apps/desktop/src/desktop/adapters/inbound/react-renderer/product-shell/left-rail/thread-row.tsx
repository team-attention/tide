import type { ProductShellThreadView } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from "react";
import { keyframes, styled } from "styled-components";
import { menuAnchorFromEvent } from "../chrome/chrome.tsx";
import { worktreeRepoRootForCwd } from "../../../../../../shared/worktree/path.ts";
import { Archive, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
import { VisuallyHidden } from "../../support/visually-hidden.tsx";
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
  const worktreeBranch = handlers.threadWorktreeBranch(thread.threadId);
  const contextItems = createThreadRowContextItems(thread);
  const contextPopoverId = `thread-row-context-${thread.threadId}`;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [contextAnchor, setContextAnchor] = useState<ThreadRowContextAnchor | null>(null);
  const threadMenu = {
    kind: "thread" as const,
    threadId: thread.threadId,
  };
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
  const scheduleContextClose = () => {
    cancelContextClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setContextAnchor(null);
    }, 180);
  };
  const openThreadMenu = (event: { currentTarget: HTMLElement }) => {
    cancelContextClose();
    setContextAnchor(null);
    handlers.onLeftRailMenuOpen(
      threadMenu,
      menuAnchorFromEvent(event),
    );
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
      cancelContextClose();
      setContextAnchor(null);
    };
    document.addEventListener(THREAD_ROW_CONTEXT_OPEN_EVENT, closeWhenAnotherRowOpens);
    return () => {
      document.removeEventListener(THREAD_ROW_CONTEXT_OPEN_EVENT, closeWhenAnotherRowOpens);
      cancelContextClose();
    };
  }, [thread.threadId]);
  const contextOpen = contextAnchor !== null;
  const contextPopoverStyle =
    contextAnchor === null
      ? hiddenThreadRowContextPopoverStyle()
      : threadRowContextPopoverStyle(contextAnchor, contextItems);
  return (
    <ThreadRowWrap
      onMouseEnter={updateContextAnchor}
      onMouseLeave={scheduleContextClose}
      onFocus={updateContextAnchor}
      onBlur={onContextBlur}
    >
      <ThreadRowFrame
        ref={rowRef}
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
            aria-describedby={contextPopoverId}
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
        <ThreadContextPopover
          id={contextPopoverId}
          data-thread-context-popover
          role="tooltip"
          tabIndex={-1}
          hidden={!contextOpen}
          aria-hidden={contextOpen ? undefined : true}
          style={contextPopoverStyle}
          onMouseEnter={cancelContextClose}
          onMouseLeave={scheduleContextClose}
        >
          {contextItems.map((item) => (
            <ThreadContextRow key={item.kind} data-thread-context-row>
              <ThreadContextKind>{item.label}</ThreadContextKind>
              <ThreadContextValue title={item.title ?? item.value}>
                {item.value}
              </ThreadContextValue>
            </ThreadContextRow>
          ))}
        </ThreadContextPopover>
      </ThreadRowFrame>
    </ThreadRowWrap>
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

function hiddenThreadRowContextPopoverStyle(): CSSProperties {
  return {
    left: "0px",
    top: "0px",
    width: 300,
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
  animation: ${({ $running }) => ($running ? threadRowStatusSpin : "none")} 0.9s linear infinite;
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

const ThreadContextRow = styled.span`
  min-width: 0;
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  column-gap: 8px;
`;

const ThreadContextKind = styled.span`
  color: var(--tide-muted);
  font-size: 9.5px;
  font-weight: 650;
  line-height: 13px;
  text-transform: uppercase;
`;

const ThreadContextValue = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-text);
  font-size: 12px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ThreadContextPopover = styled.div`
  position: fixed;
  z-index: 70;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 8px;
  border-radius: 9px;
  background: color-mix(in srgb, var(--tide-bg) 94%, var(--tide-surface));
  box-shadow:
    0 18px 44px -22px rgb(52 48 56 / 46%),
    0 6px 18px -12px rgb(52 48 56 / 28%);
  color: var(--tide-text);
  pointer-events: auto;
  transform: translateY(-2px) scale(0.98);
  transform-origin: top left;
  animation: tide-pop-in 0.12s ease forwards;
  user-select: text;

  &[hidden] {
    display: none;
  }

  [data-theme="dark"] & {
    box-shadow:
      0 18px 48px -18px rgb(0 0 0 / 76%),
      0 6px 18px -10px rgb(0 0 0 / 72%);
  }

  &:hover ${ThreadContextRow} {
    align-items: start;
  }

  &:hover ${ThreadContextValue} {
    overflow-wrap: anywhere;
    text-overflow: clip;
    white-space: normal;
  }
`;
