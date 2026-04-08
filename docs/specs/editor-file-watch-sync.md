# Spec: Editor File Watch Sync

## Overview

### As-Is
`crates/tide-app/src/application/services/update_service/mod.rs` consumes `FileWatchEvent` values and tries to match them to file-backed Editor Panes by exact `Path` equality. The same path is then used to decide whether the Pane should reload from disk or mark `disk_changed`. That path match is brittle when the file watcher reports an equivalent realpath while the Editor Pane stores a symlink path. The same file-watch path also updates the Editor Pane without calling `trigger_git_poll()`, so file tree git status can stay stale until unrelated terminal output or another git-poll trigger arrives. `trigger_git_poll()` currently collects CWDs from live Terminal Panes only, even though `focused_terminal_cwd()` can resolve retained terminal context for Editor Panes whose owner Terminal has already been closed. `EditorState::reload()` also clamps the cursor only to the new line length, not to a valid UTF-8 character boundary, so a clean external reload can leave `cursor.position.col` inside a multibyte scalar and later LivePreviewMode or render-time slicing can panic.

### To-Be
File-watch events match file-backed Editor Panes by normalized path identity rather than raw string equality. A clean Editor Pane reloads immediately when an external change arrives for the same file, even if the watcher reports an equivalent realpath. File-watch-driven Editor Pane updates also trigger the background git poll using the current editor context, including retained terminal CWDs, so file tree git status refreshes promptly. Clean external reload also preserves the cursor only at valid UTF-8 character boundaries so Markdown Pane rendering and LivePreviewMode cannot inherit an invalid byte offset.

### Approach
1. Normalize file-watch event paths and Editor Pane file paths through filesystem-aware comparison before matching them.
2. Keep the existing clean-reload vs dirty-conflict behavior once a matching Editor Pane is found.
3. Trigger the existing background git poll after file-watch events that affect file-backed Editor Panes.
4. Expand git-poll CWD collection to include retained terminal context and focused editor context, not only live Terminal Panes.
5. Clamp the reloaded cursor column to the nearest valid character boundary on the reloaded line before any later render or LivePreviewMode code reads it.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/pane` | Owns file-backed Editor Pane disk-sync flags (`disk_changed`, `file_deleted`, `diff_mode`). |
| `application/services/update_service` | Consumes file-watch events and applies reload/conflict behavior to Editor Panes. |
| `application/services/file_tree_service` | Triggers the background git poll and applies git-status results to the file tree. |
| `adapter/outward/file_watcher_adapter` | Produces file-watch paths that must be matched back to Editor Panes robustly. |

## Use Cases

### UC-1: ReloadCleanEditorPaneFromEquivalentWatchPath
- **Actor**: System
- **Trigger**: A file-watch event arrives for a file-backed clean Editor Pane
- **Precondition**: The Editor Pane has `is_modified() = false`
- **Flow**:
  1. The file watcher reports a changed path for a file-backed Editor Pane.
  2. The app compares the watch path to open Editor Pane paths using normalized path identity.
  3. The app reloads the matching Editor Pane from disk.
  4. The app clears disk-conflict flags and invalidates the Pane cache.
- **Postcondition**: The Editor Pane content reflects disk state even when the watch path uses an equivalent realpath.
- **Business Rules**:
  - BR-1: File-watch matching uses normalized path identity, not raw `Path` equality alone.
  - BR-2: A clean file-backed Editor Pane reloads immediately after a matching external change.
  - BR-3: A clean file-backed Editor Pane reload clamps the preserved cursor column to a valid UTF-8 character boundary on the reloaded line.

### UC-2: RefreshFileTreeGitStatusAfterEditorFileWatchEvent
- **Actor**: System
- **Trigger**: A file-watch event affects a file-backed Editor Pane
- **Precondition**: The Editor Pane belongs to a live or retained terminal context with a CWD
- **Flow**:
  1. The app processes the file-watch event for the matching Editor Pane.
  2. The app collects git-poll CWDs from live Terminal Panes, retained terminal contexts, and the focused editor context.
  3. The app triggers the background git poll with those CWDs.
  4. The file tree later refreshes from the resulting git-status payload.
- **Postcondition**: File tree git status refreshes promptly after external file changes, without waiting for unrelated terminal output.
- **Business Rules**:
  - BR-4: File-watch-driven Editor Pane updates trigger the background git poll.
  - BR-5: Git-poll CWD collection includes retained terminal context when no live Terminal Pane owns the focused Editor Pane.

## Invariants

1. Clean Editor Panes reload silently from disk; dirty Editor Panes still surface conflict state instead of overwriting in-memory edits.
2. File-watch event handling stays asynchronous; git polling remains background work only.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1 | `editor_file_watch_sync` | `clean_editor_reloads_when_file_watch_event_uses_equivalent_real_path` |
| UC-1 | BR-2 | `editor_file_watch_sync` | `clean_editor_reloads_when_file_watch_event_uses_equivalent_real_path` |
| UC-1 | BR-3 | `editor_file_watch_sync` | `clean_editor_reload_clamps_cursor_to_character_boundary` |
| UC-2 | BR-4 | `editor_file_watch_sync` | `file_watch_event_triggers_git_poll_for_retained_editor_context` |
| UC-2 | BR-5 | `editor_file_watch_sync` | `file_watch_event_triggers_git_poll_for_retained_editor_context` |

## Location

| What | Location |
|------|----------|
| File-watch event handling | `crates/tide-app/src/application/services/update_service/mod.rs` |
| Git-poll CWD collection | `crates/tide-app/src/application/services/file_tree_service/mod.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/editor_file_watch_sync.rs` |
