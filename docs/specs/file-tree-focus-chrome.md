# Spec: File Tree Focus Chrome

## Overview

### As-Is
`crates/tide-app/src/adapter/outward/view/chrome/file_tree.rs` currently treats `FocusArea::FileTree` as a heavy panel-focus state. The FileTree panel switches to a thicker border, adds a warm shadow, tints the header separator with the Dock accent, and draws the `FileTree Cursor Row` with both a warm fill and a left accent bar. `crates/tide-app/src/adapter/outward/view/hover.rs` can also stack a second hover overlay on top of that same row.

The result is visually louder than the rest of Tide chrome, especially when `Cmd+2` moves focus into the FileTree. The selection cue competes with the panel container instead of reading like a natural list selection.

### To-Be
When `FocusArea` is `FileTree`, Tide keeps the FileTree container quiet and shifts emphasis to the `FileTree Cursor Row`. The panel border stays subtle, no focus shadow is added, and the header separator stays in the same quiet family as the unfocused FileTree. The `FileTree Cursor Row` uses a subdued fill plus a light stroke, without the left accent bar. Hover does not stack an extra overlay on that same focused row.

### Approach
1. Add dedicated FileTree focus tokens to the theme palette instead of reusing the Dock accent.
2. Extract FileTree focus chrome decisions into pure helpers that behavior tests can call directly.
3. Render the focused FileTree row with a stroke-and-fill selection treatment behind the row text and remove the left accent bar.
4. Suppress hover overlay stacking when the hovered row is already the focused `FileTree Cursor Row`.
5. Keep expanded directory emphasis visible even when that row is also the focused `FileTree Cursor Row`.

## Bounded Contexts

| Context | Role |
|---------|------|
| `adapter/outward/view/chrome/file_tree` | Resolves FileTree panel and row chrome for `FocusArea::FileTree`. |
| `adapter/outward/view/hover` | Prevents hover overlay from stacking on the focused `FileTree Cursor Row`. |
| `theme` | Supplies the dedicated FileTree focus colors. |

## Use Cases

### UC-1: RenderFocusedFileTreeChrome

- **Actor**: System
- **Trigger**: Chrome rendering while `FocusArea` is `FileTree`
- **Precondition**: The FileTree is visible
- **Flow**:
  1. Tide resolves FileTree focus chrome from the active theme palette.
  2. Tide keeps the FileTree container border subtle and skips focus shadow.
  3. Tide renders the `FileTree Cursor Row` with a subdued fill and stroke.
  4. Tide avoids the old left accent bar and warm header separator tint.
- **Postcondition**: FileTree focus reads as a natural list selection instead of a heavy panel state.
- **Business Rules**:
  - BR-1: Focused FileTree panel chrome keeps the same quiet border weight as the unfocused FileTree and adds no focus shadow.
  - BR-2: The focused `FileTree Cursor Row` uses dedicated selection fill and stroke colors instead of the Dock accent bar treatment.
  - BR-3: The focused FileTree header separator stays in the subtle FileTree border family rather than switching to the warm Dock accent.
  - BR-4: The focused `FileTree Cursor Row` chrome must render as a background layer so its fill never obscures row text.
  - BR-5: Expanded directory rows keep their bold text styling even when the focused `FileTree Cursor Row` is on them.

### UC-2: AvoidHoverStackOnFocusedFileTreeCursorRow

- **Actor**: System
- **Trigger**: Hover rendering while `FocusArea` is `FileTree`
- **Precondition**: The pointer is over a FileTree row
- **Flow**:
  1. Tide resolves which FileTree row is hovered.
  2. Tide compares that row with `FileTreeModel.cursor`.
  3. If the hovered row is already the focused `FileTree Cursor Row`, Tide skips the extra hover overlay.
  4. Otherwise Tide renders the normal FileTree hover overlay.
- **Postcondition**: Keyboard focus remains visually stable and does not double-highlight one row.
- **Business Rules**:
  - BR-6: Hover overlay is suppressed when the hovered row is also the focused `FileTree Cursor Row`.
  - BR-7: Hover overlay still renders for other FileTree rows, and for the cursor row when the FileTree itself is not focused.

## Invariants

- FileTree focus chrome is row-first, not panel-first.
- FileTree hover never double-highlights the same row that already owns FileTree keyboard focus.
- FileTree focus tokens remain distinct from Dock tab accent tokens.

## Tests

| UC | BR | Test function |
|----|----|---------------|
| UC-1 | BR-1 | `focused_file_tree_uses_selection_row_chrome_instead_of_panel_shadow` |
| UC-1 | BR-2 | `focused_file_tree_cursor_row_uses_stroke_and_fill_without_accent_bar` |
| UC-1 | BR-3 | `focused_file_tree_header_separator_stays_subtle` |
| UC-1 | BR-4 | `focused_file_tree_cursor_row_chrome_renders_behind_entry_text` |
| UC-1 | BR-5 | `expanded_directory_rows_keep_bold_text_when_selected` |
| UC-2 | BR-6/BR-7 | `hovered_focused_file_tree_cursor_row_does_not_stack_a_second_overlay` |

## Location

- `crates/tide-app/src/adapter/outward/view/chrome/file_tree.rs`
- `crates/tide-app/src/adapter/outward/view/hover.rs`
- `crates/tide-app/src/theme.rs`
- `crates/tide-app/src/application/behavior_tests/file_tree_focus_chrome.rs`
