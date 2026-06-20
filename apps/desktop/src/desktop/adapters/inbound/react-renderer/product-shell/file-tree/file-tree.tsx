import { memo, useMemo, useState } from "react";
import type { CSSProperties, DragEvent, ReactElement } from "react";
import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellFileTreeMenu, ProductShellTreeEdit } from "../../../../../application/domains/product-shell/product-shell.ts";
import { relativeBaseName } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { createColumnResizeHandle } from "../chrome/chrome.tsx";
import { createFileTreeContextMenuOverlay } from "./file-tree-context-menu.tsx";
import { ChevronRight, FilePlus, Folder, FolderOpen, FolderPlus, Search, X } from "lucide-react";
import { fileIconFor } from "../../support/file-icons.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure); file
// operations (toolbar / context menu / inline edits / drag-move) added per
// workbench-filetree-file-operations.

// The bundle of FileTree state the column renders: the tree view plus the transient
// inline-edit / context-menu / error-notice state.
export interface FileTreeColumnViewModel {
  fileTree: ProductShellViewModel["fileTree"];
  fileTreeEdit: ProductShellTreeEdit | null;
  fileTreeMenu: ProductShellFileTreeMenu | null;
  fileTreeNotice: string | null;
}

type FileTreeEntryView = ProductShellViewModel["fileTree"]["entries"][number];

export function filterFileTreeEntries(
  entries: FileTreeEntryView[],
  filterDraft: string,
): FileTreeEntryView[] {
  const normalizedFilter = filterDraft.trim().toLowerCase();
  if (normalizedFilter.length === 0) {
    return entries;
  }
  const visiblePaths = new Set<string>();
  for (const entry of entries) {
    const relativePath = entry?.relativePath;
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      continue;
    }
    if (!relativePath.toLowerCase().includes(normalizedFilter)) {
      continue;
    }
    const parts = relativePath.split("/");
    for (let index = 1; index <= parts.length; index++) {
      visiblePaths.add(parts.slice(0, index).join("/"));
    }
  }
  return entries.filter((entry) => {
    const relativePath = entry?.relativePath;
    return typeof relativePath === "string" && visiblePaths.has(relativePath);
  });
}

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

