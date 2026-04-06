// ActionPort — global action dispatch and input routing.
// Source: domain/action/mod.rs

use crate::tide_core::{InputEvent, SplitDirection};
use crate::tide_input::{Action, GlobalAction};

pub(crate) trait ActionPort {
    fn handle_action(&mut self, action: Action, event: Option<InputEvent>);
    fn handle_global_action(&mut self, action: GlobalAction);
    fn open_focused_browser_externally(&mut self);
    fn open_context_comment_composer(&mut self, source_pane_id: crate::tide_core::PaneId);
    fn submit_context_comment_composer(&mut self) -> bool;
    fn split_pane(&mut self, direction: SplitDirection, cwd: Option<std::path::PathBuf>);
    fn split_pane_from(&mut self, source: crate::tide_core::PaneId, direction: SplitDirection, cwd: Option<std::path::PathBuf>) -> Option<crate::tide_core::PaneId>;
    fn cleanup_retained_context(&mut self, closed_pane_id: crate::tide_core::PaneId);
    fn exit_app(&self);
}
