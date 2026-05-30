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

It does not implement folder expand/collapse-on-click, rename, delete,
drag/drop, live file watching, ignored-file preferences, or a full IDE tree
model.

## Evidence

- `docs_v2/master-plan.md` says the Workbench can contain FileTree views for
  inspection, editing, verification, and direct work.
- `docs_v2/glossary.md` defines Workbench View as a visible non-Pane view such
  as FileTree View.
- `docs_v2/specs/desktop-product-shell-visual-foundation.md` says FileTree is a
  single independent right-side column attached to the active Thread's cwd.
- `src/desktop/application/domains/product-shell/product-shell-state.ts`
  currently creates FileTree entries from hard-coded Product Shell fixture data.
- `src/backend/application/ports/outbound/workspace-file-port.ts` already owns
  bounded workspace file access for Thread-root file tools.

## Decisions

### D1. FileTree View is Backend-owned Thread evidence

Desktop must not read the filesystem directly. Backend lists entries through
the workspace file port using the active Thread root and sends a bounded view
over Shared Contracts.

### D2. FileTree is a Workbench View, not a Workbench Pane

The FileTree View is delivered alongside Workbench Pane refs in
`workbench.changed`, but it is not inserted into the Pane tab list and does not
consume a `WorkbenchPaneId`.

### D3. Listing is bounded and root-scoped

Backend lists only paths inside the active Thread root. The first slice uses a
bounded depth and entry count, includes root-level directories as entries, and
does not descend into heavy vendor/build directories.

### D4. Desktop opens the column before refresh completes

When the user toggles FileTree open, Desktop opens the column immediately and
emits `workbench.command refresh_file_tree` for the active Thread. The column
renders an empty state until Backend returns a FileTree View.

### D5. File rows open Editor Panes through Backend

Clicking a FileTree file row emits `workbench.command open_editor` with the
entry `relativePath`.

Backend reuses the same Thread-root scoped file read path as `tide_open_file`
and opens or reveals a visible Editor Pane. Desktop does not read the file
directly.

## Contracts

Add to `src/shared/contracts/workbench.ts`:

- `WorkbenchFileTreeEntryDto`
- `WorkbenchFileTreeDto`

Add optional `fileTree?: WorkbenchFileTreeDto` to:

- `BackendEventPayloadByKind["workbench.changed"]`
- `BackendEventPayloadByKind["thread.hydrated"]`

No new BackendCommand kind is required. Use `workbench.command` with:

```json
{
  "threadId": "...",
  "command": "refresh_file_tree",
  "data": {
    "maxDepth": 2,
    "maxEntries": 160
  }
}
```

## Flow

### UC-1: Open FileTree for active Thread

1. User clicks the FileTree toggle.
2. Desktop opens the FileTree column.
3. Desktop emits `workbench.command refresh_file_tree` for the active Thread.
4. Backend resolves the active Thread root from the Thread scope.
5. Backend lists bounded file entries through `WorkspaceFilePort`.
6. Backend emits `workbench.changed` with Pane refs and `fileTree`.
7. Desktop renders the returned FileTree entries.

### UC-2: Hydrate Thread with existing FileTree View

1. User reopens a Thread whose Backend Workbench has a FileTree View snapshot.
2. Backend emits `thread.hydrated`.
3. Desktop preserves the FileTree View in Product Shell state.
4. When the FileTree column is open, it renders the stored entries.

### UC-3: Open FileTree file in Editor Pane

1. User selects a file row in the FileTree View.
2. Desktop emits `workbench.command open_editor` with the row relative path.
3. Backend resolves and reads the file inside the Thread root.
4. Backend creates or reveals an Editor Pane.
5. Desktop receives `workbench.changed` and renders the Editor Pane in the
   Workbench column.

## Invariants

1. Desktop FileTree entries come from Backend events or are empty.
2. FileTree listing never escapes the Thread root.
3. FileTree is never duplicated inside Workbench Pane content.
4. FileTree View does not create a Workbench Pane tab.
5. FileTree listing is bounded by depth and count.
6. File row open uses Backend file access, not Desktop filesystem access.

## Tests

| Rule | Test expectation |
|------|------------------|
| Shared Contract carries FileTree View | `Workbench FileTree View refs preserve root label entries and truncation` |
| Backend refreshes FileTree | `refresh_file_tree_workbench_command_lists_thread_root_entries` |
| Desktop toggles and requests refresh | `opening_file_tree_emits_refresh_workbench_command_for_active_thread` |
| Desktop renders Backend FileTree | `file_tree_renders_backend_entries_without_fixture_paths` |
| Backend opens Editor Pane from command | `opening_editor_from_workbench_command_reads_file_and_creates_editor_pane` |
| Desktop dispatches FileTree file row | `product_shell_file_tree_file_row_emits_open_editor_command` |

## Implementation Notes

- Extend `WorkspaceFilePort` with a bounded directory listing method.
- Keep the Node adapter responsible for filesystem traversal and sorting.
- Keep Product Shell state structural: it stores the latest `fileTree` payload
  and does not fabricate fixture entries.
