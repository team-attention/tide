# Spec: Search

In-pane text search and replacement: query input, match finding, result
navigation, Editor replacement, and `Search Bar` text presentation.

## Overview

### As-Is

- `SearchState` already stores query text, cursor position, and match navigation state per `Pane`.
- `SearchState` stores an optional replacement input and active field for Editor
  replace workflows.
- The `Search Bar` already renders committed text plus IME preedit inline in `adapter/outward/view/overlays/search_bar.rs`.
- The `Search Bar` caret position uses `visual_width()` while the top-layer text renderer advances one cell per non-space glyph in `adapter/outward/renderer_adapter/mod.rs`.
- Long Hangul input can therefore leave a visible gap between rendered text and the `Search Bar` caret even though the underlying `InputLine` cursor stays on a valid byte boundary.

### To-Be

- Search query entry and match navigation keep their current behavior.
- Editor Panes expose a second replacement field in the Search Bar.
- Replacement is explicit: replace current from the replacement field, or replace
  all matches through the same visible Search Bar state.
- The `Search Bar` committed text, IME preedit, and caret stay visually aligned during long Korean input.
- The `Search Bar` presents committed text and IME preedit with the same width model that drives the caret and IME overlay geometry.

### Approach

1. Preserve the existing `SearchState` query and match lifecycle.
2. Keep replacement state inside `SearchState` so the visible Search Bar is the
   source of truth for human-facing replace.
3. Define a `Search Bar` rendering rule that uses one visual-width model for committed text, IME preedit, and caret placement.
4. Map that rule to behavior tests before changing renderer or overlay code.

## Bounded Contexts

| Context | Role |
|---------|------|
| `state` | Owns `SearchState` and `InputLine` query text per `Pane` |
| `view/overlays` | Renders the `Search Bar` committed text, IME preedit, and caret |
| `renderer` | Draws top-layer glyphs used by the `Search Bar` |
| `adapter/inward/search_adapter` | Handles Search Bar field routing, Editor replacement, and match refresh |

## Use Cases

### UC-1: ExecuteSearch

- **Actor**: User
- **Trigger**: Type query in `Search Bar`
- **Precondition**: `Search Bar` is open on a `Pane`
- **Flow**:
  1. User types query text
  2. `execute_search_editor()` scans all lines for matches
  3. Matches stored with line/col/len
  4. Current match index set
- **Postcondition**: All occurrences found and navigable
- **Business Rules**:
  - BR-1: New `SearchState` has empty input and no matches
  - BR-2: Search finds all occurrences across lines
  - BR-3: Empty search query clears all matches

### UC-2: NavigateMatches

- **Actor**: User
- **Trigger**: Next or previous match action
- **Precondition**: Matches exist
- **Flow**:
  1. `next_match()` increments the current index
  2. `prev_match()` decrements the current index
  3. Search wraps at the boundaries
- **Postcondition**: Current match index updated
- **Business Rules**:
  - BR-4: Display shows `0/0` when no matches
  - BR-5: `next_match()` wraps from last to first
  - BR-6: `prev_match()` wraps from first to last

### UC-3: RenderSearchBarText

- **Actor**: Renderer
- **Trigger**: The `Search Bar` redraws while query text or IME preedit changes
- **Precondition**: A `Pane` has a visible `Search Bar`
- **Flow**:
  1. Tide measures the committed query text before the caret
  2. Tide measures IME preedit text when composition is active
  3. Tide renders committed text, preedit, and caret with one shared visual-width model
- **Postcondition**: The visible `Search Bar` text and caret remain aligned
- **Business Rules**:
  - BR-7: Long Korean query text keeps the rendered `Search Bar` text and caret visually contiguous
  - BR-8: `Search Bar` committed text and IME preedit use the same visual-width rules

### UC-4: ReplaceInEditorSearchBar

- **Actor**: User
- **Trigger**: The focused Editor Pane has an open `Search Bar`
- **Precondition**: The Editor Pane is in source mode
- **Flow**:
  1. The user enters a query.
  2. The user opens the replacement field.
  3. The user enters replacement text.
  4. The user replaces the current match or all current matches.
  5. Tide re-runs search against the updated buffer.
- **Postcondition**: The visible Editor buffer reflects the explicit replacement.
- **Business Rules**:
  - BR-9: Editor `Search Bar` replacement keeps the query and replacement text visible.
  - BR-10: Replace current mutates only the selected current match.
  - BR-11: Replace all mutates the current match set and then refreshes matches.
  - BR-12: Preview mode blocks replacement mutation.

## Invariants

1. Search match discovery remains independent from `Search Bar` rendering.
2. `InputLine.cursor` remains the source of truth for byte-boundary correctness.
3. `Search Bar` rendering uses one visual-width model for committed text, IME preedit, and caret placement.
4. Replacement applies only to Editor source buffers. Preview remains read-oriented.

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `new_search_state_has_empty_input` |
| UC-1 | BR-2 | `search_in_editor_finds_all_occurrences` |
| UC-1 | BR-3 | `empty_search_query_clears_matches` |
| UC-2 | BR-4 | `search_display_shows_zero_of_zero_when_empty` |
| UC-2 | BR-5 | `next_match_wraps_around_from_last_to_first` |
| UC-2 | BR-6 | `prev_match_wraps_around_from_first_to_last` |
| UC-3 | BR-7 | `search_bar_long_hangul_input_keeps_text_and_caret_aligned` |
| UC-3 | BR-8 | `search_bar_inline_preedit_uses_same_visual_width_as_committed_text` |
| UC-4 | BR-9 | `editor_search_bar_replaces_current_match_from_replace_field` |
| UC-4 | BR-10 | `editor_search_bar_replaces_current_match_from_replace_field` |
| UC-4 | BR-11 | `editor_search_bar_replace_all_updates_all_current_matches` |
| UC-4 | BR-12 | `editor_search_bar_replace_does_not_mutate_preview_mode` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Search state | `tide-app` | `crates/tide-app/src/domain/state/search.rs`, `crates/tide-app/src/domain/state/input_line.rs` |
| Search Bar view | `tide-app` | `crates/tide-app/src/adapter/outward/view/overlays/search_bar.rs` |
| Renderer | `tide-app` | `crates/tide-app/src/adapter/outward/renderer_adapter/mod.rs` |
| Behavior tests | `tide-app` | `crates/tide-app/src/application/behavior_tests/search_behavior.rs`, `crates/tide-app/src/application/behavior_tests/ime_behavior.rs` |
