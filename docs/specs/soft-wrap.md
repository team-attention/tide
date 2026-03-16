# Spec: Soft Wrap

## Overview

### As-Is
EditorState renders each logical line as exactly one visual row. Long lines extend beyond the viewport and require horizontal scrolling (`h_scroll_offset`). This is fine for source code but painful for prose files (Markdown, plain text) where lines are naturally long.

### To-Be
Prose files (`.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`, `.text`) automatically soft-wrap at the viewport width. Visual behavior matches VSCode word wrap:

- Long logical lines wrap to multiple visual rows
- Line numbers appear only on the first visual row of each logical line
- Continuation rows are indented to the same level as the gutter (no extra indent)
- Horizontal scroll is disabled when soft wrap is active
- Cursor Up/Down moves by visual row, not logical line
- Diff mode and preview mode are unaffected (no wrap)

All other file types: no wrap (current behavior preserved).

### Approach

1. Add `soft_wrap: bool` field to `EditorPane`. Set `true` when file extension is prose.
2. Add `WrapMap` to `EditorPane` — a cached mapping from logical lines to visual rows, computed from buffer content + viewport column width. Invalidated on content change or resize.
3. Modify rendering (`render_grid_full`) to use WrapMap when `soft_wrap` is true:
   - Iterate visual rows instead of logical lines
   - Map each visual row back to (logical_line, char_offset_in_line)
   - Draw line number only when char_offset == 0
   - Skip h_scroll logic entirely
4. Modify cursor rendering (`render_cursor`) to map buffer position → visual row via WrapMap.
5. Modify mouse click → cursor position mapping to go through WrapMap.
6. Modify scroll: `scroll_offset` becomes visual-row based when soft wrap is active.
7. Modify cursor movement (Up/Down) to move by visual row when soft wrap is active.
8. Modify scrollbar to use total visual rows for thumb sizing.

## Bounded Contexts

| Crate | Change |
|-------|--------|
| `tide-editor` | Add `WrapMap` struct. Add visual-row-aware cursor movement methods. |
| `tide-app` | Set `soft_wrap` based on file extension. Use WrapMap in rendering, click handling, scroll. |

## Use Cases

### UC-1: Open Prose File
- **Actor**: User
- **Trigger**: Open a `.md` or `.txt` file
- **Precondition**: None
- **Flow**: EditorPane detects prose extension → sets `soft_wrap = true` → builds WrapMap
- **Postcondition**: Long lines wrap at viewport width. Line numbers only on first visual row.
- **Business Rules**:
  - BR-1: Extensions `.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`, `.text` → soft wrap on
  - BR-2: All other extensions → soft wrap off
  - BR-3: Diff mode → always no wrap (regardless of file type)
  - BR-4: Preview mode → unaffected (already has its own wrap)

### UC-2: Render Wrapped Lines
- **Actor**: Renderer
- **Trigger**: Frame render with soft_wrap enabled
- **Precondition**: WrapMap is built for current content + viewport width
- **Flow**: Iterate visual rows. For each, look up (logical_line, offset). Draw line number only if offset == 0. Draw characters from offset until end of visual row or end of logical line.
- **Postcondition**: Text wraps at viewport edge. No horizontal overflow.
- **Business Rules**:
  - BR-5: Line number shown only on first visual row of a logical line
  - BR-6: Continuation rows show blank gutter
  - BR-7: Horizontal scroll disabled when soft wrap is active
  - BR-8: Wide characters (CJK) that would exceed viewport width wrap to next visual row

### UC-3: Cursor Navigation in Wrapped Text
- **Actor**: User
- **Trigger**: Arrow Up/Down key press
- **Precondition**: soft_wrap is true
- **Flow**: Cursor moves by one visual row (not logical line). If cursor is mid-wrap and presses Down, it moves to the next visual row within the same logical line.
- **Postcondition**: Cursor is on the adjacent visual row. Column preserved (desired_col style).
- **Business Rules**:
  - BR-9: Up/Down moves by visual row, not logical line
  - BR-10: Home goes to start of visual row (not logical line start)
  - BR-11: End goes to end of visual row (not logical line end)
  - BR-12: Left/Right at visual row boundary continues within the same logical line (no change from current behavior)

