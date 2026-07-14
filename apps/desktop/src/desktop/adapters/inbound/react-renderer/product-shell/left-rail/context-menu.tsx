import type { ProductShellLeftRailMenu, ProductShellListSettings } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { MenuAnchorRect, ProductShellHandlers } from "../support/types.ts";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { createListSettingsMenu } from "./section-header.tsx";
import { Archive, Clipboard, ClipboardCheck, FolderOpen, GitBranchPlus, Pencil, Pin, Trash2 } from "lucide-react";
import {
  FloatingMenuBackdrop,
  FloatingMenuIcon,
  FloatingMenuItem,
  FloatingMenuSurface,
} from "../support/floating-menu.parts.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Renders the left-rail context menu as a fixed popover anchored to its trigger
// (escaping the rail's scroll-overflow clip), behind a transparent full-viewport
// backdrop that closes it on outside click.
export function createLeftRailContextMenuOverlay(
  menu: ProductShellLeftRailMenu,
  anchor: MenuAnchorRect,
  onClose: () => void,
  handlers: ProductShellHandlers,
  listSettings: ProductShellListSettings,
): ReactElement {
  const viewportH = typeof window === "undefined" ? 900 : window.innerHeight;
  const viewportW = typeof window === "undefined" ? 1200 : window.innerWidth;
  const width = menu.kind === "project" ? 244 : menu.kind === "list_settings" ? 200 : 238;
  const estimated = menu.kind === "project" ? 230 : menu.kind === "list_settings" ? 230 : 214;
  const openUp = anchor.bottom + estimated > viewportH;
  // The trigger (⋯) sits at the right edge of the narrow left rail, so right-align
  // the menu to it (open leftward) — left-aligning would spill over into the chat.
  const left = Math.max(8, Math.min(anchor.right - width, viewportW - width - 8));
  const style: Record<string, string> = {
    position: "fixed",
    left: `${left}px`,
    zIndex: "60",
  };
  if (openUp) {
    style.bottom = `${viewportH - anchor.top + 4}px`;
  } else {
    style.top = `${anchor.bottom + 4}px`;
  }
  return (
    <FloatingMenuBackdrop data-left-rail-menu-backdrop onMouseDown={onClose}>
      <div
        onMouseDown={(event: { stopPropagation: () => void }) => event.stopPropagation()}
        style={{ ...style, width: `${width}px` } as unknown as CSSProperties}
      >
        {menu.kind === "list_settings"
          ? createListSettingsMenu(listSettings, handlers)
          : createLeftRailContextMenu(menu, handlers)}
      </div>
    </FloatingMenuBackdrop>
  );
}

interface ContextMenuItem {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  danger?: boolean;
}

function createLeftRailContextMenu(
  menu: Exclude<ProductShellLeftRailMenu, { kind: "list_settings" }>,
  handlers: ProductShellHandlers,
): ReactElement {
  const threadInfo = menu.kind === "thread" ? handlers.threadContextMenuInfo(menu.threadId) : null;
  const items: ContextMenuItem[] =
    menu.kind === "thread"
      ? [
          {
            label: "Review changes",
            icon: <ClipboardCheck size={15} strokeWidth={1.9} />,
            onClick: () => handlers.onOpenThreadReview(menu.threadId),
          },
          {
            label: "Rename task",
            icon: <Pencil size={15} strokeWidth={1.9} />,
            onClick: () => handlers.onThreadRenameStart(menu.threadId),
          },
          ...(threadInfo?.workingDirectory != null
            ? [
                {
                  label: "Reveal in Finder",
                  icon: <FolderOpen size={15} strokeWidth={1.9} />,
                  onClick: () => handlers.onThreadRevealInFinder(menu.threadId),
                } satisfies ContextMenuItem,
                {
                  label: "Copy working directory",
                  icon: <Clipboard size={15} strokeWidth={1.9} />,
                  onClick: () => copyTextAndClose(threadInfo.workingDirectory ?? "", handlers),
                } satisfies ContextMenuItem,
              ]
            : []),
          {
            label: "Copy session ID",
            icon: <Clipboard size={15} strokeWidth={1.9} />,
            onClick: () => copyTextAndClose(threadInfo?.sessionId ?? menu.threadId, handlers),
          },
          {
            label: "Copy thread ID",
            icon: <Clipboard size={15} strokeWidth={1.9} />,
            onClick: () => copyTextAndClose(menu.threadId, handlers),
          },
        ]
      : [
          {
            label: "Pin project",
            icon: <Pin size={16} strokeWidth={1.9} />,
            onClick: () => handlers.onProjectPinToggle(menu.projectId),
          },
          {
            label: "Open in Finder",
            icon: <FolderOpen size={16} strokeWidth={1.9} />,
            onClick: () => handlers.onProjectRevealInFinder(menu.projectId),
          },
          {
            label: "Create permanent worktree",
            icon: <GitBranchPlus size={16} strokeWidth={1.9} />,
            onClick: () => handlers.onProjectCreateWorktree(menu.projectId),
          },
          {
            label: "Rename project",
            icon: <Pencil size={16} strokeWidth={1.9} />,
            onClick: () => handlers.onProjectRenameStart(menu.projectId),
          },
          {
            label: "Archive chats",
            icon: <Archive size={16} strokeWidth={1.9} />,
            onClick: () => handlers.onProjectArchiveChats(menu.projectId),
          },
          ...(handlers.isProjectWorktree(menu.projectId)
            ? [
                {
                  label: "Delete worktree",
                  icon: <Trash2 size={16} strokeWidth={1.9} />,
                  onClick: () => handlers.onProjectDeleteWorktree(menu.projectId),
                  danger: true,
                } satisfies ContextMenuItem,
              ]
            : handlers.isProjectRemovable(menu.projectId)
            ? [
                {
                  label: "Remove from sidebar",
                  icon: <Trash2 size={16} strokeWidth={1.9} />,
                  onClick: () => handlers.onProjectRemove(menu.projectId),
                  danger: true,
                } satisfies ContextMenuItem,
              ]
            : []),
        ];

  return (
    <FloatingMenuSurface $kind={menu.kind} data-left-rail-menu-kind={menu.kind}>
      {items.map((item) => (
        <FloatingMenuItem
          key={item.label}
          type="button"
          disabled={item.onClick === undefined}
          data-left-rail-menu-item={item.label}
          $danger={item.danger}
          $disabled={item.onClick === undefined}
          onClick={item.onClick}
        >
          <FloatingMenuIcon $danger={item.danger} aria-hidden>
            {item.icon}
          </FloatingMenuIcon>
          <span>{item.label}</span>
        </FloatingMenuItem>
      ))}
    </FloatingMenuSurface>
  );
}

function copyTextAndClose(value: string, handlers: ProductShellHandlers): void {
  if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(value);
  }
  handlers.onLeftRailMenuOpen(null);
}
