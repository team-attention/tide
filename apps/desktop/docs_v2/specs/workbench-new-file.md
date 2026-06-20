# Spec: New File In The Workbench

Status: **Superseded by `workbench-filetree-file-operations.md`**

The old design asked the user to type a relative path up front and then opened it
with:

- `workspace.readFile { create: true }` on the Start page
- `workbench.command open_editor { create: true }` inside a Thread

The current product model is VSCode-style:

1. New File opens an untitled editor buffer immediately.
2. If the user is on the Start Composer, Tide first creates the Composer Draft
   Thread.
3. The untitled buffer is bound to that thread id.
4. Save As creates the file through Main-process filesystem IPC.
5. The saved file opens through `workbench.command open_editor` on the owning
   thread.

The backend `open_editor { create: true }` path still exists for explicit
path-known creation, but the primary UI flow is blank-then-name.
