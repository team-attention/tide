# Spec: Workbench Open Polish And Image Pane

## Scope

Fix Workbench file and terminal open regressions without changing the Thread,
Agent Runtime, or Workbench ownership model.

This slice covers:

- Visible Workbench Terminal Pane open/close responsiveness.
- Editor file picker cancellation when the user opens a new pane or closes the
  active picker tab.
- Opening image files from the Workbench file picker or file tree.
- Reducing perceptible cold-boot rail skeleton flash.

## Evidence

- `docs_v2/master-plan.md` defines Workbench as the optional visible work area
  for Browser, Diff, Editor, and Terminal Panes.
- `docs_v2/glossary.md` keeps the hidden Agent Runtime separate from visible
  Terminal Panes.
- `docs_v2/implementation/source-map.md` routes Workbench UI changes through
  `desktop/adapters/inbound/react-renderer/product-shell/workbench/` and
  Workbench behavior through `backend/application/services/workbench/`.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` requires hidden
  PTY behavior for agents, but that does not require visible Terminal Panes to
  block UI while a shell starts or stops.
- Current `WorkbenchCommandHandler.open_terminal` awaits PTY start before the
  pane snapshot returns.
- Current `WorkbenchCommandHandler.close_pane` awaits terminal stop before the
  pane is removed from the UI.
- Current editor picker is renderer-only state (`editorPickerFilter`) that
  overrides pane content rendering; New Pane creates/reveals panes behind it and
  tab close can leave the picker visible.
- Current file open path calls `readTextFile`; image files are rejected as binary
  and have no renderable Workbench pane.

## Decisions

1. Visible Terminal Pane opening is optimistic. Backend creates the pane, marks it
   running, returns the snapshot immediately, and starts the PTY in the
   background.
2. Visible Terminal Pane closing is UI-first. Backend removes the pane from the
   Workbench immediately and stops the PTY asynchronously.
3. Workbench's default shell launch is non-login. The PTY still runs the user's
   shell in the target cwd, but does not add `-l` by default.
4. The editor picker is transient. New Pane and pane close clear it before
   applying their normal Workbench command.
5. Image files open as a first-class `image` Workbench Pane. Text files continue
   to open as `editor` panes.
6. Image pane refs cross the Desktop/Backend boundary as metadata only. Bounded
   base64 image bytes are read by an explicit `workspace.readImageFile` request
   when the renderer needs to display the pane, so recurring Workbench snapshots
   do not repeatedly ship large image payloads.
7. Cold boot avoids very short shimmer flashes and parallelizes cheap filesystem
   metadata checks where possible.

## Out Of Scope

- General binary file viewers beyond images.
- Image editing, zoom tools, or EXIF metadata.
- Making the hidden Agent Runtime visible.
- Reworking persistence or provider session discovery.

## Domain Model

Add `ImagePaneState` / `ImagePaneRef`:

- `kind: "image"`
- `root`
- `filePath`
- `relativePath`
- `mimeType`
- `byteLength`

The pane is read-only and close/focus behavior matches any non-terminal pane.

## Contracts

`WorkbenchPaneRefDto.kind` gains `"image"`.

Image refs include:

- `root?: string`
- `filePath?: string`
- `relativePath?: string`
- `mimeType?: string`
- `byteLength?: number`

`open_editor` remains the command name for the file picker entry. The backend
chooses `editor` or `image` based on the file path.

Renderer image data is fetched through:

```ts
workspace.readImageFile: {
  cwd: string;
  path: string;
  byteLimit?: number;
}

workspace.imageLoaded: {
  cwd: string;
  relativePath: string;
  mimeType: string;
  dataBase64: string;
  byteLength: number;
}
```

## Flow

### Terminal Open

1. User selects Terminal.
2. Backend creates/reveals a Terminal Pane.
3. Backend starts the PTY without delaying the command response.
4. Renderer mounts xterm immediately; subsequent PTY bytes stream into the pane.

### Terminal Close

1. User closes a terminal tab.
2. Backend removes the pane and returns the new Workbench snapshot.
3. Backend stops the PTY handle asynchronously.

### Editor Picker

1. User opens the Editor picker.
2. New Pane clears the picker and opens a Launcher pane.
3. Closing a pane while the picker is visible clears the picker too.
4. Selecting a file clears the picker and opens the selected file.

### Image Open

1. User selects an image file.
2. Backend reads only enough metadata to create/reveal an Image Pane ref.
3. Desktop renders the pane shell and requests bounded image bytes through
   `workspace.readImageFile`.
4. Desktop renders the returned base64 data URL inside a read-only image surface.

## Invariants

1. Desktop never reads workspace files directly.
2. The hidden Agent Runtime is not reused as a visible Terminal Pane.
3. Terminal pane close does not wait for process teardown before removing UI.
4. Image panes are read-only and never use editor save/code-intelligence paths.
5. Text file open behavior remains unchanged.
6. New Pane is visible immediately even if the editor picker was active.
7. `thread.hydrated` and recurring `workbench.changed` snapshots do not include
   `dataBase64` for image panes.
8. Background Terminal Pane startup failures do not create unhandled promise
   rejections after the pane has already opened optimistically.
9. Workbench filesystem reads tolerate files disappearing or becoming unreadable
   between metadata checks and content reads.
10. Worktree project registry cleanup can remove a missing Tide-rule worktree
    entry even when the backing git worktree command can no longer run.

## Tests

| Expectation | Test |
| --- | --- |
| Terminal opens with the shell command but no login arg | `open_terminal_uses_non_login_shell_by_default` |
| Terminal close removes UI before awaiting a slow stop | `closing_terminal_pane_removes_it_before_stop_settles` |
| New Pane clears the editor picker | `new_workbench_pane_clears_editor_picker` |
| Closing while picker is visible clears it | `closing_workbench_pane_clears_editor_picker` |
| Image files read as bounded binary payloads | `readImageFile_returns_base64_for_supported_image` |
| Backend opens an image file as an image pane | `open_editor_opens_image_pane_for_image_file` |
| Image pane refs omit repeated base64 payloads | `image_pane_snapshot_omits_base64_payload` |
| Renderer fetches and shows an image pane | `workbench_image_pane_fetches_and_renders_data_url_image` |
| App storage directory listing skips entries whose stat fails | `file_app_storage_listDirectories_skips_entries_whose_stat_fails` |
| Image byte reads return a typed unreadable error when content read fails | `readImageFile_returns_unreadable_when_image_bytes_cannot_be_read` |

## Implementation Notes

- Keep `open_editor` as the command so the existing file picker and file tree do
  not need a new command.
- Use extension-based MIME detection for common web-renderable images.
- Keep the cold-boot shimmer delay in the renderer; do not hide genuinely long
  loading states forever.
