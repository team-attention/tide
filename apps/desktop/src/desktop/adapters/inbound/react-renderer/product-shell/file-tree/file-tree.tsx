import { memo } from "react";
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

// One tree row, memoized on its PRIMITIVE props. The file-tree view-model rebuilds
// every entry object whenever its slice recomputes (a folder expands, the active
// file changes, even an unrelated thread streams — selectFileTreeViewModel also
// depends on `threads`), and the list is not virtualized. Without this memo each
// such change re-rendered EVERY row's two lucide SVG icons on the main thread, so
// opening a file or expanding a folder in a real project visibly stuttered. With
// it, only the rows whose primitives actually changed re-render (file open → the
// 2 active rows; expand → just the new child rows; stream token → none). `onOpen`
// is the stable handler forwarding object, so it never breaks the memo.
const FileTreeRow = memo(function FileTreeRow(props: {
  id: string;
  name: string;
  kind: "file" | "folder";
  depth: number;
  active: boolean;
  expanded: boolean | undefined;
  onOpen: (id: string) => void;
}): ReactElement {
  const { id, name, kind, depth, active, expanded, onOpen } = props;
  const isFolder = kind === "folder";
  const RowIcon = isFolder ? (expanded === false ? Folder : FolderOpen) : fileIconFor(name);
  return (
    <button
      type="button"
      className={`file-tree-row${active ? " file-tree-row--active" : ""}`}
      data-depth={depth}
      data-file-kind={kind}
      data-expanded={isFolder ? String(expanded ?? true) : undefined}
      aria-expanded={isFolder ? (expanded ?? true) : undefined}
      style={{ "--file-tree-depth": depth } as CSSProperties}
      onClick={() => onOpen(id)}
    >
      {/* Folders show a disclosure chevron + open/closed folder icon; both are
          clickable to toggle. Files open in the editor. */}
      {isFolder ? (
        <ChevronRight
          size={12}
          strokeWidth={2}
          className={`file-tree-row__chevron${expanded === false ? "" : " file-tree-row__chevron--expanded"}`}
          aria-hidden
        />
      ) : (
        <span className="file-tree-row__chevron-spacer" aria-hidden />
      )}
      <RowIcon size={14} strokeWidth={1.8} aria-hidden />
      <span>{name}</span>
    </button>
  );
});

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
                const row = (
                  <FileTreeRow
                    key={entry.id}
                    id={entry.id}
                    name={entry.name}
                    kind={entry.kind}
                    depth={entry.depth}
                    active={entry.active === true}
                    expanded={entry.kind === "folder" ? entry.expanded : undefined}
                    onOpen={handlers.onFileTreeEntryOpen}
                  />
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
