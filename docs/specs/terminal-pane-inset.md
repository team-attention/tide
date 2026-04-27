# Spec: Terminal Pane Inset

## Overview

### As-Is
`crates/tide-app/src/layout_compute.rs`, `crates/tide-app/src/adapter/outward/view/grid.rs`, and `crates/tide-app/src/adapter/outward/view/cursor.rs` all start `Terminal Pane` content at `TAB_BAR_HEIGHT` with no extra top inset. `crates/tide-app/src/application/services/text_extract_service/mod.rs`, `crates/tide-app/src/adapter/inward/click_adapter/hit_test.rs`, and `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` mirror that same origin for pointer and IME cursor-area mapping. `crates/tide-app/src/adapter/outward/view/ime.rs` also paints terminal IME preedit text from that same tab-bar edge. The result is that the first terminal row visually sits against the tab bar, with no breathing room above it.

### To-Be
`Terminal Pane` content should start below the tab bar with a small, cell-relative top inset that matches typical terminal presentation. Tide must use that same inset consistently for rendering, row sizing, pointer mapping, and IME cursor positioning so the first visible row remains visually padded and interaction coordinates stay truthful.

Terminal backend resize should also happen only after transient layout motion settles. Window resizing, side-surface visibility animation, and border dragging may change the rendered `Terminal Pane` rect repeatedly, but Tide should not resize the PTY on every intermediate frame because prompt renderers can leave stale right-prompt fragments in the grid.

`Terminal Pane` glyphs should also stay left-anchored inside the padded content rect. Centering the grid inside the remaining sub-cell width makes the glyph origin change whenever a right-side surface drag changes `rect.width`, which reads as text jitter even when the PTY size is correctly deferred.

### Approach
1. Introduce a shared `Terminal Pane` top inset helper derived from terminal cell height.
2. Use that helper in the terminal layout/resize path and in terminal grid/cursor rendering.
3. Use the same helper in terminal hit-testing, text extraction, and IME cursor-area mapping.
4. Defer Terminal backend resize while the app is inside a transient layout transition.
5. Send the final PTY resize immediately once the layout transition has settled.
6. Keep terminal grid glyphs left-anchored inside the padded content rect so transient right-edge width changes do not move already-rendered text.
7. Cover the behavior with behavior tests for the inset value, first-row click mapping, terminal IME cursor positioning, grid-origin stability, and resize stability.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| `layout_compute` | Derive the `Terminal Pane` content rect used for PTY row sizing. |
| `adapter/outward/view` | Render the terminal grid, cursor, and highlights using the same content origin. |
| `adapter/inward/click_adapter` | Map pixel positions to terminal cells and pane-content hover targets. |
| `adapter/inward/event_loop_adapter` | Position the terminal IME cursor area from the same inset-adjusted origin. |
| `adapter/outward/view/ime` | Paint terminal IME preedit text from the same inset-adjusted origin. |
| `application/services/text_extract_service` | Resolve terminal URL/file extraction from inset-adjusted pointer coordinates. |
| `domain/terminal` | Apply the final PTY resize immediately after layout-level coalescing. |

## Use Cases

### UC-1: LayoutTerminalPaneContent
- **Actor**: Tide
- **Trigger**: Tide computes layout and renders a `Terminal Pane`
- **Precondition**: The `Terminal Pane` has a known cell size
- **Flow**:
  1. Tide derives a terminal top inset from the current cell height
  2. Tide positions the first visible terminal row below `TAB_BAR_HEIGHT + inset`
  3. Tide uses the same inset for terminal row sizing and terminal overlay rendering
- **Postcondition**: The first visible terminal row no longer touches the tab bar
- **Business Rules**:
  - BR-1: `Terminal Pane` content starts half a cell below the tab bar
  - BR-4: Terminal IME cursor geometry uses the same inset-adjusted origin as terminal rendering
  - BR-9: `Terminal Pane` grid origin stays left-anchored inside the padded content rect when the rect width changes.
  - BR-10: Terminal pointer mapping uses the same left-anchored grid origin as terminal rendering.

