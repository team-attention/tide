// Winit ↔ tide key conversion utilities.

use winit::keyboard::{Key as WinitKey, KeyCode, ModifiersState, NamedKey, PhysicalKey};

use tide_core::{Key, Modifiers};

pub fn winit_key_to_tide(key: &WinitKey) -> Option<Key> {
    match key {
        WinitKey::Named(named) => match named {
            NamedKey::Enter => Some(Key::Enter),
            NamedKey::Backspace => Some(Key::Backspace),
            NamedKey::Tab => Some(Key::Tab),
            NamedKey::Escape => Some(Key::Escape),
            NamedKey::Delete => Some(Key::Delete),
            NamedKey::ArrowUp => Some(Key::Up),
            NamedKey::ArrowDown => Some(Key::Down),
            NamedKey::ArrowLeft => Some(Key::Left),
            NamedKey::ArrowRight => Some(Key::Right),
            NamedKey::Home => Some(Key::Home),
            NamedKey::End => Some(Key::End),
            NamedKey::PageUp => Some(Key::PageUp),
            NamedKey::PageDown => Some(Key::PageDown),
            NamedKey::Insert => Some(Key::Insert),
            NamedKey::F1 => Some(Key::F(1)),
            NamedKey::F2 => Some(Key::F(2)),
            NamedKey::F3 => Some(Key::F(3)),
            NamedKey::F4 => Some(Key::F(4)),
            NamedKey::F5 => Some(Key::F(5)),
            NamedKey::F6 => Some(Key::F(6)),
            NamedKey::F7 => Some(Key::F(7)),
            NamedKey::F8 => Some(Key::F(8)),
            NamedKey::F9 => Some(Key::F(9)),
            NamedKey::F10 => Some(Key::F(10)),
            NamedKey::F11 => Some(Key::F(11)),
            NamedKey::F12 => Some(Key::F(12)),
            NamedKey::Space => Some(Key::Char(' ')),
            _ => None,
        },
        WinitKey::Character(s) => {
            let mut chars = s.chars();
            if let Some(c) = chars.next() {
                if chars.next().is_none() {
                    Some(Key::Char(c))
                } else {
                    None
                }
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Convert a winit PhysicalKey to a tide Key based on physical keyboard position.
/// Used for hotkey matching when Cmd/Ctrl is held, so hotkeys work regardless of IME/language.
pub fn winit_physical_key_to_tide(physical: &PhysicalKey) -> Option<Key> {
    match physical {
        PhysicalKey::Code(code) => match code {
            KeyCode::KeyA => Some(Key::Char('a')),
            KeyCode::KeyB => Some(Key::Char('b')),
            KeyCode::KeyC => Some(Key::Char('c')),
            KeyCode::KeyD => Some(Key::Char('d')),
            KeyCode::KeyE => Some(Key::Char('e')),
            KeyCode::KeyF => Some(Key::Char('f')),
            KeyCode::KeyG => Some(Key::Char('g')),
            KeyCode::KeyH => Some(Key::Char('h')),
            KeyCode::KeyI => Some(Key::Char('i')),
            KeyCode::KeyJ => Some(Key::Char('j')),
            KeyCode::KeyK => Some(Key::Char('k')),
            KeyCode::KeyL => Some(Key::Char('l')),
            KeyCode::KeyM => Some(Key::Char('m')),
            KeyCode::KeyN => Some(Key::Char('n')),
            KeyCode::KeyO => Some(Key::Char('o')),
            KeyCode::KeyP => Some(Key::Char('p')),
            KeyCode::KeyQ => Some(Key::Char('q')),
            KeyCode::KeyR => Some(Key::Char('r')),
            KeyCode::KeyS => Some(Key::Char('s')),
            KeyCode::KeyT => Some(Key::Char('t')),
            KeyCode::KeyU => Some(Key::Char('u')),
            KeyCode::KeyV => Some(Key::Char('v')),
            KeyCode::KeyW => Some(Key::Char('w')),
            KeyCode::KeyX => Some(Key::Char('x')),
            KeyCode::KeyY => Some(Key::Char('y')),
            KeyCode::KeyZ => Some(Key::Char('z')),
            KeyCode::Digit0 => Some(Key::Char('0')),
            KeyCode::Digit1 => Some(Key::Char('1')),
            KeyCode::Digit2 => Some(Key::Char('2')),
            KeyCode::Digit3 => Some(Key::Char('3')),
            KeyCode::Digit4 => Some(Key::Char('4')),
            KeyCode::Digit5 => Some(Key::Char('5')),
            KeyCode::Digit6 => Some(Key::Char('6')),
            KeyCode::Digit7 => Some(Key::Char('7')),
            KeyCode::Digit8 => Some(Key::Char('8')),
            KeyCode::Digit9 => Some(Key::Char('9')),
            KeyCode::Backslash => Some(Key::Char('\\')),
            KeyCode::Enter => Some(Key::Enter),
            KeyCode::Backspace => Some(Key::Backspace),
            KeyCode::Tab => Some(Key::Tab),
            KeyCode::Escape => Some(Key::Escape),
            KeyCode::Delete => Some(Key::Delete),
            KeyCode::ArrowUp => Some(Key::Up),
            KeyCode::ArrowDown => Some(Key::Down),
            KeyCode::ArrowLeft => Some(Key::Left),
            KeyCode::ArrowRight => Some(Key::Right),
            KeyCode::Home => Some(Key::Home),
            KeyCode::End => Some(Key::End),
            KeyCode::PageUp => Some(Key::PageUp),
            KeyCode::PageDown => Some(Key::PageDown),
            KeyCode::Insert => Some(Key::Insert),
            KeyCode::Space => Some(Key::Char(' ')),
            KeyCode::F1 => Some(Key::F(1)),
            KeyCode::F2 => Some(Key::F(2)),
            KeyCode::F3 => Some(Key::F(3)),
            KeyCode::F4 => Some(Key::F(4)),
            KeyCode::F5 => Some(Key::F(5)),
            KeyCode::F6 => Some(Key::F(6)),
            KeyCode::F7 => Some(Key::F(7)),
            KeyCode::F8 => Some(Key::F(8)),
            KeyCode::F9 => Some(Key::F(9)),
            KeyCode::F10 => Some(Key::F(10)),
            KeyCode::F11 => Some(Key::F(11)),
            KeyCode::F12 => Some(Key::F(12)),
            _ => None,
        },
        _ => None,
    }
}

pub fn winit_modifiers_to_tide(modifiers: ModifiersState) -> Modifiers {
    Modifiers {
        shift: modifiers.shift_key(),
        ctrl: modifiers.control_key(),
        alt: modifiers.alt_key(),
        meta: modifiers.super_key(),
    }
}
