# Spec: FileTree View

FileTree View placement and scroll behavior.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | FileTreeModel owns scroll state |
| `tide-tree` | FsTree filesystem traversal |
| `layout_compute.rs` | Places FileTree View on the right side independently from Terminal Context Surface |
| `adapter/outward/view/chrome/file_tree.rs` | Renders FileTree View chrome and rows |

## Use Cases

### UC-1: ScrollClamp

- **Actor**: System (update loop)
- **Trigger**: Window resize or content change while FileTree View is visible
- **Precondition**: FileTree View is visible
- **Flow**:
  1. On each update(), compute max scroll based on content height vs viewport
  2. Clamp scroll and scroll_target to [0, max]
- **Postcondition**: Scroll position within valid bounds
- **Business Rules**:
  - BR-1: Scroll is clamped after window resize shrinks viewport
  - BR-2: scroll_target is clamped independently of scroll
  - BR-3: Hidden FileTree View scroll is not clamped (preserves position for re-show)

### UC-2: PlaceFileTreeOnRight

- **Actor**: User
- **Trigger**: User opens FileTree through `ToggleFileTree` or the titlebar FileTree button
- **Precondition**: A Stage `Terminal` exists
- **Flow**:
  1. Tide marks `FileTreeModel.visible` true.
  2. Layout computation reserves one right-side FileTree View region.
  3. Tide renders FileTree View in that right region instead of reserving a left global sidebar.
  4. When Terminal Context Surface is also visible, Tide keeps it visible between Stage and FileTree View.
  5. Switching the focused Stage `Terminal` keeps FileTree View on the right and refreshes root state through `update_file_tree_cwd()`.
- **Postcondition**: FileTree View behaves as an independent right-side tree view, not as a Terminal Context Surface Pane.
- **Business Rules**:
  - BR-1: Visible FileTree View must reserve right-side space, not left Stage sidebar space.
  - BR-2: FileTree View and Terminal Context Surface must be independently visible when `ToggleFileTree` and Dock are both active.
  - BR-3: FileTree View must continue to use `FocusArea::FileTree` for keyboard routing.
  - BR-4: FileTree View root refresh follows the focused Stage `Terminal` via the existing CWD update path.

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `scroll_clamped_after_window_resize_shrinks_viewport` |
| UC-1 | BR-2 | `scroll_target_clamped_independently` |
| UC-1 | BR-3 | `hidden_file_tree_scroll_not_clamped` |
| UC-2 | BR-1 | `file_tree_view_uses_right_side_without_left_sidebar` |
| UC-2 | BR-2 | `file_tree_view_coexists_with_terminal_context_surface` |
| UC-2 | BR-4 | `file_tree_view_stays_right_side_when_stage_terminal_switches` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| FileTreeModel | tide-app | `crates/tide-app/src/domain/state/file_tree_model.rs` |
| FsTree | tide-tree | `lib.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod file_tree_scroll` |