// One tree row, memoized on its PRIMITIVE props (see the long note below). `handlers`
// and `setDragOverPath` are stable, so they never break the memo; only the rows whose
// primitives actually changed re-render (file open → the 2 active rows; expand → the
// new child rows; a drag-over → the 2 folders whose highlight flips).
//
// The file-tree view-model rebuilds every entry object whenever its slice recomputes
// (a folder expands, the active file changes, even an unrelated thread streams), and
// the list is not virtualized — without this memo each change re-rendered EVERY row's
// two lucide SVG icons on the main thread, so the tree visibly stuttered.
const FileTreeRow = memo(function FileTreeRow(props: {
  id: string;
  name: string;
  kind: "file" | "folder";
  depth: number;
  active: boolean;
  expanded: boolean | undefined;
  relativePath: string;
  isDragOver: boolean;
  handlers: ProductShellHandlers;
  setDragOverPath: (path: string | null) => void;
}): ReactElement {
  const { id, name, kind, depth, active, expanded, relativePath, isDragOver, handlers, setDragOverPath } = props;
  const isFolder = kind === "folder";
  const RowIcon = isFolder ? (expanded === false ? Folder : FolderOpen) : fileIconFor(name);
  return (
    <button
      type="button"
      className={`file-tree-row${active ? " file-tree-row--active" : ""}`}
      data-depth={depth}
      data-file-kind={kind}
      data-expanded={isFolder ? String(expanded ?? true) : undefined}
      data-drag-over={isFolder && isDragOver ? "true" : undefined}
      aria-expanded={isFolder ? (expanded ?? true) : undefined}
      style={{ "--file-tree-depth": depth } as CSSProperties}
      draggable
      onClick={() => handlers.onFileTreeEntryOpen(id)}
      onContextMenu={(event) => {
        event.preventDefault();
        handlers.onFileTreeMenuOpen({
          x: event.clientX,
          y: event.clientY,
          relativePath,
          kind: isFolder ? "folder" : "file",
        });
      }}
      onDragStart={(event: DragEvent) => {
        event.dataTransfer.setData("text/tide-path", relativePath);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={
        isFolder
          ? (event: DragEvent) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverPath(relativePath);
            }
          : undefined
      }
      onDragLeave={
        isFolder
          ? () => {
              // Only clear OUR highlight: dragging A→B fires A's dragleave after B's
              // dragover, so an unguarded clear would wipe B's just-set highlight.
              if (isDragOver) {
                setDragOverPath(null);
              }
            }
          : undefined
      }
      onDrop={
        isFolder
          ? (event: DragEvent) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOverPath(null);
              const from = event.dataTransfer.getData("text/tide-path");
              if (from.length > 0) {
                handlers.onFileTreeMove(from, `${relativePath}/${relativeBaseName(from)}`);
              }
            }
          : undefined
      }
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

// The inline name input shown in place of a row (rename) or as a new child row
// (new folder). Controlled by fileTreeEdit.draft in shell state.
function FileTreeInlineInput(props: {
  depth: number;
  draft: string;
  placeholder: string;
  handlers: ProductShellHandlers;
}): ReactElement {
  return (
    <div
      className="file-tree-row file-tree-row--editing"
      data-depth={props.depth}
      style={{ "--file-tree-depth": props.depth } as CSSProperties}
    >
      <span className="file-tree-row__chevron-spacer" aria-hidden />
      <input
        className="file-tree-inline-input"
        autoFocus
        spellCheck={false}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        value={props.draft}
        onChange={(event) => props.handlers.onTreeEditDraftChange(event.currentTarget.value)}
        onBlur={() => props.handlers.onTreeEditConfirm()}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            props.handlers.onTreeEditConfirm();
          } else if (event.key === "Escape") {
            event.preventDefault();
            props.handlers.onTreeEditCancel();
          }
        }}
      />
    </div>
  );
}

export function createFileTreeColumn(
  viewModel: FileTreeColumnViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  return <FileTreeColumn viewModel={viewModel} handlers={handlers} />;
}

