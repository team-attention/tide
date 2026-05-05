# Spec: Markdown Preview Performance Polish

## Overview
### As-Is
Markdown Panes already open in authoring mode with `LivePreviewMode` enabled, and prose files already use `Soft Wrap`. Long Markdown files still have two scroll-time costs in the current render path. `LivePreviewMap` stores a sorted flat element list, so line-specific lookups derive hidden syntax ranges by scanning the whole element list. The live-preview renderer also recomputes a visible line's byte start by summing all prior buffer lines. `WrapMap` stores logical-line visual row offsets, but mapping a visual sub-row inside a long logical line still walks from the start of that line. Full preview mode also renders through the existing cell grid with no readable maximum width, so wide Panes stretch Markdown text across the full Pane instead of presenting a calmer read-oriented surface.

### To-Be
Markdown scrolling keeps cache work proportional to the visible region and the touched logical lines. `LivePreviewMap` provides cached line start offsets, line-scoped element lookup, line-scoped hidden syntax ranges, and line-scoped style ranges. `WrapMap` stores visual-row start information per logical line so scrolled sub-row lookup does not rescan from the beginning of long wrapped lines. Full preview mode uses a bounded readable width with a centered content inset on wide Panes while preserving compact behavior on narrow Panes.

### Approach
1. Extend `LivePreviewMap` with line start offsets, a per-line element index, cached hidden syntax ranges, and cached style ranges built alongside the existing sorted element list.
2. Update live-preview rendering to read line byte starts from `LivePreviewMap`.
3. Extend `WrapMap` with cached `VisualRowInfo` entries for each logical line.
4. Keep the current `Soft Wrap` semantics and line-number behavior while replacing repeated sub-row walks with cached lookup.
5. Add preview width helpers so full preview mode wraps to a readable maximum width and centers the rendered preview content on wide Panes.

## Bounded Contexts
| Context | Role |
|---------|------|
| `domain/editor` | Owns `LivePreviewMap`, Markdown parsing metadata, and `WrapMap` visual-row lookup. |
| `domain/pane` | Owns Markdown Pane cache preparation, preview wrapping width, and preview rendering. |
| `adapter/outward/view` | Calls Pane cache preparation before rendering and redraws the Pane grid when scroll state changes. |

## Use Cases

### UC-1: ScrollLivePreviewInLongMarkdownPane
- **Actor**: User
- **Trigger**: The user scrolls a Markdown Pane in `LivePreviewMode`
- **Precondition**: The Markdown Pane has many lines or many Markdown elements
- **Flow**:
  1. Tide prepares the `LivePreviewMap` for the current buffer generation.
  2. The renderer asks for hidden syntax ranges on visible lines.
  3. The renderer asks for each visible line's source byte start.
  4. Tide renders only the visible rows and reuses cached line metadata.
- **Postcondition**: Scroll-time lookup avoids scanning all prior lines or all Markdown elements for every visible row.
- **Business Rules**:
  - BR-1: `LivePreviewMap` stores a cached byte start for each buffer line.
  - BR-2: `LivePreviewMap` stores a per-line element index for line-scoped lookup.
  - BR-3: Live-preview rendering obtains visible-line byte starts from `LivePreviewMap`.
  - BR-18: `LivePreviewMap` stores hidden inline syntax ranges per line.
  - BR-19: Live-preview rendering checks hidden syntax ranges with a monotonic range index while walking a visible line.
  - BR-20: `LivePreviewMap` stores line-scoped style ranges that match `element_style` for monotonically increasing byte offsets.
  - BR-21: Live-preview rendering checks element styles with a monotonic style range index while walking a visible line.

### UC-2: ScrollSoftWrappedLongLine
- **Actor**: User
- **Trigger**: The user scrolls a soft-wrapped prose file containing very long logical lines
- **Precondition**: `Soft Wrap` is active and a logical line spans many visual rows
- **Flow**:
  1. Tide builds `WrapMap` for the current buffer generation and wrap width.
  2. `WrapMap` records `VisualRowInfo` for each visual row of each logical line.
  3. Scroll and render paths map a visual row to its logical line and sub-row start through cached row info.
