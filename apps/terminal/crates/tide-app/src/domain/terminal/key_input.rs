// Keyboard event to byte conversion for Terminal

use crate::tide_core::{Key, Modifiers};

use alacritty_terminal::term::TermMode;

use super::Terminal;

impl Terminal {
    /// Convert a key event to bytes using the terminal's currently active input modes.
    pub fn key_event_to_bytes(&self, key: &Key, modifiers: &Modifiers) -> Vec<u8> {
        let mode = {
            let term = self.term.lock();
            *term.mode()
        };

        if mode.intersects(TermMode::KITTY_KEYBOARD_PROTOCOL) {
            if let Some(bytes) = Self::kitty_key_to_bytes(key, modifiers, mode) {
                return bytes;
            }
        }

        Self::key_to_bytes(key, modifiers)
    }

    /// Convert a key event to the byte sequence that should be sent to the PTY
    pub fn key_to_bytes(key: &Key, modifiers: &Modifiers) -> Vec<u8> {
        match key {
            Key::Char(c) => {
                if modifiers.ctrl {
                    // Ctrl+A..Z maps to 0x01..0x1A
                    let lower = c.to_ascii_lowercase();
                    if lower.is_ascii_lowercase() {
                        return vec![(lower as u8) - b'a' + 1];
                    }
                }
                if modifiers.alt {
                    // Alt sends ESC prefix
                    let mut bytes = vec![0x1b];
                    let mut buf = [0u8; 4];
                    let s = c.encode_utf8(&mut buf);
                    bytes.extend_from_slice(s.as_bytes());
                    return bytes;
                }
                let mut buf = [0u8; 4];
                let s = c.encode_utf8(&mut buf);
                s.as_bytes().to_vec()
            }
            Key::Enter => {
                if modifiers.shift {
                    vec![0x1b, b'[', b'1', b'3', b';', b'2', b'u'] // CSI u: ESC[13;2u
                } else {
                    vec![0x0d] // CR
                }
            }
            Key::Backspace => vec![0x7f], // DEL
            Key::Tab => {
                if modifiers.shift {
                    vec![0x1b, b'[', b'Z'] // Shift+Tab = CSI Z
                } else {
                    vec![0x09]
                }
            }
            Key::Escape => vec![0x1b],
            Key::Delete => Self::tilde_key_bytes(3, modifiers),
            Key::Up => Self::arrow_bytes(b'A', modifiers),
            Key::Down => Self::arrow_bytes(b'B', modifiers),
            Key::Right => Self::arrow_bytes(b'C', modifiers),
            Key::Left => Self::arrow_bytes(b'D', modifiers),
            Key::Home => Self::csi_key_bytes(b'H', modifiers),
            Key::End => Self::csi_key_bytes(b'F', modifiers),
            Key::PageUp => Self::tilde_key_bytes(5, modifiers),
            Key::PageDown => Self::tilde_key_bytes(6, modifiers),
            Key::Insert => Self::tilde_key_bytes(2, modifiers),
            Key::F(n) => match n {
                1 => Self::function_key_bytes(b'P', modifiers),
                2 => Self::function_key_bytes(b'Q', modifiers),
                3 => Self::function_key_bytes(b'R', modifiers),
                4 => Self::function_key_bytes(b'S', modifiers),
                5 => Self::tilde_key_bytes(15, modifiers),
                6 => Self::tilde_key_bytes(17, modifiers),
                7 => Self::tilde_key_bytes(18, modifiers),
                8 => Self::tilde_key_bytes(19, modifiers),
                9 => Self::tilde_key_bytes(20, modifiers),
                10 => Self::tilde_key_bytes(21, modifiers),
                11 => Self::tilde_key_bytes(23, modifiers),
                12 => Self::tilde_key_bytes(24, modifiers),
                _ => vec![],
            },
        }
    }

    fn kitty_key_to_bytes(key: &Key, modifiers: &Modifiers, mode: TermMode) -> Option<Vec<u8>> {
        let report_all = mode.contains(TermMode::REPORT_ALL_KEYS_AS_ESC);
        let disambiguate = mode.contains(TermMode::DISAMBIGUATE_ESC_CODES);
        let modifier_code = Self::modifier_code(modifiers);
        let has_modifiers = modifier_code > 1;

        let codepoint = match key {
            Key::Char(c) => *c as u32,
            Key::Enter => 13,
            Key::Tab => 9,
            Key::Backspace => 127,
            Key::Escape => 27,
            _ => return None,
        };

        let disambiguated_key = matches!(
            key,
            Key::Enter | Key::Tab | Key::Backspace | Key::Escape
        );
        if !report_all && !(disambiguate && (has_modifiers || disambiguated_key)) {
            return None;
        }

        Some(Self::csi_u_bytes(codepoint, modifier_code))
    }

    fn csi_u_bytes(codepoint: u32, modifier_code: u8) -> Vec<u8> {
        if modifier_code > 1 {
            format!("\x1b[{codepoint};{modifier_code}u").into_bytes()
        } else {
            format!("\x1b[{codepoint}u").into_bytes()
        }
    }

    /// Build the CSI escape sequence for an arrow key with modifier support.
    /// Plain arrow: `\e[{dir}`, with modifiers: `\e[1;{mod}{dir}`
    /// Modifier codes: 2=Shift, 3=Alt, 5=Ctrl, etc.
    fn arrow_bytes(dir: u8, modifiers: &Modifiers) -> Vec<u8> {
        let modifier_code = Self::modifier_code(modifiers);
        if modifier_code > 1 {
            // CSI 1 ; {modifier} {dir}
            format!("\x1b[1;{}{}", modifier_code, dir as char).into_bytes()
        } else {
            vec![0x1b, b'[', dir]
        }
    }

    fn csi_key_bytes(final_byte: u8, modifiers: &Modifiers) -> Vec<u8> {
        let modifier_code = Self::modifier_code(modifiers);
        if modifier_code > 1 {
            format!("\x1b[1;{}{}", modifier_code, final_byte as char).into_bytes()
        } else {
            vec![0x1b, b'[', final_byte]
        }
    }

    fn function_key_bytes(final_byte: u8, modifiers: &Modifiers) -> Vec<u8> {
        let modifier_code = Self::modifier_code(modifiers);
        if modifier_code > 1 {
            format!("\x1b[1;{}{}", modifier_code, final_byte as char).into_bytes()
        } else {
            vec![0x1b, b'O', final_byte]
        }
    }

    fn tilde_key_bytes(code: u8, modifiers: &Modifiers) -> Vec<u8> {
        let modifier_code = Self::modifier_code(modifiers);
        if modifier_code > 1 {
            format!("\x1b[{code};{modifier_code}~").into_bytes()
        } else {
            format!("\x1b[{code}~").into_bytes()
        }
    }

    fn modifier_code(modifiers: &Modifiers) -> u8 {
        1 + if modifiers.shift { 1 } else { 0 }
            + if modifiers.alt { 2 } else { 0 }
            + if modifiers.ctrl { 4 } else { 0 }
            + if modifiers.meta { 8 } else { 0 }
    }
}
