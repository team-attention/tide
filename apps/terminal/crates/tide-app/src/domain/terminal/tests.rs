#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::tide_core::{Key, Modifiers, MouseButton, TerminalBackend};

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

    // --- Mouse Reporting (Spec: docs/specs/terminal-mouse-reporting.md) ---

    // UC-1 BR-1: DECSET 1000 reports button press and release to the program.
    #[test]
    fn mouse_click_with_sgr_mouse_reports_press_and_release() {
        let t = term_with_modes(&["\x1b[?1000h", "\x1b[?1006h"]);
        assert_eq!(
            t.mouse_press_to_bytes(MouseButton::Left, &Modifiers::default(), 4, 9),
            Some(b"\x1b[<0;5;10M".to_vec())
        );
        assert_eq!(
            t.mouse_release_to_bytes(MouseButton::Left, &Modifiers::default(), 4, 9),
            Some(b"\x1b[<0;5;10m".to_vec())
        );
    }

    // UC-1 BR-2: legacy X10 encoding is used when SGR mouse mode is off.
    #[test]
    fn mouse_click_without_sgr_uses_legacy_x10_encoding() {
        let t = term_with_modes(&["\x1b[?1000h"]);
        assert_eq!(
            t.mouse_press_to_bytes(MouseButton::Right, &Modifiers::default(), 4, 9),
            Some(vec![0x1b, b'[', b'M', 34, 37, 42])
        );
        assert_eq!(
            t.mouse_release_to_bytes(MouseButton::Right, &Modifiers::default(), 4, 9),
            Some(vec![0x1b, b'[', b'M', 35, 37, 42])
        );
    }

    // UC-2 BR-3: DECSET 1002 reports drag while a button is held.
    #[test]
    fn mouse_drag_requires_drag_or_motion_mode() {
        let click_only = term_with_modes(&["\x1b[?1000h", "\x1b[?1006h"]);
        assert_eq!(
            click_only.mouse_drag_to_bytes(MouseButton::Left, &Modifiers::default(), 1, 2),
            None
        );

        let drag = term_with_modes(&["\x1b[?1000h", "\x1b[?1002h", "\x1b[?1006h"]);
        assert_eq!(
            drag.mouse_drag_to_bytes(MouseButton::Left, &Modifiers::default(), 1, 2),
            Some(b"\x1b[<32;2;3M".to_vec())
        );
    }

    // UC-3 BR-4: DECSET 1003 reports any-motion with no button pressed.
    #[test]
    fn mouse_move_requires_any_motion_mode() {
        let drag = term_with_modes(&["\x1b[?1000h", "\x1b[?1002h", "\x1b[?1006h"]);
        assert_eq!(drag.mouse_move_to_bytes(&Modifiers::default(), 1, 2), None);

        let motion = term_with_modes(&["\x1b[?1000h", "\x1b[?1003h", "\x1b[?1006h"]);
        assert_eq!(
            motion.mouse_move_to_bytes(&Modifiers::default(), 1, 2),
            Some(b"\x1b[<35;2;3M".to_vec())
        );
    }

    // UC-4 BR-5: modifier bits are encoded in the button field.
    #[test]
    fn mouse_report_includes_modifier_bits() {
        let t = term_with_modes(&["\x1b[?1000h", "\x1b[?1006h"]);
        let modifiers = Modifiers {
            shift: true,
            ctrl: true,
            alt: false,
            meta: true,
        };
        assert_eq!(
            t.mouse_press_to_bytes(MouseButton::Middle, &modifiers, 0, 0),
            Some(b"\x1b[<21;1;1M".to_vec())
        );
    }

    // UC-4 BR-6: reports are disabled when the program has not opted in.
    #[test]
    fn mouse_reports_return_none_without_mouse_mode() {
        let t = term_with_modes(&[]);
        assert_eq!(
            t.mouse_press_to_bytes(MouseButton::Left, &Modifiers::default(), 0, 0),
            None
        );
        assert_eq!(t.mouse_move_to_bytes(&Modifiers::default(), 0, 0), None);
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

    // --- Kitty Keyboard Protocol (Spec: docs/specs/terminal-kitty-keyboard.md) ---

    #[test]
    fn kitty_keyboard_disambiguates_control_keys() {
        let t = term_with_modes(&["\x1b[=1u"]);
        let ctrl = Modifiers {
            ctrl: true,
            ..Default::default()
        };

        assert_eq!(
            t.key_event_to_bytes(&Key::Enter, &Modifiers::default()),
            b"\x1b[13u".to_vec()
        );
        assert_eq!(
            t.key_event_to_bytes(&Key::Char('i'), &ctrl),
            b"\x1b[105;5u".to_vec()
        );
        assert_eq!(
            t.key_event_to_bytes(&Key::Char('a'), &Modifiers::default()),
            b"a".to_vec()
        );
    }

    #[test]
    fn kitty_keyboard_report_all_encodes_plain_text_as_csi_u() {
        let t = term_with_modes(&["\x1b[=8u"]);

        assert_eq!(
            t.key_event_to_bytes(&Key::Char('a'), &Modifiers::default()),
            b"\x1b[97u".to_vec()
        );
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

    // --- OSC 8 Hyperlinks (Spec: docs/specs/terminal-osc8-hyperlinks.md) ---

    // UC-1 BR-1: OSC 8 attaches an explicit target URI to printed cells.
    #[test]
    fn osc8_hyperlink_ranges_expose_target_uri() {
        let mut t = Terminal::new(80, 24).expect("terminal backend");
        t.bench_sync_grid();
        t.bench_write_to_term(b"\x1b[2J\x1b[H\x1b]8;id=docs;https://target.example/docs\x07label\x1b]8;;\x07");
        t.bench_sync_grid();
        t.bench_sync_grid();

        let row = t
            .grid()
            .cells
            .iter()
            .position(|cells| cells.iter().take(5).map(|cell| cell.character).collect::<String>() == "label")
            .expect("expected OSC 8 label in grid");
        assert_eq!(
            t.grid().cells[row][..5]
                .iter()
                .map(|cell| cell.character)
                .collect::<String>(),
            "label"
        );
        assert_eq!(
            t.hyperlink_ranges()[row],
            vec![(0, 5, "https://target.example/docs".to_string())]
        );
        assert_eq!(
            t.grid().cells[row][0].hyperlink.as_deref(),
            Some("https://target.example/docs")
        );
        assert_eq!(t.grid().cells[row][5].hyperlink, None);
    }

    // --- OSC Title / Bell / Clipboard (Spec: docs/specs/terminal-osc-title-bell-clipboard.md) ---

    // UC-1 BR-1: OSC 0/2 sets the title; latest write wins.
    #[test]
    fn title_event_sets_pending_title_last_wins() {
        let t = term_with_modes(&["\x1b]2;first\x07", "\x1b]0;second\x07"]);
        assert_eq!(
            t.drain_title(),
            Some(TitleChange::Set("second".to_string()))
        );
        // Drained — nothing pending afterwards.
        assert_eq!(t.drain_title(), None);
    }

    // UC-1 BR-2: popping a (None) title off the stack resets to default.
    #[test]
    fn reset_title_event_clears_pending_title() {
        // Fresh terminal title is None; push it, then pop -> set_title(None) -> Reset.
        let t = term_with_modes(&["\x1b[22t", "\x1b[23t"]);
        assert_eq!(t.drain_title(), Some(TitleChange::Reset));
    }

    // UC-2 BR-3: BEL is edge-triggered — multiple bells coalesce, drain clears it.
    #[test]
    fn bell_event_is_edge_triggered() {
        let t = term_with_modes(&["\x07", "\x07"]);
        assert!(t.take_bell(), "bell should be pending after BEL");
        assert!(!t.take_bell(), "bell should be cleared after taking it");
    }

    // UC-3 BR-4: OSC 52 write queues the decoded text for the system pasteboard.
    #[test]
    fn clipboard_store_event_queues_text() {
        // base64("hi") = "aGk=". OSC 52 ; c ; aGk=
        let t = term_with_modes(&["\x1b]52;c;aGk=\x07"]);
        let writes = t.drain_clipboard_writes();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].0, ClipboardTarget::Clipboard);
        assert_eq!(writes[0].1, "hi");
    }

    // UC-4 BR-5: OSC 52 read is dropped when clipboard-read policy is off (default).
    #[test]
    fn clipboard_load_dropped_when_read_disabled() {
        let t = term_with_modes(&["\x1b]52;c;?\x07"]);
        assert!(t.drain_clipboard_loads().is_empty());
    }

    // UC-4 BR-6: OSC 52 read is queued for a PTY response when policy is on.
    #[test]
    fn clipboard_load_responds_when_read_enabled() {
        let t = Terminal::new(80, 24).expect("terminal backend");
        t.set_clipboard_read_allowed(true);
        t.bench_write_to_term(b"\x1b]52;c;?\x07");
        let loads = t.drain_clipboard_loads();
        assert_eq!(loads.len(), 1);
        assert_eq!(loads[0].0, ClipboardTarget::Clipboard);
        // The formatter wraps clipboard text into an OSC 52 reply.
        let reply = (loads[0].1)("hi");
        assert!(reply.starts_with("\x1b]52;c;"), "got: {reply:?}");
    }

    // --- TerminalSpawnConfig env injection (M-3: replaces the former statics) ---

    #[test]
    fn spawn_config_exports_gateway_socket_unconditionally() {
        let cfg = TerminalSpawnConfig {
            gateway_socket: Some("/tmp/tide.sock".to_string()),
            auto_integration: false,
            ..Default::default()
        };
        let mut env = std::collections::HashMap::new();
        cfg.apply_integration_env(&mut env);
        assert_eq!(
            env.get("TIDE_TERMINAL_SOCKET").map(String::as_str),
            Some("/tmp/tide.sock")
        );
        // auto-integration off → no wrapper / ZDOTDIR hijack.
        assert!(!env.contains_key("__TIDE_TERMINAL_WRAPPER_DIR"));
        assert!(!env.contains_key("ZDOTDIR"));
    }

    #[test]
    fn spawn_config_injects_wrapper_and_zdotdir_when_auto_integration_on() {
        let cfg = TerminalSpawnConfig {
            gateway_socket: Some("/tmp/tide.sock".to_string()),
            agent_wrapper_dir: Some("/bundle/bin".to_string()),
            shell_integration_dir: Some("/bundle/shell".to_string()),
            auto_integration: true,
        };
        let mut env = std::collections::HashMap::new();
        cfg.apply_integration_env(&mut env);
        assert_eq!(
            env.get("__TIDE_TERMINAL_WRAPPER_DIR").map(String::as_str),
            Some("/bundle/bin")
        );
        assert_eq!(env.get("ZDOTDIR").map(String::as_str), Some("/bundle/shell"));
    }

    #[test]
    fn spawn_config_without_socket_exports_no_gateway_var() {
        let cfg = TerminalSpawnConfig::default();
        let mut env = std::collections::HashMap::new();
        cfg.apply_integration_env(&mut env);
        assert!(!env.contains_key("TIDE_TERMINAL_SOCKET"));
    }
}
