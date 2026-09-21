# Spec: Flush Pane Content Geometry

## Overview

### As-Is

`pane_content_rect()` adds `PANE_PADDING` to the left edge, removes it from both horizontal sides, and removes it from the bottom. `Terminal Pane` paths also add a rounded half-cell top inset through `terminal_content_top(cell_height)`. Rendering, PTY resize, pointer mapping, selection, scrolling, search, completion placement, IME, and text extraction repeat parts of this arithmetic, so their usable rectangles can diverge.

Editor, Diff, and Markdown Pane content starts from the same padded base rectangle before applying semantic gutters or readable-column centering. Launcher uses that base rectangle before centering its choices. Browser Pane native geometry is already handled by its dedicated flush `browser_webview_frame()` path.

`Terminal::resize()` forwards layout-settled width changes into the underlying `alacritty_terminal::Term::resize()` primary screen path. Tide coalesces transient layout changes while still allowing throttled live resize during longer border drags and side-surface animations.

### To-Be

Every Pane base content rectangle uses the full Pane width and all remaining height immediately below the header: its x-coordinate equals the Pane x-coordinate, its y-coordinate equals the Pane y-coordinate plus `TAB_BAR_HEIGHT`, its width equals the Pane width, and its height equals the Pane height minus `TAB_BAR_HEIGHT`.

Terminal rendering, PTY sizing, pointer mapping, cursor, IME, selection, scrolling, search, completions, and text extraction derive from that shared rectangle. Editor, Diff, and Markdown Pane content starts from the same base rectangle before applying semantic editor gutters, scrollbar reservations, or Markdown readable-column centering. `PANE_PADDING` remains available for non-content chrome such as popups, navigation controls, and FileTree View hierarchy indentation. Browser Pane native geometry remains on its dedicated already-flush frame helper. Launcher uses the flush base rectangle while retaining its internal centering and minimum spacing.

### Approach

1. Make `pane_content_rect()` return the full Pane width and remaining height below the header.
2. Remove the terminal-only half-cell inset and use `TAB_BAR_HEIGHT` directly at every terminal content boundary.
3. Derive Terminal PTY rows and columns from `pane_content_rect()`.
4. Route terminal render, cursor, IME, pointer, selection, and text extraction through the same content rectangle.
5. Derive Editor, Diff, Markdown preview, scroll, search, and completion geometry from the shared base rectangle and existing viewport helpers.
6. Preserve semantic internal spacing, non-content chrome padding, Browser Pane native-frame behavior, and Launcher centering.
7. Preserve layout-level PTY resize coalescing, normal primary-screen reflow, and the minimum readable Terminal backend width.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| `domain/pane` | Define the shared flush Pane content rectangle. |
| `layout_compute` | Derive Terminal Pane PTY rows and columns from shared content geometry. |
| `adapter/outward/view` | Render Pane content, cursor, IME, and completion overlays from the same geometry. |
| `adapter/inward` | Map pointer, selection, scroll, and search coordinates through the shared rectangle. |
| `application/services` | Use shared content geometry for actions and terminal text extraction. |
| `domain/terminal` | Apply final and throttled live PTY resize without adding an internal debounce. |

## Use Cases

### UC-1: LayoutFlushPaneContent

- **Actor**: Tide
- **Trigger**: Tide lays out or renders Pane content
- **Precondition**: The Pane has a visible rectangle and header
- **Flow**:
  1. Tide subtracts only the shared header height from the Pane rectangle.
  2. Tide preserves the full Pane width and all remaining height.
  3. Pane-specific rendering applies only its semantic internal geometry after receiving the shared rectangle.
- **Postcondition**: Pane content is flush with the Pane edges below the header.
- **Business Rules**:
  - BR-1: `pane_content_rect()` returns `x = pane.x`, `y = pane.y + TAB_BAR_HEIGHT`, `width = pane.width`, and `height = pane.height - TAB_BAR_HEIGHT`, clamped to at least one logical pixel.
  - BR-4: Terminal grid, cursor, and IME geometry start at the same flush content origin.
  - BR-9: Terminal glyphs remain left-anchored at the shared content x-origin when Pane width changes.
  - BR-14: Editor, Diff, and Markdown Pane content starts from the shared flush base rectangle before semantic gutters and readable-column logic.
  - BR-18: Editor render and interaction geometry uses the same content rectangle after any notification or save-confirm bar.
  - BR-16: Browser Pane native geometry remains on the dedicated already-flush `browser_webview_frame()` path.
  - BR-17: Launcher uses the flush base rectangle while retaining internal centering and minimum spacing.

### UC-2: MapFlushPaneCoordinates

- **Actor**: User
- **Trigger**: The user points, selects, scrolls, searches, or requests completion inside a Pane
- **Precondition**: The Pane content rectangle is visible
- **Flow**:
  1. Tide derives the same shared content rectangle used by rendering.
  2. Tide rejects positions in the header.
  3. Tide maps content positions and visible capacity from the shared rectangle plus Pane-specific semantic geometry.
