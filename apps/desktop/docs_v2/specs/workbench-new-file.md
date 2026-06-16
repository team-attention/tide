# Spec: New File (blank file → save) in the Workbench

## Scope
A "New File" action in the file panel: type a path, get a blank editable editor tab,
Cmd+S saves it under the current folder. Works on the start (New Thread) page AND
inside a thread. ("like tide terminal" — the cwd always exists, so you can create.)

## Evidence
- The editor today can only OPEN existing files (file-tree click → `workspace.readFile`
  for the start page / `open_editor` for a thread). There is no create path.
- Both open paths funnel through one read: `readWorkspaceFile` and `readThreadFile`
  both call `WorkspaceFilePort.readTextFile`, which returns `workspace_file_not_found`
  for a missing file.
- Start-page save (`workspace.writeFile`) and thread save (`save_editor_file`) both
  use `writeTextFile`, which also requires the file to already exist.

## Decisions
- **Name on create** (user choice): the user types the relative path up front; the
  file is created empty on disk immediately (touch), then opened. This is the only
  shape that works uniformly for threads (which have no renderer-side blank pane) and
  matches a terminal `touch` + edit + `:w`.
- **Never clobber**: create uses the `wx` flag; if the path already exists it is left
  intact and simply opened (open-or-create).
- One mechanism for both contexts: a `create` flag on the existing read, so the file
  exists before the normal open/edit/save machinery runs (no new save path needed).

## Out Of Scope
- New folder, rename, delete in the tree.
- A composer entry (it does not belong on the composer).

## Contracts
- `workspace.readFile` payload: add `create?: boolean`.
- `open_editor` rides its `create` in the freeform `workbench.command.data` (no
  contract change).
- `WorkspaceFilePort.readTextFile` input: add `create?: boolean`. When true and the
  file is missing, create the parent dirs + an empty file (`wx`, EEXIST ignored),
  then read.

## Flow
1. The Workbench **launcher** shows a "New file" action (alongside Browser/Editor/
   Terminal) → reveals an inline name input (Enter confirms, Escape/blur cancels). It is
   a renderer-handled action so it shows on every launcher (empty default + backend).
2. On confirm, `onCreateFile(relativePath)` → reducer `newProductShellFile`:
   - start page (`activeThreadId === null`): `workspace.readFile {cwd, path,
     create:true}` (cwd = composer start scope). `workspace.fileLoaded` opens the tab.
   - thread: `workbench.command {threadId, command:"open_editor", data:{path,
     create:true}}` (backend resolves the thread cwd).
3. The created file is empty + clean; the user types → dirty → Cmd+S saves through the
   unchanged start-page/thread save paths (the file now exists).

## Invariants
- An existing file at that path is opened, never emptied.
- `readTextFile` without `create` behaves exactly as before.
- Start page requires a project scope cwd (no scope ⇒ no-op, as today).

## Tests
- `readTextFile`: create:true + missing ⇒ creates empty + reads ""; create:true +
  existing ⇒ content preserved; create:false/absent + missing ⇒ not_found (unchanged).
- `newProductShellFile`: start page ⇒ readFile w/ create:true under composer cwd;
  thread ⇒ open_editor w/ data.create:true; empty path / no scope ⇒ no-op.
