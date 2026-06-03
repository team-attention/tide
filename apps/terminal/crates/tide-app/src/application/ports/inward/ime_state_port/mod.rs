// ImeStatePort — IME composition state management.

use crate::tide_core::PaneId;

pub(crate) trait ImeStatePort {
    fn ime_clear_composition(&mut self);
    fn ime_set_preedit(&mut self, text: &str);
    fn effective_ime_target(&self) -> Option<PaneId>;
    fn send_text_to_target(&mut self, text: &str);
    fn set_ime_cursor_dirty(&mut self);

    /// Reset cursor blink phase to visible (called after user input).
    fn reset_cursor_blink(&mut self);

    /// Drain pending IME proxy creates/removes queues.
    fn drain_pending_creates(&mut self) -> Vec<PaneId>;
    fn drain_pending_removes(&mut self) -> Vec<PaneId>;

    /// IME composition state for target switching.
    fn ime_last_target(&self) -> Option<PaneId>;
    fn set_ime_last_target(&mut self, target: Option<PaneId>);
    fn ime_preedit(&self) -> &str;
    fn ime_composing(&self) -> bool;
    fn clear_ime_preedit(&mut self);
    fn set_ime_composing(&mut self, composing: bool);
}
