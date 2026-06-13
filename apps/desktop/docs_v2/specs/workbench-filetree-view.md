# Spec: Workbench FileTree View

## Scope

This spec connects the right-side FileTree View to the active Thread's
Execution Context root.

It covers:

- Backend-owned bounded FileTree listing for a Thread root.
- A `refresh_file_tree` Workbench command.
- Shared Contract delivery of the FileTree View through `workbench.changed`.
- Desktop rendering of the latest Backend-provided FileTree View.
- Opening an Editor Pane from a FileTree file row through Backend.
- **Lazy per-folder loading**: a folder's children are fetched from Backend only
  when the folder is expanded, with a per-row skeleton while loading.

It does not implement rename, delete, drag/drop, live file watching,
ignored-file preferences, or a full IDE tree model.

## Evidence

- `docs_v2/master-plan.md` says the Workbench can contain FileTree views for
  inspection, editing, verification, and direct work.
- `docs_v2/glossary.md` defines Workbench View as a visible non-Pane view such
  as FileTree View.
- `docs_v2/specs/desktop-product-shell-visual-foundation.md` says FileTree is a
  single independent right-side column attached to the active Thread's cwd.
- `src/backend/application/ports/outbound/workspace-file-port.ts` already owns
  bounded workspace file access for Thread-root file tools.
- VSCode's file explorer (`explorerViewer.ts` `ExplorerDataSource`,
  `explorerModel.ts` `ExplorerItem.fetchChildren` →
  `fileService.resolve(resource, { resolveSingleChildDescendants })`) loads
  **one directory level on expand**, tracked by `_isDirectoryResolved`; it never
  eagerly walks the whole tree and has no per-folder cap. Heavy dirs are a
  cosmetic `files.exclude` filter, not a performance safety ceiling.

## Decisions

### D1. FileTree View is Backend-owned Thread evidence

Desktop must not read the filesystem directly. Backend lists entries through
the workspace file port using the active Thread root and sends a bounded view
over Shared Contracts.

### D2. FileTree is a Workbench View, not a Workbench Pane

The FileTree View is delivered alongside Workbench Pane refs in
`workbench.changed`, but it is not inserted into the Pane tab list and does not
consume a `WorkbenchPaneId`.

### D3. Listing is lazy per-folder, driven by the expanded set

Backend lists only paths inside the active Thread root. A listing always
includes the root's immediate children; it descends into a folder **only when
that folder's relative path is in the request's `expandedPaths`** (recursively).
A collapsed folder is listed as a single entry and is never descended into, so a
giant machine directory (a pnpm store, a Python `.venv`) the user has not
expanded costs exactly one entry and never starves the rest of the tree.

This replaces the previous eager full-load (depth 12 / 4000 entries in one
call). That walk was depth-first under a fixed budget, so a single un-excluded
huge directory that sorted early consumed the whole budget and truncated the
walk before the real source — the tree then showed only the few dirs visited
before the blowout. Lazy descent removes the budget-starvation failure mode at
the source: there is no eager whole-tree walk to starve.

`maxEntries` remains a safety ceiling for a single pathological expanded folder.
A separate **full** listing mode (depth-bounded, no `expandedPaths`) is retained
only for Quick Open (Cmd+P), which needs every file for fuzzy search.

### D4. Desktop opens the column before refresh completes

When the user toggles FileTree open, Desktop opens the column immediately and
emits `workbench.command refresh_file_tree` (root level, empty `expandedPaths`)
for the active Thread. The column renders a skeleton until Backend returns a
FileTree View.

### D5. File rows open Editor Panes through Backend

Clicking a FileTree file row emits `workbench.command open_editor` with the
entry `relativePath`. Backend reuses the same Thread-root scoped file read path
as `tide_open_file` and opens or reveals a visible Editor Pane. Desktop does not
read the file directly.

### D6. Lazy expand with client-side reveal cache and a per-row skeleton

Folders are collapsed by default: an entry is visible only when every ancestor
folder on its path is expanded.

Expanding a folder:

- If its children are **already present** in the loaded entries (a re-expand
  after a collapse, or after a full Quick Open load) → reveal them client-side
  with no Backend round-trip.
- Otherwise → mark the folder loading (Desktop renders a skeleton child row
  under it) and dispatch a refresh carrying the new `expandedPaths`. Backend
  returns the snapshot of the root plus every expanded subtree, which replaces
  the loaded entries (a superset, so no previously loaded folder is lost).

Collapsing a folder hides its descendants client-side with no Backend round-trip
and keeps them in the loaded entries as a best-effort cache.

### D7. FileTree does not consult `.gitignore`; only heavy machine dirs are hidden

The FileTree (and Cmd+Shift+F content search) **no longer consult `.gitignore`**
(the matcher was removed in 0.1.46): gitignored/hidden files (`.env`, `.claude/`,
dotfiles) are listed and searchable so config/env/scratch files are reachable.
The only exclusion is a fixed set of heavy vendor/build/VCS/cache directories,
which are neither listed nor descended into. The set must span every ecosystem's
machine dirs (`node_modules dist build out target coverage .next .git .svn .hg
.pnpm-store .yarn .turbo .gradle .venv venv __pycache__ .mypy_cache .pytest_cache
.ruff_cache .cache`), because under lazy descent it is still the thing that keeps
an expanded parent from listing tens of thousands of vendor children, and it
keeps the cosmetic clutter out. It is a declutter filter, not the perf ceiling
(lazy descent is).

