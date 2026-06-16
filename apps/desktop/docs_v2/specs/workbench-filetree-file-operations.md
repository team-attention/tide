# Spec: FileTree file operations + VSCode-style New File (untitled → save-as)

## Scope
Turn the read-only FileTree into a real file manager and replace the awkward
"type a full path" New File with a VSCode-style untitled flow:

1. **New File** (FileTree toolbar + row context menu + Workbench launcher): opens a
   **blank untitled editor immediately**; the name/location is chosen **on save**
   (Save As). No up-front path typing.
2. **New Folder** — inline name input at the target folder.
3. **Rename** — inline name input in place of the row's label.
4. **Delete** — confirm dialog → move to the **OS Trash** (recoverable).
5. **Move via drag-and-drop** — drag a file/folder row onto a folder (or the root)
   to move it there.

All operations work both inside a thread and on the start (New Thread) page (which
shows the composer project's tree), since both already expose an absolute root.

## Evidence
- FileTree (`file-tree/file-tree.tsx`) is read-only: folder rows toggle, file rows
  open. No context menu, toolbar, or inline inputs.
- New File today lives ONLY in the Workbench launcher (`workbench/launcher-pane.tsx`)
  as an inline input where the user types the whole relative path; it routes to
  `newProductShellFile(path)` → `workspace.readFile {create:true}` (start) /
  `open_editor {create:true}` (thread). The user finds this UX bad and wants
  blank-then-name-on-save.
- The backend `WorkspaceFilePort` (`node-workspace-file-port.ts`) has list / read /
  search / replace / write only. There is **no create-folder, rename, move, or
  delete**, and the backend utility process has **no Electron `shell`** (so it cannot
  trash).
- Host/OS/git/worktree operations are ALREADY done as **main-process IPC handlers**
  taking an absolute `cwd` from the renderer: `tide:reveal-in-finder`,
  `tide:create-worktree`, `tide:remove-worktree`, `tide:git-changes`,
  `tide:git-file-diff`, etc. (`electron-main.ts` + `preload/index.ts`). `shell` (incl.
  `shell.trashItem`) lives in main.
- The renderer already knows the absolute root in both contexts: start page =
  `composer.startOptions.scope.cwd`; thread = `thread.scope.cwd`; and the loaded
  tree carries `fileTree.root`. (`thread-list.ts` normalizes/compares these.)
- Start-page editors are renderer-owned, editable, drafted panes derived from
  `startPageFiles` under synthetic `start-file:<rel>` pane ids
  (`types.ts`, `workbench-editor.ts`, `view-model.ts`). This is the precedent for a
  renderer-owned untitled pane.
- Context-menu popover precedent: `left-rail/context-menu.tsx` (fixed popover +
  transparent backdrop). Confirm-dialog precedent: `dialogs/worktree-delete-dialog.tsx`.
  HTML5 DnD precedent: left-rail manual ordering.

## Decisions
- **New File = untitled, name-on-save** (user choice "vsc처럼 빈 파일 열고 저장할 때
  이름 지정"). Trigger stays in BOTH the FileTree and the launcher. The launcher's
  path-typing input is removed; its button now opens an untitled pane.
- **Structural FS mutations = main-process IPC handlers**, mirroring the existing
  git/worktree/reveal handlers (absolute root + relative path from the renderer).
  This keeps `shell.trashItem` native (no backend↔main bridge) and matches how this
  app already does host/FS operations. The backend `WorkspaceFilePort` (agent/editor
  read-write pipeline) is left unchanged.
- **Delete = OS Trash** via `shell.trashItem` (recoverable), behind a confirm dialog.
- **Path safety in main**: a shared `resolveInsideRoot(root, rel)` helper (ported from
  the backend port) rejects any path that escapes the root; every handler uses it.
- **Open-tab reconciliation on mutate = close** the affected editor tab(s)
  (deleted / renamed / moved file, or a descendant of a renamed/moved folder). Simple
  and safe (no stale-path saves); "follow the file to its new path" is a later polish.
- **Collision = refuse** (create/rename/move onto an existing path returns a
  `*_exists` error surfaced as a toast); no silent overwrite.

## Out Of Scope
- Multi-select / bulk operations in the tree.
- Cut/copy/paste of files; duplicate.
- Following an open editor to its new path on rename/move (we close it instead).
- Exposing these mutations to agents through the Tide MCP surface.
- Undo of a trashed file beyond the OS Trash itself.

## Domain Model
- `ProductShellUntitledFile` (renderer state): `{ id: "untitled:<n>", title: "Untitled-<n>",
  draft: string, threadId: string | null, scopeCwd: string }`. Lives in
  `state.untitledFiles`. Derived to an editable editor pane `untitled:<n>` by the
  view-model, shown only when `threadId === activeThreadId`.
- `ProductShellTreeEdit` (renderer state): `{ kind: "new-folder" | "rename",
  parentPath: string, targetPath?: string, draft: string } | null` in
  `state.fileTreeEdit`. Drives the inline input row.
- `ProductShellFileTreeMenu` (renderer state): right-click popover anchor + target
  entry (or root), in `state.fileTreeMenu`.

## Contracts
New main-process IPC (preload `window.tide.fs*`, `ipcMain.handle("tide:fs-*")`),
each returning `{ ok: true } | { ok: false; code: string; message: string }`:
- `fsCreateFile(root, relPath, content)` — mkdir -p parent; write with `wx` (refuse
  clobber → `file_exists`).
- `fsCreateFolder(root, relPath)` — `mkdir` (refuse existing → `folder_exists`).
- `fsMove(root, fromRel, toRel)` — `rename`; refuse when `toRel` exists
  (`path_exists`) or `toRel` is inside `fromRel` (`invalid_move`). Covers rename AND
  drag-move.
- `fsTrash(root, relPath)` — `shell.trashItem(abs)`.
All validate both paths with `resolveInsideRoot`; out-of-scope → `path_outside_root`.

No Shared Contracts (`src/shared/contracts`) change — these are host IPC, not backend
commands (same category as `tide:create-worktree`).

## Flow
**New File (untitled):** toolbar / context-menu / launcher → `onNewUntitledFile()` →
`newProductShellUntitledFile` appends an untitled bound to the active thread (or null)
and the current scope cwd, opens the Workbench, focuses its pane. Typing updates
`draft` (`onEditorDraftChange` handles `untitled:` ids). Cmd+S on an untitled pane →
reducer returns `{ needsSaveAs: untitledId }`; the editor pane shows an inline
"Save as: [path]" bar. Confirm → handler `window.tide.fsCreateFile(scopeCwd, path,
draft)`; on ok → open the now-real file via the existing open path
(`workspace.readFile` start / `open_editor` thread) + drop the untitled + refresh tree;
on `file_exists` → keep the bar + toast.

**New Folder / Rename:** context-menu / toolbar → `beginProductShellTreeEdit({kind,
parentPath / targetPath})` renders the inline input. Confirm → handler calls
`fsCreateFolder` / `fsMove`; on ok → close the edit, refresh tree, (rename) reconcile
open tabs; on error → toast, keep input.

**Delete:** context-menu → confirm dialog → `window.tide.fsTrash(root, rel)` → on ok
close affected tabs + refresh tree; on error toast.

**Move (DnD):** dragstart on a row carries its relativePath; valid drop targets =
folder rows + the tree root; drop → `fsMove(root, fromRel, targetDir + "/" + base)`
guarded by `isInvalidMove` (into self/descendant) → refresh + reconcile tabs.

After every mutation the tree is refreshed through the EXISTING refresh path
(`refresh_file_tree` thread / `workspace.readFileTree` start) so the backend stays the
source of truth for tree contents.

## Invariants
- No structural op escapes the root (`resolveInsideRoot` on every path).
- Create/rename/move never silently overwrite an existing path.
- `readTextFile` / existing open paths are unchanged; reopening a just-created file
  reads exactly the written content.
- An untitled pane shows only in the context (thread/start) it was created in and
  never enters the backend workbench snapshot (so it is never clobbered).
- Trash is recoverable (OS Trash), never `rm -rf`.
- A mutation to a path with an open editor tab closes that tab (no save against a
  moved/deleted path).

## Tests
- `resolveInsideRoot` (main helper): in-root ok; `..` escape, absolute-outside,
  sibling-prefix (`/root-x`) rejected.
- `isInvalidMove`: into self, into own descendant rejected; into sibling/parent ok.
- Untitled reducers: new appends bound untitled + opens workbench; draft change sets
  dirty; Cmd+S → `needsSaveAs`; save-as success drops untitled + emits create/open;
  `file_exists` keeps it; close drops it; thread-bound untitled hidden when another
  thread active.
- Tree-edit reducers: begin new-folder/rename sets `fileTreeEdit`; confirm empty =
  no-op; cancel clears.
- Tab reconciliation reducer: deleting/renaming/moving an open file removes its
  start-file / yields its pane id to close; folder rename reconciles descendants.
- View-model: untitled file → one editable `untitled:` editor pane in the right
  context; absent in the wrong context.
- (light integration, temp dir) main fs handlers: create-file/folder, move, collision
  refusal, out-of-root refusal. Trash is faked (no real Trash in tests).

## Implementation Notes
- Main: `infrastructure/electron/main/workspace-fs.ts` (pure `resolveInsideRoot` +
  op functions taking an injected `trashItem`) + `ipcMain.handle` wiring in
  `electron-main.ts`; preload surface additions; `window.tide` typing.
- Renderer state: `state/untitled-files.ts`, `state/file-tree.ts` (tree-edit + menu +
  reconciliation), view-model derivation, handlers in
  `product-shell/handlers/*` (async window.tide calls + follow-up dispatch).
- Renderer UI: FileTree toolbar + context menu + inline input + DnD in
  `file-tree/file-tree.tsx` (+ a `file-tree-context-menu.tsx`); untitled Save-As bar in
  the editor pane; delete confirm dialog under `dialogs/`.
- CSS under the renderer area stylesheet for tree rows/menu/input/drag-over.
- Keep handler logic thin; push decisions into tested reducers/helpers.
