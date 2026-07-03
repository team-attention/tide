import { memo, useMemo, useState } from "react";
import type { CSSProperties, DragEvent, ReactElement } from "react";
import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellFileTreeMenu, ProductShellTreeEdit } from "../../../../../application/domains/product-shell/product-shell.ts";
import { relativeBaseName } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { GitChangeStatus, GitChangesView, ProductShellHandlers } from "../support/types.ts";
import { createColumnResizeHandle } from "../chrome/chrome.tsx";
import { createFileTreeContextMenuOverlay } from "./file-tree-context-menu.tsx";
import { filterFileTreeEntries } from "./file-tree-filter.ts";
import { createGitAwareEntries, gitStatusTitle } from "./git-status.ts";
import { FilePlus, Folder, FolderOpen, FolderPlus, Search, X } from "lucide-react";
import { fileIconFor } from "../../support/file-icons.ts";
import { ColumnTopRowLeading, ColumnTopRowTitle } from "../support/column-top-row.parts.tsx";
import {
  FileTreeBody,
  FileTreeChevron,
  FileTreeChevronSpacer,
  FileTreeColumnFrame,
  FileTreeEditingRow,
  FileTreeEmpty,
  FileTreeEntries,
  FileTreeGitDot,
  FileTreeInlineInputField,
  FileTreeLoadingRow,
  FileTreeNotice,
  FileTreeNoticeDismiss,
  FileTreeRowButton,
  FileTreeRowName,
  FileTreeSearch,
  FileTreeSearchClear,
  FileTreeSearchInput,
  FileTreeSkeleton,
  FileTreeSkeletonIcon,
  FileTreeSkeletonLabel,
  FileTreeSkeletonRow,
  FileTreeToolbar,
  FileTreeToolbarButton,
  FileTreeTopRow,
} from "./file-tree.parts.tsx";
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
  gitChanges: GitChangesView | null;
}

export { filterFileTreeEntries } from "./file-tree-filter.ts";

// Shimmer rows shown while the active thread's file tree is (re)loading, so a thread
// switch shows motion instead of a blank/empty tree.
function createFileTreeSkeleton(): ReactElement {
  const widths = [82, 64, 73, 58, 70, 50, 66, 60];
  return (
    <FileTreeSkeleton aria-hidden aria-label="Loading files" data-file-tree-skeleton>
      {widths.map((width, index) => (
        <FileTreeSkeletonRow
          key={index}
          style={{ "--depth": index % 3 } as CSSProperties}
        >
          <FileTreeSkeletonIcon />
          <FileTreeSkeletonLabel
            style={{ width: `${width}%` } as CSSProperties}
          />
        </FileTreeSkeletonRow>
      ))}
    </FileTreeSkeleton>
  );
}