## Contracts

`WorkbenchFileTreeEntryDto` / `WorkbenchFileTreeDto` (in
`src/shared/contracts/workbench.ts`) and the optional `fileTree` on
`workbench.changed` / `thread.hydrated` are unchanged.

`workbench.command refresh_file_tree` `data` carries the expanded set for a lazy
listing, or `maxDepth` for the Quick Open full listing:

```json
{ "threadId": "...", "command": "refresh_file_tree",
  "data": { "expandedPaths": ["src", "src/app"], "maxEntries": 4000 } }
```

```json
{ "threadId": "...", "command": "refresh_file_tree",
  "data": { "maxDepth": 12, "maxEntries": 5000 } }
```

The start-page query `workspace.readFileTree` (`{ cwd, expandedPaths?,
maxEntries? }` → `workspace.fileTreeLoaded`) takes the same `expandedPaths`.

`WorkspaceFilePort.listTree` input becomes
`{ root; maxEntries; expandedPaths?; maxDepth? }`: with `expandedPaths` it
descends only into expanded folders; with `maxDepth` (and no `expandedPaths`) it
does the bounded full walk for Quick Open.

Desktop Product Shell state gains `fileTree.loadingFolderPath?: string | null`
(state-only, not a contract field) to drive the per-row skeleton.

## Flow

### UC-1: Open FileTree for active Thread

1. User clicks the FileTree toggle.
2. Desktop opens the FileTree column and shows a skeleton.
3. Desktop emits `refresh_file_tree` with `expandedPaths: []` (root level).
4. Backend resolves the active Thread root and lists the root's children.
5. Backend emits `workbench.changed` with Pane refs and `fileTree`.
6. Desktop renders the root entries (folders collapsed).

### UC-1b: Expand a folder (lazy)

1. User clicks a collapsed folder row whose children are not yet loaded.
2. Desktop marks the folder loading (skeleton child row) and emits
   `refresh_file_tree` with the updated `expandedPaths`.
3. Backend lists the root plus every expanded subtree.
4. Backend emits `workbench.changed` with `fileTree`.
5. Desktop replaces the entries, clears the loading mark, and reveals children.

Re-expanding a previously loaded folder reveals it client-side with no command.

### UC-2: Hydrate Thread with existing FileTree View

1. User reopens a Thread whose Backend Workbench has a FileTree View snapshot.
2. Backend emits `thread.hydrated`; Desktop preserves the FileTree View.
3. When the FileTree column is open, it renders the stored entries.

### UC-3: Open FileTree file in Editor Pane

1. User selects a file row in the FileTree View.
2. Desktop emits `workbench.command open_editor` with the row relative path.
3. Backend resolves and reads the file inside the Thread root.
4. Backend creates or reveals an Editor Pane.
5. Desktop renders the Editor Pane in the Workbench column.

## Invariants

1. Desktop FileTree entries come from Backend events or are empty.
2. FileTree listing never escapes the Thread root.
3. FileTree is never duplicated inside Workbench Pane content.
4. FileTree View does not create a Workbench Pane tab.
5. A folder is descended into only when it is in the request `expandedPaths`
   (lazy mode); a collapsed folder costs one entry and is never walked.
6. File row open uses Backend file access, not Desktop filesystem access.
7. Folders are collapsed by default; a descendant is visible only when every
   ancestor folder is expanded. Collapsing, and re-expanding an already-loaded
   folder, emit no Backend command.
8. FileTree listing never returns entries inside the fixed heavy-dir set; it does
   NOT otherwise consult `.gitignore` (gitignored/hidden files are listed).

## Tests

| Rule | Test expectation |
|------|------------------|
| Lazy descent only into expanded folders | `file_tree_listing_descends_only_into_expanded_paths` |
| Collapsed heavy/huge dir costs one entry, never starves siblings | `file_tree_listing_is_not_starved_by_a_huge_heavy_dir_that_sorts_first` |
| Gitignored files shown, heavy dirs hidden | `file_tree_listing_shows_gitignored_files_but_still_hides_heavy_dirs` |
| Quick Open full mode still walks deep | `file_tree_full_listing_walks_to_max_depth_for_quick_open` |
| Expanding an unloaded folder emits a refresh with the new expanded set | `expanding_unloaded_folder_emits_refresh_with_expanded_paths` |
| Re-expanding a loaded folder reveals client-side with no command | `re_expanding_loaded_folder_does_not_emit_a_command` |
| Collapsing a folder emits no command | `collapsing_folder_does_not_emit_a_command` |
| Backend opens Editor Pane from command | `opening_editor_from_workbench_command_reads_file_and_creates_editor_pane` |

## Implementation Notes

- `listTree` descends conditionally on `expandedPaths`; keep the Node adapter
  responsible for filesystem traversal, sorting, and the heavy-dir exclusion.
- Keep Product Shell state structural: it stores the latest `fileTree` payload
  plus `expandedFolderPaths` / `loadingFolderPath`; the folder-toggle reducer
  decides reveal-from-cache vs dispatch-refresh.
- `workspace.fileTreeLoaded` must reset `expandedFolderPaths` only when the cwd
  changes (a new project), not on an expand-driven re-list of the same cwd.
- Quick Open keeps the depth-bounded full listing (no `expandedPaths`); the
  heavy-dir exclusion keeps it bounded.
</content>
</invoke>
