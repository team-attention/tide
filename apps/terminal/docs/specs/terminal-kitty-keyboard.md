# Terminal Kitty Keyboard Protocol

Terminal applications can opt into Kitty keyboard protocol modes with
`CSI = Ps u`, `CSI > Ps u`, and related queries. Tide enables the engine's
protocol parser and encodes user key input according to the active mode.

## Use Cases

### UC-1: Disambiguate Control Keys

When `DISAMBIGUATE_ESC_CODES` is enabled, ambiguous keys such as Enter, Tab,
Backspace, Escape, and modified printable characters are sent as CSI-u
sequences. This lets terminal applications distinguish `Ctrl-I` from Tab and
`Ctrl-M` from Enter.

### UC-2: Report All Keys

When `REPORT_ALL_KEYS_AS_ESC` is enabled, printable text keys are also sent as
CSI-u sequences instead of raw UTF-8.

## Business Rules

- BR-1: The terminal engine's `kitty_keyboard` config is enabled so programs can
  set, push, pop, and query Kitty keyboard modes.
- BR-2: Runtime key encoding reads the current terminal mode; the legacy static
  encoder remains available for code that does not have a terminal instance.
- BR-3: CSI-u modifier code is `1 + Shift(1) + Alt(2) + Ctrl(4) + Meta(8)`.
- BR-4: Navigation/function keys keep xterm-compatible escape forms, with
  modifier parameters where applicable.