// A single shimmer row shown under a folder while its children are lazily fetched
// (an expand round-trip is in flight), indented to sit where the children will land.
function createFileTreeLoadingRow(depth: number): ReactElement {
  return (
    <FileTreeLoadingRow
      key="__file-tree-loading__"
      data-depth={depth}
      data-file-tree-loading-row
      style={{ "--file-tree-depth": depth } as CSSProperties}
      aria-hidden
    >
      <FileTreeChevronSpacer aria-hidden />
      <FileTreeSkeletonIcon />
      <FileTreeSkeletonLabel style={{ width: "52%" } as CSSProperties} />
    </FileTreeLoadingRow>
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
  gitStatus: GitChangeStatus | undefined;
  gitDescendantCount: number | undefined;
  gitDescendantStatus: GitChangeStatus | undefined;
  syntheticDeleted: boolean | undefined;
  gitRoot: string | undefined;
  handlers: ProductShellHandlers;
  setDragOverPath: (path: string | null) => void;
}): ReactElement {
  const {
    id,
    name,
    kind,
    depth,
    active,
    expanded,
    relativePath,
    isDragOver,
    gitStatus,
    gitDescendantCount,
    gitDescendantStatus,
    syntheticDeleted,
    gitRoot,
    handlers,
    setDragOverPath,
  } = props;
  const isFolder = kind === "folder";
  // Files carry their own status; folders inherit the dominant status of their
  // changed descendants. Either way the row is colored, never numbered.
  const gitStatusForRow = gitStatus ?? gitDescendantStatus;
  const hasDescendantCount =
    isFolder && gitDescendantCount !== undefined && gitDescendantCount > 0;
  const gitStatusHint =
    gitStatusForRow === undefined
      ? undefined
      : hasDescendantCount
        ? `${gitDescendantCount} changed files`
        : gitStatusTitle(gitStatusForRow);
  const RowIcon = isFolder ? (expanded === false ? Folder : FolderOpen) : fileIconFor(name);
  const openRow = () => {
    if (syntheticDeleted === true) {
      handlers.onOpenChanges(gitRoot);
      return;
    }
    handlers.onFileTreeEntryOpen(id);
  };
  return (
    <FileTreeRowButton
      type="button"
      $active={active}
      $syntheticDeleted={syntheticDeleted === true}
      data-depth={depth}
      data-file-kind={kind}
      data-expanded={isFolder ? String(expanded ?? true) : undefined}
      data-active={active ? "true" : undefined}
      data-synthetic-deleted={syntheticDeleted === true ? "true" : undefined}
      data-drag-over={isFolder && isDragOver ? "true" : undefined}
      data-git-status={gitStatusForRow}
      aria-expanded={isFolder ? (expanded ?? true) : undefined}
      style={{ "--file-tree-depth": depth } as CSSProperties}
      draggable={syntheticDeleted !== true}
      title={syntheticDeleted === true ? `Open ${relativePath} in Changes` : relativePath}
      onClick={openRow}
      onContextMenu={(event) => {
        event.preventDefault();
        if (syntheticDeleted === true) {
          handlers.onOpenChanges(gitRoot);
          return;
        }
        handlers.onFileTreeMenuOpen({
          x: event.clientX,
          y: event.clientY,
          relativePath,
          kind: isFolder ? "folder" : "file",
        });
      }}
      onDragStart={(event: DragEvent) => {
        if (syntheticDeleted === true) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData("text/tide-path", relativePath);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={
        isFolder && syntheticDeleted !== true
          ? (event: DragEvent) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverPath(relativePath);
            }
          : undefined
      }
      onDragLeave={
        isFolder && syntheticDeleted !== true
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
        isFolder && syntheticDeleted !== true
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
        <FileTreeChevron
          size={12}
          strokeWidth={2}
          $expanded={expanded !== false}
          aria-hidden
        />
      ) : (
        <FileTreeChevronSpacer aria-hidden />
      )}
      <RowIcon size={14} strokeWidth={1.8} aria-hidden />
      <FileTreeRowName>{name}</FileTreeRowName>
      {gitStatusForRow !== undefined ? (
        <FileTreeGitDot
          $status={gitStatusForRow}
          title={gitStatusHint}
          aria-label={gitStatusHint}
          role="img"
        />
      ) : null}
    </FileTreeRowButton>
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
    <FileTreeEditingRow
      data-depth={props.depth}
      style={{ "--file-tree-depth": props.depth } as CSSProperties}
    >
      <FileTreeChevronSpacer aria-hidden />
      <FileTreeInlineInputField
        data-file-tree-inline-input
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
    </FileTreeEditingRow>
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
  const { fileTree, fileTreeEdit, fileTreeMenu, fileTreeNotice, gitChanges } = viewModel;
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [filterDraft, setFilterDraft] = useState("");

  const renamingPath =
    fileTreeEdit?.kind === "rename" ? fileTreeEdit.targetPath : undefined;
  const newFolderParent =
    fileTreeEdit?.kind === "new-folder" ? fileTreeEdit.parentPath : undefined;
  const filterActive = filterDraft.trim().length > 0;
  const gitAwareEntries = useMemo(
    () => createGitAwareEntries(fileTree.entries, fileTree.root, gitChanges),
    [fileTree.entries, fileTree.root, gitChanges],
  );
  const entriesForView = useMemo(
    () => filterFileTreeEntries(gitAwareEntries, filterDraft),
    [gitAwareEntries, filterDraft],
  );

  return (
    <FileTreeColumnFrame aria-label="FileTree" data-column="file-tree">
      {createColumnResizeHandle("fileTree", "left", handlers)}
      <FileTreeTopRow aria-label="FileTree Top Row">
        <ColumnTopRowLeading>
          <FolderOpen size={15} strokeWidth={1.9} aria-hidden />
          <ColumnTopRowTitle>{fileTree.cwdLabel}</ColumnTopRowTitle>
        </ColumnTopRowLeading>
        <FileTreeToolbar>
          <FileTreeToolbarButton
            type="button"
            title="New File"
            aria-label="New File"
            onClick={() => handlers.onNewUntitledFile()}
          >
            <FilePlus size={14} strokeWidth={1.9} aria-hidden />
          </FileTreeToolbarButton>
          <FileTreeToolbarButton
            type="button"
            title="New Folder"
            aria-label="New Folder"
            onClick={() => handlers.onFileTreeNewFolder("")}
          >
            <FolderPlus size={14} strokeWidth={1.9} aria-hidden />
          </FileTreeToolbarButton>
        </FileTreeToolbar>
      </FileTreeTopRow>
      {fileTreeNotice !== null ? (
        <FileTreeNotice role="alert">
          <span>{fileTreeNotice}</span>
          <FileTreeNoticeDismiss
            type="button"
            aria-label="Dismiss"
            onClick={() => handlers.onFileTreeNoticeClear()}
          >
            <X size={12} strokeWidth={2} aria-hidden />
          </FileTreeNoticeDismiss>
        </FileTreeNotice>
      ) : null}
      <FileTreeBody>
        <FileTreeSearch>
          <Search size={14} strokeWidth={1.9} aria-hidden />
          <FileTreeSearchInput
            aria-label="Filter files"
            placeholder="Filter files..."
            spellCheck={false}
            value={filterDraft}
            onChange={(event) => setFilterDraft(event.currentTarget.value)}
          />
          {filterDraft.length > 0 ? (
            <FileTreeSearchClear
              type="button"
              title="Clear filter"
              aria-label="Clear file filter"
              onClick={() => setFilterDraft("")}
            >
              <X size={12} strokeWidth={2} aria-hidden />
            </FileTreeSearchClear>
          ) : null}
        </FileTreeSearch>
        {/* The entries container is the root drop target: dropping here (not on a
            folder) moves an item to the workspace root. */}
        <FileTreeEntries
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
                            gitStatus={entry.gitStatus}
                            gitDescendantCount={entry.gitDescendantCount}
                            gitDescendantStatus={entry.gitDescendantStatus}
                            syntheticDeleted={entry.syntheticDeleted}
                            gitRoot={fileTree.root}
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
                      <FileTreeEmpty key="__file-tree-filter-empty__">
                        No matching files
                      </FileTreeEmpty>,
                    ]
                  : []),
              ]}
        </FileTreeEntries>
      </FileTreeBody>
      {fileTreeMenu !== null ? createFileTreeContextMenuOverlay(fileTreeMenu, handlers) : null}
    </FileTreeColumnFrame>
  );
}