- **Postcondition**: Mapping a wrapped visual row inside a long logical line does not rescan from the logical line start.
- **Business Rules**:
  - BR-4: `WrapMap` stores cached `VisualRowInfo` entries for wrapped sub-rows.
  - BR-5: `visual_row_to_line_info` returns cached row info for the requested visual row.
  - BR-6: Existing `Soft Wrap` line-number and cursor semantics are preserved.
  - BR-16: `visual_row_info_for_line` returns cached row info for a logical line's wrapped sub-row.

### UC-3: ReadFullMarkdownPreview
- **Actor**: User
- **Trigger**: The user switches a Markdown Pane to full preview mode
- **Precondition**: The Markdown Pane is wide enough for the preview to exceed a comfortable reading measure
- **Flow**:
  1. Tide computes a preview wrap width from the Pane rect and current `Cell Size`.
  2. Wide Panes clamp preview text to the Markdown preview readable width.
  3. The renderer centers the preview content inside the available preview rect.
- **Postcondition**: Full preview mode reads as a calmer Markdown document without changing editor buffer semantics.
- **Business Rules**:
  - BR-7: Full preview mode caps Markdown wrapping at the readable preview width on wide Panes.
  - BR-8: Full preview mode centers the rendered preview content when the Pane is wider than the readable preview width.
  - BR-9: Narrow Panes keep using the available preview width instead of clipping to the readable preview width.

### UC-4: ScrollTableHeavyPreview
- **Actor**: User
- **Trigger**: The user scrolls full preview mode in a Markdown Pane with many table rows
- **Precondition**: The preview cache contains one or more large Markdown tables
- **Flow**:
  1. Tide renders table preview output into compact row lines.
  2. Tide avoids body-row separator lines between every table row.
  3. The preview renderer slices the visible preview range directly from the cached lines.
- **Postcondition**: Table-heavy previews produce fewer cached rows and less scroll-time iteration.
- **Business Rules**:
  - BR-10: Table preview emits only structural separators needed for the table outline and header boundary, not one separator before every body row.
  - BR-11: Preview rendering iterates only the visible cached preview line range.

### UC-5: RenderLongMarkdownPreview
- **Actor**: User
- **Trigger**: The user opens full preview mode for a Markdown Pane with long prose lines, long inline code, or long path-heavy rows
- **Precondition**: The Markdown Pane contains long logical lines that wrap into multiple preview rows
- **Flow**:
  1. Tide parses the Markdown buffer into preview lines.
  2. Tide coalesces adjacent text with the same style while building preview lines.
  3. Tide wraps overlong inline code spans instead of allowing a single preview line to exceed the preview width.
- **Postcondition**: Long Markdown preview cache build and visible-row rendering create fewer spans and avoid overwide preview lines.
- **Business Rules**:
  - BR-12: Adjacent preview text with the same `TextStyle` is coalesced into one `StyledSpan` per visual run.
  - BR-13: Inline code that is wider than the preview width wraps across preview lines instead of producing an overwide cached line.

### UC-6: ScrollLongLivePreviewLine
- **Actor**: User
- **Trigger**: The user scrolls a Markdown Pane in `LivePreviewMode` where one logical line wraps into many visual rows
- **Precondition**: The Markdown Pane uses `Soft Wrap` and has long prose lines with ordinary text outside Markdown elements
- **Flow**:
  1. Tide obtains syntax-highlighted `StyledSpan` runs for visible logical lines.
  2. Tide resolves fallback `TextStyle` for non-Markdown-styled characters through a monotonic `StyledSpanCursor`.
  3. Tide starts each visible sub-row from cached `VisualRowInfo` offsets instead of walking from the logical line start.
  4. Tide advances the cursor as character indexes increase instead of scanning from the first span for every character.
