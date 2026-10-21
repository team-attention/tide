#[cfg(test)]
mod tests {
    use super::super::*;
    use crate::tide_core::{Key, Modifiers, MouseButton, TerminalBackend};

    // --- UC-1/2/3: Wheel Forwarding (Spec: docs/specs/terminal-wheel-forwarding.md) ---

    /// Build a Terminal and apply the given escape sequences to set TermMode flags.
    fn term_with_modes(seqs: &[&str]) -> Terminal {
        let mut term = Terminal::new(80, 24).expect("terminal backend");
        term.stop_pty_for_test();
        for s in seqs {
            term.bench_write_to_term(s.as_bytes());
        }
        term
    }

    #[test]
    fn terminal_product_compatibility_smoke_covers_core_matrix_baseline() {
        // Product Standard: docs/product-standard.md
        // Terminal Capabilities: docs/terminal-capabilities.md
        //
        // This is intentionally a broad smoke, not a replacement for the
        // narrower protocol tests below. It keeps the public capability matrix
        // anchored to one repeatable domain test.
        let mut terminal = Terminal::new(80, 24).expect("terminal backend");
        terminal.bench_sync_grid();
        terminal.bench_write_to_term(
            b"\x1b[2J\x1b[Hsmoke https://example.test\n\
              \x1b[31mred\x1b[0m\n\
              \x1b]8;id=docs;https://target.example/docs\x07link\x1b]8;;\x07\n\
              \x07\x1b]2;Tide Smoke\x07\x1b]52;c;T0s=\x07",
        );
        terminal.bench_sync_grid();
        terminal.bench_sync_grid();

        assert!(
            !terminal.search_buffer("smoke").is_empty(),
            "terminal search should find visible text"
        );
        assert!(
            terminal.url_ranges().iter().any(|row| !row.is_empty()),
            "plain URL detection should report at least one range"
        );
        assert!(
            terminal.hyperlink_ranges().iter().any(|row| row
                .iter()
                .any(|(_, _, uri)| uri == "https://target.example/docs")),
            "OSC 8 hyperlink target should be preserved"
        );
        assert!(
            terminal
                .grid()
                .cells
                .iter()
                .flatten()
                .any(|cell| cell.character == 'r'
                    && cell.style.foreground
                        == Terminal::named_color_to_rgb(true, NamedColor::Red)),
            "ANSI red text should survive grid sync"
        );
        assert_eq!(
            terminal.drain_title(),
            Some(TitleChange::Set("Tide Smoke".to_string()))
        );
        assert!(terminal.take_bell(), "BEL should set the bell flag");
        assert_eq!(
            terminal.drain_clipboard_writes(),
            vec![(ClipboardTarget::Clipboard, "OK".to_string())]
        );

        let interactive = term_with_modes(&["\x1b[?1000h", "\x1b[?1006h", "\x1b[=1u"]);
        assert_eq!(
            interactive.mouse_press_to_bytes(MouseButton::Left, &Modifiers::default(), 4, 9),
            Some(b"\x1b[<0;5;10M".to_vec())
        );
        assert_eq!(
            interactive.wheel_to_bytes(true, 1, 4, 9),
            Some(b"\x1b[<64;5;10M".to_vec())
        );
        assert_eq!(
            interactive.key_event_to_bytes(&Key::Enter, &Modifiers::default()),
            b"\x1b[13u".to_vec()
        );
    }

    // UC-1 BR-1: alt screen + alt scroll, wheel up -> Cursor Up
    #[test]
    fn wheel_up_on_alt_screen_sends_cursor_up() {
        let t = term_with_modes(&["\x1b[?1049h", "\x1b[?1007h"]);
        assert_eq!(
            t.wheel_to_bytes(true, 1, 0, 0),
            Some(vec![0x1b, b'[', b'A'])
        );
    }

    // UC-1 BR-1: alt screen + alt scroll, wheel down -> Cursor Down
    #[test]
    fn wheel_down_on_alt_screen_sends_cursor_down() {
        let t = term_with_modes(&["\x1b[?1049h", "\x1b[?1007h"]);
        assert_eq!(
            t.wheel_to_bytes(false, 1, 0, 0),
            Some(vec![0x1b, b'[', b'B'])
        );
    }

