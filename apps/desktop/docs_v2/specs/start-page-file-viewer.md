# Spec: Start-Page File Viewer

Status: **Superseded**

This spec described the old renderer-local start-page editor:

- `workspace.readFile` / `workspace.fileLoaded`
- synthetic `start-file:<path>` Workbench panes
- `workspace.writeFile` / `workspace.fileSaved`

That path is no longer the product model. Opening a file, creating a file, or saving
an untitled file from the Start Composer first creates the Composer Draft Thread and
then uses the normal backend Workbench commands:

- `workbench.command open_editor`
- `workbench.command open_editor { create: true }`
- `workbench.command save_editor_file`

The Start page may still list and expand the composer-scoped file tree through
`workspace.readFileTree`, but visible file panes are Thread Workbench panes owned by
the Draft Thread. See `composer-draft-thread.md`,
`workbench-filetree-file-operations.md`, and `workbench-editor-pane-editing.md`.
