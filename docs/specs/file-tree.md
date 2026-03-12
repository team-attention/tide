# Spec: File Tree

File tree sidebar: scroll behavior and viewport clamping.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | FileTreeModel owns scroll state |
| `tide-tree` | FsTree filesystem traversal |

## Use Cases

### UC-1: ScrollClamp

- **Actor**: System (update loop)
- **Trigger**: Window resize or content change while file tree is visible
- **Precondition**: File tree is visible
- **Flow**:
  1. On each update(), compute max scroll based on content height vs viewport
  2. Clamp scroll and scroll_target to [0, max]
- **Postcondition**: Scroll position within valid bounds
- **Business Rules**:
  - BR-1: Scroll is clamped after window resize shrinks viewport
  - BR-2: scroll_target is clamped independently of scroll
  - BR-3: Hidden file tree scroll is not clamped (preserves position for re-show)

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `scroll_clamped_after_window_resize_shrinks_viewport` |
| UC-1 | BR-2 | `scroll_target_clamped_independently` |
| UC-1 | BR-3 | `hidden_file_tree_scroll_not_clamped` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| FileTreeModel | tide-app | `ui_state.rs` |
| FsTree | tide-tree | `lib.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod file_tree_scroll` |
