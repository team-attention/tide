// PaneAssociations — terminal ↔ pane associations.

use crate::tide_core::PaneId;
use std::collections::HashMap;

pub(crate) struct PaneAssociations {
    pub associated_terminal: HashMap<PaneId, PaneId>,
    pub retained_contexts: HashMap<PaneId, crate::pane::TerminalContext>,
    pub pending_terminal_close: Option<PaneId>,
}

impl PaneAssociations {
    pub fn new() -> Self {
        Self {
            associated_terminal: HashMap::new(),
            retained_contexts: HashMap::new(),
            pending_terminal_close: None,
        }
    }
}
