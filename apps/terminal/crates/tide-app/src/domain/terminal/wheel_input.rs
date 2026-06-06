// Mouse-wheel event to byte conversion for Terminal — Wheel Forwarding.
//
// Spec: docs/specs/terminal-wheel-forwarding.md
//
// When a full-screen TUI takes the Alternate Screen (zero scrollback) or enables
// mouse reporting, the wheel must be forwarded to the PTY as input instead of
// scrolling the local scrollback. This mirrors xterm/Ghostty/iTerm behavior.

use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::TermMode;

use super::Terminal;

/// Legacy X10 mouse encoding caps each coordinate at 223 (255 - 32 offset).
const X10_COORD_MAX: u16 = 223;

impl Terminal {
    /// Convert a mouse-wheel notch into the bytes to forward to the PTY when the
    /// foreground program owns the wheel. Returns `None` when the wheel should
    /// scroll the local scrollback instead (ordinary output).
    ///
    /// - `up`: wheel scrolled toward history (up).
    /// - `lines`: number of wheel notches to emit (clamped to at least 1).
    /// - `col`/`row`: 0-based cell coordinates under the cursor (mouse reporting only).
    ///
    /// Priority: mouse reporting > Alternate Screen + Alternate Scroll > `None`.
    pub fn wheel_to_bytes(&self, up: bool, lines: usize, col: u16, row: u16) -> Option<Vec<u8>> {
        let term = self.term.lock();
        let mode = term.mode();
        let n = lines.max(1);

        // 1. Mouse reporting takes priority — encode wheel button events.
        if mode.intersects(TermMode::MOUSE_MODE) {
            // Wheel up = button 64, wheel down = button 65.
            let button: u16 = if up { 64 } else { 65 };
            let cols = term.grid().columns() as u16;
            let rows = term.grid().screen_lines() as u16;
            // Report 1-based coordinates, clamped to the grid.
            let x = col.min(cols.saturating_sub(1)) + 1;
            let y = row.min(rows.saturating_sub(1)) + 1;
            let sgr = mode.contains(TermMode::SGR_MOUSE);
            drop(term);

            let mut out = Vec::new();
            for _ in 0..n {
                if sgr {
                    // SGR: ESC [ < button ; x ; y M
                    out.extend_from_slice(format!("\x1b[<{button};{x};{y}M").as_bytes());
                } else {
                    // X10: ESC [ M Cb Cx Cy — each value offset by 32, coords capped.
                    let cb = (button + 32) as u8;
                    let cx = (x.min(X10_COORD_MAX) + 32) as u8;
                    let cy = (y.min(X10_COORD_MAX) + 32) as u8;
                    out.extend_from_slice(&[0x1b, b'[', b'M', cb, cx, cy]);
                }
            }
            return Some(out);
        }

        // 2. Alternate Screen + Alternate Scroll — translate the wheel to arrow keys.
        if mode.contains(TermMode::ALT_SCREEN) && mode.contains(TermMode::ALTERNATE_SCROLL) {
            let dir = if up { b'A' } else { b'B' };
            // DECCKM (APP_CURSOR) selects SS3 (ESC O) over CSI (ESC [).
            let intro = if mode.contains(TermMode::APP_CURSOR) {
                b'O'
            } else {
                b'['
            };
            drop(term);

            let mut out = Vec::with_capacity(3 * n);
            for _ in 0..n {
                out.extend_from_slice(&[0x1b, intro, dir]);
            }
            return Some(out);
        }

        // 3. Ordinary output — let the caller scroll local scrollback.
        None
    }
}
