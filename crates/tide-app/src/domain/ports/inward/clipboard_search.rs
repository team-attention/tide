// ClipboardSearchPort — clipboard operations and completion.
// Source: domain/action/search.rs

use tide_core::PaneId;

pub(crate) trait ClipboardSearchPort {
    fn handle_paste(&mut self);
    fn handle_copy(&mut self);
    fn handle_find(&mut self);
    fn dismiss_completion(&mut self, pane_id: PaneId);
    fn accept_completion(&mut self, pane_id: PaneId);
}