function FileTreeColumn(props: {
  viewModel: FileTreeColumnViewModel;
  handlers: ProductShellHandlers;
}): ReactElement {
  const { viewModel, handlers } = props;
  const { fileTree, fileTreeEdit, fileTreeMenu, fileTreeNotice } = viewModel;
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [filterDraft, setFilterDraft] = useState("");

  const renamingPath =
    fileTreeEdit?.kind === "rename" ? fileTreeEdit.targetPath : undefined;
  const newFolderParent =
    fileTreeEdit?.kind === "new-folder" ? fileTreeEdit.parentPath : undefined;
  const filterActive = filterDraft.trim().length > 0;
  const entriesForView = useMemo(
    () => filterFileTreeEntries(fileTree.entries, filterDraft),
    [fileTree.entries, filterDraft],
  );

  return (
    <aside className="file-tree-column" aria-label="FileTree" data-column="file-tree">
      {createColumnResizeHandle("fileTree", "left", handlers)}
      <header className="file-tree-column__top-row column-top-row" aria-label="FileTree Top Row">
        <div className="column-top-row__leading">
          <FolderOpen size={15} strokeWidth={1.9} aria-hidden />
          <span className="column-top-row__title">{fileTree.cwdLabel}</span>
        </div>
        <div className="column-top-row__trailing file-tree-toolbar">
          <button
            type="button"
            className="file-tree-toolbar__button"
            title="New File"
            aria-label="New File"
            onClick={() => handlers.onNewUntitledFile()}
          >
            <FilePlus size={14} strokeWidth={1.9} aria-hidden />
          </button>
          <button
            type="button"
            className="file-tree-toolbar__button"
            title="New Folder"
            aria-label="New Folder"
            onClick={() => handlers.onFileTreeNewFolder("")}
          >
            <FolderPlus size={14} strokeWidth={1.9} aria-hidden />
          </button>
        </div>
      </header>
      {fileTreeNotice !== null ? (
        <div className="file-tree-notice" role="alert">
          <span>{fileTreeNotice}</span>
          <button
            type="button"
            className="file-tree-notice__dismiss"
            aria-label="Dismiss"
            onClick={() => handlers.onFileTreeNoticeClear()}
          >
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : null}
      <div className="file-tree-column__body">
        <label className="file-tree-column__search">
          <Search size={14} strokeWidth={1.9} aria-hidden />
          <input
            className="file-tree-column__search-input"
            aria-label="Filter files"
            placeholder="Filter files..."
            spellCheck={false}
            value={filterDraft}
            onChange={(event) => setFilterDraft(event.currentTarget.value)}
          />
          {filterDraft.length > 0 ? (
            <button
              type="button"
              className="file-tree-column__search-clear"
              title="Clear filter"
              aria-label="Clear file filter"
              onClick={() => setFilterDraft("")}
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </button>
          ) : null}
        </label>
        {/* The entries container is the root drop target: dropping here (not on a
            folder) moves an item to the workspace root. */}
        <div
          className="file-tree-column__entries"
          onDragOver={(event: DragEvent) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event: DragEvent) => {
            const from = event.dataTransfer.getData("text/tide-path");
            setDragOverPath(null);
            if (from.length > 0 && from.includes("/")) {
              handlers.onFileTreeMove(from, relativeBaseName(from));
            }
          }}
        >
          {fileTree.loading
            ? createFileTreeSkeleton()
            : [
                // Root-level "New Folder" input.
                ...(newFolderParent === ""
                  ? [
                      <FileTreeInlineInput
                        key="__new-folder-root__"
                        depth={0}
                        draft={fileTreeEdit?.draft ?? ""}
                        placeholder="folder name"
                        handlers={handlers}
                      />,
                    ]
                  : []),
                ...entriesForView.flatMap((entry) => {
                  const rows: ReactElement[] =
                    renamingPath === entry.relativePath
                      ? [
                          <FileTreeInlineInput
                            key={entry.id}
                            depth={entry.depth}
                            draft={fileTreeEdit?.draft ?? ""}
                            placeholder="new name"
                            handlers={handlers}
                          />,
                        ]
                      : [
                          <FileTreeRow
                            key={entry.id}
                            id={entry.id}
                            name={entry.name}
                            kind={entry.kind}
                            depth={entry.depth}
                            active={entry.active === true}
                            expanded={entry.kind === "folder" ? entry.expanded : undefined}
                            relativePath={entry.relativePath}
                            isDragOver={dragOverPath === entry.relativePath}
                            handlers={handlers}
                            setDragOverPath={setDragOverPath}
                          />,
                        ];
                  // A lazily-expanding folder shows a skeleton child row until its children land.
                  if (
                    entry.kind === "folder" &&
                    entry.relativePath === fileTree.loadingFolderPath
                  ) {
                    rows.push(createFileTreeLoadingRow(entry.depth + 1));
                  }
                  // A "New Folder" input nested under this folder.
                  if (newFolderParent === entry.relativePath) {
                    rows.push(
                      <FileTreeInlineInput
                        key={`__new-folder-${entry.relativePath}__`}
                        depth={entry.depth + 1}
                        draft={fileTreeEdit?.draft ?? ""}
                        placeholder="folder name"
                        handlers={handlers}
                      />,
                    );
                  }
                  return rows;
                }),
                ...(filterActive && entriesForView.length === 0
                  ? [
                      <div key="__file-tree-filter-empty__" className="file-tree-column__empty">
                        No matching files
                      </div>,
                    ]
                  : []),
              ]}
        </div>
      </div>
      {fileTreeMenu !== null ? createFileTreeContextMenuOverlay(fileTreeMenu, handlers) : null}
    </aside>
  );
}
