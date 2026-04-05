# Spec: Soft Wrap

## Overview

### As-Is
`EditorPane::open()` already marks prose extensions as `soft_wrap = true`, and file-backed Markdown Panes now open with `preview_mode = false` in `crates/tide-app/src/domain/pane/editor.rs`. That means `EditorPane::effective_soft_wrap()` is active immediately for Markdown authoring, while preview mode and diff mode still disable wrapping. The remaining Soft Wrap risk is no longer the open default; it is keeping wrapped authoring behavior, click mapping, scroll state, and preview transitions synchronized across the two Pane modes. In particular, wrapped authoring still mixes logical-line scroll state with visual-row rendering, so a long single-line Markdown paragraph can occupy many visual rows while the Editor Pane still clamps scroll as if only one row existed.

### To-Be
Prose files (`.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`, `.text`) automatically soft-wrap at the viewport width while the Pane is in authoring mode. Visual behavior matches VS Code word wrap:

- Long logical lines wrap to multiple visual rows
- Line numbers appear only on the first visual row of each logical line
- Continuation rows are indented to the same level as the gutter (no extra indent)
- Horizontal scroll is disabled when soft wrap is active
- Cursor Up/Down moves by visual row, not logical line
- Markdown authoring opens directly into the wrapped authoring flow
- Diff mode and preview mode are unaffected (no wrap)

All other file types: no wrap (current behavior preserved).

### Approach

1. Keep `soft_wrap: bool` on `EditorPane` and preserve the current prose extension detection.
2. Preserve the current `preview_mode = false` Markdown open behavior so `effective_soft_wrap()` is active immediately for Markdown authoring.
3. Keep `WrapMap` on `EditorPane` as the cached mapping from logical lines to visual rows, computed from buffer content + viewport column width and invalidated on content change or resize.
4. Continue using WrapMap in rendering (`render_grid_full`) when `soft_wrap` is true:
   - Iterate visual rows instead of logical lines
   - Map each visual row back to (logical_line, char_offset_in_line)
   - Draw line number only when char_offset == 0
   - Skip h_scroll logic entirely
5. Continue mapping cursor rendering (`render_cursor`) from buffer position to visual row via WrapMap.
6. Continue mapping mouse click to cursor position through WrapMap.
7. Continue using visual-row-based scrolling, cursor movement, and scrollbar sizing when Soft Wrap is active.
8. Preserve the existing preview rendering path as a separate layout model that does not share WrapMap.

## Bounded Contexts

| Context | Change |
|---------|--------|
| `domain/editor` | Owns `WrapMap` and visual-row-aware cursor movement behavior. |
| `domain/pane` | Stores `soft_wrap`, caches WrapMap, and applies wrapped rendering, click handling, and scroll behavior. |

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
  - BR-3: Markdown files open in authoring mode so Soft Wrap is active immediately
  - BR-4: Diff mode → always no wrap (regardless of file type)
  - BR-5: Preview mode → unaffected (already has its own wrap)

### UC-2: Render Wrapped Lines
- **Actor**: Renderer
- **Trigger**: Frame render with soft_wrap enabled
- **Precondition**: WrapMap is built for current content + viewport width
- **Flow**: Iterate visual rows. For each, look up (logical_line, offset). Draw line number only if offset == 0. Draw characters from offset until end of visual row or end of logical line.
- **Postcondition**: Text wraps at viewport edge. No horizontal overflow.
- **Business Rules**:
  - BR-6: Line number shown only on first visual row of a logical line
  - BR-7: Continuation rows show blank gutter
  - BR-8: Horizontal scroll disabled when soft wrap is active
  - BR-9: Wide characters (CJK) that would exceed viewport width wrap to next visual row

### UC-3: Cursor Navigation in Wrapped Text
- **Actor**: User
- **Trigger**: Arrow Up/Down key press
- **Precondition**: soft_wrap is true
- **Flow**: Cursor moves by one visual row (not logical line). If cursor is mid-wrap and presses Down, it moves to the next visual row within the same logical line.
- **Postcondition**: Cursor is on the adjacent visual row. Column preserved (desired_col style).
- **Business Rules**:
  - BR-10: Up/Down moves by visual row, not logical line
  - BR-11: Home goes to start of visual row (not logical line start)
  - BR-12: End goes to end of visual row (not logical line end)
  - BR-13: Left/Right at visual row boundary continues within the same logical line (no change from current behavior)

