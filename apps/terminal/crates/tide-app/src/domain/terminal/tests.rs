#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::tide_core::{Key, Modifiers};

    // --- UC-1/2/3: Wheel Forwarding (Spec: docs/specs/terminal-wheel-forwarding.md) ---

    /// Build a Terminal and apply the given escape sequences to set TermMode flags.
    fn term_with_modes(seqs: &[&str]) -> Terminal {
        let term = Terminal::new(80, 24).expect("terminal backend");
        for s in seqs {
            term.bench_write_to_term(s.as_bytes());
        }
        term
    }

    // UC-1 BR-1: alt screen + alt scroll, wheel up -> Cursor Up
    #[test]
    fn wheel_up_on_alt_screen_sends_cursor_up() {
        let t = term_with_modes(&["\x1b[?1049h", "\x1b[?1007h"]);
        assert_eq!(t.wheel_to_bytes(true, 1, 0, 0), Some(vec![0x1b, b'[', b'A']));
    }

    // UC-1 BR-1: alt screen + alt scroll, wheel down -> Cursor Down
    #[test]
    fn wheel_down_on_alt_screen_sends_cursor_down() {
        let t = term_with_modes(&["\x1b[?1049h", "\x1b[?1007h"]);
        assert_eq!(t.wheel_to_bytes(false, 1, 0, 0), Some(vec![0x1b, b'[', b'B']));
    }

    // UC-1 BR-2: APP_CURSOR (DECCKM) selects SS3 (ESC O) over CSI (ESC [)
    #[test]
    fn wheel_on_alt_screen_with_app_cursor_uses_ss3() {
        let t = term_with_modes(&["\x1b[?1049h", "\x1b[?1007h", "\x1b[?1h"]);
        assert_eq!(t.wheel_to_bytes(true, 1, 0, 0), Some(vec![0x1b, b'O', b'A']));
    }

    // UC-1 BR-3: line count repeats the arrow sequence
    #[test]
    fn wheel_lines_emit_repeated_arrow_sequences() {
        let t = term_with_modes(&["\x1b[?1049h", "\x1b[?1007h"]);
        assert_eq!(
            t.wheel_to_bytes(true, 3, 0, 0),
            Some(vec![0x1b, b'[', b'A', 0x1b, b'[', b'A', 0x1b, b'[', b'A'])
        );
    }

    // UC-2 BR-4: mouse reporting wins even when alt scroll is also enabled
    #[test]
    fn mouse_reporting_takes_priority_over_alternate_scroll() {
        let t = term_with_modes(&["\x1b[?1049h", "\x1b[?1007h", "\x1b[?1000h", "\x1b[?1006h"]);
        assert_eq!(t.wheel_to_bytes(true, 1, 4, 9), Some(b"\x1b[<64;5;10M".to_vec()));
    }

    // UC-2 BR-5: SGR mouse encoding
    #[test]
    fn wheel_with_sgr_mouse_uses_sgr_encoding() {
        let t = term_with_modes(&["\x1b[?1000h", "\x1b[?1006h"]);
        assert_eq!(t.wheel_to_bytes(false, 1, 0, 0), Some(b"\x1b[<65;1;1M".to_vec()));
    }

    // UC-2 BR-5: legacy X10 mouse encoding (no SGR)
    #[test]
    fn wheel_with_x10_mouse_uses_legacy_encoding() {
        let t = term_with_modes(&["\x1b[?1000h"]);
        // col=4,row=9 -> 1-based 5,10 -> +32 -> 37,42 ; wheel-up button 64 -> 96
        assert_eq!(
            t.wheel_to_bytes(true, 1, 4, 9),
            Some(vec![0x1b, b'[', b'M', 96, 37, 42])
        );
    }

    // UC-2 BR-6: reported cell is 1-based and clamped to the grid
    #[test]
    fn wheel_mouse_report_uses_one_based_clamped_cell() {
        let t = term_with_modes(&["\x1b[?1000h", "\x1b[?1006h"]);
        // 80x24 grid: col 999/row 999 clamp to 80/24 (1-based)
        assert_eq!(
            t.wheel_to_bytes(true, 1, 999, 999),
            Some(b"\x1b[<64;80;24M".to_vec())
        );
    }

    // UC-3 BR-7: plain screen, no mouse -> None (local scrollback)
    #[test]
    fn wheel_on_plain_screen_returns_none() {
        let t = term_with_modes(&[]);
        assert_eq!(t.wheel_to_bytes(true, 1, 0, 0), None);
    }

    // UC-3 BR-8: alt screen but alt scroll disabled, no mouse -> None
    #[test]
    fn wheel_on_alt_screen_without_alternate_scroll_returns_none() {
        let t = term_with_modes(&["\x1b[?1049h", "\x1b[?1007l"]);
        assert_eq!(t.wheel_to_bytes(true, 1, 0, 0), None);
    }

    #[test]
    fn test_key_to_bytes_char() {
        let bytes = Terminal::key_to_bytes(&Key::Char('a'), &Modifiers::default());
        assert_eq!(bytes, vec![b'a']);
    }

    #[test]
    fn test_key_to_bytes_ctrl_c() {
        let mods = Modifiers {
            ctrl: true,
            ..Default::default()
        };
        let bytes = Terminal::key_to_bytes(&Key::Char('c'), &mods);
        assert_eq!(bytes, vec![3]); // ETX
    }

    #[test]
    fn test_key_to_bytes_enter() {
        let bytes = Terminal::key_to_bytes(&Key::Enter, &Modifiers::default());
        assert_eq!(bytes, vec![0x0d]);
    }

    #[test]
    fn test_key_to_bytes_escape() {
        let bytes = Terminal::key_to_bytes(&Key::Escape, &Modifiers::default());
        assert_eq!(bytes, vec![0x1b]);
    }

    #[test]
    fn test_key_to_bytes_arrow_up() {
        let bytes = Terminal::key_to_bytes(&Key::Up, &Modifiers::default());
        assert_eq!(bytes, vec![0x1b, b'[', b'A']);
    }

    #[test]
    fn test_key_to_bytes_f1() {
        let bytes = Terminal::key_to_bytes(&Key::F(1), &Modifiers::default());
        assert_eq!(bytes, vec![0x1b, b'O', b'P']);
    }

    #[test]
    fn test_named_color_to_rgb() {
        let color = Terminal::named_color_to_rgb(true, NamedColor::Red);
        assert_eq!(color, Color::rgb(1.0, 0.33, 0.33));
    }

    #[test]
    fn test_indexed_color_fallback_grayscale() {
        let color = Terminal::indexed_color_fallback(232);
        // 232 = first grayscale entry: (8 + 10*0) / 255
        let expected = 8.0 / 255.0;
        assert!((color.r - expected).abs() < 0.001);
    }

    #[test]
    fn test_build_empty_grid() {
        let grid = Terminal::build_empty_grid(80, 24);
        assert_eq!(grid.cols, 80);
        assert_eq!(grid.rows, 24);
        assert_eq!(grid.cells.len(), 24);
        assert_eq!(grid.cells[0].len(), 80);
        assert_eq!(grid.cells[0][0].character, ' ');
    }

    #[test]
    fn terminal_resize_applies_without_internal_debounce() {
        // Spec: docs/specs/terminal-pane-inset.md
        // UC-3 BR-8: Terminal::resize applies immediately after layout-level coalescing.
        let mut terminal = Terminal::new(80, 24).unwrap();

        terminal.resize(100, 30);

        assert_eq!(terminal.current_cols(), 100);
        assert_eq!(terminal.current_rows(), 30);
        assert!(terminal.pending_pty_resize.is_none());
    }

    #[test]
    fn test_trim_url_trailing_paren() {
        // Unbalanced closing paren should be trimmed
        assert_eq!(
            crate::tide_terminal::trim_url_trailing("https://example.com/page)"),
            "https://example.com/page"
        );
        // Balanced parens (Wikipedia-style) should be preserved
        assert_eq!(
            crate::tide_terminal::trim_url_trailing("https://en.wikipedia.org/wiki/Foo_(bar)"),
            "https://en.wikipedia.org/wiki/Foo_(bar)"
        );
        // Trailing punctuation
        assert_eq!(
            crate::tide_terminal::trim_url_trailing("https://example.com/page."),
            "https://example.com/page"
        );
        assert_eq!(
            crate::tide_terminal::trim_url_trailing("https://example.com/page,"),
            "https://example.com/page"
        );
        assert_eq!(
            crate::tide_terminal::trim_url_trailing("https://example.com/page;"),
            "https://example.com/page"
        );
        // Combined: paren + punctuation
        assert_eq!(
            crate::tide_terminal::trim_url_trailing("https://example.com/page)."),
            "https://example.com/page"
        );
        // No trimming needed
        assert_eq!(
            crate::tide_terminal::trim_url_trailing("https://example.com/page"),
            "https://example.com/page"
        );
    }
}
