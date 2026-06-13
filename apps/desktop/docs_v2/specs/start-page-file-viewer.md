# Spec: Start-Page File Tree & File Viewer

## Scope

Make the START (New Thread) page's file tree behave like a real tree:
folders expand to their already-loaded children, clicking a file opens a
READ-ONLY viewer over the empty stage, and a composer scope-chip change
reloads the tree (and closes a stale viewer).

## Evidence

- `selectProductShellFileTreeEntry` bailed whenever `activeThreadId === null`,
  freezing the start-page tree at its top level even though
  `workspace.readFileTree` had loaded 12 levels.
- Opening a file used `workbench.command open_editor`, which requires a
  thread — the start page has none.

## Decisions

- New thread-independent read: `workspace.readFile { cwd, path, byteLimit? }`
  → `workspace.fileLoaded { cwd, relativePath, content, truncated }`, served
  by `WorkspaceQueryHandler` (the same byte limit as the workbench's
  open_file; truncated shows a badge).
- The viewer (`chat-column/start-file-viewer.ts`) is READ-ONLY CodeMirror with
  the themed `tok-*` highlighting — editing starts once a thread exists.
  Esc / ✕ closes it.
- `startPageFile` lives in product-shell state, exposed via the view model
  only while no thread is active; a `workspace.fileTreeLoaded` for a
  DIFFERENT cwd (scope-chip switch) closes it, the same cwd (tree toggle)
  keeps it.
- `WorkspaceQueryHandler` extracted from `WorkbenchCommandHandler` (file-size
  cap): it owns ALL thread-independent workspace queries — file tree, file
  read, content search, code intel — reached via
  `ThreadRuntimeService.workspaceQueries()`.

## Out Of Scope

- Editing/saving from the start page; diff/markdown-preview modes.
- Lazy per-level tree loading (the full tree is loaded upfront, as on
  thread pages).

## Tests

- `desktop-product-shell-visual-foundation.test.ts`: start-page folder toggle
  expands without a thread; file click emits `workspace.readFile` with the
  composer scope cwd; `workspace.fileLoaded` fills the viewer; a
  different-cwd tree load closes it; same-cwd keeps it; explicit close.
- Live: `scripts/pw-start-page-tree-verify.cjs` — real app, scope chip
  Scratch→project reloads the tree, folder expand, file open renders content
  with syntax tokens, Esc closes. ALL PASS.
