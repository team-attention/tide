# Spec: Start-Page File Tree & Editor

## Scope

Make the START (New Thread) page's file tree behave like a real tree:
folders expand to their already-loaded children, and clicking a file opens it
as a real, EDITABLE Workbench editor pane on the right (the same editor used
inside a thread) — not an overlay over the chat. A composer scope-chip change
reloads the tree (and drops a stale open file).

## Evidence

- `selectProductShellFileTreeEntry` bailed whenever `activeThreadId === null`,
  freezing the start-page tree at its top level even though
  `workspace.readFileTree` had loaded 12 levels.
- Opening a file used `workbench.command open_editor`, which requires a
  thread — the start page has none.
- The first cut rendered the file in a READ-ONLY overlay over the chat stage
  (`chat-column/start-file-viewer.ts`). Users expected it in the Workbench,
  editable like any editor.

## Decisions

- Thread-independent read: `workspace.readFile { cwd, path, byteLimit? }`
  → `workspace.fileLoaded { cwd, relativePath, content, truncated }`. Opening a
  file also sets `workbenchOpen: true` so the editor column animates in.
- Thread-independent write (NEW): `workspace.writeFile { cwd, path, content,
  byteLimit? }` → `workspace.fileSaved { cwd, relativePath, content, truncated }`.
  The thread-bound editor still uses `workbench.command save_editor_file`; the
  start page has no thread, so it writes under the composer's cwd instead. Both
  are served by `WorkspaceQueryHandler`.
- The open file lives in `startPageFile` (now with `draft`/`dirty`). The view
  model SYNTHESIZES one editor pane (`START_FILE_PANE_ID`) + its draft from it
  and renders through the normal Workbench column — so the file gets the real
  editor (code editor or markdown Preview/Edit), tab strip, and breadcrumb for
  free. The editor's draft/save/close handlers special-case that pane id when
  `activeThreadId === null`.
- A truncated read stays read-only (saving would clobber the unread tail).
- A `workspace.fileTreeLoaded` for a DIFFERENT cwd (scope-chip switch) drops the
  open file; the same cwd (tree toggle) keeps it. Starting / resetting to a New
  Thread also clears it.
- `WorkspaceQueryHandler` (extracted from `WorkbenchCommandHandler`) owns ALL
  thread-independent workspace ops — file tree, file read/write, content search,
  code intel — reached via `ThreadRuntimeService.workspaceQueries()`.

## Out Of Scope

- Go-to-definition / find-references from the start-page editor (those use the
  thread-bound workbench command path; code intel hover/completion is
  thread-independent and could be wired later).
- Lazy per-level tree loading (the full tree is loaded upfront, as on
  thread pages).

## Tests

- `desktop-product-shell-visual-foundation.test.ts`
  (`start_page_file_opens_as_an_editable_workbench_editor_pane`): folder toggle
  expands without a thread; file click emits `workspace.readFile` and opens the
  workbench; `workspace.fileLoaded` synthesizes an `editor` pane + draft; editing
  marks it dirty; save emits `workspace.writeFile`; `workspace.fileSaved` re-bases
  and clears dirty; different-cwd tree load drops it; closing the pane collapses
  the workbench.
- Live: `scripts/pw-start-page-tree-verify.cjs` — real app, scope chip
  Scratch→project reloads the tree, folder expand, file open shows a Workbench
  editor pane (no overlay) with content + an editable affordance, closing the
  tab collapses the workbench. ALL PASS.