### UC-4: Click in Wrapped Text
- **Actor**: User
- **Trigger**: Mouse click in editor content area
- **Precondition**: soft_wrap is true
- **Flow**: Pixel position → visual row + column → WrapMap lookup → (logical_line, byte_offset)
- **Postcondition**: Cursor placed at correct buffer position
- **Business Rules**:
  - BR-14: Click on continuation row maps to correct position in the logical line

### UC-5: Resize Viewport
- **Actor**: User / system
- **Trigger**: Window resize changes viewport column count
- **Precondition**: soft_wrap is true
- **Flow**: WrapMap invalidated → rebuilt with new width → scroll position adjusted proportionally
- **Postcondition**: Text re-wraps to new width. Cursor remains visible.
- **Business Rules**:
  - BR-15: WrapMap rebuilt on viewport width change
  - BR-16: Cursor visibility ensured after re-wrap (scroll adjusted if needed)

### UC-6: Scrollbar with Wrapped Lines
- **Actor**: Renderer
- **Trigger**: Render scrollbar with soft_wrap enabled
- **Precondition**: WrapMap exists
- **Flow**: Use total visual rows (not logical line count) for thumb ratio calculation
- **Postcondition**: Scrollbar thumb accurately represents viewport position in wrapped content
- **Business Rules**:
  - BR-17: Scrollbar thumb ratio uses total visual rows

### UC-7: Scroll Wrapped Authoring
- **Actor**: User
- **Trigger**: Mouse wheel or trackpad scroll in a soft-wrapped Editor Pane
- **Precondition**: The wrapped content occupies more visual rows than the viewport
- **Flow**: Convert the authoring viewport position into visual-row space, advance or retreat by the requested delta, clamp against total visual rows, then render from the resulting visual row
- **Postcondition**: The user can reach the last visible wrapped row of the document
- **Business Rules**:
  - BR-18: Soft-wrap authoring scroll advances in visual rows, not only whole logical lines
  - BR-19: Soft-wrap scroll clamping uses total visual rows so the wrapped tail remains reachable

## Invariants

1. **WrapMap consistency**: WrapMap total visual rows == sum of visual rows per logical line
2. **Logical↔Visual bijection**: Every (logical_line, char_offset) maps to exactly one visual row, and vice versa
3. **No wrap in non-prose**: Files without prose extension never produce multi-row wraps
4. **Preview separation**: Preview mode never reuses WrapMap for its own layout model
5. **Generation sync**: WrapMap invalidation triggers generation increment for dirty tracking

## Tests

| UC | BR | Test Function |
|----|-----|---------------|
| UC-1 | BR-1 | `soft_wrap_enabled_for_markdown_files()` |
| UC-1 | BR-1 | `soft_wrap_enabled_for_txt_files()` |
| UC-1 | BR-2 | `soft_wrap_disabled_for_source_code()` |
| UC-1 | BR-3 | `markdown_authoring_opens_with_soft_wrap_active()` |
| UC-1 | BR-4 | `soft_wrap_disabled_in_diff_mode()` |
| UC-2 | BR-6 | `line_number_only_on_first_visual_row()` |
| UC-2 | BR-7 | `continuation_rows_have_blank_gutter()` |
| UC-2 | BR-8 | `horizontal_scroll_disabled_with_soft_wrap()` |
| UC-2 | BR-9 | `wide_characters_wrap_correctly()` |
| UC-3 | BR-10 | `cursor_up_down_moves_by_visual_row()` |
| UC-3 | BR-11 | `home_goes_to_visual_row_start()` |
| UC-3 | BR-12 | `end_goes_to_visual_row_end()` |
| UC-4 | BR-14 | `click_on_continuation_row_maps_correctly()` |
| UC-5 | BR-15 | `wrap_map_rebuilt_on_width_change()` |
| UC-5 | BR-16 | `cursor_visible_after_rewrap()` |
| UC-6 | BR-17 | `scrollbar_uses_visual_row_count()` |
| UC-7 | BR-18 | `scrolling_wrapped_markdown_advances_by_visual_row()` |
| UC-7 | BR-19 | `scrolling_wrapped_markdown_reaches_the_last_visual_row()` |

## Location

| What | Where |
|------|-------|
| WrapMap | `crates/tide-app/src/domain/editor/wrap.rs` |
| Soft Wrap flag + WrapMap cache | `crates/tide-app/src/domain/pane/editor.rs` |
| Wrapped rendering | `crates/tide-app/src/domain/pane/editor_rendering.rs` |
| Wrapped cursor movement | `crates/tide-app/src/domain/editor/mod.rs` |
| Click mapping | `crates/tide-app/src/application/services/action_service/mod.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/soft_wrap_behavior.rs` |