### UC-4: Click in Wrapped Text
- **Actor**: User
- **Trigger**: Mouse click in editor content area
- **Precondition**: soft_wrap is true
- **Flow**: Pixel position → visual row + column → WrapMap lookup → (logical_line, byte_offset)
- **Postcondition**: Cursor placed at correct buffer position
- **Business Rules**:
  - BR-13: Click on continuation row maps to correct position in the logical line

### UC-5: Resize Viewport
- **Actor**: User / system
- **Trigger**: Window resize changes viewport column count
- **Precondition**: soft_wrap is true
- **Flow**: WrapMap invalidated → rebuilt with new width → scroll position adjusted proportionally
- **Postcondition**: Text re-wraps to new width. Cursor remains visible.
- **Business Rules**:
  - BR-14: WrapMap rebuilt on viewport width change
  - BR-15: Cursor visibility ensured after re-wrap (scroll adjusted if needed)

### UC-6: Scrollbar with Wrapped Lines
- **Actor**: Renderer
- **Trigger**: Render scrollbar with soft_wrap enabled
- **Precondition**: WrapMap exists
- **Flow**: Use total visual rows (not logical line count) for thumb ratio calculation
- **Postcondition**: Scrollbar thumb accurately represents viewport position in wrapped content
- **Business Rules**:
  - BR-16: Scrollbar thumb ratio uses total visual rows

## Invariants

1. **WrapMap consistency**: WrapMap total visual rows == sum of visual rows per logical line
2. **Logical↔Visual bijection**: Every (logical_line, char_offset) maps to exactly one visual row, and vice versa
3. **No wrap in non-prose**: Files without prose extension never produce multi-row wraps
4. **Generation sync**: WrapMap invalidation triggers generation increment for dirty tracking

## Tests

| UC | BR | Test Function |
|----|-----|---------------|
| UC-1 | BR-1 | `soft_wrap_enabled_for_markdown_files()` |
| UC-1 | BR-1 | `soft_wrap_enabled_for_txt_files()` |
| UC-1 | BR-2 | `soft_wrap_disabled_for_source_code()` |
| UC-1 | BR-3 | `soft_wrap_disabled_in_diff_mode()` |
| UC-2 | BR-5 | `line_number_only_on_first_visual_row()` |
| UC-2 | BR-6 | `continuation_rows_have_blank_gutter()` |
| UC-2 | BR-7 | `horizontal_scroll_disabled_with_soft_wrap()` |
| UC-2 | BR-8 | `wide_characters_wrap_correctly()` |
| UC-3 | BR-9 | `cursor_up_down_moves_by_visual_row()` |
| UC-3 | BR-10 | `home_goes_to_visual_row_start()` |
| UC-3 | BR-11 | `end_goes_to_visual_row_end()` |
| UC-4 | BR-13 | `click_on_continuation_row_maps_correctly()` |
| UC-5 | BR-14 | `wrap_map_rebuilt_on_width_change()` |
| UC-5 | BR-15 | `cursor_visible_after_rewrap()` |
| UC-6 | BR-16 | `scrollbar_uses_visual_row_count()` |

## Location

| What | Where |
|------|-------|
| WrapMap | `crates/tide-editor/src/wrap.rs` |
| Soft wrap flag + WrapMap cache | `crates/tide-app/src/editor_pane/mod.rs` (EditorPane) |
| Wrapped rendering | `crates/tide-app/src/editor_pane/rendering.rs` |
| Wrapped cursor movement | `crates/tide-editor/src/cursor.rs` |
| Click mapping | `crates/tide-app/src/action/mod.rs` |
| Behavior tests | `crates/tide-app/src/behavior_tests.rs` |
