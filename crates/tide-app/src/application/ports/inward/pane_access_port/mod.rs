// PaneAccessPort — read/write access to individual panes.

use crate::tide_core::PaneId;
use crate::pane::PaneKind;

pub(crate) trait PaneAccessPort {
    fn pane(&self, id: PaneId) -> Option<&PaneKind>;
    fn pane_mut(&mut self, id: PaneId) -> Option<&mut PaneKind>;
    fn has_pane(&self, id: PaneId) -> bool;
    fn pane_entries(&self) -> Vec<(PaneId, &PaneKind)>;
    fn pane_title(&self, id: PaneId) -> String;
    fn clear_all_selections(&mut self);

    /// Check if there are running terminals among all panes.
    fn has_terminals(&self) -> bool;

    /// Check if there are dirty editors (modified with a file path) among all panes.
    fn has_dirty_editors(&self) -> bool;

    /// Reset browser pane first-responder flags (used on window focus gain).
    fn reset_browser_first_responder_flags(&mut self);
}
