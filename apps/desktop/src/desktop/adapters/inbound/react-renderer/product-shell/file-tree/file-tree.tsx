import type { CSSProperties, ReactElement } from "react";
import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { createColumnResizeHandle } from "../chrome/chrome.tsx";
import { ChevronRight, Folder, FolderOpen, Search } from "lucide-react";
import { fileIconFor } from "../../support/file-icons.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Shimmer rows shown while the active thread's file tree is (re)loading, so a thread
// switch shows motion instead of a blank/empty tree.
function createFileTreeSkeleton(): ReactElement {
  const widths = [82, 64, 73, 58, 70, 50, 66, 60];
  return (
    <div className="file-tree-skeleton" aria-hidden aria-label="Loading files">
      {widths.map((width, index) => (
        <div
          key={index}
          className="file-tree-skeleton__row"
          style={{ "--depth": index % 3 } as CSSProperties}
        >
          <span className="file-tree-skeleton__icon" />
          <span
            className="file-tree-skeleton__label"
            style={{ width: `${width}%` } as CSSProperties}
          />
        </div>
      ))}
    </div>
  );
}

// A single shimmer row shown under a folder while its children are lazily fetched
// (an expand round-trip is in flight), indented to sit where the children will land.
function createFileTreeLoadingRow(depth: number): ReactElement {
  return (
    <div
      key="__file-tree-loading__"
      className="file-tree-row file-tree-row--loading"
      data-depth={depth}
      style={{ "--file-tree-depth": depth } as CSSProperties}
      aria-hidden
    >
      <span className="file-tree-row__chevron-spacer" aria-hidden />
      <span className="file-tree-skeleton__icon" />
      <span className="file-tree-skeleton__label" style={{ width: "52%" } as CSSProperties} />
    </div>
  );
}

export function createFileTreeColumn(
  viewModel: Pick<ProductShellViewModel, "fileTree">,
  handlers: ProductShellHandlers,
): ReactElement {
  return (
    <aside className="file-tree-column" aria-label="FileTree" data-column="file-tree">
      {createColumnResizeHandle("fileTree", "left", handlers)}
      <header className="file-tree-column__top-row column-top-row" aria-label="FileTree Top Row">
        <div className="column-top-row__leading">
          <FolderOpen size={15} strokeWidth={1.9} aria-hidden />
          <span className="column-top-row__title">{viewModel.fileTree.cwdLabel}</span>
        </div>
        {/* Spacer; the FileTree toggle now lives in the fixed window cluster. */}
        <div className="column-top-row__trailing" />
      </header>
      <div className="file-tree-column__body">
        <label className="file-tree-column__search">
          <Search size={14} strokeWidth={1.9} aria-hidden />
          <span>Filter files...</span>
        </label>
        <div className="file-tree-column__entries">
          {viewModel.fileTree.loading
            ? createFileTreeSkeleton()
            : viewModel.fileTree.entries.flatMap((entry) => {
                const RowIcon =
                  entry.kind === "folder"
                    ? entry.expanded === false
                      ? Folder
                      : FolderOpen
                    : fileIconFor(entry.name);
                const row = (
                  <button
                    key={entry.id}
                    type="button"
                    className={`file-tree-row${entry.active ? " file-tree-row--active" : ""}`}
                    data-depth={entry.depth}
                    data-file-kind={entry.kind}
                    data-expanded={entry.kind === "folder" ? String(entry.expanded ?? true) : undefined}
                    aria-expanded={entry.kind === "folder" ? (entry.expanded ?? true) : undefined}
                    style={{ "--file-tree-depth": entry.depth } as CSSProperties}
                    onClick={() => handlers.onFileTreeEntryOpen(entry.id)}
                  >
                    {/* Folders show a disclosure chevron + open/closed folder icon; both
                        are clickable to toggle. Files open in the editor. */}
                    {entry.kind === "folder" ? (
                      <ChevronRight
                        size={12}
                        strokeWidth={2}
                        className={`file-tree-row__chevron${entry.expanded === false ? "" : " file-tree-row__chevron--expanded"}`}
                        aria-hidden
                      />
                    ) : (
                      <span className="file-tree-row__chevron-spacer" aria-hidden />
                    )}
                    <RowIcon size={14} strokeWidth={1.8} aria-hidden />
                    <span>{entry.name}</span>
                  </button>
                );
                // A lazily-expanding folder shows a skeleton child row until its children land.
                return entry.kind === "folder" &&
                  entry.relativePath === viewModel.fileTree.loadingFolderPath
                  ? [row, createFileTreeLoadingRow(entry.depth + 1)]
                  : [row];
              })}
        </div>
      </div>
    </aside>
  );
}