### UC-2: MapTerminalCoordinates
- **Actor**: User
- **Trigger**: The user clicks or hovers inside a `Terminal Pane`
- **Precondition**: The `Terminal Pane` content rect is visible
- **Flow**:
  1. Tide derives the inset-adjusted terminal content origin
  2. Tide rejects pointer positions that fall inside the top inset
  3. Tide maps pointer positions on visible terminal rows to row/column coordinates from the inset-adjusted origin
- **Postcondition**: Pointer mapping matches the rendered terminal content
- **Business Rules**:
  - BR-2: Pointer positions inside the terminal top inset do not map to terminal row 0
  - BR-3: Pointer positions on the first visible terminal row still map to row 0 after the inset is applied

### UC-3: StabilizeTerminalResize
- **Actor**: Tide
- **Trigger**: A `Terminal Pane` rect changes because the window, Dock, FileTree View, Workspace rail, or split border is moving
- **Precondition**: A `Terminal Pane` is visible
- **Flow**:
  1. Tide detects whether the layout change is transient.
  2. While transient, Tide recomputes visual rects for chrome but does not resize the Terminal backend.
  3. When the transition settles, Tide computes the final content rect and resizes the Terminal backend once.
  4. The Terminal backend sends the final PTY resize immediately.
- **Postcondition**: Prompt redraw happens at the stable final size instead of accumulating resize artifacts across intermediate widths.
- **Business Rules**:
  - BR-5: Deferred window resize must not resize the Terminal backend before the deferred layout settles.
  - BR-6: Side-surface visibility animation must not resize the Terminal backend on intermediate animation frames.
  - BR-7: The final settled layout must resize the Terminal backend to the final visible content size.
  - BR-8: `Terminal::resize()` must not add a second internal debounce after layout-level coalescing.

## Invariants

1. `Terminal Pane` left/right padding remains `PANE_PADDING`.
2. `Terminal Pane` top inset scales with terminal cell height rather than using a fixed pixel literal.
3. Terminal render and terminal interaction paths must share the same inset calculation.
4. Terminal backend resize is coalesced by layout state, not by changing the terminal grid on every transient frame.
5. Terminal glyph x-origin is independent of the content rect width.

## Tests

| UC | BR | Test Function |
|----|----|---------------|
| UC-1 | BR-1 | `terminal_content_top_offset_is_half_a_cell` |
| UC-1 | BR-4 | `terminal_ime_cursor_area_uses_the_terminal_top_inset` |
| UC-1 | BR-9 | `terminal_grid_origin_stays_left_anchored_when_width_changes` |
| UC-2 | BR-2, BR-3 | `terminal_click_mapping_respects_the_terminal_top_inset` |
| UC-2 | BR-10 | `terminal_click_mapping_uses_left_anchored_grid_origin` |
| UC-3 | BR-5, BR-7 | `terminal_backend_resize_waits_for_deferred_window_resize_to_settle` |
| UC-3 | BR-6, BR-7 | `terminal_backend_resize_waits_for_side_surface_animation_to_settle` |
| UC-3 | BR-8 | `terminal_resize_applies_without_internal_debounce` |

## Location

| What | Where |
|------|-------|
| Terminal content inset helper | `crates/tide-app/src/theme.rs` |
| Terminal layout/resize rect | `crates/tide-app/src/layout_compute.rs` |
| Terminal backend resize | `crates/tide-app/src/domain/terminal/mod.rs` |
| Terminal grid, cursor, and IME preedit rendering | `crates/tide-app/src/adapter/outward/view/grid.rs`, `crates/tide-app/src/adapter/outward/view/cursor.rs`, `crates/tide-app/src/adapter/outward/view/ime.rs` |
| Terminal pointer mapping | `crates/tide-app/src/adapter/inward/click_adapter/hit_test.rs`, `crates/tide-app/src/application/services/text_extract_service/mod.rs` |
| Terminal IME cursor area | `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/terminal_pane_inset.rs` |
