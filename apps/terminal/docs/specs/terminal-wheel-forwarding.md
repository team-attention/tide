# Spec: Terminal Wheel Forwarding

## Overview

### As-Is
Mouse-wheel scroll over a Terminal Pane always drives the local scrollback via
`Terminal::scroll_display()` (see `application/services/action_service/mod.rs`
`PaneKind::Terminal` branch in the `MouseScroll` handler). The terminal **never**
forwards the wheel to the foreground program, and it ignores every relevant
`TermMode` flag.

This breaks full-screen TUIs. When an application enters the **Alternate Screen**
(`DECSET 1049`, e.g. Claude Code, `less`, `vim`, `lazygit`), the active grid is the
alternate grid which is created with **zero scrollback** (`inactive_grid =
Grid::new(num_lines, num_cols, 0)` in the alacritty fork). So `scroll_display()`
cannot move `display_offset`, and because Tide also doesn't translate the wheel into
input for the app, the wheel is completely dead.

### To-Be
On a wheel event over a Terminal Pane, Tide consults the foreground program's
`TermMode` and forwards the wheel to the PTY when the program owns it:

1. **Mouse reporting active** (`MOUSE_MODE` = click/drag/motion): encode the wheel as
   mouse button events (button 64 = up, 65 = down) — SGR encoding when `SGR_MOUSE`,
   otherwise legacy X10 — and write them to the PTY.
2. **Alternate Screen + Alternate Scroll** (`ALT_SCREEN` && `ALTERNATE_SCROLL`):
   translate the wheel into arrow-key sequences (up → Cursor Up, down → Cursor Down),
   respecting `APP_CURSOR` (DECCKM): `ESC O A/B` when set, else `ESC [ A/B`.
3. **Otherwise**: unchanged — scroll the local scrollback via `scroll_display()`.

Mouse reporting takes priority over Alternate Scroll.

### Approach
1. Add `Terminal::wheel_to_bytes(up, lines, col, row) -> Option<Vec<u8>>` in
   `domain/terminal/` that reads `TermMode` and returns the bytes to forward, or
   `None` when the wheel should scroll local scrollback.
2. In the `action_service` Terminal scroll branch, derive the wheel direction/line
   count from the accumulated delta and the cell under the cursor from the
   `MouseScroll` position; if `wheel_to_bytes` returns `Some`, write to the PTY and
   skip `scroll_display`; otherwise keep the existing local-scroll path.

## Bounded Contexts
- **terminal** (`domain/terminal/`): new `wheel_to_bytes()` (mode lookup + sequence
  construction), alongside `key_to_bytes`.
- **action** (`application/services/action_service/mod.rs`): branch the Terminal
  wheel handler between PTY forwarding and local scrollback.

## Use Cases

### UC-1: Forward wheel to a full-screen TUI on the Alternate Screen
- **Actor**: User
- **Trigger**: Wheel scroll over a Terminal Pane whose foreground program is on the
  Alternate Screen with Alternate Scroll enabled
- **Precondition**: `ALT_SCREEN` set, `ALTERNATE_SCROLL` set, `MOUSE_MODE` clear
- **Flow**:
  1. `wheel_to_bytes(up, lines, _, _)` sees Alternate Screen + Alternate Scroll
  2. Emits `lines` copies of Cursor Up (`up`) or Cursor Down (`!up`)
  3. Uses `ESC O A/B` when `APP_CURSOR` is set, else `ESC [ A/B`
  4. `action_service` writes the bytes to the PTY and skips `scroll_display`
- **Postcondition**: The TUI scrolls its own content; local scrollback untouched
- **Business Rules**:
  - BR-1: With Alternate Screen + Alternate Scroll and no mouse reporting, wheel up
    yields Cursor Up and wheel down yields Cursor Down
  - BR-2: `APP_CURSOR` selects SS3 (`ESC O`) vs CSI (`ESC [`) arrow encoding
  - BR-3: The number of emitted arrow sequences equals the wheel line count

### UC-2: Forward wheel to a mouse-reporting program
- **Actor**: User
- **Trigger**: Wheel scroll over a Terminal Pane whose foreground program enabled
  mouse reporting
- **Precondition**: any `MOUSE_MODE` flag set
- **Flow**:
  1. `wheel_to_bytes(up, lines, col, row)` sees mouse reporting (priority over
     Alternate Scroll)
  2. Emits `lines` wheel button events: button 64 (up) / 65 (down) at the cursor cell
  3. SGR (`ESC [ < b ; x ; y M`) when `SGR_MOUSE`, else X10 (`ESC [ M Cb Cx Cy`)
- **Postcondition**: The program receives wheel events at the cursor cell
- **Business Rules**:
  - BR-4: Mouse reporting takes priority over Alternate Scroll
  - BR-5: SGR encoding is used when `SGR_MOUSE` is set; otherwise X10 with each byte
    offset by 32 and clamped to the legacy 223-column limit
  - BR-6: Reported cell coordinates are 1-based (col+1, row+1) and clamped to the grid

### UC-3: Plain output keeps local scrollback
- **Actor**: User
- **Trigger**: Wheel scroll over a Terminal Pane running ordinary output (shell,
  `cat`, build logs)
- **Precondition**: `ALT_SCREEN` clear and `MOUSE_MODE` clear
- **Flow**:
  1. `wheel_to_bytes` returns `None`
  2. `action_service` scrolls the local scrollback via `scroll_display` (unchanged)
- **Postcondition**: Existing scrollback behavior is preserved
- **Business Rules**:
  - BR-7: With neither mouse reporting nor Alternate Screen, `wheel_to_bytes` returns
    `None` and local scrollback scrolling is used
  - BR-8: On the Alternate Screen with Alternate Scroll **disabled** and no mouse
    reporting, `wheel_to_bytes` returns `None`

## Invariants
- Hexagonal dependency direction (Architecture Invariant #7): the wheel decision is a
  service-layer concern calling `Terminal` backend methods; the inward scroll adapter
  still routes through the existing port path.
- No change to local scrollback semantics for the non-TUI case (UC-3).

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-1 | BR-1 | `wheel_up_on_alt_screen_sends_cursor_up()` |
| UC-1 | BR-1 | `wheel_down_on_alt_screen_sends_cursor_down()` |
| UC-1 | BR-2 | `wheel_on_alt_screen_with_app_cursor_uses_ss3()` |
| UC-1 | BR-3 | `wheel_lines_emit_repeated_arrow_sequences()` |
| UC-2 | BR-4 | `mouse_reporting_takes_priority_over_alternate_scroll()` |
| UC-2 | BR-5 | `wheel_with_sgr_mouse_uses_sgr_encoding()` |
| UC-2 | BR-5 | `wheel_with_x10_mouse_uses_legacy_encoding()` |
| UC-2 | BR-6 | `wheel_mouse_report_uses_one_based_clamped_cell()` |
| UC-3 | BR-7 | `wheel_on_plain_screen_returns_none()` |
| UC-3 | BR-8 | `wheel_on_alt_screen_without_alternate_scroll_returns_none()` |

## Location
- `domain/terminal/wheel_input.rs` — new `Terminal::wheel_to_bytes()`
- `domain/terminal/tests.rs` — behavior tests
- `application/services/action_service/mod.rs` — Terminal wheel branch wiring
