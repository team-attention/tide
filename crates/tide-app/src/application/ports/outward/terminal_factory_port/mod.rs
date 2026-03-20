// TerminalFactoryPort — PTY creation and terminal pane construction.

use std::path::Path;
use crate::tide_core::PaneId;
use crate::pane::TerminalPane;

type BoxErr = Box<dyn std::error::Error>;

pub(crate) trait TerminalFactoryPort {
    fn create_terminal(&self, id: PaneId, cols: u16, rows: u16, cwd: Option<&Path>, dark_mode: bool) -> Result<TerminalPane, BoxErr>;
    fn pre_spawn_terminal(&self, cols: u16, rows: u16, dark_mode: bool) -> Result<crate::tide_terminal::Terminal, BoxErr>;
}
