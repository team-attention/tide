// ClipboardSearchPort — clipboard operations and completion.
// Source: domain/action/search.rs

use crate::tide_core::PaneId;

pub(crate) trait ClipboardSearchPort {
    fn handle_paste(&mut self);
    fn handle_copy(&mut self);
    fn handle_find(&mut self);
    fn dismiss_completion(&mut self, pane_id: PaneId);
    fn accept_completion(&mut self, pane_id: PaneId);
    fn trigger_completion_explicit(&mut self, pane_id: PaneId);
    fn clipboard_set_text(&self, text: &str) -> Result<(), String>;
    fn clipboard_get_text(&self) -> Result<String, String>;
}
