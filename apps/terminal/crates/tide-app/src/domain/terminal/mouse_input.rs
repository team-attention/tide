// Mouse event to byte conversion for Terminal mouse reporting.
//
// Supports normal click reporting (1000), drag reporting (1002), any-motion
// reporting (1003), and SGR mouse coordinates (1006).

use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::term::TermMode;

use crate::tide_core::{Modifiers, MouseButton};

use super::Terminal;

/// Legacy X10 mouse encoding caps each coordinate at 223 (255 - 32 offset).
const X10_COORD_MAX: u16 = 223;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MouseReportKind {
    Press,
    Release,
    Drag,
    Move,
}

impl Terminal {
    /// Convert a mouse button press into bytes for terminal mouse reporting.
    pub fn mouse_press_to_bytes(
        &self,
        button: MouseButton,
        modifiers: &Modifiers,
        col: u16,
        row: u16,
    ) -> Option<Vec<u8>> {
        self.mouse_report_to_bytes(MouseReportKind::Press, Some(button), modifiers, col, row)
    }

    /// Convert a mouse button release into bytes for terminal mouse reporting.
    pub fn mouse_release_to_bytes(
        &self,
        button: MouseButton,
        modifiers: &Modifiers,
        col: u16,
        row: u16,
    ) -> Option<Vec<u8>> {
        self.mouse_report_to_bytes(MouseReportKind::Release, Some(button), modifiers, col, row)
    }

    /// Convert a mouse drag into bytes for terminal mouse reporting.
    pub fn mouse_drag_to_bytes(
        &self,
        button: MouseButton,
        modifiers: &Modifiers,
        col: u16,
        row: u16,
    ) -> Option<Vec<u8>> {
        self.mouse_report_to_bytes(MouseReportKind::Drag, Some(button), modifiers, col, row)
    }

    /// Convert buttonless pointer motion into bytes for any-motion reporting.
    pub fn mouse_move_to_bytes(&self, modifiers: &Modifiers, col: u16, row: u16) -> Option<Vec<u8>> {
        self.mouse_report_to_bytes(MouseReportKind::Move, None, modifiers, col, row)
    }

    fn mouse_report_to_bytes(
        &self,
        kind: MouseReportKind,
        button: Option<MouseButton>,
        modifiers: &Modifiers,
        col: u16,
        row: u16,
    ) -> Option<Vec<u8>> {
        let term = self.term.lock();
        let mode = term.mode();

        if !mode.intersects(TermMode::MOUSE_MODE) {
            return None;
        }
        if matches!(kind, MouseReportKind::Drag)
            && !(mode.contains(TermMode::MOUSE_DRAG) || mode.contains(TermMode::MOUSE_MOTION))
        {
            return None;
        }
        if matches!(kind, MouseReportKind::Move) && !mode.contains(TermMode::MOUSE_MOTION) {
            return None;
        }

        let cols = term.grid().columns() as u16;
        let rows = term.grid().screen_lines() as u16;
        let x = col.min(cols.saturating_sub(1)) + 1;
        let y = row.min(rows.saturating_sub(1)) + 1;
        let sgr = mode.contains(TermMode::SGR_MOUSE);
        drop(term);

        let mut code = match kind {
            MouseReportKind::Press => mouse_button_code(button?)?,
            MouseReportKind::Release if sgr => mouse_button_code(button?)?,
            MouseReportKind::Release => 3,
            MouseReportKind::Drag => 32 + mouse_button_code(button?)?,
            MouseReportKind::Move => 35,
        };
        code += mouse_modifier_bits(modifiers);

        if sgr {
            let suffix = if matches!(kind, MouseReportKind::Release) {
                'm'
            } else {
                'M'
            };
            Some(format!("\x1b[<{code};{x};{y}{suffix}").into_bytes())
        } else {
            let cb = (code + 32) as u8;
            let cx = (x.min(X10_COORD_MAX) + 32) as u8;
            let cy = (y.min(X10_COORD_MAX) + 32) as u8;
            Some(vec![0x1b, b'[', b'M', cb, cx, cy])
        }
    }
}

fn mouse_button_code(button: MouseButton) -> Option<u16> {
    match button {
        MouseButton::Left => Some(0),
        MouseButton::Middle => Some(1),
        MouseButton::Right => Some(2),
    }
}

fn mouse_modifier_bits(modifiers: &Modifiers) -> u16 {
    let mut bits = 0;
    if modifiers.shift {
        bits += 4;
    }
    if modifiers.alt {
        bits += 8;
    }
    if modifiers.ctrl {
        bits += 16;
    }
    bits
}
