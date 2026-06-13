import { createElement } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { createColumnResizeHandle } from "../chrome/chrome.ts";
import { ChevronRight, Folder, FolderOpen, Search } from "lucide-react";
import { fileIconFor } from "../../support/file-icons.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Shimmer rows shown while the active thread's file tree is (re)loading, so a thread
// switch shows motion instead of a blank/empty tree.
function createFileTreeSkeleton(): ReactElement {
  const widths = [82, 64, 73, 58, 70, 50, 66, 60];
  return createElement(
    "div",
    { className: "file-tree-skeleton", "aria-hidden": true, "aria-label": "Loading files" },
    ...widths.map((width, index) =>
      createElement(
        "div",
        { key: index, className: "file-tree-skeleton__row", style: { "--depth": index % 3 } as CSSProperties },
        createElement("span", { className: "file-tree-skeleton__icon" }),
        createElement("span", { className: "file-tree-skeleton__label", style: { width: `${width}%` } as CSSProperties }),
      ),
    ),
  );
}

export function createFileTreeColumn(
  viewModel: Pick<ProductShellViewModel, "fileTree">,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "aside",
    { className: "file-tree-column", "aria-label": "FileTree", "data-column": "file-tree" },
    createColumnResizeHandle("fileTree", "left", handlers),
    createElement(
      "header",
      { className: "file-tree-column__top-row column-top-row", "aria-label": "FileTree Top Row" },
      createElement(
        "div",
        { className: "column-top-row__leading" },
        createElement(FolderOpen, { size: 15, strokeWidth: 1.9, "aria-hidden": true }),
        createElement("span", { className: "column-top-row__title" }, viewModel.fileTree.cwdLabel),
      ),
      // Spacer; the FileTree toggle now lives in the fixed window cluster.
      createElement("div", { className: "column-top-row__trailing" }),
    ),
    createElement(
      "div",
      { className: "file-tree-column__body" },
      createElement(
        "label",
        { className: "file-tree-column__search" },
        createElement(Search, { size: 14, strokeWidth: 1.9, "aria-hidden": true }),
        createElement("span", null, "Filter files..."),
      ),
      createElement(
        "div",
        { className: "file-tree-column__entries" },
        viewModel.fileTree.loading
          ? createFileTreeSkeleton()
          : viewModel.fileTree.entries.map((entry) =>
          createElement(
            "button",
            {
              key: entry.id,
              type: "button",
              className: `file-tree-row${entry.active ? " file-tree-row--active" : ""}`,
              "data-depth": entry.depth,
              "data-file-kind": entry.kind,
              "data-expanded": entry.kind === "folder" ? String(entry.expanded ?? true) : undefined,
              "aria-expanded": entry.kind === "folder" ? (entry.expanded ?? true) : undefined,
              style: { "--file-tree-depth": entry.depth } as CSSProperties,
              onClick: () => handlers.onFileTreeEntryOpen(entry.id),
            },
            // Folders show a disclosure chevron + open/closed folder icon; both
            // are clickable to toggle. Files open in the editor.
            entry.kind === "folder"
              ? createElement(ChevronRight, {
                  size: 12,
                  strokeWidth: 2,
                  className: `file-tree-row__chevron${entry.expanded === false ? "" : " file-tree-row__chevron--expanded"}`,
                  "aria-hidden": true,
                })
              : createElement("span", { className: "file-tree-row__chevron-spacer", "aria-hidden": true }),
            entry.kind === "folder"
              ? createElement(entry.expanded === false ? Folder : FolderOpen, { size: 14, strokeWidth: 1.8, "aria-hidden": true })
              : createElement(fileIconFor(entry.name), { size: 14, strokeWidth: 1.8, "aria-hidden": true }),
            createElement("span", null, entry.name),
          ),
        ),
      ),
    ),
  );
}
