# Terminal Mouse Reporting

Terminal applications can opt in to receive mouse input using DEC private modes.
When a terminal pane has mouse reporting enabled, mouse events over that pane's
grid are forwarded to the PTY instead of starting Tide-local text selection.

## Use Cases

### UC-1: Button Press And Release

When a program enables normal tracking (`DECSET 1000`), a mouse press inside the
terminal grid is reported to the program. The matching release is also reported,
even if the pointer has moved slightly outside the grid; coordinates clamp to
the pane edge.

### UC-2: Button Drag

When a program enables button-event tracking (`DECSET 1002`) or any-motion
tracking (`DECSET 1003`), pointer movement while a reported button is held is
forwarded as a drag report.

### UC-3: Any Motion

When a program enables any-motion tracking (`DECSET 1003`), pointer movement
with no button pressed is forwarded as a motion report while the pointer is over
the terminal grid. Forwarding the report does not move keyboard focus between
Panes; only an explicit press may focus the target Terminal Pane.

### UC-4: Coordinate Encoding

When SGR mouse mode (`DECSET 1006`) is enabled, reports use
`CSI < Cb ; Cx ; Cy M/m`, with `m` only for release. Otherwise reports use the
legacy X10 `CSI M Cb Cx Cy` format.

## Business Rules

- BR-1: Terminal-local selection is not started when a terminal app consumes a
  press through mouse reporting.
- BR-2: UI chrome, modal, file tree, scrollbar, browser nav, and pane-tab
  interactions keep their app-local behavior and are not forwarded to the PTY.
- BR-3: Input cell coordinates are 0-based internally and encoded as 1-based
  terminal coordinates on the wire.
- BR-4: Legacy X10 coordinates are capped at 223 before the required 32-byte
  offset is added.
- BR-5: Shift, Alt, and Ctrl add the standard mouse modifier bits 4, 8, and 16.
  Meta is intentionally ignored for terminal mouse reporting.
- BR-6: Buttonless pointer motion never changes the focused Pane, including when
  the Terminal Pane under the pointer has any-motion tracking enabled.
- BR-7: Terminal mouse reporting does not bypass Tide's pointer-shape update
  when the pointer leaves UI chrome and enters terminal content.

## Tests

| UC | BR | Test Function |
|----|----|---------------|
| UC-3 | BR-6 | `terminal_any_motion_reporting_does_not_move_focus_between_panes` |
| UC-3 | BR-7 | `terminal_any_motion_reporting_still_updates_the_window_cursor` |