- **Postcondition**: Live-preview rendering for long wrapped lines avoids repeated prefix scans through `StyledSpan` runs and repeated prefix walks through logical-line text.
- **Business Rules**:
  - BR-14: `StyledSpanCursor` returns the same `TextStyle` as prefix scanning for monotonically increasing character indexes.
  - BR-15: Live-preview rendering uses `StyledSpanCursor` for fallback syntax style resolution.
  - BR-17: Live-preview soft-wrap rendering starts cursor and non-cursor sub-row rendering from cached `VisualRowInfo` offsets.

## Invariants
1. `LivePreviewMode` remains authoring mode and stays separate from full preview mode.
2. `Soft Wrap` line numbers still render only on the first visual row of each logical line.
3. Scroll-only changes do not rebuild `LivePreviewMap` or `WrapMap`.
4. Preview readability changes do not mutate `EditorState`.

## Tests
| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1, BR-3 | `live_preview_tests` | `live_preview_map_exposes_cached_line_byte_starts` |
| UC-1 | BR-2 | `live_preview_tests` | `live_preview_map_counts_elements_by_line` |
| UC-1 | BR-18 | `live_preview_tests` | `live_preview_map_exposes_cached_hidden_syntax_ranges_by_line` |
| UC-1 | BR-19 | implementation | `render_live_preview_grid`, `render_live_preview_soft_wrap_grid` hidden syntax lookup |
| UC-1 | BR-20 | `live_preview_tests` | `live_preview_map_line_style_cursor_matches_element_style_for_monotonic_offsets` |
| UC-1 | BR-21 | implementation | `render_live_preview_grid`, `render_live_preview_soft_wrap_grid` element style lookup |
| UC-2 | BR-4, BR-5 | `soft_wrap_behavior` | `wrap_map_returns_cached_info_for_long_wrapped_sub_rows` |
| UC-2 | BR-6 | existing | `line_number_only_on_first_visual_row`, `cursor_up_down_moves_by_visual_row` |
| UC-2 | BR-16 | `soft_wrap_behavior` | `wrap_map_returns_direct_info_for_logical_sub_row` |
| UC-3 | BR-7, BR-8 | `preview_scroll` | `wide_markdown_preview_uses_centered_readable_width` |
| UC-3 | BR-9 | `preview_scroll` | `narrow_markdown_preview_uses_available_width` |
| UC-4 | BR-10 | `preview_scroll` | `table_heavy_markdown_preview_uses_compact_table_rows` |
| UC-4 | BR-11 | implementation | `render_preview_lines_grid` visible-range slice |
| UC-5 | BR-12 | `preview_scroll` | `long_markdown_paragraph_coalesces_plain_text_spans` |
| UC-5 | BR-13 | `preview_scroll` | `overwide_inline_code_wraps_within_preview_width` |
| UC-6 | BR-14 | `preview_scroll` | `styled_span_cursor_matches_prefix_scan_for_monotonic_access` |
| UC-6 | BR-15 | implementation | `render_live_preview_grid`, `render_live_preview_soft_wrap_grid` fallback style lookup |
| UC-6 | BR-17 | implementation | `render_live_preview_soft_wrap_grid` starts from cached `VisualRowInfo` |

## Location
| What | Location |
|------|----------|
| Spec | `docs/specs/markdown-preview-performance-polish.md` |
| LivePreviewMap | `crates/tide-app/src/domain/editor/markdown.rs` |
| StyledSpanCursor | `crates/tide-app/src/domain/editor/highlight.rs` |
| WrapMap | `crates/tide-app/src/domain/editor/wrap.rs` |
| Markdown Pane cache and preview width helpers | `crates/tide-app/src/domain/pane/editor.rs` |
| Markdown Pane rendering | `crates/tide-app/src/domain/pane/editor_rendering.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/` |
