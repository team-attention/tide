import type { CSSProperties, ReactElement, ReactNode } from "react";
import { FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";
import type { ProductShellFileTreeMenu } from "../../../../../application/domains/product-shell/product-shell.ts";
import { relativeParentPath } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import {
  FloatingMenuBackdrop,
  FloatingMenuIcon,
  FloatingMenuItem,
  FloatingMenuSurface,
} from "../support/floating-menu.parts.tsx";
// FileTree right-click context menu — a fixed popover (escaping the tree's scroll
// clip) behind a transparent backdrop that closes it on outside click. Mirrors the
// left-rail context menu. Spec: workbench-filetree-file-operations.

interface FileTreeMenuItem {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export function createFileTreeContextMenuOverlay(
  menu: ProductShellFileTreeMenu,
  handlers: ProductShellHandlers,
): ReactElement {
  const viewportH = typeof window === "undefined" ? 900 : window.innerHeight;
  const viewportW = typeof window === "undefined" ? 1200 : window.innerWidth;
  const width = 200;
  const estimated = 150;
  const left = Math.max(8, Math.min(menu.x, viewportW - width - 8));
  const top = menu.y + estimated > viewportH ? Math.max(8, menu.y - estimated) : menu.y;

  // "New Folder" lands under the targeted folder, or under a file's / the root's parent.
  const newFolderParent =
    menu.kind === "folder" ? menu.relativePath : relativeParentPath(menu.relativePath);
  const isRoot = menu.kind === "root" || menu.relativePath.length === 0;

  const items: FileTreeMenuItem[] = [
    {
      label: "New File",
      icon: <FilePlus size={15} strokeWidth={1.9} />,
      onClick: () => {
        handlers.onFileTreeMenuClose();
        handlers.onNewUntitledFile();
      },
    },
    {
      label: "New Folder",
      icon: <FolderPlus size={15} strokeWidth={1.9} />,
      onClick: () => handlers.onFileTreeNewFolder(newFolderParent),
    },
    ...(isRoot
      ? []
      : [
          {
            label: "Rename",
            icon: <Pencil size={15} strokeWidth={1.9} />,
            onClick: () => handlers.onFileTreeRenameStart(menu.relativePath),
          },
          {
            label: "Delete",
            icon: <Trash2 size={15} strokeWidth={1.9} />,
            onClick: () => handlers.onFileTreeDeleteIntent(menu),
            danger: true,
          },
        ]),
  ];

  return (
    <FloatingMenuBackdrop onMouseDown={() => handlers.onFileTreeMenuClose()}>
      <FloatingMenuSurface
        $kind="file_tree"
        data-file-tree-context-menu
        onMouseDown={(event: { stopPropagation: () => void }) => event.stopPropagation()}
        style={{ position: "fixed", left: `${left}px`, top: `${top}px`, width: `${width}px`, zIndex: "60" } as CSSProperties}
      >
        {items.map((item) => (
          <FloatingMenuItem
            key={item.label}
            type="button"
            data-file-tree-menu-item={item.label}
            $danger={item.danger}
            onClick={item.onClick}
          >
            <FloatingMenuIcon $danger={item.danger} aria-hidden>
              {item.icon}
            </FloatingMenuIcon>
            <span>{item.label}</span>
          </FloatingMenuItem>
        ))}
      </FloatingMenuSurface>
    </FloatingMenuBackdrop>
  );
}
