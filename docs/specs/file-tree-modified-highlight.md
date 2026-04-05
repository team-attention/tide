# Spec: File Tree Modified Highlight

## Overview

### As-Is
`adapter/outward/view/chrome/file_tree.rs` colors FileTree rows from `FileTreeModel.git_status` and `FileTreeModel.dir_git_status` only. Those caches are filled asynchronously by `application/services/file_tree_service/mod.rs` when the background git poller finishes. Editing a file-backed Editor Pane updates the tab indicator immediately, but the matching FileTree row stays unhighlighted until the next git poll result arrives.

### To-Be
When a file-backed Editor Pane is modified in memory, the matching FileTree row shows `Modified` immediately even before the background git poller refreshes the git-status caches. Ancestor directory rows get the same fallback when no cached directory status exists. Existing cached git statuses still win so the FileTree keeps showing `Conflict`, `Added`, or `Untracked` when the poller already knows about them.

### Approach
1. Reuse normalized path-identity matching for both file-watch and FileTree status lookup.
2. Add an effective FileTree git-status lookup that first reads the cached git status and only falls back to `Modified` when a matching file-backed Editor Pane is modified.
3. Use that effective lookup in FileTree rendering for both file rows and directory rows.

## Bounded Contexts

| Context | Role |
|---------|------|
| `application/services/file_tree_service` | Combines cached git status with file-backed Editor Pane modified state for FileTree rows. |
| `application/services/update_service` | Reuses the shared path-identity helper for file-watch matching. |
| `adapter/outward/view/chrome/file_tree` | Renders FileTree rows from the effective status lookup. |

## Use Cases

### UC-1: HighlightModifiedFileRowBeforeGitPoll

- **Actor**: User
- **Trigger**: The user edits a file-backed Editor Pane.
- **Precondition**: The FileTree contains a row for that file.
- **Flow**:
  1. The Editor Pane becomes modified in memory.
  2. FileTree rendering asks the App for the effective git status for the file row.
  3. If no cached git status exists for that file row, the App checks file-backed Editor Panes for a modified path match.
  4. The matching file row renders as `Modified`.
- **Postcondition**: The user sees the FileTree file row highlight immediately.
- **Business Rules**:
  - BR-1: File rows match file-backed Editor Panes by normalized path identity, not raw string equality.
  - BR-2: A modified file-backed Editor Pane falls back to `Modified` only when the FileTree has no cached git status for that file row.
  - BR-3: If the FileTree already has a cached git status for a file row, that cached status is preserved.

### UC-2: HighlightModifiedAncestorDirectoryBeforeGitPoll

- **Actor**: User
- **Trigger**: The user edits a file-backed Editor Pane inside an expanded directory.
- **Precondition**: The FileTree contains a row for an ancestor directory of that file.
- **Flow**:
  1. FileTree rendering asks the App for the effective git status for a directory row.
  2. If no cached directory status exists, the App checks whether any modified file-backed Editor Pane path is equal to or inside that directory.
  3. The matching directory row renders as `Modified`.
- **Postcondition**: The user sees the ancestor directory highlight immediately.
- **Business Rules**:
  - BR-4: Directory rows fall back to `Modified` when a modified file-backed Editor Pane path is equal to or inside that directory.

## Invariants

- Existing git-status caches remain the source of truth whenever they already contain a status for the row.
- Path matching remains normalized so symlink and realpath aliases resolve to the same file identity.

## Tests

| UC | BR | Test function |
|----|----|---------------|
| UC-1 | BR-1/BR-2 | `dirty_editor_marks_matching_file_tree_file_modified_before_git_poll` |
| UC-1 | BR-1 | `dirty_editor_matches_file_tree_entries_by_normalized_path_identity` |
| UC-1 | BR-3 | `cached_file_tree_git_status_is_preserved_over_dirty_editor_fallback` |
| UC-2 | BR-4 | `dirty_editor_marks_matching_file_tree_directory_modified_before_git_poll` |

## Location

- `crates/tide-app/src/application/services/file_tree_service/mod.rs`
- `crates/tide-app/src/application/services/path_identity.rs`
- `crates/tide-app/src/application/services/update_service/mod.rs`
- `crates/tide-app/src/adapter/outward/view/chrome/file_tree.rs`
- `crates/tide-app/src/application/behavior_tests/file_tree_modified_highlight.rs`