    // UC-1 BR-2: APP_CURSOR (DECCKM) selects SS3 (ESC O) over CSI (ESC [)
    #[test]
    fn wheel_on_alt_screen_with_app_cursor_uses_ss3() {
        let t = term_with_modes(&["\x1b[?1049h", "\x1b[?1007h", "\x1b[?1h"]);
        assert_eq!(
            t.wheel_to_bytes(true, 1, 0, 0),
            Some(vec![0x1b, b'O', b'A'])
        );
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
        assert_eq!(
            t.wheel_to_bytes(true, 1, 4, 9),
            Some(b"\x1b[<64;5;10M".to_vec())
        );
    }

    // UC-2 BR-5: SGR mouse encoding
    #[test]
    fn wheel_with_sgr_mouse_uses_sgr_encoding() {
        let t = term_with_modes(&["\x1b[?1000h", "\x1b[?1006h"]);
        assert_eq!(
            t.wheel_to_bytes(false, 1, 0, 0),
            Some(b"\x1b[<65;1;1M".to_vec())
        );
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
        t.bench_write_to_term(
            b"\x1b[2J\x1b[H\x1b]8;id=docs;https://target.example/docs\x07label\x1b]8;;\x07",
        );
        t.bench_sync_grid();
        t.bench_sync_grid();

        let row = t
            .grid()
            .cells
            .iter()
            .position(|cells| {
                cells
                    .iter()
                    .take(5)
                    .map(|cell| cell.character)
                    .collect::<String>()
                    == "label"
            })
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
    fn shell_state_integration_is_independent_from_agent_auto_integration() {
        let cfg = TerminalSpawnConfig {
            shell_integration_dir: Some("/bundle/shell".into()),
            auto_integration: false,
            ..Default::default()
        };
        for shell in ["/bin/zsh", "/bin/bash", "/opt/homebrew/bin/fish"] {
            let launch = cfg.shell_launch(
                std::path::Path::new(shell),
                std::path::Path::new("/work"),
                "nonce",
            );
            assert!(launch.shell_state_enabled);
            assert!(!launch.env.contains_key("__TIDE_TERMINAL_WRAPPER_DIR"));
        }
    }

    #[test]
    fn unsupported_shell_has_no_state_fallback() {
        let launch = TerminalSpawnConfig::default().shell_launch(
            std::path::Path::new("/bin/ksh"),
            std::path::Path::new("/work"),
            "nonce",
        );
        assert!(!launch.shell_state_enabled);
        assert_eq!(launch.args, vec!["--login"]);
    }

    #[test]
    fn supported_shell_launches_preserve_login_startup_contract() {
        let cfg = TerminalSpawnConfig {
            shell_integration_dir: Some("/bundle/shell".into()),
            ..Default::default()
        };

        let zsh = cfg.shell_launch(
            std::path::Path::new("/bin/zsh"),
            std::path::Path::new("/work"),
            "nonce",
        );
        assert_eq!(zsh.program, "/bin/zsh");
        assert_eq!(zsh.args, ["--login"]);
        assert_eq!(
            zsh.env.get("ZDOTDIR").map(String::as_str),
            Some("/bundle/shell")
        );

        let bash = cfg.shell_launch(
            std::path::Path::new("/bin/bash"),
            std::path::Path::new("/work"),
            "nonce",
        );
        assert_eq!(bash.program, "/bin/bash");
        assert_eq!(bash.args, ["--login"]);
        assert_eq!(
            bash.env.get("HOME").map(String::as_str),
            Some("/bundle/shell")
        );
        assert!(bash.env.contains_key("__TIDE_TERMINAL_ORIG_HOME"));

        let fish = cfg.shell_launch(
            std::path::Path::new("/opt/homebrew/bin/fish"),
            std::path::Path::new("/work"),
            "nonce",
        );
        assert_eq!(fish.program, "/opt/homebrew/bin/fish");
        assert_eq!(fish.args[0], "--login");
        assert_eq!(fish.args[1], "--init-command");
        assert!(fish.args[2].contains("set -g __tide_terminal_nonce 'nonce'"));
        assert!(!fish.env.contains_key("__TIDE_TERMINAL_SHELL_NONCE"));
    }

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
    fn spawn_config_injects_wrapper_and_zsh_state_when_auto_integration_on() {
        let cfg = TerminalSpawnConfig {
            gateway_socket: Some("/tmp/tide.sock".to_string()),
            agent_wrapper_dir: Some("/bundle/bin".to_string()),
            shell_integration_dir: Some("/bundle/shell".to_string()),
            auto_integration: true,
            ..Default::default()
        };
        let launch = cfg.shell_launch(
            std::path::Path::new("/bin/zsh"),
            std::path::Path::new("/work"),
            "nonce",
        );
        assert_eq!(
            launch
                .env
                .get("__TIDE_TERMINAL_WRAPPER_DIR")
                .map(String::as_str),
            Some("/bundle/bin")
        );
        assert_eq!(
            launch.env.get("ZDOTDIR").map(String::as_str),
            Some("/bundle/shell")
        );
        assert_eq!(
            launch
                .env
                .get("TIDE_TERMINAL_SHELL_INTEGRATION_DIR")
                .map(String::as_str),
            Some("/bundle/shell")
        );
        assert_eq!(
            launch
                .env
                .get("__TIDE_TERMINAL_SHELL_NONCE")
                .map(String::as_str),
            Some("nonce")
        );
    }

    #[test]
    fn bundled_shell_integration_covers_zsh_bash_and_fish_wrapper_path_setup() {
        let zsh = include_str!("../../../resources/shell-integration/.zshenv");
        let bash_profile = include_str!("../../../resources/shell-integration/.bash_profile");
        let bash = include_str!("../../../resources/shell-integration/bash.sh");
        let fish = include_str!("../../../resources/shell-integration/config.fish");

        assert!(zsh.contains("__TIDE_TERMINAL_WRAPPER_DIR"));
        assert!(zsh.contains("add-zsh-hook precmd _tide_terminal_install_hooks"));
        assert!(zsh.contains("_tide_terminal_nonce"));
        assert!(bash_profile.contains("__TIDE_TERMINAL_ORIG_HOME"));
        assert!(bash_profile.contains("bash.sh"));
        assert!(bash.contains("__TIDE_TERMINAL_WRAPPER_DIR"));
        assert!(bash.contains("_tide_path_without_wrapper=\":$PATH:\""));
        assert!(bash.contains("PATH=\"$__TIDE_TERMINAL_WRAPPER_DIR"));
        assert!(bash.contains("_tide_terminal_nonce"));
        assert!(fish.contains("__TIDE_TERMINAL_WRAPPER_DIR"));
        assert!(fish.contains("set -gx PATH \"$__TIDE_TERMINAL_WRAPPER_DIR\""));
        assert!(fish.contains("__tide_terminal_nonce"));
    }

    #[test]
    fn spawn_config_without_socket_exports_no_gateway_var() {
        let cfg = TerminalSpawnConfig::default();
        let mut env = std::collections::HashMap::new();
        cfg.apply_integration_env(&mut env);
        assert!(!env.contains_key("TIDE_TERMINAL_SOCKET"));
        assert_eq!(cfg.resolved_scrollback_lines(), DEFAULT_SCROLLBACK_LINES);
    }

    #[test]
    fn terminal_compat_env_uses_documented_xterm_truecolor_strategy() {
        let mut dark_env = std::collections::HashMap::new();
        apply_terminal_compat_env(&mut dark_env, true);

        assert_eq!(TERM_ENV_VALUE, "xterm-256color");
        assert_eq!(COLORTERM_ENV_VALUE, "truecolor");
        assert_eq!(
            dark_env.get("TERM").map(String::as_str),
            Some(TERM_ENV_VALUE)
        );
        assert_eq!(
            dark_env.get("COLORTERM").map(String::as_str),
            Some(COLORTERM_ENV_VALUE)
        );
        assert_eq!(
            dark_env.get("PROMPT_EOL_MARK").map(String::as_str),
            Some("")
        );
        assert_eq!(dark_env.get("COLORFGBG").map(String::as_str), Some("15;0"));
        assert!(
            dark_env
                .get("TERM")
                .is_none_or(|term| !term.contains("tide")),
            "Tide must not advertise a custom terminfo entry until one ships"
        );

        let mut light_env = std::collections::HashMap::new();
        apply_terminal_compat_env(&mut light_env, false);
        assert_eq!(light_env.get("COLORFGBG").map(String::as_str), Some("0;15"));
    }

    #[test]
    fn terminal_spawn_config_controls_scrollback_history_limit() {
        let cfg = TerminalSpawnConfig {
            scrollback_lines: 2,
            ..Default::default()
        };
        let mut terminal =
            Terminal::with_cwd_for_window(8, 2, None, true, None, None, None, Some(&cfg))
                .expect("terminal backend");

        terminal.bench_sync_grid();
        terminal.bench_write_to_term(b"one\ntwo\nthree\nfour\nfive\n");
        terminal.bench_sync_grid();
        terminal.bench_sync_grid();

        assert!(
            terminal.history_size() <= 2,
            "history_size={} should respect configured scrollback limit",
            terminal.history_size()
        );
    }

    #[test]
    fn set_scrollback_lines_updates_existing_terminal_history_limit() {
        let mut terminal = Terminal::new(8, 2).expect("terminal backend");
        terminal.set_scrollback_lines(0);
        terminal.bench_sync_grid();
        terminal.bench_write_to_term(b"one\ntwo\nthree\nfour\nfive\n");
        terminal.bench_sync_grid();
        terminal.bench_sync_grid();

        assert_eq!(terminal.history_size(), 0);
    }
}

#[test]
fn native_title_transitions_are_preserved_in_one_output_batch() {
    // Spec: docs/specs/vibe-wrapped-agent.md UC-2 BR-5.
    let terminal = super::Terminal::new(80, 24).expect("terminal backend");
    terminal
        .bench_write_to_term(b"\x1b]0;>> Vibe\x07\x1b]0;? Vibe\x07\x1b]0;Vibe - Task Complete\x07");
    assert_eq!(
        terminal.drain_titles(),
        vec![
            super::TitleChange::Set(">> Vibe".into()),
            super::TitleChange::Set("? Vibe".into()),
            super::TitleChange::Set("Vibe - Task Complete".into())
        ]
    );
    assert!(terminal.drain_titles().is_empty());
}

#[test]
fn native_title_queue_is_bounded_and_keeps_latest_display_title() {
    // Spec: docs/specs/vibe-wrapped-agent.md — UC-2 BR-5.
    let terminal = super::Terminal::new(80, 24).expect("terminal backend");
    for index in 0..300 {
        terminal.bench_write_to_term(format!("\x1b]0;title-{index}\x07").as_bytes());
    }
    let titles = terminal.drain_titles();
    assert_eq!(titles.len(), 256);
    assert_eq!(
        titles.last(),
        Some(&super::TitleChange::Set("title-299".into()))
    );
}

#[test]
fn synchronization_exposes_latest_output_with_an_older_snapshot_pending() {
    // Spec: docs/specs/terminal-snapshot-handoff.md — UC-1 BR-1/2/3.
    use crate::tide_core::TerminalBackend;
    let mut terminal = super::Terminal::new(80, 24).expect("terminal backend");
    terminal.stop_pty_for_test();
    for index in 0..100 {
        // Leave the previous frame published but unconsumed before injecting new output.
        {
            let mut snapshot = terminal.snapshot.lock().unwrap();
            snapshot.grid = terminal.grid().clone();
            terminal.snapshot_ready.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        terminal.bench_write_to_term(format!("\x1b[2J\x1b[Hframe-{index}").as_bytes());
        terminal.bench_sync_grid();
        let text: String = terminal.grid().cells[0].iter().map(|cell| cell.character).collect();
        assert!(text.starts_with(&format!("frame-{index}")), "stale snapshot: {text:?}");
    }
}

#[test]
fn runtime_event_queue_is_ordered_bounded_and_coalesces_duplicate_exit() {
    use super::{
        CommandBoundary, ShellStateSignal, TerminalRuntimeEvent, TerminalRuntimeEventQueue,
    };

    let queue = TerminalRuntimeEventQueue::default();
    for index in 0..300 {
        queue.push(TerminalRuntimeEvent::ShellState(
            ShellStateSignal::CommandLifecycle {
                boundary: CommandBoundary::CommandStart,
                nonce: index.to_string(),
            },
        ));
    }
    queue.push(TerminalRuntimeEvent::ChildExited(Some(7)));
    queue.push(TerminalRuntimeEvent::ChildExited(None));

    let events = queue.drain();
    assert_eq!(events.len(), 256);
    assert!(matches!(
        events.first(),
        Some(TerminalRuntimeEvent::ShellState(
            ShellStateSignal::CommandLifecycle { nonce, .. }
        )) if nonce == "45"
    ));
    assert_eq!(
        events.last(),
        Some(&TerminalRuntimeEvent::ChildExited(Some(7)))
    );
}

#[test]
fn duplicate_exit_events_preserve_final_output_and_apply_once() {
    use super::{TerminalRuntimeEvent, TerminalRuntimeEventQueue};

    let queue = TerminalRuntimeEventQueue::default();
    let stale_sync = queue.begin_snapshot_sync();
    queue.defer_child_exit(Some(7));
    queue.defer_child_exit(None);

    queue.publish_deferred_child_exit(stale_sync);
    assert!(queue.drain().is_empty());

    let final_sync = queue.begin_snapshot_sync();
    queue.publish_deferred_child_exit(final_sync);
    assert_eq!(
        queue.drain(),
        vec![TerminalRuntimeEvent::ChildExited(Some(7))]
    );
    queue.publish_deferred_child_exit(final_sync);
    assert!(queue.drain().is_empty());
}

#[test]
fn trusted_working_directory_requires_local_uri_and_nonce() {
    assert_eq!(
        super::decode_working_directory("file://localhost/tmp/a%20%C3%BC?tide_nonce=n", "n"),
        Some(std::path::PathBuf::from("/tmp/a ü")),
    );
    assert_eq!(
        super::decode_working_directory("file://remote/tmp?a=tide_nonce=n", "n"),
        None,
    );
    assert_eq!(
        super::decode_working_directory("file://localhost/tmp?tide_nonce=stale", "n"),
        None,
    );
    assert_eq!(
        super::decode_working_directory("https://localhost/tmp?tide_nonce=n", "n"),
        None
    );
    assert_eq!(
        super::decode_working_directory("file://localhost/%GG?tide_nonce=n", "n"),
        None
    );
}

#[test]
fn working_directory_accepts_machine_hostname_without_hostname_env() {
    assert_eq!(
        super::decode_working_directory_with_local_hostname(
            "file://tide-mac.local/tmp/project?tide_nonce=n",
            "n",
            None,
            Some("tide-mac.local"),
        ),
        Some(std::path::PathBuf::from("/tmp/project")),
    );
    assert_eq!(
        super::decode_working_directory_with_local_hostname(
            "file://remote-mac/tmp/project?tide_nonce=n",
            "n",
            None,
            Some("tide-mac.local"),
        ),
        None,
    );
}

#[test]
fn terminal_pty_is_configured_to_drain_before_child_exit() {
    assert!(super::PTY_DRAIN_ON_EXIT);
}

#[test]
fn terminal_runtime_events_update_event_backed_cwd_and_reject_stale_nonce() {
    use super::{ShellStateSignal, TerminalRuntimeEvent};
    use crate::tide_core::TerminalBackend;

    let initial = std::path::PathBuf::from("/tmp/initial");
    let mut terminal = super::Terminal::with_cwd(80, 24, Some(initial.clone()), true, None)
        .expect("terminal backend");
    terminal.stop_pty_for_test();
    assert_eq!(terminal.cwd(), Some(initial));

    terminal.shell_state_nonce = Some("current".into());
    terminal
        .runtime_events
        .push(TerminalRuntimeEvent::ShellState(
            ShellStateSignal::WorkingDirectory {
                uri: "file://localhost/tmp/stale?tide_nonce=stale".into(),
                nonce: "stale".into(),
            },
        ));
    assert!(terminal.drain_runtime_events().is_empty());
    assert_eq!(
        terminal.cwd(),
        Some(std::path::PathBuf::from("/tmp/initial"))
    );

    terminal
        .runtime_events
        .push(TerminalRuntimeEvent::ShellState(
            ShellStateSignal::WorkingDirectory {
                uri: "file://localhost/tmp/next%20dir?tide_nonce=current".into(),
                nonce: "current".into(),
            },
        ));
    let events = terminal.drain_runtime_events();
    assert_eq!(events.len(), 1);
    assert_eq!(
        terminal.cwd(),
        Some(std::path::PathBuf::from("/tmp/next dir"))
    );
}
