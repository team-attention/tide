// InputStatePort — input timing, cursor position, and interaction state.

use crate::tide_core::{Modifiers, Vec2};
use crate::state::InteractionState;

pub(crate) trait InputStatePort {
    fn last_cursor_pos(&self) -> Vec2;
    fn set_last_cursor_pos(&mut self, pos: Vec2);
    fn modifiers(&self) -> Modifiers;
    fn set_modifiers(&mut self, mods: Modifiers);
    fn mark_scroll_activity(&mut self);
    fn interaction(&self) -> &InteractionState;
    fn interaction_mut(&mut self) -> &mut InteractionState;

    // ── Batch depth (event coalescing) ──
    fn batch_depth(&self) -> u32;
    fn increment_batch_depth(&mut self);
    fn decrement_batch_depth(&mut self);

    // ── Shift double-tap detection ──
    fn shift_tap_clean(&self) -> bool;
    fn set_shift_tap_clean(&mut self, clean: bool);
    fn last_shift_up(&self) -> Option<std::time::Instant>;
    fn set_last_shift_up(&mut self, at: Option<std::time::Instant>);
}
