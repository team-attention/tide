# Spec: Terminal Pane Inset

## Overview

### As-Is
`crates/tide-app/src/layout_compute.rs`, `crates/tide-app/src/adapter/outward/view/grid.rs`, and `crates/tide-app/src/adapter/outward/view/cursor.rs` all start `Terminal Pane` content at `TAB_BAR_HEIGHT` with no extra top inset. `crates/tide-app/src/application/services/text_extract_service/mod.rs`, `crates/tide-app/src/adapter/inward/click_adapter/hit_test.rs`, and `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` mirror that same origin for pointer and IME cursor-area mapping. `crates/tide-app/src/adapter/outward/view/ime.rs` also paints terminal IME preedit text from that same tab-bar edge. The result is that the first terminal row visually sits against the tab bar, with no breathing room above it.

### To-Be
`Terminal Pane` content should start below the tab bar with a small, cell-relative top inset that matches typical terminal presentation. Tide must use that same inset consistently for rendering, row sizing, pointer mapping, and IME cursor positioning so the first visible row remains visually padded and interaction coordinates stay truthful.

### Approach
1. Introduce a shared `Terminal Pane` top inset helper derived from terminal cell height.
2. Use that helper in the terminal layout/resize path and in terminal grid/cursor rendering.
3. Use the same helper in terminal hit-testing, text extraction, and IME cursor-area mapping.
4. Cover the behavior with behavior tests for the inset value, first-row click mapping, and terminal IME cursor positioning.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| `layout_compute` | Derive the `Terminal Pane` content rect used for PTY row sizing. |
| `adapter/outward/view` | Render the terminal grid, cursor, and highlights using the same content origin. |
| `adapter/inward/click_adapter` | Map pixel positions to terminal cells and pane-content hover targets. |
| `adapter/inward/event_loop_adapter` | Position the terminal IME cursor area from the same inset-adjusted origin. |
| `adapter/outward/view/ime` | Paint terminal IME preedit text from the same inset-adjusted origin. |
| `application/services/text_extract_service` | Resolve terminal URL/file extraction from inset-adjusted pointer coordinates. |

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

## Invariants

1. `Terminal Pane` left/right padding remains `PANE_PADDING`.
2. `Terminal Pane` top inset scales with terminal cell height rather than using a fixed pixel literal.
3. Terminal render and terminal interaction paths must share the same inset calculation.

## Tests

| UC | BR | Test Function |
|----|----|---------------|
| UC-1 | BR-1 | `terminal_content_top_offset_is_half_a_cell` |
| UC-1 | BR-4 | `terminal_ime_cursor_area_uses_the_terminal_top_inset` |
| UC-2 | BR-2, BR-3 | `terminal_click_mapping_respects_the_terminal_top_inset` |

## Location

| What | Where |
|------|-------|
| Terminal content inset helper | `crates/tide-app/src/theme.rs` |
| Terminal layout/resize rect | `crates/tide-app/src/layout_compute.rs` |
| Terminal grid, cursor, and IME preedit rendering | `crates/tide-app/src/adapter/outward/view/grid.rs`, `crates/tide-app/src/adapter/outward/view/cursor.rs`, `crates/tide-app/src/adapter/outward/view/ime.rs` |
| Terminal pointer mapping | `crates/tide-app/src/adapter/inward/click_adapter/hit_test.rs`, `crates/tide-app/src/application/services/text_extract_service/mod.rs` |
| Terminal IME cursor area | `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/terminal_pane_inset.rs` |