- **Postcondition**: Interaction coordinates and visible capacity match rendered Pane content.
- **Business Rules**:
  - BR-2: Pointer positions in the header do not map to content row 0.
  - BR-3: Pointer positions on the first visible content row map to row 0.
  - BR-10: Terminal pointer, selection, and extraction paths use the same left-anchored origin as terminal rendering.
  - BR-15: Scroll, search, and completion capacity uses the shared content rectangle and existing Editor Pane viewport helpers instead of duplicated base padding.

### UC-3: StabilizeTerminalResize

- **Actor**: Tide
- **Trigger**: A `Terminal Pane` rect changes because the Tide Window, Dock, FileTree View, Workspace rail, or split border is moving
- **Precondition**: A `Terminal Pane` is visible
- **Flow**:
  1. Tide detects whether the layout change is transient.
  2. Tide coalesces rapid transient Terminal backend resizes while keeping visual rectangles current.
  3. Tide may deliver throttled live PTY resizes during longer motion.
  4. When the transition settles, Tide computes the final shared content rectangle and resizes the Terminal backend.
- **Postcondition**: Terminal backend dimensions match the stable rendered grid without accumulating resize artifacts.
- **Business Rules**:
  - BR-5: Deferred Tide Window resize must not resize the Terminal backend before the deferred layout settles.
  - BR-6: Side-surface visibility animation must not resize the Terminal backend on every intermediate animation frame.
  - BR-7: The final settled layout must resize the Terminal backend to the final visible content size.
  - BR-8: `Terminal::resize()` must not add a second internal debounce after layout-level coalescing.
  - BR-11: A layout-driven primary-screen width resize must use normal terminal reflow instead of truncating visible output.
  - BR-12: A layout-driven Terminal Pane width shrink below the minimum readable backend width must clamp the PTY to the minimum readable backend column count.
  - BR-13: Border dragging and side-surface visibility animation may deliver throttled live PTY resizes while motion is active, but never on every frame.

## Invariants

1. Base Pane content has no `PANE_PADDING` inset.
2. Terminal content begins exactly at the bottom edge of the shared header.
3. Render, PTY resize, hit-test, cursor, IME, selection, and text extraction share one Terminal Pane content rectangle.
4. Editor render, pointer, selection, IME, scroll, search, and completion paths share the same content rectangle, including any notification or save-confirm bar offset, before semantic spacing.
5. `PANE_PADDING` remains available for non-content chrome and semantic internal spacing.
6. Browser Pane native geometry remains dedicated and flush.
7. Launcher internal centering remains intact after its base rectangle becomes flush.
8. Terminal backend resize remains coalesced by layout state and terminal glyph x-origin remains independent of content width.

## Tests

| UC | BR | Test Function |
|----|----|---------------|
| UC-1 | BR-1 | `pane_content_rect_uses_full_width_below_header` |
| UC-1 | BR-4 | `terminal_ime_cursor_area_starts_at_the_content_origin` |
| UC-1 | BR-9 | `terminal_grid_origin_stays_left_anchored_when_width_changes` |
| UC-1 | BR-14 | `editor_content_rect_uses_full_pane_width_below_header` |
| UC-1 | BR-18 | `editor_click_target_tracks_optional_pane_bar` |
| UC-2 | BR-2, BR-3 | `terminal_click_mapping_starts_at_the_content_origin` |
| UC-2 | BR-10 | `terminal_click_mapping_uses_left_anchored_grid_origin` |
| UC-2 | BR-15 | `preview_visible_rows_use_full_content_height` |
| UC-3 | BR-5, BR-7 | `terminal_backend_resize_waits_for_deferred_window_resize_to_settle` |
| UC-3 | BR-6, BR-7, BR-13 | `terminal_backend_resize_throttles_live_updates_during_side_surface_animation` |
| UC-3 | BR-8 | `terminal_resize_applies_without_internal_debounce` |
| UC-3 | BR-11 | `resize_reflows_primary_screen` in `crates/alacritty_terminal/src/term/mod.rs` |
| UC-3 | BR-12 | `terminal_backend_resize_skips_pathologically_narrow_widths` |
| UC-3 | BR-13 | `terminal_backend_resize_throttles_live_updates_during_border_drag` |

## Location

| What | Where |
|------|-------|
| Shared Pane content rectangle | `crates/tide-app/src/domain/pane/mod.rs` |
| Terminal layout/resize rectangle | `crates/tide-app/src/layout_compute.rs` |
| Terminal backend resize | `crates/tide-app/src/domain/terminal/mod.rs` |
| Pane content rendering | `crates/tide-app/src/adapter/outward/view/` |
| Pointer, selection, scroll, and search mapping | `crates/tide-app/src/adapter/inward/` |
| Terminal text extraction | `crates/tide-app/src/application/services/text_extract_service/mod.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/` |
